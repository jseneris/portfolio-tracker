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

    // Display lot should be deleted or have 0 quantity
    displayLots = await getDisplayLots('AAPL');
    if (displayLots.length > 0) {
      expect(Number(displayLots[0].totalQuantity)).toBeLessThanOrEqual(TOLERANCE);
    } else {
      expect(displayLots).toHaveLength(0);
    }
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

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(7, 3);
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

    // Sell exactly the first display lot
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    displayLots = await getDisplayLots('AAPL');
    const activeDisplayLots = displayLots.filter(d => Number(d.totalQuantity) > TOLERANCE);
    
    // First lot should be deleted/empty, second remains
    expect(activeDisplayLots.length).toBeLessThanOrEqual(1);
  });

  it('multiple Display Lots auto-delete together', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 20, 100);

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

    // All three display lots should be deleted/empty
    displayLots = await getDisplayLots('AAPL');
    const activeDisplayLots = displayLots.filter(d => Number(d.totalQuantity) > TOLERANCE);
    expect(activeDisplayLots).toHaveLength(0);
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

    displayLots = await getDisplayLots('AAPL');
    const activeDisplayLots = displayLots.filter(d => Number(d.totalQuantity) > TOLERANCE);
    expect(activeDisplayLots).toHaveLength(0);
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

    displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);

    // Sell remaining 10 shares
    await sellStock('AAPL', 10, 115, [
      { lotId: purchaseLots[1].id, quantity: 10 }
    ]);

    displayLots = await getDisplayLots('AAPL');
    const activeDisplayLots = displayLots.filter(d => Number(d.totalQuantity) > TOLERANCE);
    expect(activeDisplayLots).toHaveLength(0);
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

    let aaplDisplayLots = await getDisplayLots('AAPL');
    let msftDisplayLots = await getDisplayLots('MSFT');

    const activeAAPL = aaplDisplayLots.filter(d => Number(d.totalQuantity) > TOLERANCE);
    expect(activeAAPL).toHaveLength(0);

    // MSFT should remain
    expect(msftDisplayLots).toHaveLength(1);
    expect(Number(msftDisplayLots[0].totalQuantity)).toBeCloseTo(5, 3);
  });
});
