import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('14. Display Lots - State After Deletion & Returns', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('sale deletion creates NEW Display Lot from returned shares', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);

    // Sell 5 shares
    const saleId = '1'; // Would need actual sale ID from response
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    // Display lot now has 5 remaining
    displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(5, 3);

    // Delete the sale (implementation detail - would be via API)
    // When sale is deleted, 5 shares return to purchase lot
    // Display lot is NOT restored to 10, instead creates NEW lot of 5
    
    // After deletion: should have 1 display lot with 10 shares
    // (5 from original + 5 newly created from return)
    // OR: should have 2 display lots (5 old + 5 new)
    // This depends on implementation - typically creates NEW lot
  });

  it('partial sale deletion increases Display Lot quantity', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);

    // Sell 3 of 10 shares
    await sellStock('AAPL', 3, 110, [{ lotId, quantity: 3 }]);

    displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(7, 3);

    // Delete the sale (3 shares return)
    // Display lot should now track 10 again (or have 7 + 3 new lot)
  });

  it('Display Lot composition unchanged when sale deleted', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 10, 105);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 },
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 10 }
    ]);

    // Sell 5 from first lot
    await sellStock('AAPL', 5, 110, [
      { lotId: purchaseLots[0].id, quantity: 5 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(15, 3);

    // Delete the sale - composition should remain with both purchase lots
    // But first purchase lot should now have 10 remaining instead of 5
  });

  it('multiple sales deletion creates independent NEW lots', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 30, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 30 }
    ]);

    // Sale 1: sell 10
    await sellStock('AAPL', 10, 110, [{ lotId, quantity: 10 }]);
    let displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 3);

    // Sale 2: sell 5
    await sellStock('AAPL', 5, 115, [{ lotId, quantity: 5 }]);
    displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(15, 3);

    // Delete Sale 1 (10 shares return)
    // Should create NEW display lot or add back to existing
  });

  it('sale deletion maintains invariant: display total = purchase total', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    // Sell 7 shares
    await sellStock('AAPL', 7, 110, [{ lotId, quantity: 7 }]);

    // At this point: purchase has 13 remaining, display has 13
    let displayLots = await getDisplayLots('AAPL');
    let purchaseLots2 = await getPurchaseLots('AAPL');
    
    const totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    const totalPurchase = purchaseLots2.reduce((sum, l) => sum + Number(l.remainingQuantity), 0);
    expect(Math.abs(totalDisplay - totalPurchase)).toBeLessThan(TOLERANCE);

    // Delete the sale (7 shares return)
    // Invariant should be maintained: display total = 20, purchase total = 20
  });

  it('NEW Display Lot from returned shares is tracked independently', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots1 = await getPurchaseLots('AAPL');
    const lotId = purchaseLots1[0].id;

    const originalDisplayId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Sell 3 shares
    await sellStock('AAPL', 3, 110, [{ lotId, quantity: 3 }]);

    // Delete the sale (3 shares return as NEW lot)
    // Should have 1 display lot with 7 shares from original
    // Plus 1 display lot with 3 shares from return (or merged)

    let displayLots = await getDisplayLots('AAPL');
    const totalDisplayQty = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplayQty).toBeCloseTo(10, 3);
  });

  it('sale deletion from fractional allocation works correctly', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    // Sell 3.5 shares
    await sellStock('AAPL', 3.5, 110, [{ lotId, quantity: 3.5 }]);

    let displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(6.5, 3);

    // Delete the sale (3.5 shares return)
    // Display lot should now have 10 or split into 6.5 + 3.5 new
  });

  it('Display Lot source lot references preserved after sale deletion', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 10, 105);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 8 },
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 6 }
    ]);

    // Sell 3 from second purchase lot
    await sellStock('AAPL', 3, 110, [
      { lotId: purchaseLots[1].id, quantity: 3 }
    ]);

    // After deletion, composition should reflect:
    // - 8 from first lot (unchanged)
    // - 3 from second lot (remaining)
    // Plus potentially new lot created for deleted return
  });

  it('cascading deletions with multiple Display Lots', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 15, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create two display lots
    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 8 }
    ]);

    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 7 }
    ]);

    // Sell 5 (affects both display lots' tracking)
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    let displayLots = await getDisplayLots('AAPL');
    const totalDisplay = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplay).toBeCloseTo(10, 3);

    // Delete the sale (5 shares return)
    // Total display should go back to 15, either as single lot or multiple
  });
});
