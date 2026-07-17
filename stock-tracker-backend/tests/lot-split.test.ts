import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const DISPLAY_LOTS_API_PATH = '/api/display-lots'
const TEST_USER_ID = 'test-lot-split-user'

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

describe('Display Lot split', () => {
  async function seedSingleDisplayLot() {
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

    // Get purchase lot
    const pool = getPool()
    const lotResult = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .query('SELECT id FROM PurchaseLots WHERE userId = @userId AND ticker = @ticker')

    expect(lotResult.recordset).toHaveLength(1)
    const purchaseLotId = lotResult.recordset[0].id

    // Create a display lot from the purchase lot
    const displayLotResponse = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId, quantityAllocated: 3 }]
      })
      .expect(201)

    return displayLotResponse.body.id
  }

  it('splits a 3-share display lot into 2 and 1', async () => {
    const displayLotId = await seedSingleDisplayLot()

    await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ splits: [{ quantityAllocated: 2 }, { quantityAllocated: 1 }] })
      .expect(201)

    const displayLotsAfter = await request(server)
      .get(`${DISPLAY_LOTS_API_PATH}/ticker/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(displayLotsAfter.body).toHaveLength(2)
    const quantities = displayLotsAfter.body.map((lot: any) => Number(lot.totalQuantity)).sort((a: number, b: number) => a - b)
    expect(quantities).toEqual([1, 2])
  })

  it('splits a 3-share display lot into 1, 1, and 1', async () => {
    const displayLotId = await seedSingleDisplayLot()

    await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ splits: [{ quantityAllocated: 1 }, { quantityAllocated: 1 }, { quantityAllocated: 1 }] })
      .expect(201)

    const displayLotsAfter = await request(server)
      .get(`${DISPLAY_LOTS_API_PATH}/ticker/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(displayLotsAfter.body).toHaveLength(3)
    const quantities = displayLotsAfter.body.map((lot: any) => Number(lot.totalQuantity)).sort((a: number, b: number) => a - b)
    expect(quantities).toEqual([1, 1, 1])
  })

  it('rejects split when quantities do not sum to display lot total', async () => {
    const displayLotId = await seedSingleDisplayLot()

    const response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ splits: [{ quantityAllocated: 2 }, { quantityAllocated: 0.5 }] })
      .expect(400)

    expect(String(response.body.error || '')).toContain('do not match display lot total')
  })
})
