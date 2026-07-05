import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const TEST_USER_ID = 'test-cash-summary-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM CashTransactions WHERE userId = @userId')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Cash Transaction Test', () => {
  it('tracks available cash and cost basis through deposits, withdrawals, interest and fees', async () => {
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
      .expect(201)

    let summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(1000, 2)

    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'withdrawal', amount: 200, transactionDate: '2026-01-15' })
      .expect(201)

    summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(800, 2)

    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'interest', amount: 50, transactionDate: '2026-01-31' })
      .expect(201)

    summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(850, 2)

    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'fee', amount: 10, transactionDate: '2026-02-01' })
      .expect(201)

    summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    expect(summary.body.availableCash).toBeCloseTo(840, 2)
    expect(summary.body.costBasis).toBeCloseTo(800, 2)
  })
})
