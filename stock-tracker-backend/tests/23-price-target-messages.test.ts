import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/index.js';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { isUsMarketOpen } from '../src/services/market-hours.js';
import { runPriceTargetAlertCycle } from '../src/services/price-target-alerts.js';
import { buyStock, clearUserData, TEST_USER_ID } from './setup.js';

const OTHER_USER_ID = `${TEST_USER_ID}-other`;
const TICKER = 'ZZPTA';

function prices(map: Record<string, number>) {
  return async () => map;
}

async function runCycle(price: number) {
  return runPriceTargetAlertCycle({ ignoreMarketHours: true, getPrices: prices({ [TICKER]: price }) });
}

async function runCycleWithNotification(price: number, sendNotification: (userId: string, payload: { title: string; body: string; url: string }) => Promise<void>) {
  return runPriceTargetAlertCycle({
    ignoreMarketHours: true,
    getPrices: prices({ [TICKER]: price }),
    sendNotification,
  });
}

async function listMessages(userId = TEST_USER_ID) {
  const response = await request(app)
    .get('/api/messages')
    .set('x-user-id', userId)
    .expect(200);
  return response.body as Array<{ id: string; type: string; ticker: string; targetPrice: number | null; isRead: boolean; readAt: string | null }>;
}

describe('23. Price Target Messages', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await getPool().request()
      .input('userId', sql.NVarChar, OTHER_USER_ID)
      .query('DELETE FROM Messages WHERE userId = @userId');
    await clearUserData();
  });

  describe('market hours', () => {
    it('matches the dashboard polling window', () => {
      // 2026-09-28 is a Monday during EDT (UTC-4).
      expect(isUsMarketOpen(new Date('2026-09-28T13:29:00Z'))).toBe(false);
      expect(isUsMarketOpen(new Date('2026-09-28T13:30:00Z'))).toBe(true);
      expect(isUsMarketOpen(new Date('2026-09-28T20:09:00Z'))).toBe(true);
      expect(isUsMarketOpen(new Date('2026-09-28T20:10:00Z'))).toBe(false);
      expect(isUsMarketOpen(new Date('2026-09-26T15:00:00Z'))).toBe(false);
    });

    it('handles holidays and early closes', () => {
      // Christmas and Good Friday are closed; day after Thanksgiving closes at 1pm EST (UTC-5).
      expect(isUsMarketOpen(new Date('2026-12-25T16:00:00Z'))).toBe(false);
      expect(isUsMarketOpen(new Date('2026-04-03T15:00:00Z'))).toBe(false);
      expect(isUsMarketOpen(new Date('2026-11-27T18:09:00Z'))).toBe(true);
      expect(isUsMarketOpen(new Date('2026-11-27T18:10:00Z'))).toBe(false);
    });

    it('skips the cycle when the market is closed', async () => {
      let called = false;
      const summary = await runPriceTargetAlertCycle({
        now: new Date('2026-09-26T15:00:00Z'),
        getPrices: async () => {
          called = true;
          return {};
        },
      });
      expect(summary).toMatchObject({ marketOpen: false, checked: 0, created: 0 });
      expect(called).toBe(false);
    });
  });

  describe('alert cycle', () => {
    it('creates a sell message when the sell target is hit', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));

      await runCycle(111);

      const messages = await listMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ type: 'sell-target-hit', ticker: TICKER, isRead: false });
      expect(messages[0].targetPrice).toBeCloseTo(110, 6);
    });

    it('does not create a message when no target is hit', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));

      await runCycle(100);

      expect(await listMessages()).toHaveLength(0);
    });

    it('creates a buy message when the buy target is hit', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));

      await runCycle(94);

      const messages = await listMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('buy-target-hit');
      expect(messages[0].targetPrice).toBeCloseTo(95, 6);
    });

    it('waits for the previous message to be read before sending again', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));

      await runCycle(111);
      await runCycle(112);
      const unread = await listMessages();
      expect(unread).toHaveLength(1);

      await request(app)
        .get(`/api/messages/${unread[0].id}`)
        .set('x-user-id', TEST_USER_ID)
        .expect(200);

      await runCycle(112);
      const afterRead = await listMessages();
      expect(afterRead).toHaveLength(2);
      expect(afterRead.filter((message) => !message.isRead)).toHaveLength(1);
    });

    it('sends a push only when a new unread target message is created', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));
      const notifications: Array<{ userId: string; title: string; body: string; url: string }> = [];
      const sendNotification = async (userId: string, payload: { title: string; body: string; url: string }) => {
        notifications.push({ userId, ...payload });
      };

      await runCycleWithNotification(111, sendNotification);
      await runCycleWithNotification(112, sendNotification);

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        userId: TEST_USER_ID,
        title: `${TICKER} sell target reached`,
        url: '/messages',
      });
    });

    it('suppresses buy messages while buying is restricted', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));
      await request(app)
        .put(`/api/ticker-preferences/${TICKER}`)
        .set('x-user-id', TEST_USER_ID)
        .send({ buyOnDip: true, buyRestricted: true, buyRestrictedUntil: '2099-12-31' })
        .expect(200);

      await runCycle(90);

      expect(await listMessages()).toHaveLength(0);
    });

    it('treats Buy on Dip as a buy hit', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));
      await request(app)
        .put(`/api/ticker-preferences/${TICKER}`)
        .set('x-user-id', TEST_USER_ID)
        .send({ buyOnDip: true, buyRestricted: false, buyRestrictedUntil: null })
        .expect(200);

      await runCycle(100);

      const messages = await listMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('buy-target-hit');
    });

    it('uses the split-adjusted base price for targets', async () => {
      await buyStock(TICKER, 10, 100, new Date('2026-01-05T15:00:00Z'));
      const splitId = uuidv4();
      await getPool().request()
        .input('id', sql.UniqueIdentifier, splitId)
        .input('ticker', sql.NVarChar, TICKER)
        .input('splitDate', sql.DateTime2, new Date('2026-03-02T00:00:00Z'))
        .query(`
          INSERT INTO StockSplits (id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
          VALUES (@id, @ticker, 2, 1, 2, @splitDate)
        `);
      await getPool().request()
        .input('userId', sql.NVarChar, TEST_USER_ID)
        .input('splitId', sql.UniqueIdentifier, splitId)
        .query(`
          INSERT INTO UserSplitActivations (userId, splitId, activatedBy)
          VALUES (@userId, @splitId, 'manual')
        `);

      await runCycle(56);

      const messages = await listMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('sell-target-hit');
      expect(messages[0].targetPrice).toBeCloseTo(55, 6);
    });
  });

  describe('messages API', () => {
    async function seedMessage(userId = TEST_USER_ID): Promise<string> {
      const id = uuidv4();
      await getPool().request()
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query(`
          INSERT INTO Messages (id, userId, type, ticker, targetPrice, triggerPrice, body)
          VALUES (@id, @userId, 'sell-target-hit', '${TICKER}', 110, 111, 'test message')
        `);
      return id;
    }

    it('listing does not mark messages read', async () => {
      await seedMessage();

      await listMessages();
      const messages = await listMessages();

      expect(messages[0].isRead).toBe(false);
      const count = await request(app)
        .get('/api/messages/unread-count')
        .set('x-user-id', TEST_USER_ID)
        .expect(200);
      expect(count.body.count).toBe(1);
    });

    it('opening a message marks it read and keeps the first readAt', async () => {
      const id = await seedMessage();

      const first = await request(app)
        .get(`/api/messages/${id}`)
        .set('x-user-id', TEST_USER_ID)
        .expect(200);
      expect(first.body.isRead).toBe(true);
      expect(first.body.readAt).toBeTruthy();

      const second = await request(app)
        .get(`/api/messages/${id}`)
        .set('x-user-id', TEST_USER_ID)
        .expect(200);
      expect(second.body.readAt).toBe(first.body.readAt);
    });

    it('does not expose messages across users or accept invalid ids', async () => {
      const id = await seedMessage(OTHER_USER_ID);

      await request(app)
        .get(`/api/messages/${id}`)
        .set('x-user-id', TEST_USER_ID)
        .expect(404);
      await request(app)
        .get('/api/messages/not-a-guid')
        .set('x-user-id', TEST_USER_ID)
        .expect(404);

      const otherMessages = await listMessages(OTHER_USER_ID);
      expect(otherMessages[0].isRead).toBe(false);
    });

    it('marks all messages read', async () => {
      await seedMessage();
      await seedMessage();

      const response = await request(app)
        .post('/api/messages/read-all')
        .set('x-user-id', TEST_USER_ID)
        .expect(200);
      expect(response.body.updated).toBe(2);

      const messages = await listMessages();
      expect(messages.every((message) => message.isRead)).toBe(true);
    });

    it('marks only selected messages read', async () => {
      const selectedId = await seedMessage();
      await seedMessage();

      const response = await request(app)
        .post('/api/messages/read-selected')
        .set('x-user-id', TEST_USER_ID)
        .send({ ids: [selectedId] })
        .expect(200);
      expect(response.body.updated).toBe(1);

      const messages = await listMessages();
      expect(messages.find((message) => message.id === selectedId)?.isRead).toBe(true);
      expect(messages.find((message) => message.id !== selectedId)?.isRead).toBe(false);
    });

    it('deletes selected messages only for the authenticated user', async () => {
      const ownId = await seedMessage();
      const otherId = await seedMessage(OTHER_USER_ID);

      const response = await request(app)
        .delete('/api/messages')
        .set('x-user-id', TEST_USER_ID)
        .send({ ids: [ownId, otherId] })
        .expect(200);
      expect(response.body.deleted).toBe(1);
      expect(await listMessages()).toHaveLength(0);
      expect(await listMessages(OTHER_USER_ID)).toHaveLength(1);
    });

    it('rejects invalid selected message IDs', async () => {
      await request(app)
        .post('/api/messages/read-selected')
        .set('x-user-id', TEST_USER_ID)
        .send({ ids: ['not-a-guid'] })
        .expect(400);
      await request(app)
        .delete('/api/messages')
        .set('x-user-id', TEST_USER_ID)
        .send({ ids: [] })
        .expect(400);
    });
  });
});
