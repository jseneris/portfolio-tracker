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
  TEST_USER_ID,
} from './setup.js';

async function recordSplit(ticker: string, numerator: number, denominator: number, splitDate: string) {
  const response = await request(app)
    .post(`/api/lots/ticker/${ticker}/split`)
    .set('x-user-id', TEST_USER_ID)
    .send({
      ratioNumerator: numerator,
      ratioDenominator: denominator,
      splitDate,
    })
    .expect(200)

  return response.body as {
    splitId: string
    isActive: boolean
    canActivate: boolean
  }
}

async function activateSplit(splitId: string, expectedStatus = 200) {
  return request(app)
    .post(`/api/lots/splits/${splitId}/activate`)
    .set('x-user-id', TEST_USER_ID)
    .expect(expectedStatus)
}

async function seedHistoricalPrice(ticker: string, priceDate: string, closePrice = 100) {
  const pool = getPool()
  const date = new Date(`${priceDate}T00:00:00Z`)

  await pool.request()
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('priceDate', sql.Date, date)
    .input('marketDate', sql.Date, date)
    .input('closePrice', sql.Decimal(18, 8), closePrice)
    .input('source', sql.NVarChar, 'test')
    .query(`
      MERGE HistoricalPrices AS target
      USING (
        SELECT @ticker AS ticker, @priceDate AS priceDate, @source AS source
      ) AS sourceRow
      ON target.ticker = sourceRow.ticker
         AND target.priceDate = sourceRow.priceDate
         AND target.source = sourceRow.source
      WHEN MATCHED THEN
        UPDATE SET
          marketDate = @marketDate,
          closePrice = @closePrice,
          updatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, ticker, priceDate, marketDate, closePrice, source)
        VALUES (NEWID(), @ticker, @priceDate, @marketDate, @closePrice, @source);
    `)
}

describe('05. Foundation - Stock Split Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('recording a split keeps stored purchase quantities unchanged until activation', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);

    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    expect(recorded.isActive).toBe(false)

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);
  });

  it('recording a split keeps stored unit cost unchanged until activation', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    const originalUnitCost = Number(lots[0].unitCost);

    await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].unitCost)).toBeCloseTo(originalUnitCost, 8);
  });

  it('multiple activated split events compound stored lot quantities (2:1 then 3:1 = 6:1 total)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100, new Date('2024-01-01T00:00:00Z'));

    const preSplitSummary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(preSplitSummary.body.totalShares)).toBeCloseTo(10, 3);

    const firstSplit = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 120)
    await activateSplit(firstSplit.splitId)

    let summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(20, 3);
    expect(Number(summary.body.costBasis)).toBeCloseTo(1000, 3);

    const secondSplit = await recordSplit('AAPL', 3, 1, '2024-02-01T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-02-02', 130)
    await activateSplit(secondSplit.splitId)

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
    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 125)
    await activateSplit(recorded.splitId)
    await buyStock('AAPL', 5, 50, date2);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(2);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(lots[1].remainingQuantity)).toBeCloseTo(5, 3);

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(25, 3);
  });

  it('activating a split retro-adjusts display lot quantities to stay in sync', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100, new Date('2024-01-01T00:00:00Z'));

    const lots = await getPurchaseLots('AAPL');
    const purchaseLotId = lots[0].id;

    const { createDisplayLot, getDisplayLots } = await import('./setup.js');
    await createDisplayLot('AAPL', [{ purchaseLotId, quantityAllocated: 10 }]);

    let displayLots = await getDisplayLots('AAPL');
    const beforeTotal = displayLots.reduce((sum, lot) => sum + Number(lot.totalQuantity), 0);
    expect(beforeTotal).toBeCloseTo(10, 3);

    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z');
    await seedHistoricalPrice('AAPL', '2024-01-16', 110);
    await activateSplit(recorded.splitId);
    displayLots = await getDisplayLots('AAPL');
    const afterTotal = displayLots.reduce((sum, lot) => sum + Number(lot.totalQuantity), 0);

    expect(afterTotal).toBeCloseTo(20, 3);
  });

  it('fractional split (5:2) works correctly after activation', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 100, 100, new Date('2024-01-01T00:00:00Z'));

    const recorded = await recordSplit('AAPL', 5, 2, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 100)
    await activateSplit(recorded.splitId)

    const lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(250, 3);
    expect(Number(lots[0].unitCost)).toBeCloseTo(40, 2);

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(250, 3);
    expect(Number(summary.body.costBasis)).toBeCloseTo(10000, 3);
  });

  it('activating split updates stored quantities for purchase and dividend lots while leaving transactions unchanged', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100, new Date('2024-01-01T00:00:00Z'));
    await payDividend('AAPL', 2, 50, new Date('2024-01-05T00:00:00Z'));

    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 100)
    await activateSplit(recorded.splitId)

    const lots = await getPurchaseLots('AAPL');
    const updatedPurchase = lots.find((lot) => lot.sourceType === 'purchase');
    const updatedDividend = lots.find((lot) => lot.sourceType === 'dividend');

    expect(Number(updatedPurchase!.remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(updatedDividend!.remainingQuantity)).toBeCloseTo(4, 3);

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(24, 3);
  });

  it('split does not mutate historical transaction quantity/price', async () => {
    await depositCash(10000);
    const buyTxId = await buyStock('AAPL', 10, 100, new Date('2024-01-01T00:00:00Z'));

    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 100)
    await activateSplit(recorded.splitId)

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

  it('activated split records activation rows and updates only lots on or before the split date', async () => {
    await depositCash(20000);
    const beforeSplitDate = new Date('2024-01-01');
    const afterSplitDate = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, beforeSplitDate);
    await buyStock('AAPL', 5, 120, afterSplitDate);

    const purchaseLotsBefore = await getPurchaseLots('AAPL');
    expect(purchaseLotsBefore).toHaveLength(2);

    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 100)
    await activateSplit(recorded.splitId)

    const purchaseLotsAfter = await getPurchaseLots('AAPL');
    expect(Number(purchaseLotsAfter[0].remainingQuantity)).toBeCloseTo(20, 3);
    expect(Number(purchaseLotsAfter[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(purchaseLotsAfter[0].lastSplitId).not.toBeNull();
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

  it('split only affects stored quantities on or before the split date when activated', async () => {
    await depositCash(20000);
    const beforeSplitDate = new Date('2024-01-01');
    const afterSplitDate = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, beforeSplitDate);
    await buyStock('AAPL', 5, 120, afterSplitDate);

    const recorded = await recordSplit('AAPL', 2, 1, '2024-01-15T00:00:00Z')
    await seedHistoricalPrice('AAPL', '2024-01-16', 100)
    await activateSplit(recorded.splitId)

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
  expect(result.recordset[0].lastSplitId).not.toBeNull();
    expect(Number(result.recordset[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(result.recordset[1].lastSplitId).toBeNull();

    const summary = await request(app)
      .get('/api/stocks/AAPL/summary')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);
    expect(Number(summary.body.totalShares)).toBeCloseTo(25, 3);
  });
});