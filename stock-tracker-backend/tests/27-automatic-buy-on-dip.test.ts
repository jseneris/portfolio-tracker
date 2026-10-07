import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { getPool, initializeDatabase } from '../src/db/connection.js';
import { runPriceTargetAlertCycle } from '../src/services/price-target-alerts.js';

describe('automatic Buy on Dip on sell-target hits', () => {
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
      .query('SELECT baseSize, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil FROM UserTickerPreferences WHERE userId = @userId AND ticker = @ticker');
    return result.recordset[0];
  }
  async function messages() {
    const result = await getPool().request().input('userId', sql.NVarChar, userId)
      .query('SELECT type, targetPrice, triggerPrice, body FROM Messages WHERE userId = @userId ORDER BY createdAt');
    return result.recordset;
  }
  async function seedPreference(buyOnDip: boolean, price: number | null, restrictedUntil: string | null, baseSize = 3) {
    await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker)
      .input('buyOnDip', sql.Bit, buyOnDip).input('price', sql.Decimal(18, 8), price)
      .input('baseSize', sql.Int, baseSize)
      .input('restricted', sql.Bit, restrictedUntil != null).input('until', sql.Date, restrictedUntil)
      .query(`INSERT INTO UserTickerPreferences (userId, ticker, baseSize, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil)
        VALUES (@userId, @ticker, @baseSize, @buyOnDip, @price, @restricted, @until)`);
  }

  it.each([0, 1, 2, 3, 4])('does not enable Buy on Dip on a buy-target hit with %i display lots', async (count) => {
    if (count) await setLots(count);
    const trigger = count < 3 ? 95 : count === 3 ? 90 : 85;
    await cycle(trigger);
    expect(await preference()).toBeUndefined();
    const alerts = await messages();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'buy-target-hit', targetPrice: trigger, triggerPrice: trigger });
    expect(alerts[0].body).not.toContain('automatically enabled');
  });

  it('enables at the sell target when display lots equal the default base size', async () => {
    await setLots(3);
    await cycle(111);
    expect(await preference()).toMatchObject({ baseSize: 3, buyOnDip: true, buyOnDipPrice: 111, buyRestricted: false });
    const alerts = await messages();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'sell-target-hit', targetPrice: 110, triggerPrice: 111 });
    expect(alerts[0].body).toContain('automatically enabled');

    await cycle(122.1);
    expect((await preference()).buyOnDipPrice).toBe(111);
  });

  it('uses the ticker-specific base size and requires an exact lot-count match', async () => {
    await seedPreference(false, null, null, 4);
    await setLots(4);
    await cycle(111);
    expect(await preference()).toMatchObject({ baseSize: 4, buyOnDip: true, buyOnDipPrice: 111 });

    await getPool().request().input('userId', sql.NVarChar, userId).query('DELETE FROM Messages WHERE userId = @userId');
    await getPool().request().input('userId', sql.NVarChar, userId).query('DELETE FROM UserTickerPreferences WHERE userId = @userId');
    await getPool().request().input('userId', sql.NVarChar, userId).query('DELETE FROM DisplayLots WHERE userId = @userId');
    await setLots(2);
    await cycle(111);
    expect(await preference()).toBeUndefined();
  });

  it('does not enable unless the sell target is reached and a usable price is available', async () => {
    await setLots(3);
    await cycle(109.99);
    await cycle(null);
    expect(await preference()).toBeUndefined();
    expect(await messages()).toHaveLength(0);
  });

  it('preserves an active buying restriction and suppresses automatic activation', async () => {
    await seedPreference(false, null, '2026-10-06');
    await setLots(3);
    await cycle(111);
    expect(await preference()).toMatchObject({ buyOnDip: false, buyOnDipPrice: null, buyRestricted: true });
    expect((await messages())[0]).toMatchObject({ type: 'sell-target-hit' });
  });

  it('allows activation after a restriction expires without overwriting restriction fields', async () => {
    await seedPreference(false, null, '2026-10-05');
    await setLots(3);
    await cycle(111);
    const result = await preference();
    expect(result).toMatchObject({ baseSize: 3, buyOnDip: true, buyOnDipPrice: 111, buyRestricted: true });
    expect(result.buyRestrictedUntil.toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('never recaptures the price of an already-enabled Buy on Dip preference', async () => {
    await seedPreference(true, 80, null);
    await cycle(79.2);
    expect(await preference()).toMatchObject({ buyOnDip: true, buyOnDipPrice: 80 });
    expect((await messages())[0].targetPrice).toBeCloseTo(79.2, 6);
  });

  it('enables independently of unread sell-alert suppression, then uses the new buy and sell targets', async () => {
    await setLots(3);
    await getPool().request().input('userId', sql.NVarChar, userId).input('ticker', sql.NVarChar, ticker)
      .query(`INSERT INTO Messages (userId, type, ticker, triggerPrice, body)
        VALUES (@userId, 'sell-target-hit', @ticker, 111, 'Existing unread alert')`);
    await cycle(111);
    expect(await preference()).toMatchObject({ buyOnDip: true, buyOnDipPrice: 111 });
    expect(await messages()).toHaveLength(1);
    await getPool().request().input('userId', sql.NVarChar, userId)
      .query('UPDATE Messages SET isRead = 1 WHERE userId = @userId');
    await cycle(109.89);
    const alerts = await messages();
    expect(alerts).toHaveLength(2);
    expect(alerts[1].targetPrice).toBeCloseTo(109.89, 6);
    await cycle(122.2);
    const sellAlerts = (await messages()).filter((alert) => alert.type === 'sell-target-hit' && alert.targetPrice != null);
    expect(sellAlerts[sellAlerts.length - 1].targetPrice).toBeCloseTo(122.1, 6);
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
