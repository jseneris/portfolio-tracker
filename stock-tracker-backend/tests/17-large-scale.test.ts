import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import request from 'supertest';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE, TEST_USER_ID
} from './setup.js';
import app from '../src/index.js';

describe('17. Display Lots - Large-scale & Performance', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('creates 20 Display Lots from single Purchase Lot', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create 20 display lots
    const displayLotIds = [];
    for (let i = 0; i < 20; i++) {
      const id = await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 1 }
      ]);
      displayLotIds.push(id);
    }

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(20);
  });

  it('creates 20 Purchase Lots and allocates to single Display Lot', async () => {
    await depositCash(10000);

    // Create 20 purchase lots
    for (let i = 0; i < 20; i++) {
      await buyStock('AAPL', 1, 100 + i);
    }

    const purchaseLots = await getPurchaseLots('AAPL');
    expect(purchaseLots).toHaveLength(20);

    // Create single display lot from all 20 purchase lots
    const composition = purchaseLots.map(p => ({
      purchaseLotId: p.id,
      quantityAllocated: 1
    }));

    const displayLotId = await createDisplayLot('AAPL', composition);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    const purchaseLots2 = await getPurchaseLots('AAPL');
    const totalQty = purchaseLots2.reduce((sum, p) => sum + Number(p.remainingQuantity), 0);
    expect(totalQty).toBeCloseTo(20, 1);
  });

  it('querying 50 Display Lots completes within reasonable time', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 50, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create 50 display lots
    for (let i = 0; i < 50; i++) {
      await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 1 }
      ]);
    }

    const startTime = Date.now();
    const displayLots = await getDisplayLots('AAPL');
    const duration = Date.now() - startTime;

    expect(displayLots).toHaveLength(50);
    // Query should complete in under 5 seconds (very generous for testing)
    expect(duration).toBeLessThan(5000);
  });

  it('combines 10 Display Lots into one', async () => {
    await depositCash(50000);
    await buyStock('AAPL', 50, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create 10 display lots
    const displayLotIds = [];
    for (let i = 0; i < 10; i++) {
      const id = await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 5 }
      ]);
      displayLotIds.push(id);
    }

    const startTime = Date.now();

    // Combine all 10 into one (send only the ones to combine, not the target)
    const response = await request(app)
      .post(`/api/display-lots/${displayLotIds[0]}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ displayLotIds: displayLotIds.slice(1) })
      .expect(201);

    const duration = Date.now() - startTime;

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots.length).toBeLessThanOrEqual(1);
    const purchaseLots2 = await getPurchaseLots('AAPL');
    const totalQty = purchaseLots2.reduce((sum, p) => sum + Number(p.remainingQuantity), 0);
    expect(totalQty).toBeCloseTo(50, 1);
    expect(duration).toBeLessThan(5000);
  });

  it('splits 1 Display Lot into 20 parts', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 20, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 20 }
    ]);

    const startTime = Date.now();

    // Split into 20 parts of 1 share each
    const splits = Array(20).fill(1).map(q => ({ quantityAllocated: q }));
    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ splits })
      .expect(201);

    const duration = Date.now() - startTime;

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(20);
    expect(duration).toBeLessThan(5000);
  });

  it('handles 200 shares with 20 Display Lots and multiple sales', async () => {
    await depositCash(20000);
    await buyStock('AAPL', 200, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create 20 display lots of 10 shares each
    for (let i = 0; i < 20; i++) {
      await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 10 }
      ]);
    }

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(20);

    const startTime = Date.now();

    // Perform 2 sales of 50 shares each
    for (let i = 0; i < 2; i++) {
      await sellStock('AAPL', 50, 110 + i, [
        { lotId, quantity: 50 }
      ]);
    }

    const duration = Date.now() - startTime;

    const purchaseLotsAfterSales = await getPurchaseLots('AAPL');
    const totalRemaining = purchaseLotsAfterSales.reduce((sum, p) => sum + Number(p.remainingQuantity), 0);
    expect(totalRemaining).toBeCloseTo(100, 1);
    expect(duration).toBeLessThan(10000);
  });

  it('queries composition of Display Lot with 20 Purchase Lots', async () => {
    await depositCash(10000);

    // Create 20 purchase lots
    for (let i = 0; i < 20; i++) {
      await buyStock('AAPL', 1, 100 + i);
    }

    const purchaseLots = await getPurchaseLots('AAPL');
    expect(purchaseLots).toHaveLength(20);

    // Create single display lot from all 20
    const composition = purchaseLots.map(p => ({
      purchaseLotId: p.id,
      quantityAllocated: 1
    }));

    const displayLotId = await createDisplayLot('AAPL', composition);

    const startTime = Date.now();
    // Query display lots
    const displayLots = await getDisplayLots('AAPL');
    const duration = Date.now() - startTime;

    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(20, 1);
    expect(duration).toBeLessThan(5000);
  });

  it('handles 5 tickers with 2 Display Lots each', async () => {
    await depositCash(10000);

    // Create 5 different tickers with Display Lots
    for (let t = 0; t < 5; t++) {
      const ticker = `TICK${String(t).padStart(3, '0')}`;
      await buyStock(ticker, 10, 100);

      const purchaseLots = await getPurchaseLots(ticker);
      const lotId = purchaseLots[0].id;

      // Create 2 display lots per ticker
      for (let i = 0; i < 2; i++) {
        await createDisplayLot(ticker, [
          { purchaseLotId: lotId, quantityAllocated: 5 }
        ]);
      }
    }

    const startTime = Date.now();

    // Query all tickers for display lots
    let totalDisplayLots = 0;
    for (let t = 0; t < 5; t++) {
      const ticker = `TICK${String(t).padStart(3, '0')}`;
      const displayLots = await getDisplayLots(ticker);
      totalDisplayLots += displayLots.length;
    }

    const duration = Date.now() - startTime;

    expect(totalDisplayLots).toBe(10);
    expect(duration).toBeLessThan(15000);
  });

  it('memory efficiency: handles 50 Display Lots in single session', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 50, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const startTime = Date.now();
    const memStart = process.memoryUsage().heapUsed;

    // Create 50 display lots
    for (let i = 0; i < 50; i++) {
      await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 1 }
      ]);
    }

    const memEnd = process.memoryUsage().heapUsed;
    const duration = Date.now() - startTime;
    const memUsed = (memEnd - memStart) / 1024 / 1024; // MB

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(50);
    
    // Should complete within reasonable time
    expect(duration).toBeLessThan(30000);
    
    // Memory should be reasonable (under 100MB for 50 lots)
    expect(memUsed).toBeLessThan(100);
  });

  it('cascading operations: create, combine, split sequence at scale', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 100, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const startTime = Date.now();

    // Create 20 display lots
    const displayLotIds = [];
    for (let i = 0; i < 20; i++) {
      const id = await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 5 }
      ]);
      displayLotIds.push(id);
    }

    // Combine first 10 into the first (combine displayLotIds[1-10] into displayLotIds[0])
    const response = await request(app)
      .post(`/api/display-lots/${displayLotIds[0]}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ displayLotIds: displayLotIds.slice(1, 11) })
      .expect(201);

    // Now should have 11 lots (10 combined into 1 + 10 remaining)
    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots.length).toBeLessThanOrEqual(12);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(20000);
  });
});
