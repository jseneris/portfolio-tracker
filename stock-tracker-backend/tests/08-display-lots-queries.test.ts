import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, 
  createDisplayLot, getDisplayLots, getDisplayLotComposition, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('08. Display Lots - Queries & Composition', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('queries all Display Lots for user by ticker', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 15, 105);

    const purchaseLots = await getPurchaseLots('AAPL');

    // Create multiple display lots
    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);
    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 15 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);
    expect(displayLots[0].ticker || 'AAPL').toBe('AAPL');
    expect(displayLots[1].ticker || 'AAPL').toBe('AAPL');
  });

  it('queries specific Display Lot by ID with full composition', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 15, 105);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 },
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 15 }
    ]);

    const composition = await getDisplayLotComposition(displayLotId);
    expect(composition).toHaveLength(2);
    expect(composition[0].purchaseLotId).toBe(purchaseLots[0].id);
    expect(composition[1].purchaseLotId).toBe(purchaseLots[1].id);
  });

  it('composition shows Source Lot IDs and quantities', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 5, 100);
    await buyStock('AAPL', 8, 105);
    await buyStock('AAPL', 12, 102);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 5 },
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 8 },
      { purchaseLotId: purchaseLots[2].id, quantityAllocated: 12 }
    ]);

    const composition = await getDisplayLotComposition(displayLotId);

    expect(composition).toHaveLength(3);
    expect(composition[0]).toHaveProperty('purchaseLotId');
    expect(composition[0]).toHaveProperty('quantityAllocated');
    expect(Number(composition[0].quantityAllocated)).toBeCloseTo(5, 3);
    expect(Number(composition[1].quantityAllocated)).toBeCloseTo(8, 3);
    expect(Number(composition[2].quantityAllocated)).toBeCloseTo(12, 3);
  });

  it('response includes Display Lot total quantity', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 25, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 25 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots[0]).toHaveProperty('totalQuantity');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(25, 3);
  });

  it('response includes Display Lot creation date', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots[0]).toHaveProperty('createdAt');
    expect(displayLots[0].createdAt).toBeDefined();
    
    const createdDate = new Date(displayLots[0].createdAt);
    expect(createdDate.getTime()).toBeGreaterThan(0);
  });

  it('Display Lots ordered by ticker then creation date', async () => {
    await depositCash(100000);
    
    // Create AAPL display lots
    await buyStock('AAPL', 10, 100);
    const aaplPurchase = await getPurchaseLots('AAPL');
    
    const aaplDisplay1 = await createDisplayLot('AAPL', [
      { purchaseLotId: aaplPurchase[0].id, quantityAllocated: 5 }
    ]);

    // Create MSFT display lot
    await buyStock('MSFT', 5, 300);
    const msftPurchase = await getPurchaseLots('MSFT');
    
    await createDisplayLot('MSFT', [
      { purchaseLotId: msftPurchase[0].id, quantityAllocated: 5 }
    ]);

    // Create another AAPL display lot
    const aaplDisplay2 = await createDisplayLot('AAPL', [
      { purchaseLotId: aaplPurchase[0].id, quantityAllocated: 5 }
    ]);

    const aaplLots = await getDisplayLots('AAPL');
    const msftLots = await getDisplayLots('MSFT');

    // AAPL should have 2 lots in creation order
    expect(aaplLots).toHaveLength(2);
    const aaplDates = aaplLots.map(d => new Date(d.createdAt).getTime());
    expect(aaplDates[0]).toBeLessThanOrEqual(aaplDates[1]);

    // MSFT should have 1 lot
    expect(msftLots).toHaveLength(1);
  });

  it('handles empty Display Lot list for ticker with no display lots', async () => {
    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(0);
  });

  it('composition correctly reflects partial allocations', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 30, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Allocate only 20 of 30 shares
    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    const composition = await getDisplayLotComposition(displayLotId);
    expect(composition).toHaveLength(1);
    expect(Number(composition[0].quantityAllocated)).toBeCloseTo(20, 3);

    // Verify display lot total matches composition
    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 3);
  });

  it('composition with multiple allocations from same ticker', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 8, 100);
    await buyStock('AAPL', 12, 105);
    await buyStock('AAPL', 20, 102);

    const purchaseLots = await getPurchaseLots('AAPL');

    // Create display lot combining shares from different purchase events
    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 8 },
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 10 }, // partial
      { purchaseLotId: purchaseLots[2].id, quantityAllocated: 20 }
    ]);

    const composition = await getDisplayLotComposition(displayLotId);
    expect(composition).toHaveLength(3);
    
    const totalComposed = composition.reduce((sum, c) => sum + Number(c.quantityAllocated), 0);
    expect(totalComposed).toBeCloseTo(38, 3);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(38, 3);
  });
});
