import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sql from 'mssql';
import app from '../src/index.js';
import { getPool, initializeDatabase } from '../src/db/connection.js';
import { TEST_USER_ID } from './setup.js';

describe('stock performance historical price window', () => {
  const ticker = `P${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
  beforeAll(async () => {
    await initializeDatabase();
    await getPool().request().input('ticker', sql.NVarChar, ticker).query(`
      INSERT INTO HistoricalPrices (ticker, priceDate, marketDate, closePrice, source)
      VALUES (@ticker, '2024-01-01', '2024-01-01', 90, 'performance-test'),
             (@ticker, '2025-12-30', '2025-12-30', 100, 'performance-test'),
             (@ticker, '2026-01-02', '2026-01-02', 110, 'performance-test'),
             (@ticker, '2027-01-01', '2027-01-01', 120, 'performance-test');
    `);
  });
  afterAll(async () => {
    await getPool().request().input('ticker', sql.NVarChar, ticker)
      .query("DELETE FROM HistoricalPrices WHERE ticker = @ticker AND source = 'performance-test'");
  });

  it('returns only the selected year and one latest prior close for the opening valuation', async () => {
    const response = await request(app).get('/api/stocks/historical-prices')
      .query({ startDate: '2026-01-01', endDate: '2026-12-31', tickers: ticker, includePriorClose: 'true' })
      .set('x-user-id', TEST_USER_ID).expect(200);
    expect(response.body.map((row: { priceDate: string }) => row.priceDate)).toEqual(['2025-12-30', '2026-01-02']);
    expect(response.body.map((row: { closePrice: number }) => row.closePrice)).toEqual([100, 110]);
  });

  it('preserves the existing date-range response without an opening close when not requested', async () => {
    const response = await request(app).get('/api/stocks/historical-prices')
      .query({ startDate: '2026-01-01', endDate: '2026-12-31', tickers: ticker })
      .set('x-user-id', TEST_USER_ID).expect(200);
    expect(response.body.map((row: { priceDate: string }) => row.priceDate)).toEqual(['2026-01-02']);
  });

  it('requires specific tickers to fetch opening closes', async () => {
    await request(app).get('/api/stocks/historical-prices')
      .query({ startDate: '2026-01-01', endDate: '2026-12-31', includePriorClose: 'true' })
      .set('x-user-id', TEST_USER_ID).expect(400);
  });
});
