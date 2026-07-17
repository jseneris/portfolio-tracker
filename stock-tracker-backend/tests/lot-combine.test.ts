import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const DISPLAY_LOTS_API_PATH = '/api/display-lots'
const TEST_USER_ID = 'test-lot-combine-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM DisplayLotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM DisplayLots WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM PurchaseLots WHERE userId = @userId')
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

describe('Display Lot combine', () => {
  async function seedTwoDisplayLots() {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    // Buy 2 shares to create 2 purchase lots
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

    // Get purchase lots
    const pool = getPool()
    const lotsResult = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .query('SELECT id FROM PurchaseLots WHERE userId = @userId AND ticker = @ticker ORDER BY purchaseDate ASC')

    const purchaseLots = lotsResult.recordset
    expect(purchaseLots).toHaveLength(2)

    // Create 2 display lots from the purchase lots
    const displayLot1Response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLots[0].id, quantityAllocated: 1 }]
      })
      .expect(201)

    const displayLot2Response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLots[1].id, quantityAllocated: 1 }]
      })
      .expect(201)

    return [displayLot1Response.body.id, displayLot2Response.body.id]
  }

  it('combines two 1-share display lots into a single 2-share lot', async () => {
    const [lot1Id, lot2Id] = await seedTwoDisplayLots()

    await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/${lot1Id}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ displayLotIds: [lot2Id] })
      .expect(201)

    const displayLotsAfter = await request(server)
      .get(`${DISPLAY_LOTS_API_PATH}/ticker/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(displayLotsAfter.body).toHaveLength(1)
    expect(Number(displayLotsAfter.body[0].totalQuantity)).toBe(2)
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

    const pool = getPool()
    const aaplLots = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .query('SELECT id FROM PurchaseLots WHERE userId = @userId AND ticker = @ticker')

    const msftLots = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'MSFT')
      .query('SELECT id FROM PurchaseLots WHERE userId = @userId AND ticker = @ticker')

    // Create display lots for each ticker
    const aaplDisplayLot = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: aaplLots.recordset[0].id, quantityAllocated: 1 }]
      })
      .expect(201)

    const msftDisplayLot = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/MSFT`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: msftLots.recordset[0].id, quantityAllocated: 1 }]
      })
      .expect(201)

    const response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/${aaplDisplayLot.body.id}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ displayLotIds: [msftDisplayLot.body.id] })
      .expect(400)

    expect(String(response.body.error || '')).toContain('Cannot combine display lots for different tickers')
  })
})
