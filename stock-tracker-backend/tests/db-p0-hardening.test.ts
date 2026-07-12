import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { v4 as uuidv4 } from 'uuid'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const TEST_USER_ID = 'test-db-p0-hardening-user'
const TEST_TICKER = 'P0H'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()

  await pool.request()
    .input('ticker', sql.NVarChar, TEST_TICKER)
    .query('DELETE FROM SplitAdjustments WHERE splitId IN (SELECT id FROM StockSplits WHERE ticker = @ticker)')

  await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .query('DELETE FROM LotAllocations WHERE userId = @userId')

  await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .query('DELETE FROM Lots WHERE userId = @userId')

  await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .query('DELETE FROM StockTransactions WHERE userId = @userId')

  await pool.request()
    .input('ticker', sql.NVarChar, TEST_TICKER)
    .query('DELETE FROM StockSplits WHERE ticker = @ticker')

  await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .query('DELETE FROM CashTransactions WHERE userId = @userId')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Database P0 hardening', () => {
  it('creates schema migration tracking table and records P0 migration key', async () => {
    const tableResult = await getPool().request().query(`
      SELECT 1 AS found
      FROM sys.tables
      WHERE name = 'SchemaMigrations'
    `)

    expect(tableResult.recordset).toHaveLength(1)

    const migrationResult = await getPool().request().query(`
      SELECT migrationKey
      FROM SchemaMigrations
      WHERE migrationKey = '2026-07-12-p0-hardening'
    `)

    expect(migrationResult.recordset).toHaveLength(1)
  })

  it('creates required composite, filtered, and unique indexes', async () => {
    const indexResult = await getPool().request().query(`
      SELECT name
      FROM sys.indexes
      WHERE name IN (
        'IX_CashTransactions_UserId_TransactionDate',
        'IX_StockTransactions_UserId_Ticker_TransactionDate',
        'IX_Lots_UserId_Ticker_PurchaseDate',
        'IX_Lots_OpenPositions_UserId_Ticker_PurchaseDate',
        'UX_StockSplits_Ticker_Ratio_Date'
      )
    `)

    const names = new Set(indexResult.recordset.map((r: any) => r.name))
    expect(names.has('IX_CashTransactions_UserId_TransactionDate')).toBe(true)
    expect(names.has('IX_StockTransactions_UserId_Ticker_TransactionDate')).toBe(true)
    expect(names.has('IX_Lots_UserId_Ticker_PurchaseDate')).toBe(true)
    expect(names.has('IX_Lots_OpenPositions_UserId_Ticker_PurchaseDate')).toBe(true)
    expect(names.has('UX_StockSplits_Ticker_Ratio_Date')).toBe(true)
  })

  it('enforces stock split uniqueness on ticker + ratio + splitDate', async () => {
    const splitDate = new Date('2026-05-05T00:00:00.000Z')

    await getPool().request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, TEST_TICKER)
      .input('ratioNumerator', sql.Decimal(18, 8), 2)
      .input('ratioDenominator', sql.Decimal(18, 8), 1)
      .input('multiplier', sql.Decimal(18, 8), 2)
      .input('splitDate', sql.DateTime2, splitDate)
      .query(`
        INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
        VALUES (@id, @userId, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
      `)

    await expect(
      getPool().request()
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('userId', sql.NVarChar, 'another-user')
        .input('ticker', sql.NVarChar, TEST_TICKER)
        .input('ratioNumerator', sql.Decimal(18, 8), 2)
        .input('ratioDenominator', sql.Decimal(18, 8), 1)
        .input('multiplier', sql.Decimal(18, 8), 2)
        .input('splitDate', sql.DateTime2, splitDate)
        .query(`
          INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
          VALUES (@id, @userId, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
        `)
    ).rejects.toThrow()
  })

  it('rejects invalid stock transaction values and invalid split ratio values', async () => {
    await expect(
      getPool().request()
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('userId', sql.NVarChar, TEST_USER_ID)
        .input('ticker', sql.NVarChar, TEST_TICKER)
        .input('type', sql.NVarChar, 'buy')
        .input('quantity', sql.Decimal(18, 8), 0)
        .input('price', sql.Decimal(18, 8), 100)
        .input('amount', sql.Decimal(18, 4), 0)
        .input('transactionDate', sql.DateTime2, new Date('2026-05-01'))
        .query(`
          INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
          VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
        `)
    ).rejects.toThrow()

    await expect(
      getPool().request()
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('userId', sql.NVarChar, TEST_USER_ID)
        .input('ticker', sql.NVarChar, TEST_TICKER)
        .input('ratioNumerator', sql.Decimal(18, 8), 2)
        .input('ratioDenominator', sql.Decimal(18, 8), 0)
        .input('multiplier', sql.Decimal(18, 8), 2)
        .input('splitDate', sql.DateTime2, new Date('2026-05-06'))
        .query(`
          INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
          VALUES (@id, @userId, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
        `)
    ).rejects.toThrow()
  })
})
