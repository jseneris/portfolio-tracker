import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sql from 'mssql';
import { initializeDatabase, getPool } from '../src/db/connection.js';

describe('AI chat message schema', () => {
  it('initializes idempotently and preserves a full saved response and existing alert fields', async () => {
    await initializeDatabase();
    const pool = getPool();
    const userId = `ai-message-schema-test-${randomUUID()}`;
    const body = `Question:\n${'q'.repeat(1000)}\n\nAI response:\n${'a'.repeat(4000)}`;
    try {
      await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('body', sql.NVarChar(sql.MAX), body)
        .query(`
          INSERT INTO Messages (userId, type, ticker, triggerPrice, body)
          VALUES (@userId, 'ai-chat', NULL, NULL, @body),
                 (@userId, 'buy-target-hit', 'TEST', 100, 'Existing alert');
        `);
      await pool.close();
      await initializeDatabase();
      const result = await getPool().request().input('userId', sql.NVarChar, userId)
        .query('SELECT type, ticker, triggerPrice, body, isRead FROM Messages WHERE userId = @userId ORDER BY type');
      expect(result.recordset).toEqual([
        { type: 'ai-chat', ticker: null, triggerPrice: null, body, isRead: false },
        { type: 'buy-target-hit', ticker: 'TEST', triggerPrice: 100, body: 'Existing alert', isRead: false },
      ]);
    } finally {
      await getPool().request().input('userId', sql.NVarChar, userId)
        .query('DELETE FROM Messages WHERE userId = @userId');
      await getPool().close();
    }
  });
});
