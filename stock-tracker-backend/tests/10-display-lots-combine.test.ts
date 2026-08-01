import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, 
  createDisplayLot, getDisplayLots, TEST_USER_ID 
} from './setup.js';
import request from 'supertest';
import app from '../src/index.js';

describe('10. Display Lots - Combine Operations', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('combines two lot indices into one', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 20, 100);

    const displayId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);

    const response = await request(app)
      .post(`/api/display-lots/${displayId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 1] })
      .expect(201);

    displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 3);
  });

  it('combine three indices into one', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 30, 100);

    const displayId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 1, 2] })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(30, 3);
  });

  it('combine preserves total quantity', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 15, 105);

    const displayId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 15 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 1] })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(25, 3);
  });

  it('combine single index fails (requires at least two)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0] })
      .expect(400);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('combine fails with out-of-range index', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 10, 100);

    const displayId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 },
      { purchaseLotId: 'seed', quantityAllocated: 1 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 2] })
      .expect(400);
  });

  it('combine fails with non-existent Display Lot ID', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await request(app)
      .post(`/api/display-lots/${fakeId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 1] })
      .expect(404);
  });

  it('combine fails with empty list', async () => {
    const response = await request(app)
      .post('/api/display-lots/nonexistent/combine')
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [] })
      .expect(400);
  });

  it('combine with mixed quantities', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 35, 100);

    const displayId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 8.5 },
      { purchaseLotId: 'seed', quantityAllocated: 12.3 },
      { purchaseLotId: 'seed', quantityAllocated: 14.2 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices: [0, 1, 2] })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(35, 3);
  });
});
