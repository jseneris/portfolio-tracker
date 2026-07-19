import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import sql from 'mssql';
import app from '../src/index.js';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { clearUserData, TEST_USER_ID } from './setup.js';

describe('18. User Settings - Target Preferences', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('returns default target values on an empty database', async () => {
    const response = await request(app)
      .get('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    expect(response.body).toEqual({
      saleTargetPercent: 10,
      buyTargetPercentUnder3DisplayLots: 5,
      buyTargetPercentFor3DisplayLots: 10,
      buyTargetPercentFor4DisplayLots: 15,
      buyTargetPercentFor5DisplayLots: 20,
      buyTargetPercentFor6OrMoreDisplayLots: 25,
    });
  });

  it('persists all target values and returns them on GET', async () => {
    const payload = {
      saleTargetPercent: 12.5,
      buyTargetPercentUnder3DisplayLots: 4.5,
      buyTargetPercentFor3DisplayLots: 9.25,
      buyTargetPercentFor4DisplayLots: 13,
      buyTargetPercentFor5DisplayLots: 17.75,
      buyTargetPercentFor6OrMoreDisplayLots: 22.5,
    };

    const putResponse = await request(app)
      .put('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .send(payload)
      .expect(200);

    expect(putResponse.body).toEqual(payload);

    const getResponse = await request(app)
      .get('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    expect(getResponse.body).toEqual(payload);

    const pool = getPool();
    const rowCountResult = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .query('SELECT COUNT(*) AS rowCount FROM UserSettings WHERE userId = @userId');

    expect(Number(rowCountResult.recordset[0].rowCount)).toBe(1);
  });

  it('updates the existing settings row instead of inserting a duplicate', async () => {
    const firstPayload = {
      saleTargetPercent: 11,
      buyTargetPercentUnder3DisplayLots: 6,
      buyTargetPercentFor3DisplayLots: 11,
      buyTargetPercentFor4DisplayLots: 16,
      buyTargetPercentFor5DisplayLots: 21,
      buyTargetPercentFor6OrMoreDisplayLots: 26,
    };

    const secondPayload = {
      saleTargetPercent: 14,
      buyTargetPercentUnder3DisplayLots: 7,
      buyTargetPercentFor3DisplayLots: 12,
      buyTargetPercentFor4DisplayLots: 17,
      buyTargetPercentFor5DisplayLots: 22,
      buyTargetPercentFor6OrMoreDisplayLots: 27,
    };

    await request(app)
      .put('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .send(firstPayload)
      .expect(200);

    await request(app)
      .put('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .send(secondPayload)
      .expect(200);

    const getResponse = await request(app)
      .get('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    expect(getResponse.body).toEqual(secondPayload);

    const pool = getPool();
    const rowCountResult = await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .query('SELECT COUNT(*) AS rowCount FROM UserSettings WHERE userId = @userId');

    expect(Number(rowCountResult.recordset[0].rowCount)).toBe(1);
  });

  it('rejects invalid target values', async () => {
    await request(app)
      .put('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .send({
        saleTargetPercent: 0,
        buyTargetPercentUnder3DisplayLots: 5,
        buyTargetPercentFor3DisplayLots: 10,
        buyTargetPercentFor4DisplayLots: 15,
        buyTargetPercentFor5DisplayLots: 20,
        buyTargetPercentFor6OrMoreDisplayLots: 25,
      })
      .expect(400);

    await request(app)
      .put('/api/user-settings/targets')
      .set('x-user-id', TEST_USER_ID)
      .send({
        saleTargetPercent: 10,
        buyTargetPercentUnder3DisplayLots: 5,
        buyTargetPercentFor3DisplayLots: 10,
        buyTargetPercentFor4DisplayLots: 15,
        buyTargetPercentFor5DisplayLots: 20,
        buyTargetPercentFor6OrMoreDisplayLots: 1001,
      })
      .expect(400);
  });
});
