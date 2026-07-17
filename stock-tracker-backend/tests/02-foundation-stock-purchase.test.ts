import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { clearUserData, depositCash, buyStock, getPurchaseLots, getCashBalance, TEST_USER_ID, TOLERANCE } from './setup.js';
import { getPool } from '../src/db/connection.js';
import sql from 'mssql';

describe('02. Foundation - Stock Purchase Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('single stock purchase creates one Purchase Lot', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].originalQuantity)).toBeCloseTo(10, 3);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);
    expect(Number(lots[0].unitCost)).toBeCloseTo(100, 2);
    expect(lots[0].sourceType).toBe('purchase');
  });

  it('multiple purchases of same ticker create separate Purchase Lots', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 5, 110);
    await buyStock('AAPL', 20, 95);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(3);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);
    expect(Number(lots[1].remainingQuantity)).toBeCloseTo(5, 3);
    expect(Number(lots[2].remainingQuantity)).toBeCloseTo(20, 3);
  });

  it('Purchase Lot captures quantity, price, and date (cost basis)', async () => {
    await depositCash(10000);
    const date = new Date('2024-01-15');
    const txId = await buyStock('AAPL', 10, 100, date);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].originalQuantity)).toBe(10);
    expect(Number(lots[0].unitCost)).toBe(100);
    expect(lots[0].sourceType).toBe('purchase');
  });

  it('cash is reduced correctly by purchase amount', async () => {
    await depositCash(10000);
    const balance1 = await getCashBalance();
    expect(Math.abs(balance1 - 10000)).toBeLessThan(TOLERANCE);

    await buyStock('AAPL', 10, 100); // Cost: 1000
    const balance2 = await getCashBalance();
    expect(Math.abs(balance2 - 9000)).toBeLessThan(TOLERANCE);

    await buyStock('AAPL', 5, 110); // Cost: 550
    const balance3 = await getCashBalance();
    expect(Math.abs(balance3 - 8450)).toBeLessThan(TOLERANCE);
  });

  it('multiple purchases create distinct purchase dates', async () => {
    await depositCash(50000);
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-01-15');
    const date3 = new Date('2024-02-01');

    await buyStock('AAPL', 10, 100, date1);
    await buyStock('AAPL', 5, 110, date2);
    await buyStock('AAPL', 20, 95, date3);

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(3);
    const dates = lots.map(l => new Date(l.purchaseDate).getTime());
    expect(dates[0]).toBeLessThan(dates[1]);
    expect(dates[1]).toBeLessThan(dates[2]);
  });

  it('handles fractional shares correctly', async () => {
    await depositCash(10000);
    await buyStock('TSLA', 2.5, 200);

    const lots = await getPurchaseLots('TSLA');
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(2.5, 6);
  });

  it('purchase with high precision pricing', async () => {
    await depositCash(10000);
    await buyStock('BRK.A', 0.1, 600000);

    const lots = await getPurchaseLots('BRK.A');
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].unitCost)).toBeCloseTo(600000, 2);
  });

  it('different tickers create separate Purchase Lot groups', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('MSFT', 5, 300);
    await buyStock('AAPL', 5, 110);

    const appleLots = await getPurchaseLots('AAPL');
    const msftLots = await getPurchaseLots('MSFT');

    expect(appleLots).toHaveLength(2);
    expect(msftLots).toHaveLength(1);
    expect(msftLots[0].sourceType).toBe('purchase');
  });
});
