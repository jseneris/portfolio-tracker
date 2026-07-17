import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, 
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';
import { request } from 'supertest';
import app from '../src/index.js';

describe('10. Display Lots - Combine Operations', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('combines two Display Lots into one', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(2);

    // Combine display1 and display2
    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [display1, display2] })
      .expect(200);

    displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 3);
  });

  it('combine three Display Lots', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 30, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    const display3 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 10 }
    ]);

    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [display1, display2, display3] })
      .expect(200);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(30, 3);
  });

  it('combine preserves all Purchase Lot allocations', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 10, 100);
    await buyStock('AAPL', 15, 105);

    const purchaseLots = await getPurchaseLots('AAPL');

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[1].id, quantityAllocated: 15 }
    ]);

    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [display1, display2] })
      .expect(200);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(25, 3);
  });

  it('combine single Display Lot (no-op)', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    // Combining one lot should succeed but be a no-op
    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [display1] })
      .expect(200);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(10, 3);
  });

  it('combine fails with cross-ticker Display Lots', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 10, 100);
    await buyStock('MSFT', 5, 300);

    const aaplLots = await getPurchaseLots('AAPL');
    const msftLots = await getPurchaseLots('MSFT');

    const aaplDisplay = await createDisplayLot('AAPL', [
      { purchaseLotId: aaplLots[0].id, quantityAllocated: 10 }
    ]);

    const msftDisplay = await createDisplayLot('MSFT', [
      { purchaseLotId: msftLots[0].id, quantityAllocated: 5 }
    ]);

    // Attempt to combine different tickers should fail
    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [aaplDisplay, msftDisplay] })
      .expect(400);
  });

  it('combine fails with non-existent Display Lot ID', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 10, 100);

    const purchaseLots = await getPurchaseLots('AAPL');

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: purchaseLots[0].id, quantityAllocated: 10 }
    ]);

    const fakeId = 'nonexistent-id';

    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [display1, fakeId] })
      .expect(404);
  });

  it('combine fails with empty list', async () => {
    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [] })
      .expect(400);
  });

  it('combine with mixed quantities (partial allocations)', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 35, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const display1 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 8.5 }
    ]);

    const display2 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 12.3 }
    ]);

    const display3 = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 14.2 }
    ]);

    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: [display1, display2, display3] })
      .expect(200);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(35, 3);
  });
});
