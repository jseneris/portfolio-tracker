import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const STOCKS_API_PATH = '/api/stocks'
const CASH_API_PATH = '/api/cash'
const LOTS_API_PATH = '/api/lots'
const TEST_USER_ID = 'test-dividend-debug'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  
  // Clean up
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM PurchaseLotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
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

describe('Dividend Debug Test', () => {
  it('should create a simple buy transaction', async () => {
    // Deposit cash
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    // Buy stock
    const buyResponse = await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    console.log('Buy response:', buyResponse.body)
    expect(buyResponse.body.ticker).toBe('AAPL')
    expect(buyResponse.body.type).toBe('buy')
  })

  it('should create a dividend transaction', async () => {
    // Deposit cash first
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    // Buy stock
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    // Create dividend - this should work
    const dividendResponse = await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        ticker: 'AAPL',
        type: 'dividend',
        quantity: 5,
        price: 10,
        transactionDate: '2026-03-01'
      })

    console.log('Dividend response status:', dividendResponse.status)
    console.log('Dividend response:', dividendResponse.body)

    if (dividendResponse.status !== 201) {
      console.log('ERROR: Dividend creation failed with status', dividendResponse.status)
      console.log('Response body:', dividendResponse.body)
    }

    expect(dividendResponse.status).toBe(201)
    expect(dividendResponse.body.type).toBe('dividend')
  })
})
