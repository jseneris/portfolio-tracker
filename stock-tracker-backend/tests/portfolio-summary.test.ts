import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const TEST_USER_ID = 'test-portfolio-summary-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM SplitAdjustments WHERE userId = @userId')
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

describe('Portfolio Summary API', () => {
  it('returns cash summary and stock list details from a single endpoint call', async () => {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
      .expect(201)

    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'interest', amount: 10, transactionDate: '2026-01-05' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 3, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'MSFT', type: 'buy', quantity: 1, price: 200, transactionDate: '2026-02-10' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'sell', quantity: 1, price: 120, transactionDate: '2026-03-01', allocations: [] })
      .expect(400)

    const lots = await request(server)
      .get('/api/lots/AAPL')
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        ticker: 'AAPL',
        type: 'sell',
        quantity: 1,
        price: 120,
        transactionDate: '2026-03-01',
        allocations: [{ lotId: lots.body[0].id, quantity: 1 }]
      })
      .expect(201)

    const response = await request(server)
      .get(`${STOCKS_API_PATH}/portfolio/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(response.body.availableCash).toBeCloseTo(630, 2)
    expect(response.body.cashBasis).toBeCloseTo(1000, 2)
    expect(response.body.totalStockCostBasis).toBeCloseTo(400, 2)
    expect(response.body.stockCount).toBe(2)
    expect(Array.isArray(response.body.stocks)).toBe(true)

    const aapl = response.body.stocks.find((s: any) => s.ticker === 'AAPL')
    const msft = response.body.stocks.find((s: any) => s.ticker === 'MSFT')

    expect(aapl).toMatchObject({ totalShares: 2, lotCount: 1 })
    expect(aapl.costBasis).toBeCloseTo(200, 2)
    expect(msft).toMatchObject({ totalShares: 1, lotCount: 1 })
    expect(msft.costBasis).toBeCloseTo(200, 2)
  })
})
