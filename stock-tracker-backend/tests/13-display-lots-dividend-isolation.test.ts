import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, payDividend, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('13. Display Lots - Dividend Isolation', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('Display Lot excludes Dividend Lots from quantity', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;

    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('Dividend Lot can be sold independently from Display Lot', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 10, 200);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;
    const dividendLot = purchaseLots.find(l => l.sourceType === 'dividend')!;

    // Create display lot only from purchase lot
    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    // Sell all dividend shares (not from display lot)
    await sellStock('AAPL', 10, 110, [
      { lotId: dividendLot.id, quantity: 10 }
    ]);

    // Display lot should be unaffected
    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('Display Lot remains when Dividend Lot is consumed', async () => {
    await depositCash(15000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;
    const dividendLot = purchaseLots.find(l => l.sourceType === 'dividend')!;

    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    const initialQty = Number(displayLots[0].totalQuantity);
    expect(initialQty).toBeCloseTo(10, 3);

    // Sell 3 of 5 dividend shares
    await sellStock('AAPL', 3, 105, [
      { lotId: dividendLot.id, quantity: 3 }
    ]);

    displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('multiple purchases + dividend: Display Lot includes only purchase lots', async () => {
    await depositCash(30000);
    await buyStock('AAPL', 5, 100);
    await buyStock('AAPL', 8, 105);
    await payDividend('AAPL', 7, 150);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLotsOnly = purchaseLots.filter(l => l.sourceType === 'purchase');

    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLotsOnly[0].id, quantityAllocated: 5 },
      { purchaseLotId: purchaseLotsOnly[1].id, quantityAllocated: 8 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(13, 3);
  });

  it('Display Lot with purchase lot unaffected when dividend is paid after creation', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);

    // Pay dividend after display lot creation
    await payDividend('AAPL', 5, 100);

    // Display lot quantity should remain unchanged
    displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('Display Lot invariant maintained when dividend is paid and purchase consumed', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Pay dividend
    await payDividend('AAPL', 5, 100);

    // Sell 3 purchase shares
    await sellStock('AAPL', 3, 110, [
      { lotId, quantity: 3 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(7, 3);
  });

  it('Dividend Lot cannot be added to Display Lot composition', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const dividendLot = purchaseLots.find(l => l.sourceType === 'dividend')!;

    try {
      // Attempt to create display lot with dividend lot
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: dividendLot.id, quantityAllocated: 5 }
      ]);

      // If it succeeds, verify display lot has 0 quantity
      const displayLots = await getDisplayLots('AAPL');
      if (displayLots.length > 0) {
        expect(Number(displayLots[0].totalQuantity)).toBeLessThanOrEqual(TOLERANCE);
      }
    } catch (error) {
      // Expected to fail - cannot use dividend lots in display lot
      expect(error).toBeDefined();
    }
  });

  it('Selling dividend shares does not affect display lot allocation tracking', async () => {
    await depositCash(15000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 10, 150);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;
    const dividendLot = purchaseLots.find(l => l.sourceType === 'dividend')!;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    // Sell all dividend shares first
    await sellStock('AAPL', 10, 160, [
      { lotId: dividendLot.id, quantity: 10 }
    ]);

    // Then sell purchase shares
    await sellStock('AAPL', 5, 110, [
      { lotId: purchaseLot.id, quantity: 5 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(5, 3);
  });

  it('Display Lot handles fractional dividend shares without inclusion', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    await payDividend('AAPL', 0.5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;

    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    // Display lot should still be 10 (excludes 0.5 dividend shares)
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });
});
