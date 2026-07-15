import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-stock-non-lifo-sale-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM Lots WHERE userId = @userId')

  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM PurchaseLotAllocations WHERE userId = @userId')
 await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM PurchaseLots WHERE userId = @userId')


  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM StockTransactions WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM CashTransactions WHERE userId = @userId')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Stock sale lot consolidation with user-directed purchase attribution', () => {
  it('consumes open lots smallest-to-largest while preserving user-directed buy attribution as 2 and 1', async () => {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
      .expect(201)

    const buyOne = await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 2, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    const buyTwo = await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 3, price: 100, transactionDate: '2026-03-01' })
      .expect(201)

    const lotsBeforeSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(lotsBeforeSale.body).toHaveLength(2)
    const febLot = lotsBeforeSale.body.find((lot: any) => lot.originalQuantity === 2)
    const marLot = lotsBeforeSale.body.find((lot: any) => lot.originalQuantity === 3)
    expect(febLot).toBeTruthy()
    expect(marLot).toBeTruthy()

    // User allocates the sale to the newer purchase transaction.
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        ticker: 'AAPL',
        type: 'sell',
        quantity: 2,
        price: 110,
        transactionDate: '2026-04-01',
        allocations: [{ lotId: marLot.id, quantity: 2 }],
      })
      .expect(201)

    const lotsAfterSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    // Open-lot view reflects lot consolidation after smallest-first lot consumption.
    expect(lotsAfterSale.body).toHaveLength(1)
    expect(Number(lotsAfterSale.body[0].remainingQuantity)).toBe(3)

    const tickerSummary = await request(server)
      .get(`${STOCKS_API_PATH}/AAPL/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(Number(tickerSummary.body.numberOfLots)).toBe(1)
    expect(Number(tickerSummary.body.totalShares)).toBe(3)

    const allLots = await request(server)
      .get('/api/lots')
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    // Purchase attribution reflects user-directed allocation: first buy keeps 2, second keeps 1.
const remainingByBuyTx = allLots.body
  .filter((lot: any) =>
    String(lot.transactionId).toLowerCase() === String(buyOne.body.id).toLowerCase() ||
    String(lot.transactionId).toLowerCase() === String(buyTwo.body.id).toLowerCase()
  )
  .reduce((acc: Record<string, number>, lot: any) => {
    const txId = String(lot.transactionId).toLowerCase()
    acc[txId] = (acc[txId] ?? 0) + Number(lot.remainingQuantity)
    return acc
  }, {})

expect(Number(remainingByBuyTx[String(buyOne.body.id).toLowerCase()] ?? 0)).toBe(2)
expect(Number(remainingByBuyTx[String(buyTwo.body.id).toLowerCase()] ?? 0)).toBe(1)
  })
})
