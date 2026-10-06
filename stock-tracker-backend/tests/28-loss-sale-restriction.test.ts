import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import request from 'supertest';
import app from '../src/index.js';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { restrictBuyingAfterLossSale } from '../src/services/loss-sale-restriction.js';

describe('automatic buying restriction after lot loss sales', () => {
  let userId: string;
  let lotId: string;
  let saleId: string;
  const ticker = 'ZLOSS';
  beforeAll(async () => { await initializeDatabase(); });
  beforeEach(async () => {
    userId = `loss-sale-test-${randomUUID()}`;
    lotId = randomUUID().toUpperCase();
    saleId = randomUUID();
    await getPool().request()
      .input('userId', sql.NVarChar, userId).input('lotId', sql.UniqueIdentifier, lotId)
      .query(`
        DECLARE @buyId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@buyId, @userId, 'ZLOSS', 'buy', 10, 100, 1000, '2026-01-01');
        INSERT INTO PurchaseLots (id, userId, ticker, transactionId, originalQuantity, remainingQuantity, unitCost, purchaseDate)
        VALUES (@lotId, @userId, 'ZLOSS', @buyId, 10, 10, 100, '2026-01-01');
      `);
  });
  afterEach(async () => {
    await getPool().request().input('userId', sql.NVarChar, userId).query(`
      DELETE FROM UserTickerPreferences WHERE userId = @userId;
      DELETE FROM PurchaseLotAllocations WHERE userId = @userId;
      DELETE FROM DisplayLots WHERE userId = @userId;
      DELETE FROM PurchaseLots WHERE userId = @userId;
      DELETE FROM StockTransactions WHERE userId = @userId;
      DELETE FROM Users WHERE id = @userId;
    `);
  });
  afterAll(async () => { await getPool().close(); });

  async function createSale(price: number, date = '2026-10-06', quantity = 1) {
    return request(app).post('/api/stocks').set('x-user-id', userId).send({
      ticker, type: 'sell', quantity, price, transactionDate: date,
      allocations: [{ lotId, quantity }],
    });
  }
  async function preference() {
    const result = await getPool().request().input('userId', sql.NVarChar, userId)
      .query('SELECT buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil FROM UserTickerPreferences WHERE userId = @userId');
    return result.recordset[0];
  }
  async function seedPreference(until: string, enabled = true) {
    await getPool().request().input('userId', sql.NVarChar, userId).input('until', sql.Date, until)
      .input('enabled', sql.Bit, enabled).query(`
        INSERT INTO UserTickerPreferences (userId, ticker, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil)
        VALUES (@userId, 'ZLOSS', 1, 80, @enabled, @until)
      `);
  }

  it('persists a partial-loss-sale restriction at sell date plus 31, while retaining remaining shares', async () => {
    await createSale(90).then((response) => { expect(response.status).toBe(201); });
    const row = await preference();
    expect(row).toMatchObject({ buyRestricted: true, buyOnDip: false, buyOnDipPrice: null });
    expect(row.buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2026-11-06');
    const lot = await getPool().request().input('lotId', sql.UniqueIdentifier, lotId)
      .query('SELECT remainingQuantity FROM PurchaseLots WHERE id = @lotId');
    expect(lot.recordset[0].remainingQuantity).toBe(9);
  });

  it.each([100, 110])('does not restrict a break-even/profitable sale at %i', async (price) => {
    expect((await createSale(price)).status).toBe(201);
    expect(await preference()).toBeUndefined();
  });

  it('detects a losing allocation even if other allocations make the overall sale profitable', async () => {
    const winningLot = randomUUID().toUpperCase();
    await getPool().request().input('userId', sql.NVarChar, userId).input('lotId', sql.UniqueIdentifier, winningLot)
      .query(`
        DECLARE @buyId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@buyId, @userId, 'ZLOSS', 'buy', 10, 10, 100, '2026-01-02');
        INSERT INTO PurchaseLots (id, userId, ticker, transactionId, originalQuantity, remainingQuantity, unitCost, purchaseDate)
        VALUES (@lotId, @userId, 'ZLOSS', @buyId, 10, 10, 10, '2026-01-02');
      `);
    const response = await request(app).post('/api/stocks').set('x-user-id', userId).send({
      ticker, type: 'sell', quantity: 2, price: 90, transactionDate: '2026-10-06',
      allocations: [{ lotId, quantity: 1 }, { lotId: winningLot, quantity: 1 }],
    });
    expect(response.status).toBe(201);
    expect((await preference()).buyRestricted).toBe(true);
  });

  it('preserves a later active restriction and Buy on Dip settings', async () => {
    await seedPreference('2026-12-31');
    expect((await createSale(90)).status).toBe(201);
    const row = await preference();
    expect(row).toMatchObject({ buyOnDip: true, buyOnDipPrice: 80, buyRestricted: true });
    expect(row.buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('extends a shorter restriction and handles year rollover from the sale date', async () => {
    await seedPreference('2026-10-01');
    expect((await createSale(90, '2026-10-06')).status).toBe(201);
    expect((await preference()).buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2026-11-06');
    expect((await createSale(90, '2026-12-20')).status).toBe(201);
    expect((await preference()).buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2027-01-20');
  });

  it('applies on edits that turn an allocated sale into a loss, using the stored ticker', async () => {
    const response = await createSale(110);
    expect(response.status).toBe(201);
    await request(app).put(`/api/stocks/${response.body.id}`).set('x-user-id', userId).send({
      ticker: 'IGNORED', type: 'sell', quantity: 1, price: 90, transactionDate: '2026-10-10',
    }).expect(200);
    expect((await preference()).buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2026-11-10');
  });

  it('rolls the restriction back with the sale transaction and scopes detection to its owner', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId)
      .input('id', sql.UniqueIdentifier, saleId).input('lotId', sql.UniqueIdentifier, lotId).query(`
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@id, @userId, 'ZLOSS', 'sell', 1, 90, 90, '2026-10-06');
        INSERT INTO PurchaseLotAllocations (userId, saleTransactionId, purchaseLotId, quantityConsumed)
        VALUES (@userId, @id, @lotId, 1)
      `);
    const tx = new sql.Transaction(getPool());
    await tx.begin();
    try {
      await restrictBuyingAfterLossSale(tx, `${userId}-outside`, saleId);
      await restrictBuyingAfterLossSale(tx, userId, saleId);
    } finally {
      await tx.rollback();
    }
    expect(await preference()).toBeUndefined();
  });
});
