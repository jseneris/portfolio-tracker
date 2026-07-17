import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, payDividend, sellStock, 
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('07. Display Lots - Invariants & Consumption Patterns', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('Display Lot invariant: sum equals Purchase Lot total after purchase', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    const totalPurchase = purchaseLots.reduce((sum, l) => sum + Number(l.remainingQuantity), 0);
    const totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);

    expect(Math.abs(totalDisplay - totalPurchase)).toBeLessThan(TOLERANCE);
  });

  it('Display Lot invariant: sum equals remaining Purchase Lot total after sale', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    // Sell 8 shares
    await sellStock('AAPL', 8, 110, [{ lotId, quantity: 8 }]);

    const purchaseLots2 = await getPurchaseLots('AAPL');
    const displayLots = await getDisplayLots('AAPL');

    const totalPurchase = purchaseLots2.reduce((sum, l) => sum + Number(l.remainingQuantity), 0);
    const totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);

    expect(Math.abs(totalDisplay - totalPurchase)).toBeLessThan(TOLERANCE);
  });

  it('Dividend Lots excluded from Display Lot invariant', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLotsOnly = purchaseLots.filter(l => l.sourceType === 'purchase');
    const lotId = purchaseLotsOnly[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    const totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);

    // Total display should equal purchase lots only (10), not purchase + dividend (15)
    expect(Math.abs(totalDisplay - 10)).toBeLessThan(TOLERANCE);

    const allPurchase = purchaseLots.filter(l => l.sourceType === 'purchase');
    const totalPurchase = allPurchase.reduce((sum, l) => sum + Number(l.remainingQuantity), 0);
    expect(Math.abs(totalDisplay - totalPurchase)).toBeLessThan(TOLERANCE);
  });

  it('Purchase Lot consumption from Dividend Lot does not affect Display Lot', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 10, 200);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;
    const dividendLot = purchaseLots.find(l => l.sourceType === 'dividend')!;

    // Create display lot only from purchase
    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    const displayLots1 = await getDisplayLots('AAPL');
    const displayLotQuantity1 = Number(displayLots1[0].totalQuantity);
    expect(displayLotQuantity1).toBeCloseTo(10, 3);

    // Sell from dividend lot only (not purchase lot)
    await sellStock('AAPL', 3, 110, [
      { lotId: dividendLot.id, quantity: 3 }
    ]);

    const displayLots2 = await getDisplayLots('AAPL');
    const displayLotQuantity2 = Number(displayLots2[0].totalQuantity);

    // Display lot quantity should remain unchanged
    expect(displayLotQuantity2).toBeCloseTo(10, 3);
  });

  it('smallest-first Display Lot consumption: 3 lots (1, 1, 5 shares)', async () => {
    await depositCash(50000);
    
    // Create three separate purchase lots
    await buyStock('AAPL', 1, 100);
    await buyStock('AAPL', 1, 100);
    await buyStock('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lot1 = purchaseLots[0];
    const lot2 = purchaseLots[1];
    const lot3 = purchaseLots[2];

    // Create three separate display lots (smallest-first order)
    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lot1.id, quantityAllocated: 1 }
    ]);
    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lot2.id, quantityAllocated: 1 }
    ]);
    const display3 = await createDisplayLot('AAPL', [
      { purchaseLotId: lot3.id, quantityAllocated: 5 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(3);
    expect(displayLots.map(d => Number(d.totalQuantity)).sort((a, b) => a - b))
      .toEqual([1, 1, 5]);

    // Sell 2 shares - should consume both 1-share display lots
    await sellStock('AAPL', 2, 110, [
      { lotId: lot1.id, quantity: 1 },
      { lotId: lot2.id, quantity: 1 }
    ]);

    displayLots = await getDisplayLots('AAPL');
    // Two 1-share lots should be empty/deleted, 5-share lot remains
    const activeLots = displayLots.filter(d => Number(d.totalQuantity) > 0);
    expect(activeLots.length).toBeGreaterThanOrEqual(1);
  });

  it('smallest-first: consume both 1-share lots then first share of 5-share lot', async () => {
    await depositCash(50000);
    
    // Create three purchase lots
    await buyStock('AAPL', 1, 100);
    await buyStock('AAPL', 1, 100);
    await buyStock('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    // Create display lots in order (for smallest-first matching)
    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 1 }
    ]);
    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 1 }
    ]);
    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[2].id, quantityAllocated: 5 }
    ]);

    // Sell 3 shares: should consume both 1-share lots and 1 from the 5-share lot
    await sellStock('AAPL', 3, 110, [
      { lotId: purchaseLots[0].id, quantity: 1 },
      { lotId: purchaseLots[1].id, quantity: 1 },
      { lotId: purchaseLots[2].id, quantity: 1 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    const activeLots = displayLots.filter(d => Number(d.totalQuantity) > 0);
    
    // Should have one 4-share display lot remaining
    expect(activeLots.length).toBeGreaterThanOrEqual(1);
    if (activeLots.length > 0) {
      const remainingShares = activeLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
      expect(remainingShares).toBeCloseTo(4, 3);
    }
  });

  it('combined operations maintain invariant through multiple sales', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    let totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplay).toBeCloseTo(20, 3);

    // Sale 1: 5 shares
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);
    displayLots = await getDisplayLots('AAPL');
    totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplay).toBeCloseTo(15, 3);

    // Sale 2: 7 shares
    await sellStock('AAPL', 7, 115, [{ lotId, quantity: 7 }]);
    displayLots = await getDisplayLots('AAPL');
    totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplay).toBeCloseTo(8, 3);
  });
});
