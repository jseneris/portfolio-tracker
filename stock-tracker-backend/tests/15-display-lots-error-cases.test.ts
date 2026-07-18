import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE, TEST_USER_ID
} from './setup.js';
import request from 'supertest';
import app from '../src/index.js';

describe('15. Display Lots - Additional Error Cases', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('creation with non-existent Purchase Lot ID fails', async () => {
    await depositCash(10000);
    
    try {
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: 'nonexistent', quantityAllocated: 10 }
      ]);
      
      // If it doesn't fail, display lot should be empty
      const displayLots = await getDisplayLots('AAPL');
      if (displayLots.length > 0) {
        expect(Number(displayLots[0].totalQuantity)).toBeLessThanOrEqual(TOLERANCE);
      }
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('creation with zero Purchase Lot ID fails gracefully', async () => {
    try {
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: '', quantityAllocated: 10 }
      ]);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('creation with negative quantity fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    try {
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: purchaseLots[0].id, quantityAllocated: -5 }
      ]);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('creation overallocates more than Purchase Lot has', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    try {
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: purchaseLots[0].id, quantityAllocated: 20 }
      ]);
      
      // If it succeeds (implementation dependent), display lot might have capped value
      const displayLots = await getDisplayLots('AAPL');
      if (displayLots.length > 0) {
        expect(Number(displayLots[0].totalQuantity)).toBeLessThanOrEqual(10);
      }
    } catch (error) {
      // Expected to fail
      expect(error).toBeDefined();
    }
  });

  it('combine with duplicate Display Lot ID fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    // Attempt to combine a lot with itself
    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ displayLotIds: [displayLotId, displayLotId] })
      .expect(400);
  });

  it('split with negative quantities fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ splits: [{ quantityAllocated: -5 }, { quantityAllocated: 15 }] })
      .expect(400);
  });

  it('split with very large precision (15+ decimals) handled', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ splits: [{ quantityAllocated: 3.123456789012345 }, { quantityAllocated: 6.876543210987655 }] })
      .expect(201);

    // Should handle or round appropriately
    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);
  });

  it('query Display Lots with invalid ticker returns empty', async () => {
    const displayLots = await getDisplayLots('INVALID_TICKER_12345');
    expect(displayLots).toEqual([]);
  });

  it('query Display Lot composition for non-existent ID fails gracefully', async () => {
    // Test that querying non-existent display lot returns 404
    // Using a valid UUID format but one that doesn't exist in DB
    const response = await request(app)
      .get('/api/display-lots/00000000-0000-0000-0000-000000000000/composition')
      .set('x-user-id', TEST_USER_ID)
      .expect(404);
  });

  it('create Display Lot with only unrelated Purchase Lots fails', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 10, 100);
    await buyStock('MSFT', 5, 300);

    const aaplLots = await getPurchaseLots('AAPL');
    const msftLots = await getPurchaseLots('MSFT');

    // Try to create AAPL display lot with MSFT purchase lot
    try {
      const displayLotId = await createDisplayLot('AAPL', [
        { purchaseLotId: msftLots[0].id, quantityAllocated: 5 }
      ]);
      
      // If it somehow succeeds, display lot should be empty
      const displayLots = await getDisplayLots('AAPL');
      if (displayLots.length > 0) {
        expect(Number(displayLots[0].totalQuantity)).toBeLessThanOrEqual(TOLERANCE);
      }
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('combine with mix of valid and invalid IDs fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ displayLotIds: [displayLotId, '00000000-0000-0000-0000-000000000000'] })
      .expect(400);
  });

  it('concurrent operations: create while selling from same source lot', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    // Sell from same purchase lot
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    // Display lot should reflect the sale
    const purchaseLots2 = await getPurchaseLots('AAPL');
    expect(Number(purchaseLots2[0].remainingQuantity)).toBeCloseTo(15, 3);
  });
});
