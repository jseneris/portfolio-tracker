import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sql from 'mssql';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { loadAiPreferences } from '../src/services/ai-preferences.js';
import { loadHoldingReviewContext } from '../src/services/holding-review-context.js';

describe('AI chat message schema', () => {
  it('initializes idempotently and preserves a full saved response and existing alert fields', async () => {
    await initializeDatabase();
    const pool = getPool();
    const userId = `ai-message-schema-test-${randomUUID()}`;
    const body = `Question:\n${'q'.repeat(2000)}\n\nAI response:\n${'a'.repeat(8000)}`;
    try {
      await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('body', sql.NVarChar(sql.MAX), body)
        .query(`
          INSERT INTO Messages (userId, type, ticker, triggerPrice, body)
          VALUES (@userId, 'ai-chat', NULL, NULL, @body),
                 (@userId, 'buy-target-hit', 'TEST', 100, 'Existing alert');
        `);
      await pool.request().input('userId', sql.NVarChar, userId)
        .query('INSERT INTO Users (id, aiInsightsEnabled, aiAssumptionsEnabled) VALUES (@userId, 1, 1)');
      await pool.close();
      await initializeDatabase();
      const result = await getPool().request().input('userId', sql.NVarChar, userId)
        .query('SELECT type, ticker, triggerPrice, body, isRead FROM Messages WHERE userId = @userId ORDER BY type');
      expect(result.recordset).toEqual([
        { type: 'ai-chat', ticker: null, triggerPrice: null, body, isRead: false },
        { type: 'buy-target-hit', ticker: 'TEST', triggerPrice: 100, body: 'Existing alert', isRead: false },
      ]);
      expect((await loadAiPreferences(userId))?.investmentHorizonYears).toBe(10);
      expect(await loadAiPreferences(`${userId}-outside`)).toBeNull();
      expect(await loadHoldingReviewContext(userId, [], '2026-10-06')).toEqual([]);
    } finally {
      await getPool().request().input('userId', sql.NVarChar, userId)
        .query('DELETE FROM Messages WHERE userId = @userId');
      await getPool().request().input('userId', sql.NVarChar, userId)
        .query('DELETE FROM Users WHERE id = @userId');
      await getPool().close();
    }
  });
});
