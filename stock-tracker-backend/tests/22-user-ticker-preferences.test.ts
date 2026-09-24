import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import sql from 'mssql';
import app from '../src/index.js';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { clearUserData, TEST_USER_ID } from './setup.js';

describe('22. User Ticker Preferences', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('returns neutral defaults when no preference exists', async () => {
    const response = await request(app)
      .get('/api/ticker-preferences/msft')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    expect(response.body).toEqual({
      ticker: 'MSFT',
      buyOnDip: false,
      buyRestricted: false,
      buyRestrictedUntil: null,
      isBuyRestricted: false,
    });
  });

  it('persists and updates one normalized row per user and ticker', async () => {
    await request(app)
      .put('/api/ticker-preferences/msft')
      .set('x-user-id', TEST_USER_ID)
      .send({ buyOnDip: true, buyRestricted: true, buyRestrictedUntil: '2099-12-31' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          ticker: 'MSFT',
          buyOnDip: true,
          buyRestricted: true,
          buyRestrictedUntil: '2099-12-31',
          isBuyRestricted: true,
        });
      });

    await request(app)
      .put('/api/ticker-preferences/MSFT')
      .set('x-user-id', TEST_USER_ID)
      .send({ buyOnDip: false, buyRestricted: false, buyRestrictedUntil: null })
      .expect(200);

    const listResponse = await request(app)
      .get('/api/ticker-preferences')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    expect(listResponse.body).toEqual([{
      ticker: 'MSFT',
      buyOnDip: false,
      buyRestricted: false,
      buyRestrictedUntil: null,
      isBuyRestricted: false,
    }]);

    const rowCount = await getPool().request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .query('SELECT COUNT(*) AS count FROM UserTickerPreferences WHERE userId = @userId AND ticker = \'MSFT\'');
    expect(Number(rowCount.recordset[0].count)).toBe(1);
  });

  it('reports an expired restriction as inactive', async () => {
    const response = await request(app)
      .put('/api/ticker-preferences/aapl')
      .set('x-user-id', TEST_USER_ID)
      .send({ buyOnDip: false, buyRestricted: true, buyRestrictedUntil: '2000-01-01' })
      .expect(200);

    expect(response.body.buyRestricted).toBe(true);
    expect(response.body.isBuyRestricted).toBe(false);
  });

  it('rejects an enabled restriction without a valid date', async () => {
    await request(app)
      .put('/api/ticker-preferences/MSFT')
      .set('x-user-id', TEST_USER_ID)
      .send({ buyOnDip: false, buyRestricted: true, buyRestrictedUntil: null })
      .expect(400);

    await request(app)
      .put('/api/ticker-preferences/MSFT')
      .set('x-user-id', TEST_USER_ID)
      .send({ buyOnDip: false, buyRestricted: true, buyRestrictedUntil: '2026-02-30' })
      .expect(400);
  });

  it('isolates preferences by user', async () => {
    await request(app)
      .put('/api/ticker-preferences/MSFT')
      .set('x-user-id', TEST_USER_ID)
      .send({ buyOnDip: true, buyRestricted: false, buyRestrictedUntil: null })
      .expect(200);

    const otherUserResponse = await request(app)
      .get('/api/ticker-preferences/MSFT')
      .set('x-user-id', `${TEST_USER_ID}-other`)
      .expect(200);

    expect(otherUserResponse.body.buyOnDip).toBe(false);
  });
});
