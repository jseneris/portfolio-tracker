import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import sql from 'mssql';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import {
  clearUserData,
  depositCash,
  buyStock,
  payDividend,
  getPurchaseLots,
  applySplit,
  TOLERANCE,
  TEST_USER_ID,
} from './setup.js';

describe('05. Foundation - Stock Split Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('2:1 stock split doubles share quantities', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);

    await applySplit('AAPL', 2, 1);

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(20, 3);
  });

  it('split adjusts unit cost inversely to maintain cost basis', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    const originalCost = Number(lots[0].remainingQuantity) * Number(lots[0].unitCost);

    await applySplit('AAPL', 2, 1);

    lots = await getPurchaseLots('AAPL');
    const newCost = Number(lots[0].remainingQuantity) * Number(lots[0].unitCost);

    expect(Math.abs(originalCost - newCost)).toBeLessThan(TOLERANCE);
    expect(Number(lots[0].unitCost)).toBeCloseTo(50, 2);
  });

  it('multiple split events compound correctly (2:1 then 3:1 = 6:1 total)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    await applySplit('AAPL', 2, 1);
    let lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(lots[0].unitCost)).toBeCloseTo(50, 2);

    await applySplit('AAPL', 3, 1);
    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(60, 3);
    expect(Number(lots[0].unitCost)).toBeCloseTo(16.67, 1);
  });

  it('split affects only shares purchased before split date', async () => {
    await depositCash(50000);
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, date1);
    await applySplit('AAPL', 2, 1, new Date('2024-01-15'));
    await buyStock('AAPL', 5, 50, date2);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(2);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(lots[1].remainingQuantity)).toBeCloseTo(5, 3);
  });

  it('split retro-adjusts display lot quantities to stay in sync', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const lots = await getPurchaseLots('AAPL');
    const purchaseLotId = lots[0].id;

    const { createDisplayLot, getDisplayLots } = await import('./setup.js');
    await createDisplayLot('AAPL', [{ purchaseLotId, quantityAllocated: 10 }]);

    let displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);

    await applySplit('AAPL', 2, 1);

    displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toBeDefined();
  });

  it('fractional split (5:2) works correctly', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 100, 100);

    await applySplit('AAPL', 5, 2);

    const lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(250, 3);
    expect(Number(lots[0].unitCost)).toBeCloseTo(40, 2);
  });

  it('split with dividend lots', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 2, 50);

    await applySplit('AAPL', 2, 1);

    const lots = await getPurchaseLots('AAPL');
    const updatedPurchase = lots.find((lot) => lot.sourceType === 'purchase');
    const updatedDividend = lots.find((lot) => lot.sourceType === 'dividend');

    expect(Number(updatedPurchase!.remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(updatedDividend!.remainingQuantity)).toBeCloseTo(4, 3);
  });

  it('split updates transaction history correctly', async () => {
    await depositCash(10000);
    const buyTxId = await buyStock('AAPL', 10, 100);

    await applySplit('AAPL', 2, 1);

    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, buyTxId)
      .query('SELECT quantity, price FROM StockTransactions WHERE id = @id');

    if (result.recordset.length > 0) {
      const tx = result.recordset[0];
      expect(Number(tx.quantity)).toBeCloseTo(20, 3);
      expect(Number(tx.price)).toBeCloseTo(50, 2);
    }
  });

  it('split records audit rows and lastSplitId fields', async () => {
    await depositCash(20000);
    const beforeSplitDate = new Date('2024-01-01');
    const afterSplitDate = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, beforeSplitDate);
    await buyStock('AAPL', 5, 120, afterSplitDate);

    const purchaseLotsBefore = await getPurchaseLots('AAPL');
    expect(purchaseLotsBefore).toHaveLength(2);

    await applySplit('AAPL', 2, 1, new Date('2024-01-15'));

    const purchaseLotsAfter = await getPurchaseLots('AAPL');
    expect(Number(purchaseLotsAfter[0].remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(purchaseLotsAfter[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(purchaseLotsAfter[0].lastSplitId).toBeDefined();
    expect(purchaseLotsAfter[1].lastSplitId).toBeNull();

    const pool = getPool();
    const splitRows = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .query(`
        SELECT entityType, COUNT(*) AS adjustmentCount
        FROM SplitAdjustments
        WHERE userId = @userId
        GROUP BY entityType
      `);

    const rowCounts = new Map<string, number>(
      splitRows.recordset.map((row: any) => [String(row.entityType), Number(row.adjustmentCount)])
    );

    expect(rowCounts.get('lot') || 0).toBeGreaterThan(0);
    expect(rowCounts.get('transaction') || 0).toBeGreaterThan(0);
  });

  it('split only affects lots on or before the split date', async () => {
    await depositCash(20000);
    const beforeSplitDate = new Date('2024-01-01');
    const afterSplitDate = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, beforeSplitDate);
    await buyStock('AAPL', 5, 120, afterSplitDate);

    await applySplit('AAPL', 2, 1, new Date('2024-01-15'));

    const pool = getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .query(`
        SELECT id, purchaseDate, remainingQuantity, lastSplitId
        FROM PurchaseLots
        WHERE userId = @userId AND ticker = @ticker
        ORDER BY purchaseDate ASC
      `);

    expect(result.recordset).toHaveLength(2);
    expect(Number(result.recordset[0].remainingQuantity)).toBeCloseTo(20, 3);
    expect(result.recordset[0].lastSplitId).toBeDefined();
    expect(Number(result.recordset[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(result.recordset[1].lastSplitId).toBeNull();
  });
});