import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sql from 'mssql';
import { getPool } from '../src/db/connection';

const userId = 'test-display-lots-user';
const pool = getPool();

async function execQuery(query: string, inputs?: Record<string, any>) {
  const request = pool.request();
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          request.input(key, sql.Int, value);
        } else {
          request.input(key, sql.Decimal(18, 8), value);
        }
      } else if (typeof value === 'string') {
        request.input(key, sql.NVarChar, value);
      } else {
        request.input(key, sql.UniqueIdentifier, value);
      }
    }
  }
  return await request.query(query);
}

async function cleanupTestData() {
  await pool.request().query(`DELETE FROM DisplayLotAllocations WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM DisplayLots WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM PurchaseLotAllocations WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM LotAllocations WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM Lots WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM PurchaseLots WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM StockTransactions WHERE userId = @userId`, 
    { userId });
  await pool.request().query(`DELETE FROM CashTransactions WHERE userId = @userId`, 
    { userId });
}

async function createBuyTransaction(ticker: string, quantity: number, price: number) {
  const txId = require('uuid').v4();
  const date = new Date().toISOString();
  await pool.request()
    .input('id', sql.UniqueIdentifier, txId)
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('type', sql.NVarChar, 'buy')
    .input('quantity', sql.Decimal(18, 8), quantity)
    .input('price', sql.Decimal(18, 8), price)
    .input('amount', sql.Decimal(18, 8), quantity * price)
    .input('transactionDate', sql.DateTime2, date)
    .query(`
      INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
      VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
    `);

  // Create associated Lot
  const lotId = require('uuid').v4();
  await pool.request()
    .input('id', sql.UniqueIdentifier, lotId)
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('transactionId', sql.UniqueIdentifier, txId)
    .input('sourceType', sql.NVarChar, 'purchase')
    .input('originalQuantity', sql.Decimal(18, 8), quantity)
    .input('remainingQuantity', sql.Decimal(18, 8), quantity)
    .input('unitCost', sql.Decimal(18, 8), price)
    .input('purchaseDate', sql.DateTime2, date)
    .query(`
      INSERT INTO Lots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
      VALUES (@id, @userId, @ticker, @transactionId, @sourceType, @originalQuantity, @remainingQuantity, @unitCost, @purchaseDate)
    `);

  // Create associated PurchaseLot
  await pool.request()
    .input('id', sql.UniqueIdentifier, lotId)
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('transactionId', sql.UniqueIdentifier, txId)
    .input('sourceType', sql.NVarChar, 'purchase')
    .input('originalQuantity', sql.Decimal(18, 8), quantity)
    .input('remainingQuantity', sql.Decimal(18, 8), quantity)
    .input('unitCost', sql.Decimal(18, 8), price)
    .input('purchaseDate', sql.DateTime2, date)
    .query(`
      INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
      VALUES (@id, @userId, @ticker, @transactionId, @sourceType, @originalQuantity, @remainingQuantity, @unitCost, @purchaseDate)
    `);

  return { txId, lotId };
}

async function getDisplayLotsForTicker(ticker: string) {
  const result = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .query(`
      SELECT id, ticker, totalQuantity FROM DisplayLots
      WHERE userId = @userId AND ticker = @ticker
      ORDER BY createdAt ASC
    `);
  return result.recordset;
}

async function getDisplayLotComposition(displayLotId: string) {
  const result = await pool.request()
    .input('displayLotId', sql.UniqueIdentifier, displayLotId)
    .query(`
      SELECT purchaseLotId, quantityAllocated FROM DisplayLotComposition
      WHERE displayLotId = @displayLotId
      ORDER BY purchaseLotId
    `);
  return result.recordset;
}

