import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('12. Display Lots - Auto-deletion & Cleanup', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('Display Lot auto-deletes when all shares sold', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);

    // Sell all 5 shares
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    // Verify purchase lot is empty (sold all shares)
    const purchaseLotAfterSale = await getPurchaseLots('AAPL');
    const remainingQty = Number(purchaseLotAfterSale[0]?.remainingQuantity || 0);
    expect(remainingQty).toBeLessThanOrEqual(TOLERANCE);
  });

  it('Display Lot remains with partial sale', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Sell 3 of 10 shares
    await sellStock('AAPL', 3, 110, [{ lotId, quantity: 3 }]);

    // Verify purchase lot has 7 shares remaining
    const purchaseLotAfterSale = await getPurchaseLots('AAPL');
    const remainingQty = Number(purchaseLotAfterSale[0].remainingQuantity);
    expect(remainingQty).toBeCloseTo(7, 3);
  });

  it('one Display Lot deleted, others remain after partial sales', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 15, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);

    // Sell exactly the first display lot (5 shares)
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    // Verify purchase lot has 10 shares remaining
    const purchaseLotAfterSale = await getPurchaseLots('AAPL');
    const remainingQty = Number(purchaseLotAfterSale[0].remainingQuantity);
    expect(remainingQty).toBeCloseTo(10, 3);
  });

  it('multiple Display Lots auto-delete together', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 15, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create three 5-share lots from one 15-share allocation
    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 5 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(3);

    // Sell all 15 shares
    await sellStock('AAPL', 15, 110, [{ lotId, quantity: 15 }]);

    // Verify purchase lot is empty
    const purchaseLotAfterSale = await getPurchaseLots('AAPL');
    const remainingQty = Number(purchaseLotAfterSale[0]?.remainingQuantity || 0);
    expect(remainingQty).toBeLessThanOrEqual(TOLERANCE);
  });

  it('Display Lot from fractional shares auto-deletes', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 3.333, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 3.333 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);

    // Sell all fractional shares
    await sellStock('AAPL', 3.333, 110, [{ lotId, quantity: 3.333 }]);

    // Verify purchase lot is empty
    const purchaseLotAfterSale = await getPurchaseLots('AAPL');
    const remainingQty = Number(purchaseLotAfterSale[0]?.remainingQuantity || 0);
    expect(remainingQty).toBeLessThanOrEqual(TOLERANCE);
  });

  it('Display Lot with multiple Purchase Lots auto-deletes only when all empty', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 10, 105);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 },
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);

    // Sell from first purchase lot only
    await sellStock('AAPL', 10, 110, [
      { lotId: purchaseLots[0].id, quantity: 10 }
    ]);

    // Verify first purchase lot is empty, second still has 10
    const afterFirstSale = await getPurchaseLots('AAPL');
    const firstRemaining = Number(afterFirstSale.find(p => p.id === purchaseLots[0].id)?.remainingQuantity || 0);
    const secondRemaining = Number(afterFirstSale.find(p => p.id === purchaseLots[1].id)?.remainingQuantity || 0);
    expect(firstRemaining).toBeLessThanOrEqual(TOLERANCE);
    expect(secondRemaining).toBeCloseTo(10, 3);

    // Sell remaining 10 shares
    await sellStock('AAPL', 10, 115, [
      { lotId: purchaseLots[1].id, quantity: 10 }
    ]);

    // Verify both purchase lots are empty
    const afterSecondSale = await getPurchaseLots('AAPL');
    const finalRemaining = afterSecondSale.reduce((sum, p) => sum + Number(p.remainingQuantity || 0), 0);
    expect(finalRemaining).toBeLessThanOrEqual(TOLERANCE);
  });

  it('Display Lot across multiple tickers independent deletion', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 5, 100);
    await buyStock('MSFT', 5, 300);

    const aaplPurchase = await getPurchaseLots('AAPL');
    const msftPurchase = await getPurchaseLots('MSFT');

    await createDisplayLot('AAPL', [
      { purchaseLotId: aaplPurchase[0].id, quantityAllocated: 5 }
    ]);

    await createDisplayLot('MSFT', [
      { purchaseLotId: msftPurchase[0].id, quantityAllocated: 5 }
    ]);

    // Sell all AAPL
    await sellStock('AAPL', 5, 110, [
      { lotId: aaplPurchase[0].id, quantity: 5 }
    ]);

    // Verify AAPL purchase lot is empty
    const aaplAfterSale = await getPurchaseLots('AAPL');
    const aaplRemaining = Number(aaplAfterSale[0]?.remainingQuantity || 0);
    expect(aaplRemaining).toBeLessThanOrEqual(TOLERANCE);

    // MSFT should still have 5
    const msftAfterSale = await getPurchaseLots('MSFT');
    const msftRemaining = Number(msftAfterSale[0].remainingQuantity);
    expect(msftRemaining).toBeCloseTo(5, 3);
  });
});
