import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sql from 'mssql';
import app from '../src/index.js';
import { getPool, initializeDatabase } from '../src/db/connection.js';
import { parseTransactionDate } from '../src/services/stock-transaction-date.js';

describe('date-only stock transaction editing', () => {
  let userId: string;
  let ticker: string;
  let buyId: string;
  let lotId: string;
  let saleId: string;
  beforeAll(async () => { await initializeDatabase(); });
  beforeEach(async () => {
    userId = `date-edit-${randomUUID()}`;
    ticker = `D${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
    buyId = randomUUID();
    lotId = randomUUID();
    saleId = randomUUID();
    await getPool().request().input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker).input('buyId', sql.UniqueIdentifier, buyId)
      .input('lotId', sql.UniqueIdentifier, lotId).input('saleId', sql.UniqueIdentifier, saleId).query(`
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate, isInitialPurchase)
        VALUES (@buyId, @userId, @ticker, 'buy', 10, 100, 1000, '2026-01-10', 1),
               (@saleId, @userId, @ticker, 'sell', 2, 90, 180, '2026-02-10', 0);
        INSERT INTO PurchaseLots (id, userId, ticker, transactionId, originalQuantity, remainingQuantity, unitCost, purchaseDate)
        VALUES (@lotId, @userId, @ticker, @buyId, 10, 8, 100, '2026-01-10');
        INSERT INTO PurchaseLotAllocations (userId, saleTransactionId, purchaseLotId, quantityConsumed)
        VALUES (@userId, @saleId, @lotId, 2);
        INSERT INTO UserTickerPreferences (userId, ticker, buyRestricted, buyRestrictedUntil)
        VALUES (@userId, @ticker, 1, '2026-03-13');
      `);
  });
  afterEach(async () => {
    await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker).query(`
      DELETE FROM StockExchangeLotMappings WHERE userId = @userId;
      DELETE FROM StockExchanges WHERE userId = @userId;
      DELETE FROM UserSplitActivations WHERE userId = @userId;
      DELETE FROM PurchaseLotAllocations WHERE userId = @userId;
      DELETE FROM PurchaseLots WHERE userId = @userId;
      DELETE FROM StockTransactions WHERE userId = @userId;
      DELETE FROM UserTickerPreferences WHERE userId = @userId;
      DELETE FROM StockSplits WHERE ticker = @ticker;
      DELETE FROM Users WHERE id = @userId;
    `);
  });

  function edit(id: string, date: string, expected = '2026-01-10', owner = userId) {
    return request(app).patch(`/api/stocks/${id}/date`).set('x-user-id', owner)
      .send({ transactionDate: date, expectedTransactionDate: expected });
  }
  async function rows() {
    return (await getPool().request().input('id', sql.UniqueIdentifier, buyId).query(`
      SELECT st.*, lot.purchaseDate, lot.remainingQuantity, lot.unitCost
      FROM StockTransactions st JOIN PurchaseLots lot ON lot.transactionId = st.id WHERE st.id = @id;
    `)).recordset[0];
  }
  async function restriction() {
    return (await getPool().request().input('userId', sql.NVarChar, userId)
      .query('SELECT buyRestrictedUntil FROM UserTickerPreferences WHERE userId = @userId'))
      .recordset[0].buyRestrictedUntil.toISOString().slice(0, 10);
  }

  it('validates calendar dates strictly', () => {
    expect(parseTransactionDate('2026-02-30')).toBeNull();
    expect(parseTransactionDate('2026-01-01T00:00:00Z')).toBeNull();
    expect(parseTransactionDate(null)).toBeNull();
    expect(parseTransactionDate('0000-01-01')).toBeNull();
    expect(parseTransactionDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
  it('updates the buy and its lot without changing financial data or initial-purchase flags', async () => {
    await edit(buyId, '2026-01-11').expect(200);
    const row = await rows();
    expect(row.transactionDate.toISOString().slice(0, 10)).toBe('2026-01-11');
    expect(row.purchaseDate.toISOString().slice(0, 10)).toBe('2026-01-11');
    expect(row).toMatchObject({ quantity: 10, price: 100, amount: 1000, remainingQuantity: 8, unitCost: 100, isInitialPurchase: true });
  });
  it('also synchronizes dividend lots', async () => {
    await getPool().request().input('id', sql.UniqueIdentifier, buyId)
      .query("UPDATE StockTransactions SET type = 'div' WHERE id = @id; UPDATE PurchaseLots SET sourceType = 'dividend' WHERE transactionId = @id;");
    await edit(buyId, '2026-01-09').expect(200);
    expect((await rows()).purchaseDate.toISOString().slice(0, 10)).toBe('2026-01-09');
  });
  it('rejects extra fields, invalid dates and IDs without updating data', async () => {
    await request(app).patch(`/api/stocks/${buyId}/date`).set('x-user-id', userId)
      .send({ transactionDate: '2026-01-11', expectedTransactionDate: '2026-01-10', quantity: 99 }).expect(400);
    await edit(buyId, '2026-02-30').expect(400);
    await edit('invalid', '2026-01-11').expect(400);
    expect((await rows()).quantity).toBe(10);
  });
  it('rejects other users and stale edits', async () => {
    await edit(buyId, '2026-01-11', '2026-01-10', `${userId}-other`).expect(404);
    await edit(buyId, '2026-01-11', '2026-01-09').expect(409);
    expect((await rows()).transactionDate.toISOString().slice(0, 10)).toBe('2026-01-10');
  });
  it('rejects purchases after their allocated sale and sales before their purchase', async () => {
    await edit(buyId, '2026-02-11').expect(409);
    await edit(saleId, '2026-01-09', '2026-02-10').expect(409);
    expect((await rows()).purchaseDate.toISOString().slice(0, 10)).toBe('2026-01-10');
    expect(await restriction()).toBe('2026-03-13');
  });
  it('allows same-day purchase and sale', async () => {
    await edit(buyId, '2026-02-10').expect(200);
  });
  it('rejects missing lots and incomplete sale allocations', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId)
      .query('DELETE FROM PurchaseLotAllocations WHERE userId = @userId; DELETE FROM PurchaseLots WHERE userId = @userId;');
    await edit(buyId, '2026-01-11').expect(409);
    await edit(saleId, '2026-02-11', '2026-02-10').expect(409);
  });
  it('rejects moving either direction across a split', async () => {
    await getPool().request().input('ticker', sql.NVarChar, ticker).query(`
      INSERT INTO StockSplits (id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
      VALUES (NEWID(), @ticker, 2, 1, 2, '2026-01-20');
    `);
    await edit(buyId, '2026-01-21').expect(409);
    await edit(saleId, '2026-01-19', '2026-02-10').expect(409);
    await edit(buyId, '2026-01-11').expect(200);
  });
  it('recomputes loss restrictions when moving a sale earlier or later', async () => {
    await edit(saleId, '2026-02-01', '2026-02-10').expect(200);
    expect(await restriction()).toBe('2026-03-04');
    await edit(saleId, '2026-02-20', '2026-02-01').expect(200);
    expect(await restriction()).toBe('2026-03-23');
  });
  it('preserves a separately configured later buying restriction', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId)
      .query("UPDATE UserTickerPreferences SET buyRestrictedUntil = '2026-12-31' WHERE userId = @userId;");
    await edit(saleId, '2026-02-01', '2026-02-10').expect(200);
    expect(await restriction()).toBe('2026-12-31');
  });
  it('retains the restriction from another loss sale when the latest sale moves earlier', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker).input('lotId', sql.UniqueIdentifier, lotId).query(`
        DECLARE @secondId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@secondId, @userId, @ticker, 'sell', 1, 90, 90, '2026-02-05');
        INSERT INTO PurchaseLotAllocations (userId, saleTransactionId, purchaseLotId, quantityConsumed)
        VALUES (@userId, @secondId, @lotId, 1);
        UPDATE PurchaseLots SET remainingQuantity = 7 WHERE id = @lotId;
      `);
    await edit(saleId, '2026-02-01', '2026-02-10').expect(200);
    expect(await restriction()).toBe('2026-03-08');
  });
  it('rejects generated target buys even when their ticker was not the exchange source', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker).input('buyId', sql.UniqueIdentifier, buyId)
      .input('lotId', sql.UniqueIdentifier, lotId).query(`
        DECLARE @exchangeId UNIQUEIDENTIFIER = NEWID(), @txId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO StockTransactions (id, userId, ticker, type, transactionDate)
        VALUES (@txId, @userId, 'SOURCE', 'exchange', '2026-01-10');
        INSERT INTO StockExchanges (id, userId, exchangeTransactionId, sourceTicker, targetTicker, exchangeRate, transactionDate)
        VALUES (@exchangeId, @userId, @txId, 'SOURCE', @ticker, 1, '2026-01-10');
        INSERT INTO StockExchangeLotMappings (
          id, exchangeId, userId, sourceLotId, sourceTransactionId, sourceRemainingBefore,
          sourceUnitCost, sourcePurchaseDate, targetTransactionId, targetLotId, targetQuantity, targetUnitCost
        ) VALUES (NEWID(), @exchangeId, @userId, NEWID(), NEWID(), 10,
          100, '2025-01-01', @buyId, @lotId, 10, 100);
      `);
    await edit(buyId, '2026-01-11').expect(409);
    expect((await rows()).purchaseDate.toISOString().slice(0, 10)).toBe('2026-01-10');
  });
  it('rejects exchanges and exchange-linked buys', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker).query(`
        DECLARE @exchangeId UNIQUEIDENTIFIER = NEWID(), @txId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO StockTransactions (id, userId, ticker, type, transactionDate)
        VALUES (@txId, @userId, @ticker, 'exchange', '2026-02-15');
        INSERT INTO StockExchanges (id, userId, exchangeTransactionId, sourceTicker, targetTicker, exchangeRate, transactionDate)
        VALUES (@exchangeId, @userId, @txId, @ticker, 'TARGET', 2, '2026-02-15');
      `);
    await edit(buyId, '2026-01-11').expect(409);
    const result = await getPool().request().input('userId', sql.NVarChar, userId)
      .query("SELECT id FROM StockTransactions WHERE userId = @userId AND type = 'exchange';");
    await edit(result.recordset[0].id, '2026-02-16', '2026-02-15').expect(409);
  });
});
