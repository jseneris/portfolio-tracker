import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import sql from 'mssql';
import app from '../src/index.js';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { clearUserData, TEST_USER_ID } from './setup.js';

describe('20. Auth Foundation', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('accepts the test/dev identity header and upserts a Users row', async () => {
    await request(app)
      .get('/api/health')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar, TEST_USER_ID)
      .query('SELECT id, email, name, pictureUrl FROM Users WHERE id = @id');

    expect(result.recordset).toHaveLength(1);
    expect(result.recordset[0].id).toBe(TEST_USER_ID);
    expect(result.recordset[0].email).toBeNull();
    expect(result.recordset[0].name).toBeNull();
    expect(result.recordset[0].pictureUrl).toBeNull();
  });
});
