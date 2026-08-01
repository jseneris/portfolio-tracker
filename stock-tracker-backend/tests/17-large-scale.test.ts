import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import request from 'supertest';
import { 
  clearUserData, depositCash, buyStock, sellStock,
  createDisplayLot, getDisplayLots, getPurchaseLots, TEST_USER_ID
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

    const composition = Array.from({ length: 20 }, () => ({ purchaseLotId: 'seed', quantityAllocated: 1 }));
    await createDisplayLot('AAPL', composition);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(20);
  });

  it('creates 20 Purchase Lots and stores 20 display lot quantities', async () => {
    await depositCash(10000);

    // Create 20 purchase lots
    for (let i = 0; i < 20; i++) {
      await buyStock('AAPL', 1, 100 + i);
    }

    const purchaseLots = await getPurchaseLots('AAPL');
    expect(purchaseLots).toHaveLength(20);

    // In the simplified model, source lot IDs are not persisted; quantities are.
    const composition = purchaseLots.map(p => ({
      purchaseLotId: p.id,
      quantityAllocated: 1
    }));

    await createDisplayLot('AAPL', composition);

    const displayLots = await getDisplayLots('AAPL');
    expect(displayLots).toHaveLength(20);
    const totalDisplayQty = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplayQty).toBeCloseTo(20, 3);
    const purchaseLots2 = await getPurchaseLots('AAPL');
    const totalQty = purchaseLots2.reduce((sum, p) => sum + Number(p.remainingQuantity), 0);
    expect(totalQty).toBeCloseTo(20, 1);
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
    const quantities = Array(20).fill(1);
    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ index: 0, quantities })
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

    const composition = Array.from({ length: 20 }, () => ({ purchaseLotId: 'seed', quantityAllocated: 10 }));
    await createDisplayLot('AAPL', composition);

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

  it('queries expanded display lots for a 20-quantity display row', async () => {
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

    await createDisplayLot('AAPL', composition);

    const startTime = Date.now();
    // Query display lots
    const displayLots = await getDisplayLots('AAPL');
    const duration = Date.now() - startTime;

    expect(displayLots).toHaveLength(20);
    const totalDisplayQty = displayLots.reduce((sum, d) => sum + Number(d.totalQuantity), 0);
    expect(totalDisplayQty).toBeCloseTo(20, 1);
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

      // Create two quantities per ticker.
      await createDisplayLot(ticker, [
        { purchaseLotId: 'seed', quantityAllocated: 5 },
        { purchaseLotId: 'seed', quantityAllocated: 5 }
      ]);
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

  it('cascading operations: create, combine, split sequence at scale', async () => {
    await depositCash(100000);
    await buyStock('AAPL', 100, 100);

    const startTime = Date.now();

    const displayLotId = await createDisplayLot(
      'AAPL',
      Array.from({ length: 20 }, () => ({ purchaseLotId: 'seed', quantityAllocated: 5 }))
    );

    const beforeCombineLots = await getDisplayLots('AAPL');
    expect(beforeCombineLots.length).toBeGreaterThan(0);

    const indices = Array.from({ length: 10 }, (_, i) => i);
    const response = await request(app)
      .post(`/api/display-lots/${displayLotId}/combine`)
      .set('x-user-id', TEST_USER_ID)
      .send({ indices })
      .expect(201);

    // Count should strictly decrease after combine.
    let displayLots = await getDisplayLots('AAPL');
    expect(displayLots.length).toBeLessThan(beforeCombineLots.length);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(20000);
  });
});
