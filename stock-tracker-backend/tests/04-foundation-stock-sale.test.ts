import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { clearUserData, depositCash, buyStock, payDividend, sellStock, getPurchaseLots, getCashBalance, TEST_USER_ID, TOLERANCE } from './setup.js';

describe('04. Foundation - Stock Sale Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('sale consumes exact amount from explicitly allocated Purchase Lot', async () => {
    await depositCash(10000);
    const buyId = await buyStock('AAPL', 10, 100);

    // Get purchase lot ID
    let lots = await getPurchaseLots('AAPL');
    const lotId = lots[0].id;

    // Sell 5 shares from that lot
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    lots = await getPurchaseLots('AAPL');
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(5, 3);
  });

  it('sale can allocate across multiple Purchase Lots', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 15, 105);

    let lots = await getPurchaseLots('AAPL');
    const lot1Id = lots[0].id;
    const lot2Id = lots[1].id;

    // Sell: 5 from lot1, 10 from lot2
    await sellStock('AAPL', 15, 110, [
      { lotId: lot1Id, quantity: 5 },
      { lotId: lot2Id, quantity: 10 }
    ]);

    lots = await getPurchaseLots('AAPL');
    const lot1 = lots.find(l => l.id === lot1Id);
    const lot2 = lots.find(l => l.id === lot2Id);

    expect(Number(lot1!.remainingQuantity)).toBeCloseTo(5, 3);
    expect(Number(lot2!.remainingQuantity)).toBeCloseTo(5, 3);
  });

  it('sale with mixed Purchase and Dividend allocation', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 5, 100);

    let lots = await getPurchaseLots('AAPL');
    const purchaseLot = lots.find(l => l.sourceType === 'purchase')!;
    const dividendLot = lots.find(l => l.sourceType === 'dividend')!;

    // Sell: 5 from purchase, 2 from dividend
    await sellStock('AAPL', 7, 110, [
      { lotId: purchaseLot.id, quantity: 5 },
      { lotId: dividendLot.id, quantity: 2 }
    ]);

    lots = await getPurchaseLots('AAPL');
    const updatedPurchase = lots.find(l => l.id === purchaseLot.id);
    const updatedDividend = lots.find(l => l.id === dividendLot.id);

    expect(Number(updatedPurchase!.remainingQuantity)).toBeCloseTo(5, 3);
    expect(Number(updatedDividend!.remainingQuantity)).toBeCloseTo(3, 3);
  });

  it('cash increased correctly by sale proceeds', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100); // Spend $1000
    const balance1 = await getCashBalance();
    expect(Math.abs(balance1 - 9000)).toBeLessThan(TOLERANCE);

    const lots = await getPurchaseLots('AAPL');
    const lotId = lots[0].id;

    // Sell 5 shares at $120 = $600
    await sellStock('AAPL', 5, 120, [{ lotId, quantity: 5 }]);
    const balance2 = await getCashBalance();
    expect(Math.abs(balance2 - 9600)).toBeLessThan(TOLERANCE); // 9000 + 600
  });

  it('complete lot consumption marks lot as depleted', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    let lots = await getPurchaseLots('AAPL');
    const lotId = lots[0].id;
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(10, 3);

    // Sell entire lot
    await sellStock('AAPL', 10, 110, [{ lotId, quantity: 10 }]);

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(0, 3);
  });

  it('partial sale leaves lot available for future sales', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 20, 100);

    let lots = await getPurchaseLots('AAPL');
    const lotId = lots[0].id;

    // Sell 7 shares
    await sellStock('AAPL', 7, 110, [{ lotId, quantity: 7 }]);
    
    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(13, 3);

    // Sell 5 more from same lot
    await sellStock('AAPL', 5, 115, [{ lotId, quantity: 5 }]);

    lots = await getPurchaseLots('AAPL');
    expect(Number(lots[0].remainingQuantity)).toBeCloseTo(8, 3);
  });

  it('sale profit/loss calculation is correct', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100); // Cost: $1000
    const balance1 = await getCashBalance();

    const lots = await getPurchaseLots('AAPL');
    const lotId = lots[0].id;

    // Sell at profit: 10 shares at $120 = $1200
    await sellStock('AAPL', 10, 120, [{ lotId, quantity: 10 }]);
    const balance2 = await getCashBalance();

    // Should be: 10000 - 1000 + 1200 = 10200
    expect(Math.abs(balance2 - 10200)).toBeLessThan(TOLERANCE);
  });
});
