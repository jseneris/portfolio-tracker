import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-lot-combine-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM Lots WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM StockTransactions WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM CashTransactions WHERE userId = @userId')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Lot combine', () => {
  async function seedTwoOneShareLots() {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 1, price: 100, transactionDate: '2026-01-10' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 1, price: 100, transactionDate: '2026-01-11' })
      .expect(201)

    const lotsResponse = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(lotsResponse.body).toHaveLength(2)
    return lotsResponse.body
  }

  it('combines two 1-share lots into a single 2-share lot', async () => {
    const lots = await seedTwoOneShareLots()

    await request(server)
      .post(`${LOTS_API_PATH}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ lotIds: [lots[0].id, lots[1].id] })
      .expect(201)

    const openLotsAfter = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(openLotsAfter.body).toHaveLength(1)
    expect(Number(openLotsAfter.body[0].remainingQuantity)).toBe(2)

    const tickerSummary = await request(server)
      .get(`${STOCKS_API_PATH}/AAPL/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(Number(tickerSummary.body.numberOfLots)).toBe(1)
  })

  it('rejects combine across different tickers', async () => {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 1, price: 100, transactionDate: '2026-01-10' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'MSFT', type: 'buy', quantity: 1, price: 100, transactionDate: '2026-01-11' })
      .expect(201)

    const aaplLots = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const msftLots = await request(server)
      .get(`${LOTS_API_PATH}/MSFT`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const response = await request(server)
      .post(`${LOTS_API_PATH}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ lotIds: [aaplLots.body[0].id, msftLots.body[0].id] })
      .expect(400)

    expect(String(response.body.error || '')).toContain('same ticker')
  })
})