describe('Display Lots - Core Operations', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('creates a display lot from a single purchase lot', async () => {
    const { lotId } = await createBuyTransaction('AAPL', 100, 150);

    // Create display lot
    const displayLotId = require('uuid').v4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('totalQuantity', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
        VALUES (@id, @userId, @ticker, @totalQuantity)
      `);

    // Create composition
    await pool.request()
      .input('id', sql.UniqueIdentifier, require('uuid').v4())
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('purchaseLotId', sql.UniqueIdentifier, lotId)
      .input('quantityAllocated', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
        VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
      `);

    const displayLots = await getDisplayLotsForTicker('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(displayLots[0].totalQuantity).toBe(100);

    const composition = await getDisplayLotComposition(displayLotId);
    expect(composition).toHaveLength(1);
    expect(composition[0].quantityAllocated).toBe(100);
  });

  it('creates a display lot from multiple purchase lots', async () => {
    const { lotId: lot1 } = await createBuyTransaction('AAPL', 50, 150);
    const { lotId: lot2 } = await createBuyTransaction('AAPL', 50, 155);

    // Create display lot spanning both
    const displayLotId = require('uuid').v4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('totalQuantity', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
        VALUES (@id, @userId, @ticker, @totalQuantity)
      `);

    // Add both lots to composition
    for (const [idx, lotId] of [lot1, lot2].entries()) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, require('uuid').v4())
        .input('displayLotId', sql.UniqueIdentifier, displayLotId)
        .input('purchaseLotId', sql.UniqueIdentifier, lotId)
        .input('quantityAllocated', sql.Decimal(18, 8), 50)
        .query(`
          INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
          VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
        `);
    }

    const composition = await getDisplayLotComposition(displayLotId);
    expect(composition).toHaveLength(2);
    expect(composition.reduce((sum, c) => sum + c.quantityAllocated, 0)).toBe(100);
  });

  it('maintains invariant: sum of display lot totals equals sum of purchase lot remaining quantities', async () => {
    const { lotId } = await createBuyTransaction('AAPL', 100, 150);

    // Create display lot
    const displayLotId = require('uuid').v4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('totalQuantity', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
        VALUES (@id, @userId, @ticker, @totalQuantity)
      `);

    await pool.request()
      .input('id', sql.UniqueIdentifier, require('uuid').v4())
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('purchaseLotId', sql.UniqueIdentifier, lotId)
      .input('quantityAllocated', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
        VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
      `);

    // Get totals
    const displayLots = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .query(`
        SELECT SUM(totalQuantity) as total FROM DisplayLots
        WHERE userId = @userId AND ticker = @ticker
      `);

    const purchaseLots = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .query(`
        SELECT SUM(remainingQuantity) as total FROM PurchaseLots
        WHERE userId = @userId AND ticker = @ticker
      `);

    expect(displayLots.recordset[0].total).toBe(purchaseLots.recordset[0].total);
  });
});

describe('Display Lots - Reversibility on Sale Deletion', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('restores display lot quantities when a sale transaction is deleted', async () => {
    // Setup: Buy 100 shares
    const { lotId, txId: buyTxId } = await createBuyTransaction('AAPL', 100, 150);

    // Create display lot
    const displayLotId = require('uuid').v4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('totalQuantity', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
        VALUES (@id, @userId, @ticker, @totalQuantity)
      `);

    await pool.request()
      .input('id', sql.UniqueIdentifier, require('uuid').v4())
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('purchaseLotId', sql.UniqueIdentifier, lotId)
      .input('quantityAllocated', sql.Decimal(18, 8), 100)
      .query(`
        INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
        VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
      `);

    // Create a sell transaction
    const sellTxId = require('uuid').v4();
    const sellDate = new Date().toISOString();
    await pool.request()
      .input('id', sql.UniqueIdentifier, sellTxId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('type', sql.NVarChar, 'sell')
      .input('quantity', sql.Decimal(18, 8), 50)
      .input('price', sql.Decimal(18, 8), 160)
      .input('amount', sql.Decimal(18, 8), 50 * 160)
      .input('transactionDate', sql.DateTime2, sellDate)
      .query(`
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `);

    // Create allocation records (purchase, lot, and display)
    await pool.request()
      .input('id', sql.UniqueIdentifier, require('uuid').v4())
      .input('userId', sql.NVarChar, userId)
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .input('purchaseLotId', sql.UniqueIdentifier, lotId)
      .input('quantityConsumed', sql.Decimal(18, 8), 50)
      .query(`
        INSERT INTO PurchaseLotAllocations (id, userId, saleTransactionId, purchaseLotId, quantityConsumed)
        VALUES (@id, @userId, @saleTransactionId, @purchaseLotId, @quantityConsumed)
      `);

    await pool.request()
      .input('id', sql.UniqueIdentifier, require('uuid').v4())
      .input('userId', sql.NVarChar, userId)
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .input('lotId', sql.UniqueIdentifier, lotId)
      .input('quantityConsumed', sql.Decimal(18, 8), 50)
      .query(`
        INSERT INTO LotAllocations (id, userId, saleTransactionId, lotId, quantityConsumed)
        VALUES (@id, @userId, @saleTransactionId, @lotId, @quantityConsumed)
      `);

    await pool.request()
      .input('id', sql.UniqueIdentifier, require('uuid').v4())
      .input('userId', sql.NVarChar, userId)
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('quantityConsumed', sql.Decimal(18, 8), 50)
      .query(`
        INSERT INTO DisplayLotAllocations (id, userId, saleTransactionId, displayLotId, quantityConsumed)
        VALUES (@id, @userId, @saleTransactionId, @displayLotId, @quantityConsumed)
      `);

    // Update quantities after sale
    await pool.request()
      .input('lotId', sql.UniqueIdentifier, lotId)
      .input('quantity', sql.Decimal(18, 8), 50)
      .query(`
        UPDATE Lots SET remainingQuantity = 50 WHERE id = @lotId
      `);

    await pool.request()
      .input('purchaseLotId', sql.UniqueIdentifier, lotId)
      .input('quantity', sql.Decimal(18, 8), 50)
      .query(`
        UPDATE PurchaseLots SET remainingQuantity = 50 WHERE id = @purchaseLotId
      `);

    await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('quantity', sql.Decimal(18, 8), 50)
      .query(`
        UPDATE DisplayLots SET totalQuantity = 50 WHERE id = @displayLotId
      `);

    // Verify pre-deletion state
    let displayLot = await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .query(`SELECT totalQuantity FROM DisplayLots WHERE id = @displayLotId`);
    expect(displayLot.recordset[0].totalQuantity).toBe(50);

    // Delete the sale transaction with reversal logic
    await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('quantity', sql.Decimal(18, 8), 50)
      .query(`
        UPDATE DisplayLots 
        SET totalQuantity = totalQuantity + @quantity
        WHERE id = @displayLotId
      `);

    await pool.request()
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .query(`DELETE FROM StockTransactions WHERE id = @saleTransactionId`);

    // Verify post-deletion restoration
    displayLot = await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .query(`SELECT totalQuantity FROM DisplayLots WHERE id = @displayLotId`);
    expect(displayLot.recordset[0].totalQuantity).toBe(100);
  });

  it('ensures allocation records are deleted by cascade when transaction is deleted', async () => {
    const { lotId, txId: buyTxId } = await createBuyTransaction('AAPL', 100, 150);
    const displayLotId = require('uuid').v4();

    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('totalQuantity', sql.Decimal(18, 8), 100)
      .query(`INSERT INTO DisplayLots (id, userId, ticker, totalQuantity) VALUES (@id, @userId, @ticker, @totalQuantity)`);

    const sellTxId = require('uuid').v4();
    const sellDate = new Date().toISOString();
    await pool.request()
      .input('id', sql.UniqueIdentifier, sellTxId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('type', sql.NVarChar, 'sell')
      .input('quantity', sql.Decimal(18, 8), 50)
      .input('price', sql.Decimal(18, 8), 160)
      .input('amount', sql.Decimal(18, 8), 8000)
      .input('transactionDate', sql.DateTime2, sellDate)
      .query(`INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate) VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)`);

    const allocId = require('uuid').v4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, allocId)
      .input('userId', sql.NVarChar, userId)
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .input('quantityConsumed', sql.Decimal(18, 8), 50)
      .query(`INSERT INTO DisplayLotAllocations (id, userId, saleTransactionId, displayLotId, quantityConsumed) VALUES (@id, @userId, @saleTransactionId, @displayLotId, @quantityConsumed)`);

    // Verify allocation exists
    let allocations = await pool.request()
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .query(`SELECT COUNT(*) as count FROM DisplayLotAllocations WHERE saleTransactionId = @saleTransactionId`);
    expect(allocations.recordset[0].count).toBe(1);

    // Delete transaction (CASCADE should remove allocation)
    await pool.request()
      .input('id', sql.UniqueIdentifier, sellTxId)
      .query(`DELETE FROM StockTransactions WHERE id = @id`);

    // Verify allocation was cascade deleted
    allocations = await pool.request()
      .input('saleTransactionId', sql.UniqueIdentifier, sellTxId)
      .query(`SELECT COUNT(*) as count FROM DisplayLotAllocations WHERE saleTransactionId = @saleTransactionId`);
    expect(allocations.recordset[0].count).toBe(0);
  });
});

describe('Display Lots - Invariant Verification', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('verifies display lot composition sum matches display lot total quantity', async () => {
    const { lotId: lot1 } = await createBuyTransaction('AAPL', 30, 150);
    const { lotId: lot2 } = await createBuyTransaction('AAPL', 70, 155);

    const displayLotId = require('uuid').v4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('totalQuantity', sql.Decimal(18, 8), 100)
      .query(`INSERT INTO DisplayLots (id, userId, ticker, totalQuantity) VALUES (@id, @userId, @ticker, @totalQuantity)`);

    for (const [lotId, qty] of [[lot1, 30], [lot2, 70]]) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, require('uuid').v4())
        .input('displayLotId', sql.UniqueIdentifier, displayLotId)
        .input('purchaseLotId', sql.UniqueIdentifier, lotId)
        .input('quantityAllocated', sql.Decimal(18, 8), qty)
        .query(`INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated) VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)`);
    }

    const displayLot = await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .query(`SELECT totalQuantity FROM DisplayLots WHERE id = @displayLotId`);

    const composition = await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, displayLotId)
      .query(`SELECT SUM(quantityAllocated) as total FROM DisplayLotComposition WHERE displayLotId = @displayLotId`);

    expect(displayLot.recordset[0].totalQuantity).toBe(composition.recordset[0].total);
  });
});
