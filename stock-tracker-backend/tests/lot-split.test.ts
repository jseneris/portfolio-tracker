import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-lot-split-user'

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

describe('Lot split', () => {
  async function seedSingleThreeShareLot() {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 3, price: 100, transactionDate: '2026-01-10' })
      .expect(201)

    const lotsResponse = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(lotsResponse.body).toHaveLength(1)
    return lotsResponse.body[0]
  }

  it('splits a 3-share lot into 2 and 1', async () => {
    const lot = await seedSingleThreeShareLot()

    await request(server)
      .post(`${LOTS_API_PATH}/lot/${lot.id}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ quantities: [2, 1] })
      .expect(201)

    const openLotsAfter = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(openLotsAfter.body).toHaveLength(2)
    const remaining = openLotsAfter.body.map((entry: any) => Number(entry.remainingQuantity)).sort((a: number, b: number) => a - b)
    expect(remaining).toEqual([1, 2])
  })

  it('splits a 3-share lot into 1, 1, and 1', async () => {
    const lot = await seedSingleThreeShareLot()

    await request(server)
      .post(`${LOTS_API_PATH}/lot/${lot.id}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ quantities: [1, 1, 1] })
      .expect(201)

    const openLotsAfter = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(openLotsAfter.body).toHaveLength(3)
    const remaining = openLotsAfter.body.map((entry: any) => Number(entry.remainingQuantity)).sort((a: number, b: number) => a - b)
    expect(remaining).toEqual([1, 1, 1])
  })

  it('rejects split when quantities do not sum to remaining quantity', async () => {
    const lot = await seedSingleThreeShareLot()

    const response = await request(server)
      .post(`${LOTS_API_PATH}/lot/${lot.id}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ quantities: [2, 0.5] })
      .expect(400)

    expect(String(response.body.error || '')).toContain('must equal lot remaining quantity')
  })
})
