import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, 
  createDisplayLot, getDisplayLots, TEST_USER_ID 
} from './setup.js';
import request from 'supertest';
import app from '../src/index.js';

describe('11. Display Lots - Split Operations', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('splits 10-share Display Lot into two 5-share lots', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [5, 5] })
      .expect(201);

    displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);
    expect(displayLots.map(d => Number(d.totalQuantity)).sort()).toEqual([5, 5]);
  });

  it('splits into unequal quantities [3, 7]', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [3, 7] })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);
    expect(displayLots.map(d => Number(d.totalQuantity)).sort()).toEqual([3, 7]);
  });

  it('splits into three parts [4, 3, 3]', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [4, 3, 3] })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(3);
    expect(displayLots.map(d => Number(d.totalQuantity)).sort()).toEqual([3, 3, 4]);
  });

  it('split fails when quantities sum exceeds lot size', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [6, 5] })
      .expect(400);
  });

  it('split fails when quantities sum less than lot size', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [4, 5] })
      .expect(400);
  });

  it('split with fractional quantities [2.5, 2.5, 5]', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [2.5, 2.5, 5] })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(3);
    expect(Number(displayLots.find(d => Number(d.totalQuantity) === 2.5)?.totalQuantity || 0))
      .toBeCloseTo(2.5, 3);
  });

  it('split non-existent Display Lot fails', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await request(app)
      .post(`/api/display-lots/${fakeId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [5, 5] })
      .expect(404);
  });

  it('split with empty quantities list fails', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [] })
      .expect(400);
  });

  it('split into single quantity (no-op)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities: [10] })
      .expect(400);
  });

  it('split with many parts [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: 'seed', quantityAllocated: 10 }
    ]);

    const quantities = Array(10).fill(1);
    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities })
      .expect(201);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(10);
    displayLots.forEach(lot => {
      expect(Number(lot.totalQuantity)).toBeCloseTo(1, 3);
    });
  });
});
