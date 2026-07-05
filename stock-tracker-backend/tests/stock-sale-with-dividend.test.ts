import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-stock-sale-with-dividend-user'

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

describe('Stock Sale with Dividend Test', () => {
  it('sells across purchase lots while leaving the dividend lot untouched', async () => {
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

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'div', quantity: 0.1, price: 100, transactionDate: '2026-04-01' })
      .expect(201)

    const purchaseLotsBeforeSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL?sourceType=purchase`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(purchaseLotsBeforeSale.body).toHaveLength(2)

    const febLot = purchaseLotsBeforeSale.body.find((lot: any) => lot.originalQuantity === 3)
    const marLot = purchaseLotsBeforeSale.body.find((lot: any) => lot.originalQuantity === 2)
    expect(febLot).toBeTruthy()
    expect(marLot).toBeTruthy()

    // Sell 4 shares: fully consume the 3/1 lot (2 shares) and partially consume the 2/1 lot (2 of 3 shares)
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        ticker: 'AAPL',
        type: 'sell',
        quantity: 4,
        price: 110,
        transactionDate: '2026-05-01',
        allocations: [
          { lotId: marLot.id, quantity: 2 },
          { lotId: febLot.id, quantity: 2 },
        ],
      })
      .expect(201)

    const summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(840, 2)

    const purchaseLotsAfterSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL?sourceType=purchase`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(purchaseLotsAfterSale.body).toHaveLength(1)
    expect(purchaseLotsAfterSale.body[0]).toMatchObject({ originalQuantity: 3, remainingQuantity: 1 })

    const tickerSummary = await request(server)
      .get(`${STOCKS_API_PATH}/AAPL/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(tickerSummary.body.totalShares).toBeCloseTo(1.1, 4)
  })
})
