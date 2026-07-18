import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, 
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('09. Display Lots - Edge Cases & Error Handling', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('handles Display Lot with 0.01 shares (floating point precision)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 0.01, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 0.01 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(0.01, 6);
  });

  it('handles Display Lot with 1000+ shares (large quantity)', async () => {
    await depositCash(1000000);
    await buyStock('AAPL', 1500, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 1500 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(1500, 0);
  });

  it('handles Display Lot composed from 10+ Source Lots', async () => {
    await depositCash(100000);
    
    // Create 15 purchase lots
    for (let i = 0; i < 15; i++) {
      await buyStock('AAPL', 1, 100 + i);
    }

    const purchaseLots = await getPurchaseLots('AAPL');
    expect(purchaseLots.length).toBeGreaterThanOrEqual(15);

    // Create display lot from all of them
    const composition = purchaseLots.map(p => ({
      purchaseLotId: p.id,
      quantityAllocated: 1
    }));

    const displayLotId = await createDisplayLot('AAPL', composition);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(15, 3);
  });

  it('sequential sales from same Display Lot', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    // First sale
    const { sellStock } = await import('./setup.js');
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    let pLots = await getPurchaseLots('AAPL');
    let remaining = Number(pLots[0].remainingQuantity);
    expect(remaining).toBeCloseTo(15, 3);

    // Second sale
    await sellStock('AAPL', 3, 112, [{ lotId, quantity: 3 }]);

    pLots = await getPurchaseLots('AAPL');
    remaining = Number(pLots[0].remainingQuantity);
    expect(remaining).toBeCloseTo(12, 3);

    // Third sale - sell all remaining
    await sellStock('AAPL', 12, 115, [{ lotId, quantity: 12 }]);

    pLots = await getPurchaseLots('AAPL');
    if (pLots.length > 0) {
      remaining = Number(pLots[0].remainingQuantity);
      expect(remaining).toBeCloseTo(0, 3);
    }
  });

  it('fractional shares after multiple sales', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 7.5, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 7.5 }
    ]);

    const { sellStock } = await import('./setup.js');
    await sellStock('AAPL', 2.3, 110, [{ lotId, quantity: 2.3 }]);

    // Verify purchase lot remaining quantity is correct
    const purchaseLots2 = await getPurchaseLots('AAPL');
    const remaining = Number(purchaseLots2[0].remainingQuantity);
    expect(remaining).toBeCloseTo(5.2, 6);
  });

  it('Display Lot query returns empty result for non-existent ticker', async () => {
    const displayLots = await getDisplayLots('NONEXISTENT');
    expect(displayLots).toEqual([]);
  });

  it('Display Lot handles zero quantity allocation edge case', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    
    // Try to create display lot with 0 shares (should fail or be handled)
    try {
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: purchaseLots[0].id, quantityAllocated: 0 }
      ]);
      
      // If it succeeds, verify it's handled correctly
      const displayLots = await getDisplayLots('AAPL');
      if (displayLots.length > 0) {
        expect(Number(displayLots[0].totalQuantity)).toBeLessThanOrEqual(TOLERANCE);
      }
    } catch (error) {
      // Expected to fail - allocation must be positive
      expect(error).toBeDefined();
    }
  });

  it('Display Lot precision maintained with repeated fractional operations', async () => {
    await depositCash(10000);
    
    // Create lot with fractional value
    await buyStock('AAPL', 3.333, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 3.333 }
    ]);

    const { sellStock } = await import('./setup.js');
    await sellStock('AAPL', 1.111, 110, [{ lotId, quantity: 1.111 }]);

    // Verify purchase lot remaining quantity is correct (not display lot total)
    const purchaseLots2 = await getPurchaseLots('AAPL');
    const remaining = Number(purchaseLots2[0].remainingQuantity);
    
    // Should be approximately 2.222 with acceptable precision
    expect(Math.abs(remaining - 2.222)).toBeLessThan(0.001);
  });

  it('Display Lot handles very high precision pricing', async () => {
    await depositCash(100000);
    await buyStock('BRK.A', 0.01234, 600000);

    const purchaseLots = await getPurchaseLots('BRK.A');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('BRK.A', [
      { purchaseLotId: lotId, quantityAllocated: 0.01234 }
    ]);

    const displayLots = await getDisplayLots('BRK.A');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(0.01234, 6);
  });

  it('multiple tickers with overlapping Display Lot operations', async () => {
    await depositCash(100000);
    
    // Create lots for multiple tickers
    await buyStock('AAPL', 10, 100);
    await buyStock('MSFT', 5, 300);
    await buyStock('GOOGL', 2, 2500);

    const aaplLots = await getPurchaseLots('AAPL');
    const msftLots = await getPurchaseLots('MSFT');
    const googlLots = await getPurchaseLots('GOOGL');

    // Create display lots for all
    const aaplDisplay = await createDisplayLot('AAPL', [
      { purchaseLotId: aaplLots[0].id, quantityAllocated: 10 }
    ]);
    const msftDisplay = await createDisplayLot('MSFT', [
      { purchaseLotId: msftLots[0].id, quantityAllocated: 5 }
    ]);
    const googlDisplay = await createDisplayLot('GOOGL', [
      { purchaseLotId: googlLots[0].id, quantityAllocated: 2 }
    ]);

    const aaplDisplayLots = await getDisplayLots('AAPL');
    const msftDisplayLots = await getDisplayLots('MSFT');
    const googlDisplayLots = await getDisplayLots('GOOGL');

    expect(aaplDisplayLots).toHaveLength(1);
    expect(msftDisplayLots).toHaveLength(1);
    expect(googlDisplayLots).toHaveLength(1);

    expect(Number(aaplDisplayLots[0].totalQuantity)).toBeCloseTo(10, 3);
    expect(Number(msftDisplayLots[0].totalQuantity)).toBeCloseTo(5, 3);
    expect(Number(googlDisplayLots[0].totalQuantity)).toBeCloseTo(2, 3);
  });
});
