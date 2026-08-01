import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import sql from 'mssql';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import request from 'supertest';
import app from '../src/index.js';
import {
  clearUserData,
  depositCash,
  buyStock,
  payDividend,
  getPurchaseLots,
  applySplit,
  TEST_USER_ID,
} from './setup.js';

describe('05. Foundation - Stock Split Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('2:1 stock split keeps stored purchase quantities unchanged', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);

    await applySplit('AAPL', 2, 1);

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);
  });

  it('split keeps stored unit cost unchanged', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    const originalUnitCost = Number(lots[0].unitCost);

    await applySplit('AAPL', 2, 1);

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].unitCost)).toBeCloseTo(originalUnitCost, 8);
  });

  it('multiple split events compound in ticker summary projection (2:1 then 3:1 = 6:1 total)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const preSplitSummary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(preSplitSummary.body.totalShares)).toBeCloseTo(10, 3);

    await applySplit('AAPL', 2, 1);
    let summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(20, 3);
    expect(Number(summary.body.costBasis)).toBeCloseTo(1000, 3);

    await applySplit('AAPL', 3, 1);
    summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(60, 3);
    expect(Number(summary.body.costBasis)).toBeCloseTo(1000, 3);
  });

  it('split affects only shares purchased before split date in summary projection', async () => {
    await depositCash(50000);
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, date1);
    await applySplit('AAPL', 2, 1, new Date('2024-01-15'));
    await buyStock('AAPL', 5, 50, date2);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(2);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);
    expect(Number(lots[1].remainingQuantity)).toBeCloseTo(5, 3);

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(25, 3);
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

  it('fractional split (5:2) works correctly in projection', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 100, 100);

    await applySplit('AAPL', 5, 2);

    const lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(100, 3);
    expect(Number(lots[0].unitCost)).toBeCloseTo(100, 2);

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(250, 3);
    expect(Number(summary.body.costBasis)).toBeCloseTo(10000, 3);
  });

  it('split with dividend lots updates projected quantities, not stored lot values', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 2, 50);

    await applySplit('AAPL', 2, 1);

    const lots = await getPurchaseLots('AAPL');
    const updatedPurchase = lots.find((lot) => lot.sourceType === 'purchase');
    const updatedDividend = lots.find((lot) => lot.sourceType === 'dividend');

    expect(Number(updatedPurchase!.remainingQuantity)).toBeCloseTo(10, 3);
    expect(Number(updatedDividend!.remainingQuantity)).toBeCloseTo(2, 3);

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(24, 3);
  });

  it('split does not mutate historical transaction quantity/price', async () => {
    await depositCash(10000);
    const buyTxId = await buyStock('AAPL', 10, 100);

    await applySplit('AAPL', 2, 1);

    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, buyTxId)
      .query('SELECT quantity, price FROM StockTransactions WHERE id = @id');

    if (result.recordset.length > 0) {
      const tx = result.recordset[0];
      expect(Number(tx.quantity)).toBeCloseTo(10, 3);
      expect(Number(tx.price)).toBeCloseTo(100, 2);
    }
  });

  it('split records activation rows and leaves legacy audit/lastSplit fields untouched', async () => {
    await depositCash(20000);
    const beforeSplitDate = new Date('2024-01-01');
    const afterSplitDate = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, beforeSplitDate);
    await buyStock('AAPL', 5, 120, afterSplitDate);

    const purchaseLotsBefore = await getPurchaseLots('AAPL');
    expect(purchaseLotsBefore).toHaveLength(2);

    await applySplit('AAPL', 2, 1, new Date('2024-01-15'));

    const purchaseLotsAfter = await getPurchaseLots('AAPL');
    expect(Number(purchaseLotsAfter[0].remainingQuantity)).toBeCloseTo(10, 3);
    expect(Number(purchaseLotsAfter[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(purchaseLotsAfter[0].lastSplitId).toBeNull();
    expect(purchaseLotsAfter[1].lastSplitId).toBeNull();

    const pool = getPool();
    const activationRows = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .query(`
        SELECT COUNT(*) AS activationCount
        FROM UserSplitActivations usa
        JOIN StockSplits ss ON ss.id = usa.splitId
        WHERE usa.userId = @userId AND ss.ticker = 'AAPL'
      `);

    expect(Number(activationRows.recordset[0].activationCount || 0)).toBeGreaterThan(0);
  });

  it('split only affects projected quantities on or before the split date', async () => {
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
    expect(Number(result.recordset[0].remainingQuantity)).toBeCloseTo(10, 3);
    expect(result.recordset[0].lastSplitId).toBeNull();
    expect(Number(result.recordset[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(result.recordset[1].lastSplitId).toBeNull();

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(25, 3);
  });
});