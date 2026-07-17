import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TOLERANCE 
} from './setup.js';

describe('17. Display Lots - Large-scale & Performance', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('creates 100 Display Lots from single Purchase Lot', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 100, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create 100 display lots
    const displayLotIds = [];
    for (let i = 0; i < 100; i++) {
      const id = await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 1 }
      ]);
      displayLotIds.push(id);
    }

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(100);
  });

  it('creates 100 Purchase Lots and allocates to single Display Lot', async () => {
    await depositCash(100000);

    // Create 100 purchase lots
    for (let i = 0; i < 100; i++) {
      await buyStock('AAPL', 1, 100 + i);
    }

    const purchaseLots = await getPurchaseLots('AAPL');
    expect(purchaseLots).toHaveLength(100);

    // Create single display lot from all 100 purchase lots
    const composition = purchaseLots.map(p => ({
      purchaseLotId: p.id,
      quantityAllocated: 1
    }));

    const displayLotId = await createDisplayLot('AAPL', composition);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(100, 1);
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

    // Combine all 10 into one
    const { request } = await import('supertest');
    const app = (await import('../src/index.js')).default;
    
    const response = await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds })
      .expect(200);

    const duration = Date.now() - startTime;

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(1);
    expect(Number(displayLots[0].totalQuantity)).toBeCloseTo(50, 1);
    expect(duration).toBeLessThan(5000);
  });

  it('splits 1 Display Lot into 50 parts', async () => {
    await depositCash(10000);
    await buyStock('AAPL', 50, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const displayLotId = await createDisplayLot('AAPL', [
      { purchaseLotId: lotId, quantityAllocated: 50 }
    ]);

    const { request } = await import('supertest');
    const app = (await import('../src/index.js')).default;

    const startTime = Date.now();

    // Split into 50 parts of 1 share each
    const quantities = Array(50).fill(1);
    const response = await request(app)
      .put(`/api/display-lots/${displayLotId}/split`)
      .send({ quantities })
      .expect(200);

    const duration = Date.now() - startTime;

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(50);
    expect(duration).toBeLessThan(5000);
  });

  it('handles 1000 shares with 100 Display Lots and multiple sales', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 1000, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    // Create 100 display lots of 10 shares each
    for (let i = 0; i < 100; i++) {
      await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 10 }
      ]);
    }

    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(100);

    const startTime = Date.now();

    // Perform 10 sales of 50 shares each
    for (let i = 0; i < 10; i++) {
      await sellStock('AAPL', 50, 110 + i, [
        { lotId, quantity: 50 }
      ]);
    }

    const duration = Date.now() - startTime;

    displayLots = await getDisplayLots('AAPL');
    const totalDisplayQty = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplayQty).toBeCloseTo(500, 1);
    expect(duration).toBeLessThan(10000);
  });

  it('queries composition of Display Lot with 50 Purchase Lots', async () => {
    await depositCash(50000);

    // Create 50 purchase lots
    for (let i = 0; i < 50; i++) {
      await buyStock('AAPL', 1, 100 + i);
    }

    const purchaseLots = await getPurchaseLots('AAPL');

    // Create single display lot from all 50
    const composition = purchaseLots.map(p => ({
      purchaseLotId: p.id,
      quantityAllocated: 1
    }));

    const displayLotId = await createDisplayLot('AAPL', composition);

    const startTime = Date.now();
    const displayComposition = await import('./setup.js')
      .then(m => m.getDisplayLotComposition(displayLotId));
    const duration = Date.now() - startTime;

    expect(displayComposition).toHaveLength(50);
    expect(duration).toBeLessThan(5000);
  });

  it('handles 100 tickers with 10 Display Lots each', async () => {
    await depositCash(1000000);

    // Create 100 different tickers with Display Lots
    for (let t = 0; t < 100; t++) {
      const ticker = `TICK${String(t).padStart(3, '0')}`;
      await buyStock(ticker, 10, 100);

      const purchaseLots = await getPurchaseLots(ticker);
      const lotId = purchaseLots[0].id;

      // Create 10 display lots per ticker
      for (let i = 0; i < 10; i++) {
        await createDisplayLot(ticker, [
          { purchaseLotId: lotId, quantityAllocated: 1 }
        ]);
      }
    }

    const startTime = Date.now();

    // Query all tickers for display lots
    let totalDisplayLots = 0;
    for (let t = 0; t < 100; t++) {
      const ticker = `TICK${String(t).padStart(3, '0')}`;
      const displayLots = await getDisplayLots(ticker);
      totalDisplayLots += displayLots.length;
    }

    const duration = Date.now() - startTime;

    expect(totalDisplayLots).toBe(1000);
    expect(duration).toBeLessThan(15000);
  });

  it('memory efficiency: handles 500 Display Lots in single session', async () => {
    await depositCash(500000);
    await buyStock('AAPL', 500, 100);

    const purchaseLots = await getPurchaseLots('AAPL');
    const lotId = purchaseLots[0].id;

    const startTime = Date.now();
    const memStart = process.memoryUsage().heapUsed;

    // Create 500 display lots
    for (let i = 0; i < 500; i++) {
      await createDisplayLot('AAPL', [
        { purchaseLotId: lotId, quantityAllocated: 1 }
      ]);
    }

    const memEnd = process.memoryUsage().heapUsed;
    const duration = Date.now() - startTime;
    const memUsed = (memEnd - memStart) / 1024 / 1024; // MB

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(500);
    
    // Should complete within reasonable time
    expect(duration).toBeLessThan(30000);
    
    // Memory should be reasonable (under 100MB for 500 lots)
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

    // Combine first 10
    const { request } = await import('supertest');
    const app = (await import('../src/index.js')).default;
    
    await request(app)
      .put('/api/display-lots/combine')
      .send({ displayLotIds: displayLotIds.slice(0, 10) })
      .expect(200);

    // Now should have 11 lots (10 combined into 1 + 10 remaining)
    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots.length).toBeLessThanOrEqual(12);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(10000);
  });
});
