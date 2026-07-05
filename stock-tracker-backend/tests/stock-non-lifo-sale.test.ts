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
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM StockTransactions WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM CashTransactions WHERE userId = @userId')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Stock non-LIFO sale lot Test', () => {
  it('allows the user to allocate a sale against the newer lot, leaving the older lot untouched', async () => {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 2, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 3, price: 100, transactionDate: '2026-03-01' })
      .expect(201)

    const lotsBeforeSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const febLot = lotsBeforeSale.body.find((lot: any) => lot.originalQuantity === 2)
    const marLot = lotsBeforeSale.body.find((lot: any) => lot.originalQuantity === 3)
    expect(febLot).toBeTruthy()
    expect(marLot).toBeTruthy()

    // User explicitly allocates the sale to the newer (3/1) lot instead of the older (2/1) lot
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

    const summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(720, 2)

    const lotsAfterSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(lotsAfterSale.body).toHaveLength(1)
    expect(lotsAfterSale.body[0]).toMatchObject({ originalQuantity: 3, remainingQuantity: 1 })

    const allLots = await request(server)
      .get('/api/lots')
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const febLotAfter = allLots.body.find((lot: any) => lot.id === febLot.id)
    const marLotAfterSale = allLots.body.find((lot: any) => lot.id === marLot.id)
    expect(febLotAfter.remainingQuantity).toBe(2)
    expect(marLotAfterSale.remainingQuantity).toBe(1)
  })
})
