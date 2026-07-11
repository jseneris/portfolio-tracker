import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { v4 as uuidv4 } from 'uuid'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

// Unique user so this test never collides with other test suites running in parallel
const TEST_USER_ID = 'test-table-crud-user'

let server: any

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

// Pre-generate IDs so FK relationships can be wired before any inserts run.
//
// FK dependency tree:
//   CashTransactions         — standalone
//   StockTransactions        — standalone (lastSplitId FK is nullable; set after StockSplits exists)
//   StockSplits              — standalone
//   Lots                     → StockTransactions (transactionId, CASCADE), StockSplits (lastSplitId, nullable)
//   LotAllocations           → StockTransactions (saleTransactionId, CASCADE), Lots (lotId)
//   SplitAdjustments         → StockSplits (splitId)

const cashId             = uuidv4()
const stockTxBuyId       = uuidv4()
const stockTxSellId      = uuidv4()
const splitId            = uuidv4()
const lotId              = uuidv4()
const lotAllocationId    = uuidv4()
const splitAdjustmentId  = uuidv4()

describe('Table CRUD — write, read, delete across all tables', () => {

  // ── WRITES (FK insertion order) ──────────────────────────────────────────

  it('writes to CashTransactions', async () => {
    await getPool().request()
      .input('id',              sql.UniqueIdentifier, cashId)
      .input('userId',          sql.NVarChar,         TEST_USER_ID)
      .input('type',            sql.NVarChar,         'deposit')
      .input('amount',          sql.Decimal(18, 4),   1000)
      .input('transactionDate', sql.DateTime2,        new Date('2026-01-01'))
      .query(`
        INSERT INTO CashTransactions (id, userId, type, amount, transactionDate)
        VALUES (@id, @userId, @type, @amount, @transactionDate)
      `)
  })

  it('writes a buy row to StockTransactions', async () => {
    await getPool().request()
      .input('id',              sql.UniqueIdentifier, stockTxBuyId)
      .input('userId',          sql.NVarChar,         TEST_USER_ID)
      .input('ticker',          sql.NVarChar,         'CRUD')
      .input('type',            sql.NVarChar,         'buy')
      .input('quantity',        sql.Decimal(18, 8),   10)
      .input('price',           sql.Decimal(18, 8),   50)
      .input('amount',          sql.Decimal(18, 4),   500)
      .input('transactionDate', sql.DateTime2,        new Date('2026-01-15'))
      .query(`
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `)
  })

  it('writes a sell row to StockTransactions', async () => {
    await getPool().request()
      .input('id',              sql.UniqueIdentifier, stockTxSellId)
      .input('userId',          sql.NVarChar,         TEST_USER_ID)
      .input('ticker',          sql.NVarChar,         'CRUD')
      .input('type',            sql.NVarChar,         'sell')
      .input('quantity',        sql.Decimal(18, 8),   5)
      .input('price',           sql.Decimal(18, 8),   60)
      .input('amount',          sql.Decimal(18, 4),   300)
      .input('transactionDate', sql.DateTime2,        new Date('2026-02-01'))
      .query(`
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `)
  })

  it('writes to StockSplits', async () => {
    await getPool().request()
      .input('id',               sql.UniqueIdentifier, splitId)
      .input('userId',           sql.NVarChar,         TEST_USER_ID)
      .input('ticker',           sql.NVarChar,         'CRUD')
      .input('ratioNumerator',   sql.Decimal(18, 8),   2)
      .input('ratioDenominator', sql.Decimal(18, 8),   1)
      .input('multiplier',       sql.Decimal(18, 8),   2)
      .input('splitDate',        sql.DateTime2,        new Date('2026-01-20'))
      .query(`
        INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
        VALUES (@id, @userId, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
      `)
  })

  it('writes to Lots (references StockTransactions buy row and StockSplits row)', async () => {
    await getPool().request()
      .input('id',                sql.UniqueIdentifier, lotId)
      .input('userId',            sql.NVarChar,         TEST_USER_ID)
      .input('ticker',            sql.NVarChar,         'CRUD')
      .input('transactionId',     sql.UniqueIdentifier, stockTxBuyId)
      .input('sourceType',        sql.NVarChar,         'purchase')
      .input('originalQuantity',  sql.Decimal(18, 8),   10)
      .input('remainingQuantity', sql.Decimal(18, 8),   10)
      .input('unitCost',          sql.Decimal(18, 8),   50)
      .input('purchaseDate',      sql.DateTime2,        new Date('2026-01-15'))
      .input('splitAdjusted',     sql.Bit,              1)
      .input('lastSplitId',       sql.UniqueIdentifier, splitId)
      .query(`
        INSERT INTO Lots (id, userId, ticker, transactionId, sourceType, originalQuantity,
                          remainingQuantity, unitCost, purchaseDate, splitAdjusted, lastSplitId)
        VALUES (@id, @userId, @ticker, @transactionId, @sourceType, @originalQuantity,
                @remainingQuantity, @unitCost, @purchaseDate, @splitAdjusted, @lastSplitId)
      `)
  })

  it('writes to LotAllocations (references sell StockTransaction and Lot)', async () => {
    await getPool().request()
      .input('id',                sql.UniqueIdentifier, lotAllocationId)
      .input('userId',            sql.NVarChar,         TEST_USER_ID)
      .input('saleTransactionId', sql.UniqueIdentifier, stockTxSellId)
      .input('lotId',             sql.UniqueIdentifier, lotId)
      .input('quantityConsumed',  sql.Decimal(18, 8),   5)
      .query(`
        INSERT INTO LotAllocations (id, userId, saleTransactionId, lotId, quantityConsumed)
        VALUES (@id, @userId, @saleTransactionId, @lotId, @quantityConsumed)
      `)
  })

  it('writes to SplitAdjustments (references StockSplits row)', async () => {
    await getPool().request()
      .input('id',         sql.UniqueIdentifier, splitAdjustmentId)
      .input('userId',     sql.NVarChar,         TEST_USER_ID)
      .input('splitId',    sql.UniqueIdentifier, splitId)
      .input('entityType', sql.NVarChar,         'lot')
      .input('entityId',   sql.UniqueIdentifier, lotId)
      .input('multiplier', sql.Decimal(18, 8),   2)
      .query(`
        INSERT INTO SplitAdjustments (id, userId, splitId, entityType, entityId, multiplier)
        VALUES (@id, @userId, @splitId, @entityType, @entityId, @multiplier)
      `)
  })

  // ── READS ────────────────────────────────────────────────────────────────

  it('reads the CashTransactions row', async () => {
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, cashId)
      .query('SELECT * FROM CashTransactions WHERE id = @id')
    expect(result.recordset).toHaveLength(1)
    const row = result.recordset[0]
    expect(row.userId).toBe(TEST_USER_ID)
    expect(row.type).toBe('deposit')
    expect(Number(row.amount)).toBeCloseTo(1000, 2)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('reads both StockTransactions rows', async () => {
    const result = await getPool().request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'CRUD')
      .query(`
        SELECT * FROM StockTransactions
        WHERE userId = @userId AND ticker = @ticker
        ORDER BY transactionDate
      `)
    expect(result.recordset).toHaveLength(2)
    const [buy, sell] = result.recordset
    expect(buy.type).toBe('buy')
    expect(Number(buy.quantity)).toBeCloseTo(10, 6)
    expect(Number(buy.price)).toBeCloseTo(50, 6)
    expect(sell.type).toBe('sell')
    expect(Number(sell.quantity)).toBeCloseTo(5, 6)
    expect(Number(sell.price)).toBeCloseTo(60, 6)
  })

  it('reads the StockSplits row', async () => {
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, splitId)
      .query('SELECT * FROM StockSplits WHERE id = @id')
    expect(result.recordset).toHaveLength(1)
    const row = result.recordset[0]
    expect(row.ticker).toBe('CRUD')
    expect(Number(row.ratioNumerator)).toBeCloseTo(2, 6)
    expect(Number(row.ratioDenominator)).toBeCloseTo(1, 6)
    expect(Number(row.multiplier)).toBeCloseTo(2, 6)
    expect(row.createdAt).toBeInstanceOf(Date)
  })

  it('reads the Lots row', async () => {
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, lotId)
      .query('SELECT * FROM Lots WHERE id = @id')
    expect(result.recordset).toHaveLength(1)
    const row = result.recordset[0]
    expect(row.ticker).toBe('CRUD')
    expect(row.sourceType).toBe('purchase')
    expect(Number(row.originalQuantity)).toBeCloseTo(10, 6)
    expect(Number(row.remainingQuantity)).toBeCloseTo(10, 6)
    expect(Number(row.unitCost)).toBeCloseTo(50, 6)
    expect(row.splitAdjusted).toBe(true)
    expect(row.lastSplitId.toLowerCase()).toBe(splitId.toLowerCase())
    expect(row.transactionId.toLowerCase()).toBe(stockTxBuyId.toLowerCase())
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('reads the LotAllocations row', async () => {
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, lotAllocationId)
      .query('SELECT * FROM LotAllocations WHERE id = @id')
    expect(result.recordset).toHaveLength(1)
    const row = result.recordset[0]
    expect(row.userId).toBe(TEST_USER_ID)
    expect(row.saleTransactionId.toLowerCase()).toBe(stockTxSellId.toLowerCase())
    expect(row.lotId.toLowerCase()).toBe(lotId.toLowerCase())
    expect(Number(row.quantityConsumed)).toBeCloseTo(5, 6)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('reads the SplitAdjustments row', async () => {
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, splitAdjustmentId)
      .query('SELECT * FROM SplitAdjustments WHERE id = @id')
    expect(result.recordset).toHaveLength(1)
    const row = result.recordset[0]
    expect(row.userId).toBe(TEST_USER_ID)
    expect(row.splitId.toLowerCase()).toBe(splitId.toLowerCase())
    expect(row.entityType).toBe('lot')
    expect(row.entityId.toLowerCase()).toBe(lotId.toLowerCase())
    expect(Number(row.multiplier)).toBeCloseTo(2, 6)
    expect(row.createdAt).toBeInstanceOf(Date)
  })

  // ── DELETES (reverse FK order) ────────────────────────────────────────────
  //
  // Reverse of insert order to satisfy FK constraints:
  //   SplitAdjustments → LotAllocations → Lots → StockSplits → StockTransactions → CashTransactions
  //
  // Notes on CASCADE behaviour:
  //   - Deleting a StockTransaction cascades to its Lots and LotAllocations, NOT vice versa.
  //   - Deleting a Lot does NOT cascade to StockTransactions.
  //   - So we must remove LotAllocations and Lots manually before touching their parents.

  it('deletes from SplitAdjustments and confirms row is gone', async () => {
    await getPool().request()
      .input('id', sql.UniqueIdentifier, splitAdjustmentId)
      .query('DELETE FROM SplitAdjustments WHERE id = @id')
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, splitAdjustmentId)
      .query('SELECT 1 AS found FROM SplitAdjustments WHERE id = @id')
    expect(result.recordset).toHaveLength(0)
  })

  it('deletes from LotAllocations and confirms row is gone', async () => {
    await getPool().request()
      .input('id', sql.UniqueIdentifier, lotAllocationId)
      .query('DELETE FROM LotAllocations WHERE id = @id')
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, lotAllocationId)
      .query('SELECT 1 AS found FROM LotAllocations WHERE id = @id')
    expect(result.recordset).toHaveLength(0)
  })

  it('deletes from Lots and confirms row is gone', async () => {
    await getPool().request()
      .input('id', sql.UniqueIdentifier, lotId)
      .query('DELETE FROM Lots WHERE id = @id')
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, lotId)
      .query('SELECT 1 AS found FROM Lots WHERE id = @id')
    expect(result.recordset).toHaveLength(0)
  })

  it('deletes from StockSplits and confirms row is gone', async () => {
    await getPool().request()
      .input('id', sql.UniqueIdentifier, splitId)
      .query('DELETE FROM StockSplits WHERE id = @id')
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, splitId)
      .query('SELECT 1 AS found FROM StockSplits WHERE id = @id')
    expect(result.recordset).toHaveLength(0)
  })

  it('deletes from StockTransactions and confirms both rows are gone', async () => {
    await getPool().request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'CRUD')
      .query('DELETE FROM StockTransactions WHERE userId = @userId AND ticker = @ticker')
    const result = await getPool().request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'CRUD')
      .query('SELECT 1 AS found FROM StockTransactions WHERE userId = @userId AND ticker = @ticker')
    expect(result.recordset).toHaveLength(0)
  })

  it('deletes from CashTransactions and confirms row is gone', async () => {
    await getPool().request()
      .input('id', sql.UniqueIdentifier, cashId)
      .query('DELETE FROM CashTransactions WHERE id = @id')
    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, cashId)
      .query('SELECT 1 AS found FROM CashTransactions WHERE id = @id')
    expect(result.recordset).toHaveLength(0)
  })

  it('handcheck',async () => {
    await getPool().request()
            .input('id', sql.UniqueIdentifier, splitId)
            .input('userId', sql.NVarChar, 'test')
            .input('ticker', sql.NVarChar, 'TEST')
            .input('ratioNumerator', sql.Decimal(18, 8), 5)
            .input('ratioDenominator', sql.Decimal(18, 8), 3)
            .input('multiplier', sql.Decimal(18, 8), 3)
            .input('splitDate', sql.DateTime2, '2026-02-10')
            .query(`
               INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
               VALUES (@id, @userId, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
               `)
  })

    it('handcheck2',async () => {
    await getPool().request()
      .input('userId', sql.NVarChar, 'test')
      .input('ticker', sql.NVarChar, 'TEST')
      .input('multiplier', sql.Decimal(18, 8), 3)
      .input('splitDate', sql.DateTime2, '2026-02-10')
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE Lots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            unitCost = unitCost / @multiplier,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE userId = @userId AND ticker = @ticker AND purchaseDate <= @splitDate
      `)
  })
})
