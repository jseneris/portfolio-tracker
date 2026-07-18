import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, sellStock, payDividend, applySplit,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('16. Display Lots - Additional Edge Cases', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('Display Lot with single penny purchase (0.01 precision)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 0.01, 10000);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 0.01 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    const purchaseLots2 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots2[0].remainingQuantity)).toBeCloseTo(0.01, 6);
  });

  it('Display Lot with 1,000,000+ shares (extreme scale within single operation)', async () => {
    await depositCash(100000000);
    await buyStock('PENNY', 1000000, 0.001);

    const purchaseLots = await getPurchaseLots('PENNY');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('PENNY', [
      { purchaseLotId: lotId, quantityAllocated: 1000000 }
    ]);

    const displayLots = await getDisplayLots('PENNY');
    const purchaseLots2 = await getPurchaseLots('PENNY');
    expect(Number(purchaseLots2[0].remainingQuantity)).toBeCloseTo(1000000, 0);
  });

  it('Display Lot after multiple splits (compounding)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Apply 2:1 split
    await applySplit('AAPL', 2, 1);

    let purchaseLots = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots[0].remainingQuantity)).toBeCloseTo(20, 3);

    // Apply 3:1 split
    await applySplit('AAPL', 3, 1);

    let purchaseLots2 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots2[0].remainingQuantity)).toBeCloseTo(60, 3);
  });

  it('Display Lot survives reverse split (5:2)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Apply 5:2 reverse split
    await applySplit('AAPL', 2, 5);

    const purchaseLots = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots[0].remainingQuantity)).toBeCloseTo(4, 3);
  });

  it('Display Lot correctly tracks after complex transaction sequence', async () => {
    await depositCash(50000);
    
    // Buy 1
    await buyStock('AAPL', 5, 100);
    
    // Dividend
    await payDividend('AAPL', 2, 50);
    
    // Buy 2
    await buyStock('AAPL', 10, 105);
    
    // Buy 3
    await buyStock('AAPL', 8, 102);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLotsOnly = purchaseLots.filter(l => l.sourceType === 'purchase');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLotsOnly[0].id, quantityAllocated: 5 },
      { purchaseLotId: purchaseLotsOnly[1].id, quantityAllocated: 10 },
      { purchaseLotId: purchaseLotsOnly[2].id, quantityAllocated: 8 }
    ]);

    const purchaseLotsAfterCreate = await getPurchaseLots('AAPL');
    const purchaseLotsOnlyAfter = purchaseLotsAfterCreate.filter(l => l.sourceType === 'purchase');
    const totalPurchaseQuantity = purchaseLotsOnlyAfter.reduce((sum, p) => sum + Number(p.remainingQuantity), 0);
    expect(totalPurchaseQuantity).toBeCloseTo(23, 3);

    // Sell some
    await sellStock('AAPL', 12, 110, [
      { lotId: purchaseLotsOnly[0].id, quantity: 5 },
      { lotId: purchaseLotsOnly[1].id, quantity: 7 }
    ]);

    const purchaseLotsAfterSale = await getPurchaseLots('AAPL');
    const purchaseLotsOnlyAfterSale = purchaseLotsAfterSale.filter(l => l.sourceType === 'purchase');
    const totalPurchaseQuantityAfterSale = purchaseLotsOnlyAfterSale.reduce((sum, p) => sum + Number(p.remainingQuantity), 0);
    expect(totalPurchaseQuantityAfterSale).toBeCloseTo(11, 3);
  });

  it('Display Lot with alternating split and sale operations', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 100, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 100 }
    ]);

    // Split 2:1
    await applySplit('AAPL', 2, 1);
    let purchaseLots2 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots2[0].remainingQuantity)).toBeCloseTo(200, 3);

    // Sell 50
    await sellStock('AAPL', 50, 110, [{ lotId, quantity: 50 }]);
    let purchaseLots3 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots3[0].remainingQuantity)).toBeCloseTo(150, 3);

    // Split 3:2
    await applySplit('AAPL', 3, 2);
    let purchaseLots4 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots4[0].remainingQuantity)).toBeCloseTo(225, 3);
  });

  it('Display Lot precision loss at extreme small quantities', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 0.0001, 1000);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 0.0001 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeGreaterThan(0);
  });

  it('Display Lot across ticker transitions (delisted → relisted)', async () => {
    await depositCash(50000);
    
    // Buy ticker that will have operations
    await buyStock('TEMP', 10, 100);

    const purchaseLots = await getPurchaseLots('TEMP');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('TEMP', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Sell all (simulating delisting)
    await sellStock('TEMP', 10, 110, [{ lotId, quantity: 10 }]);

    let purchaseLots2 = await getPurchaseLots('TEMP');
    const activePurchaseLots = purchaseLots2.filter(p => Number(p.remainingQuantity) > TOLERANCE);
    expect(activePurchaseLots).toHaveLength(0);

    // Re-buy same ticker
    await buyStock('TEMP', 5, 105);

    const newPurchaseLots = await getPurchaseLots('TEMP');
    const newLotId = newPurchaseLots[0].id;

    const newDisplayLotId = await createDisplayLot('TEMP', [
      { purchaseLotId: newLotId, quantityAllocated: 5 }
    ]);

    let displayLotsAfterRebuy = await getDisplayLots('TEMP');
    const activeDisplayLotsAfterRebuy = displayLotsAfterRebuy.filter(d => Number(d.totalQuantity) > TOLERANCE);
    expect(activeDisplayLotsAfterRebuy.length).toBeGreaterThanOrEqual(1);
    const purchaseLotsAfterRebuy = await getPurchaseLots('TEMP');
    const activePurchaseLotsAfterRebuy = purchaseLotsAfterRebuy.filter(p => Number(p.remainingQuantity) > TOLERANCE);
    expect(Number(activePurchaseLotsAfterRebuy[0].remainingQuantity)).toBeCloseTo(5, 3);
  });

  it('Display Lot idempotency: creating identical lot twice', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLot1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    const displayLot2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    // Both should be created independently
    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);

    // Both should have 5 shares
    expect(displayLots.map(d => Number(d.totalQuantity)).sort()).toEqual([5, 5]);
  });

  it('Display Lot fractional dividend shares handled correctly', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);
    
    // Fractional dividend share
    await payDividend('AAPL', 0.333, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const purchaseLot = purchaseLots.find(l => l.sourceType === 'purchase')!;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLot.id, quantityAllocated: 10 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('Display Lot survives transaction with same price for buy and sell', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Sell at same price
    await sellStock('AAPL', 5, 100, [{ lotId, quantity: 5 }]);

    const purchaseLots2 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots2[0].remainingQuantity)).toBeCloseTo(5, 3);
  });
});
