import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const USER_A = 'test-global-split-user-a'
const USER_B = 'test-global-split-user-b'
const TICKER = 'GLBL'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()

  // First clear per-user portfolio data.
  for (const userId of [USER_A, USER_B]) {
    await pool.request().input('userId', sql.NVarChar, userId).query('DELETE FROM LotAllocations WHERE userId = @userId')
    await pool.request().input('userId', sql.NVarChar, userId).query('DELETE FROM SplitAdjustments WHERE userId = @userId')
    await pool.request().input('userId', sql.NVarChar, userId).query('DELETE FROM Lots WHERE userId = @userId')
    await pool.request().input('userId', sql.NVarChar, userId).query('DELETE FROM StockTransactions WHERE userId = @userId')
    await pool.request().input('userId', sql.NVarChar, userId).query('DELETE FROM CashTransactions WHERE userId = @userId')
  }

  // Then clear any ticker-scoped leftovers globally (from interrupted/previous runs).
  await pool.request()
    .input('ticker', sql.NVarChar, TICKER)
    .query(`
      DELETE la
      FROM LotAllocations la
      JOIN StockTransactions st ON la.saleTransactionId = st.id
      WHERE st.ticker = @ticker
    `)

  await pool.request().input('ticker', sql.NVarChar, TICKER).query('DELETE FROM Lots WHERE ticker = @ticker')
  await pool.request().input('ticker', sql.NVarChar, TICKER).query('DELETE FROM StockTransactions WHERE ticker = @ticker')

  // Remove split audit rows before deleting split records.
  await pool.request()
    .input('ticker', sql.NVarChar, TICKER)
    .query(`
      DELETE FROM SplitAdjustments
      WHERE splitId IN (SELECT id FROM StockSplits WHERE ticker = @ticker)
    `)

  // Delete parent rows last.
  await pool.request().input('ticker', sql.NVarChar, TICKER).query('DELETE FROM StockSplits WHERE ticker = @ticker')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Global and Sequential Stock Splits', () => {
  it('applies a split across all users who hold the ticker', async () => {
    for (const userId of [USER_A, USER_B]) {
      await request(server)
        .post(CASH_API_PATH)
        .set('x-user-id', userId)
        .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
        .expect(201)

      await request(server)
        .post(STOCKS_API_PATH)
        .set('x-user-id', userId)
        .send({ ticker: TICKER, type: 'buy', quantity: 3, price: 100, transactionDate: '2026-02-01' })
        .expect(201)
    }

    await request(server)
      .post(`${LOTS_API_PATH}/ticker/${TICKER}/split`)
      .set('x-user-id', USER_A)
      .send({ ratioNumerator: 2, ratioDenominator: 1, splitDate: '2026-02-10' })
      .expect(200)

    const lotsA = await request(server)
      .get(`${LOTS_API_PATH}/${TICKER}`)
      .set('x-user-id', USER_A)
      .expect(200)

    const lotsB = await request(server)
      .get(`${LOTS_API_PATH}/${TICKER}`)
      .set('x-user-id', USER_B)
      .expect(200)

    expect(lotsA.body).toHaveLength(1)
    expect(lotsB.body).toHaveLength(1)
    expect(lotsA.body[0].remainingQuantity).toBe(6)
    expect(lotsB.body[0].remainingQuantity).toBe(6)
    expect(lotsA.body[0].unitCost).toBeCloseTo(50, 6)
    expect(lotsB.body[0].unitCost).toBeCloseTo(50, 6)
  })

  it('records sequential splits and preserves per-user audit rows in SplitAdjustments', async () => {
    for (const userId of [USER_A, USER_B]) {
      await request(server)
        .post(CASH_API_PATH)
        .set('x-user-id', userId)
        .send({ type: 'deposit', amount: 1000, transactionDate: '2026-01-01' })
        .expect(201)

      await request(server)
        .post(STOCKS_API_PATH)
        .set('x-user-id', userId)
        .send({ ticker: TICKER, type: 'buy', quantity: 3, price: 100, transactionDate: '2026-02-01' })
        .expect(201)
    }

    await request(server)
      .post(`${LOTS_API_PATH}/ticker/${TICKER}/split`)
      .set('x-user-id', USER_A)
      .send({ ratioNumerator: 2, ratioDenominator: 1, splitDate: '2026-02-10' })
      .expect(200)

    await request(server)
      .post(`${LOTS_API_PATH}/ticker/${TICKER}/split`)
      .set('x-user-id', USER_B)
      .send({ ratioNumerator: 3, ratioDenominator: 2, splitDate: '2026-02-10' })
      .expect(200)

    const lotsA = await request(server)
      .get(`${LOTS_API_PATH}/${TICKER}`)
      .set('x-user-id', USER_A)
      .expect(200)

    const lotsB = await request(server)
      .get(`${LOTS_API_PATH}/${TICKER}`)
      .set('x-user-id', USER_B)
      .expect(200)

    expect(lotsA.body[0].remainingQuantity).toBeCloseTo(9, 6)
    expect(lotsB.body[0].remainingQuantity).toBeCloseTo(9, 6)
    expect(lotsA.body[0].unitCost).toBeCloseTo(100 / 3, 6)
    expect(lotsB.body[0].unitCost).toBeCloseTo(100 / 3, 6)

    const pool = getPool()
    const splitResult = await pool.request()
      .input('ticker', sql.NVarChar, TICKER)
      .query('SELECT id FROM StockSplits WHERE ticker = @ticker ORDER BY splitDate, createdAt')

    expect(splitResult.recordset).toHaveLength(2)

    const splitIds = splitResult.recordset.map((row: any) => row.id)
    const adjustments = await pool.request()
      .input('splitId1', sql.UniqueIdentifier, splitIds[0])
      .input('splitId2', sql.UniqueIdentifier, splitIds[1])
      .query(`
        SELECT splitId, userId, entityType, COUNT(*) AS adjustmentCount
        FROM SplitAdjustments
        WHERE splitId IN (@splitId1, @splitId2)
        GROUP BY splitId, userId, entityType
      `)

    const bySplitUserEntity = new Map<string, number>()
    for (const row of adjustments.recordset) {
      bySplitUserEntity.set(`${row.splitId.toLowerCase()}|${row.userId}|${row.entityType}`, Number(row.adjustmentCount))
    }

    for (const splitId of splitIds) {
      const keyA = `${splitId.toLowerCase()}|${USER_A}|lot`
      const keyB = `${splitId.toLowerCase()}|${USER_B}|lot`
      const txA = `${splitId.toLowerCase()}|${USER_A}|transaction`
      const txB = `${splitId.toLowerCase()}|${USER_B}|transaction`

      expect(bySplitUserEntity.get(keyA)).toBe(1)
      expect(bySplitUserEntity.get(keyB)).toBe(1)
      expect(bySplitUserEntity.get(txA)).toBe(1)
      expect(bySplitUserEntity.get(txB)).toBe(1)
    }
  })
})
