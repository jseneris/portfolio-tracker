import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-stock-dividend-user'

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

describe('Stock Dividend Test', () => {
  it('applies a reinvested dividend without disturbing existing purchase lots', async () => {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 3, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 2, price: 100, transactionDate: '2026-03-01' })
      .expect(201)

    const cashBefore = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'div', quantity: 0.1, price: 100, transactionDate: '2026-04-01' })
      .expect(201)

    // Dividends are reinvested only - available cash is unaffected
    const cashAfter = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(cashAfter.body.availableCash).toBeCloseTo(cashBefore.body.availableCash, 2)

    const purchaseLots = await request(server)
      .get(`${LOTS_API_PATH}/AAPL?sourceType=purchase`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(purchaseLots.body).toHaveLength(2)
    const quantities = purchaseLots.body.map((lot: any) => lot.remainingQuantity).sort((a: number, b: number) => a - b)
    expect(quantities).toEqual([2, 3])

    const dividendLots = await request(server)
      .get(`${LOTS_API_PATH}/AAPL?sourceType=dividend`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(dividendLots.body).toHaveLength(1)
    expect(dividendLots.body[0]).toMatchObject({ originalQuantity: 0.1, remainingQuantity: 0.1, unitCost: 100 })
  })
})
