import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { getPool, initializeDatabase } from '../src/db/connection.js';
import { runPriceTargetAlertCycle } from '../src/services/price-target-alerts.js';

describe('automatic Buy on Dip on buy-target hits', () => {
  let userId: string;
  let ticker: string;
  const now = new Date('2026-10-06T15:00:00Z');
  beforeAll(async () => { await initializeDatabase(); });
  beforeEach(async () => {
    userId = `auto-dip-test-${randomUUID()}`;
    ticker = `Z${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
    await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .query(`
        DECLARE @transactionId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@transactionId, @userId, @ticker, 'buy', 10, 100, 1000, '2026-01-01');
        INSERT INTO PurchaseLots (userId, ticker, transactionId, originalQuantity, remainingQuantity, unitCost, purchaseDate)
        VALUES (@userId, @ticker, @transactionId, 10, 10, 100, '2026-01-01');
      `);
  });
  afterEach(async () => {
    await getPool().request().input('userId', sql.NVarChar, userId).query(`
      DELETE FROM Messages WHERE userId = @userId;
      DELETE FROM UserTickerPreferences WHERE userId = @userId;
      DELETE FROM DisplayLots WHERE userId = @userId;
      DELETE FROM PurchaseLots WHERE userId = @userId;
      DELETE FROM StockTransactions WHERE userId = @userId;
      DELETE FROM UserSettings WHERE userId = @userId;
    `);
  });
  afterAll(async () => { await getPool().close(); });

  async function setLots(count: number) {
    await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker)
      .input('lotsCsv', sql.NVarChar(sql.MAX), Array.from({ length: count }, () => '1').join(','))
      .query('INSERT INTO DisplayLots (userId, ticker, lotsCsv) VALUES (@userId, @ticker, @lotsCsv)');
  }
  async function cycle(price: number | null) {
    return runPriceTargetAlertCycle({
      now, ignoreMarketHours: true,
      getPrices: async () => price == null ? {} : { [ticker]: price },
      sendNotification: async () => undefined,
    });
  }
  async function preference() {
    const result = await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker)
      .query('SELECT buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil FROM UserTickerPreferences WHERE userId = @userId AND ticker = @ticker');
    return result.recordset[0];
  }
  async function messages() {
    const result = await getPool().request().input('userId', sql.NVarChar, userId)
      .query('SELECT type, targetPrice, triggerPrice, body FROM Messages WHERE userId = @userId ORDER BY createdAt');
    return result.recordset;
  }
  async function seedPreference(buyOnDip: boolean, price: number | null, restrictedUntil: string | null) {
    await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker)
      .input('buyOnDip', sql.Bit, buyOnDip).input('price', sql.Decimal(18, 8), price)
      .input('restricted', sql.Bit, restrictedUntil != null).input('until', sql.Date, restrictedUntil)
      .query(`INSERT INTO UserTickerPreferences (userId, ticker, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil)
        VALUES (@userId, @ticker, @buyOnDip, @price, @restricted, @until)`);
  }

  it.each([0, 1, 2, 3])('saves the trigger price at the buy target with %i display lots', async (count) => {
    if (count) await setLots(count);
    const trigger = count === 3 ? 90 : 95;
    await cycle(trigger);
    expect(await preference()).toMatchObject({ buyOnDip: true, buyOnDipPrice: trigger, buyRestricted: false });
    const alerts = await messages();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'buy-target-hit', targetPrice: trigger, triggerPrice: trigger });
    expect(alerts[0].body).toContain('automatically enabled');
    await cycle(trigger * 0.98);
    expect((await preference()).buyOnDipPrice).toBe(trigger);
    expect(await messages()).toHaveLength(1);
  });

  it('does not enable for four display lots even when the buy target is reached', async () => {
    await setLots(4);
    await cycle(85);
    expect(await preference()).toBeUndefined();
    expect((await messages())[0]).toMatchObject({ type: 'buy-target-hit', targetPrice: 85 });
  });

  it('does not enable above the target or without a usable price', async () => {
    await setLots(3);
    await cycle(90.01);
    await cycle(null);
    expect(await preference()).toBeUndefined();
    expect(await messages()).toHaveLength(0);
  });

  it('preserves an active buying restriction and suppresses automatic activation', async () => {
    await seedPreference(false, null, '2026-10-06');
    await cycle(90);
    expect(await preference()).toMatchObject({ buyOnDip: false, buyOnDipPrice: null, buyRestricted: true });
    expect(await messages()).toHaveLength(0);
  });

  it('allows activation after a restriction expires without overwriting restriction fields', async () => {
    await seedPreference(false, null, '2026-10-05');
    await cycle(94);
    const result = await preference();
    expect(result).toMatchObject({ buyOnDip: true, buyOnDipPrice: 94, buyRestricted: true });
    expect(result.buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('never recaptures the price of an already-enabled Buy on Dip preference', async () => {
    await seedPreference(true, 80, null);
    await cycle(79.2);
    expect(await preference()).toMatchObject({ buyOnDip: true, buyOnDipPrice: 80 });
    expect((await messages())[0].targetPrice).toBeCloseTo(79.2, 6);
  });

  it('enables independently of unread buy-alert suppression, then uses the new buy and sell targets', async () => {
    await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker)
      .query(`INSERT INTO Messages (userId, type, ticker, triggerPrice, body)
        VALUES (@userId, 'buy-target-hit', @ticker, 95, 'Existing unread alert')`);
    await cycle(94);
    expect(await preference()).toMatchObject({ buyOnDip: true, buyOnDipPrice: 94 });
    expect(await messages()).toHaveLength(1);
    await getPool().request().input('userId', sql.NVarChar, userId)
      .query('UPDATE Messages SET isRead = 1 WHERE userId = @userId');
    await cycle(93.06);
    const alerts = await messages();
    expect(alerts).toHaveLength(2);
    expect(alerts[1].targetPrice).toBeCloseTo(93.06, 6);
    await cycle(103.4);
    expect((await messages()).find((alert) => alert.type === 'sell-target-hit')?.targetPrice).toBeCloseTo(103.4, 6);
  });

  it('does not mutate another user with the same ticker', async () => {
    const otherUser = `${userId}-other`;
    try {
      await getPool().request().input('userId', sql.NVarChar, otherUser).input('ticker', sql.NVarChar, ticker)
        .query(`INSERT INTO UserTickerPreferences (userId, ticker, buyOnDip, buyOnDipPrice)
          VALUES (@userId, @ticker, 1, 75)`);
      await cycle(94);
      const other = await getPool().request().input('userId', sql.NVarChar, otherUser)
        .query('SELECT buyOnDipPrice FROM UserTickerPreferences WHERE userId = @userId');
      expect(other.recordset[0].buyOnDipPrice).toBe(75);
    } finally {
      await getPool().request().input('userId', sql.NVarChar, otherUser)
        .query('DELETE FROM UserTickerPreferences WHERE userId = @userId');
    }
  });
});
