import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-stock-sale-after-split-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()

  // Remove direct user-owned rows first.
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM SplitAdjustments WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM Lots WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM StockTransactions WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM CashTransactions WHERE userId = @userId')

  // Split rows are now global by ticker, so clear ticker-scoped leftovers in FK-safe order.
  await pool.request()
    .input('ticker', sql.NVarChar, 'AAPL')
    .query(`
      DELETE la
      FROM LotAllocations la
      JOIN StockTransactions st ON la.saleTransactionId = st.id
      WHERE st.ticker = @ticker
    `)
  await pool.request().input('ticker', sql.NVarChar, 'AAPL').query('DELETE FROM Lots WHERE ticker = @ticker')
  await pool.request().input('ticker', sql.NVarChar, 'AAPL').query('DELETE FROM StockTransactions WHERE ticker = @ticker')
  await pool.request()
    .input('ticker', sql.NVarChar, 'AAPL')
    .query(`
      DELETE FROM SplitAdjustments
      WHERE splitId IN (SELECT id FROM StockSplits WHERE ticker = @ticker)
    `)
  await pool.request().input('ticker', sql.NVarChar, 'AAPL').query('DELETE FROM StockSplits WHERE ticker = @ticker')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Stock Sale After Split Test', () => {
  it('sells split-adjusted shares against the correct lots', async () => {
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

    // Split date of 2/10 falls after the 2/1 buy but before the 3/1 buy
    await request(server)
      .post(`${LOTS_API_PATH}/ticker/AAPL/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ ratioNumerator: 5, ratioDenominator: 3, splitDate: '2026-02-10' })
      .expect(200)

    const lotsAfterSplit = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const splitLot = lotsAfterSplit.body.find((lot: any) => Boolean(lot.splitAdjusted))
    const unsplitLot = lotsAfterSplit.body.find((lot: any) => !Boolean(lot.splitAdjusted))
    expect(splitLot).toBeTruthy()
    expect(unsplitLot).toBeTruthy()
    expect(Number(splitLot.originalQuantity)).toBeCloseTo(5, 6)
    expect(Number(splitLot.remainingQuantity)).toBeCloseTo(5, 6)
    expect(Number(unsplitLot.originalQuantity)).toBeCloseTo(2, 6)
    expect(Number(unsplitLot.remainingQuantity)).toBeCloseTo(2, 6)

    // Sell 4 shares: 2 shares from each lot
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
          { lotId: splitLot.id, quantity: 2 },
          { lotId: unsplitLot.id, quantity: 2 },
        ],
      })
      .expect(201)

    const summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(940, 2)

    const lotsAfterSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(lotsAfterSale.body).toHaveLength(1)
    expect(lotsAfterSale.body[0].id).toBe(splitLot.id)
    expect(Number(lotsAfterSale.body[0].originalQuantity)).toBeCloseTo(5, 6)
    expect(Number(lotsAfterSale.body[0].remainingQuantity)).toBeCloseTo(3, 6)

    const allLotsAfterSale = await request(server)
      .get('/api/lots')
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const splitLotAfterSale = allLotsAfterSale.body.find((lot: any) => lot.id === splitLot.id)
    const unsplitLotAfterSale = allLotsAfterSale.body.find((lot: any) => lot.id === unsplitLot.id)
    expect(splitLotAfterSale).toBeTruthy()
    expect(unsplitLotAfterSale).toBeTruthy()
    expect(Number(splitLotAfterSale.originalQuantity)).toBeCloseTo(5, 6)
    expect(Number(splitLotAfterSale.remainingQuantity)).toBeCloseTo(3, 6)
    expect(Number(unsplitLotAfterSale.originalQuantity)).toBeCloseTo(2, 6)
    expect(Number(unsplitLotAfterSale.remainingQuantity)).toBeCloseTo(0, 6)
  })
})
