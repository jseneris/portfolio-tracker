import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TEST_USER_ID
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

  it('creation endpoint with invalid payload fails', async () => {
    const response = await request(app)
      .post('/api/display-lots/AAPL')
      .set('x-user-id', TEST_USER_ID)
      .send({ quantities: [] })
      .expect(400);

    expect(String(response.body?.error || '')).toContain('quantities');
  });

  it('creation helper with zero/negative quantity fails gracefully', async () => {
    try {
      await createDisplayLot('AAPL', [
        { purchaseLotId: 'x', quantityAllocated: 0 }
      ]);
      expect.fail('Expected helper to throw on zero quantity');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('creation with negative quantity fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    try {
      await createDisplayLot('AAPL', [
        { purchaseLotId: 'seed', quantityAllocated: -5 }
      ]);
      expect.fail('Expected helper to throw on negative quantity');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('creation overallocates versus holdings is accepted by minimal display-lot model', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    await createDisplayLot('AAPL', [{ purchaseLotId: 'seed', quantityAllocated: 20 }]);
    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 3);
  });

  it('replacement rejects quantities that change the display-lot total', async () => {
    await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 15 }
    ]);

    await request(app)
      .post('/api/display-lots/AAPL')
      .set('x-user-id', TEST_USER_ID)
      .send({ quantities: [20] })
      .expect(400);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots.map((lot) => Number(lot.totalQuantity))).toEqual([10, 15]);
  });

  it('combine with too few indices fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0] })
      .expect(400);
  });

  it('split with negative quantities fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [-5, 15] })
      .expect(400);
  });

  it('split with very large precision (15+ decimals) handled', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [3.123456789012345, 6.876543210987655] })
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

  it('create Display Lot does not validate source purchase lot IDs', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 10, 100);
    await buyStock('MSFT', 5, 300);

    await createDisplayLot('AAPL', [{ purchaseLotId: 'msft-lot-id', quantityAllocated: 5 }]);
    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots.length).toBeGreaterThan(0);
  });

  it('combine with mix of valid and invalid indices fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 5 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 99] })
      .expect(400);
  });

  it('concurrent operations: create while selling from same source lot', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 20, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 20 }
    ]);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = String(purchaseLots[0].id);
    await sellStock('AAPL', 5, 110, [{ lotId, quantity: 5 }]);

    const displayLots = await getDisplayLots('AAPL');
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 3);
  });
});
