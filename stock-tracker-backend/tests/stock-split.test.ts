import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-stock-split-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM StockSplits WHERE userId = @userId')
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

describe('Stock Split Test', () => {
  it('applies a 2-for-1 split retroactively while preserving cost basis and flagging affected records', async () => {
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

    const summaryBeforeSplit = await request(server)
      .get(`${STOCKS_API_PATH}/AAPL/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    const costBasisBeforeSplit = summaryBeforeSplit.body.costBasis

    // Split date of 2/10 falls after the 2/1 buy but before the 3/1 buy, so only the 2/1 lot is affected
    await request(server)
      .post(`${LOTS_API_PATH}/ticker/AAPL/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ ratioNumerator: 2, ratioDenominator: 1, splitDate: '2026-02-10' })
      .expect(200)

    const lotsAfterSplit = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(lotsAfterSplit.body).toHaveLength(2)
    const quantities = lotsAfterSplit.body.map((lot: any) => lot.remainingQuantity).sort((a: number, b: number) => a - b)
    expect(quantities).toEqual([2, 6])

    const summaryAfterSplit = await request(server)
      .get(`${STOCKS_API_PATH}/AAPL/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summaryAfterSplit.body.costBasis).toBeCloseTo(costBasisBeforeSplit, 2)

    const splitLot = lotsAfterSplit.body.find((lot: any) => lot.remainingQuantity === 6)
    const untouchedLot = lotsAfterSplit.body.find((lot: any) => lot.remainingQuantity === 2)
    expect(splitLot.splitAdjusted).toBeTruthy()
    expect(splitLot.lastSplitId).toBeTruthy()
    expect(splitLot.unitCost).toBeCloseTo(50, 2)
    expect(untouchedLot.splitAdjusted).toBeFalsy()
    expect(untouchedLot.unitCost).toBeCloseTo(100, 2)

    const transactions = await request(server)
      .get(`${STOCKS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const febTransaction = transactions.body.find((tx: any) => tx.quantity === 6)
    const marTransaction = transactions.body.find((tx: any) => tx.quantity === 2)
    expect(febTransaction.splitAdjusted).toBeTruthy()
    expect(marTransaction.splitAdjusted).toBeFalsy()
  })
})
