import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { clearUserData, depositCash, buyStock, payDividend, getPurchaseLots, TOLERANCE } from './setup.js';

describe('03. Foundation - Stock Dividend Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('dividend transaction creates Dividend Lot (not Purchase Lot)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 1, 15); // 1 share dividend, $15 total

    const lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(2);
    
    const purchaseLot = lots.find(l => l.sourceType === 'purchase');
    const dividendLot = lots.find(l => l.sourceType === 'dividend');
    
    expect(purchaseLot).toBeDefined();
    expect(dividendLot).toBeDefined();
    expect(Number(purchaseLot!.remainingQuantity)).toBeCloseTo(10, 3);
    expect(Number(dividendLot!.remainingQuantity)).toBeCloseTo(1, 3);
    expect(Number(dividendLot!.unitCost)).toBeCloseTo(15, 2); // Amount / quantity
  });

  it('multiple dividends create separate Dividend Lots', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 1, 15);
    await payDividend('AAPL', 2, 35);

    const lots = await getPurchaseLots('AAPL');
    const dividendLots = lots.filter(l => l.sourceType === 'dividend');
    
    expect(dividendLots).toHaveLength(2);
    expect(Number(dividendLots[0].remainingQuantity)).toBeCloseTo(1, 3);
    expect(Number(dividendLots[1].remainingQuantity)).toBeCloseTo(2, 3);
  });

  it('dividend shares are independent from purchase lot shares', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 100, 100);
    await payDividend('AAPL', 5, 100);

    const lots = await getPurchaseLots('AAPL');
    const purchaseLots = lots.filter(l => l.sourceType === 'purchase');
    const dividendLots = lots.filter(l => l.sourceType === 'dividend');

    expect(purchaseLots).toHaveLength(1);
    expect(dividendLots).toHaveLength(1);
    
    const totalPurchaseShares = purchaseLots.reduce((sum, l) => sum + Number(l.remainingQuantity), 0);
    const totalDividendShares = dividendLots.reduce((sum, l) => sum + Number(l.remainingQuantity), 0);
    
    expect(totalPurchaseShares).toBeCloseTo(100, 3);
    expect(totalDividendShares).toBeCloseTo(5, 3);
  });

  it('dividend amount is properly converted to unit cost', async () => {
    await depositCash(10000);
    await buyStock('MSFT', 20, 300);
    await payDividend('MSFT', 2, 50); // 2 shares, $50 total = $25 per share

    const lots = await getPurchaseLots('MSFT');
    const dividendLot = lots.find(l => l.sourceType === 'dividend');
    
    expect(dividendLot).toBeDefined();
    expect(Number(dividendLot!.unitCost)).toBeCloseTo(25, 2); // 50 / 2
  });

  it('handles fractional dividend shares', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 0.5, 10);

    const lots = await getPurchaseLots('AAPL');
    const dividendLot = lots.find(l => l.sourceType === 'dividend');
    
    expect(dividendLot).toBeDefined();
    expect(Number(dividendLot!.remainingQuantity)).toBeCloseTo(0.5, 6);
  });

  it('multiple stocks with dividends maintain separation', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('MSFT', 5, 300);
    await buyStock('GOOGL', 2, 2500);
    
    await payDividend('AAPL', 1, 15);
    await payDividend('MSFT', 0.5, 20);
    await payDividend('GOOGL', 0.25, 50);

    const appleLots = await getPurchaseLots('AAPL');
    const msftLots = await getPurchaseLots('MSFT');
    const googlLots = await getPurchaseLots('GOOGL');

    const aaplDiv = appleLots.filter(l => l.sourceType === 'dividend');
    const msftDiv = msftLots.filter(l => l.sourceType === 'dividend');
    const googlDiv = googlLots.filter(l => l.sourceType === 'dividend');

    expect(aaplDiv).toHaveLength(1);
    expect(msftDiv).toHaveLength(1);
    expect(googlDiv).toHaveLength(1);

    expect(Number(aaplDiv[0].remainingQuantity)).toBeCloseTo(1, 3);
    expect(Number(msftDiv[0].remainingQuantity)).toBeCloseTo(0.5, 6);
    expect(Number(googlDiv[0].remainingQuantity)).toBeCloseTo(0.25, 6);
  });
});
