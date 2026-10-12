import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sql from 'mssql';

const chart = vi.hoisted(() => vi.fn());
vi.mock('yahoo-finance2', () => ({
  default: class { chart = chart; },
}));

import app from '../src/index.js';
import { getPool, initializeDatabase } from '../src/db/connection.js';

describe('saved watchlist', () => {
  let userId: string;
  const today = new Date().toISOString().slice(0, 10);
  beforeAll(async () => { await initializeDatabase(); });
  beforeEach(() => {
    userId = `watchlist-test-${randomUUID()}`;
    chart.mockReset();
    chart.mockResolvedValue({ quotes: [
      { date: new Date('2025-01-02T00:00:00Z'), close: 100 },
      { date: new Date('2025-01-03T00:00:00Z'), close: 110 },
      { date: new Date('2025-01-04T00:00:00Z'), close: null },
    ] });
  });
  afterEach(async () => {
    await getPool().request().input('userId', sql.NVarChar, userId).query(`
      DELETE FROM WatchlistItems WHERE userId = @userId;
      DELETE FROM Users WHERE id = @userId OR id = @userId + '-other';
    `);
  });

  async function add(ticker = 'VTSAX', startDate = '2025-01-01') {
    return request(app).post('/api/watchlist').set('x-user-id', userId).send({ ticker, startDate });
  }

  it('saves normalized tickers and start dates and lists them after subsequent requests', async () => {
    const response = await add(' vtsax ');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ ticker: 'VTSAX', startDate: '2025-01-01' });
    expect(chart).not.toHaveBeenCalled();
    const list = await request(app).get('/api/watchlist').set('x-user-id', userId).expect(200);
    expect(list.body).toEqual([response.body]);
  });

  it('rejects duplicate tickers, invalid symbols, calendar dates and future watch dates', async () => {
    await add().then((response) => expect(response.status).toBe(201));
    await add().then((response) => expect(response.status).toBe(409));
    await add('BAD TICKER').then((response) => expect(response.status).toBe(400));
    await add('VBTLX', '2025-02-30').then((response) => expect(response.status).toBe(400));
    const future = new Date(`${today}T00:00:00Z`);
    future.setUTCDate(future.getUTCDate() + 1);
    await add('VBTLX', future.toISOString().slice(0, 10)).then((response) => expect(response.status).toBe(400));
  });

  it('fetches and caches valid closes only when requested, independent of stock transactions', async () => {
    const item = (await add()).body;
    const first = await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(200);
    expect(first.body).toEqual([{ date: '2025-01-02', close: 100 }, { date: '2025-01-03', close: 110 }]);
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(200);
    expect(chart).toHaveBeenCalledTimes(1);
    expect(chart.mock.calls[0][0]).toBe('VTSAX');
    const transactions = await getPool().request().input('userId', sql.NVarChar, userId)
      .query('SELECT id FROM StockTransactions WHERE userId = @userId');
    expect(transactions.recordset).toEqual([]);
  });

  it('scopes listing, prices and removal to the owner', async () => {
    const item = (await add()).body;
    const list = await request(app).get('/api/watchlist').set('x-user-id', `${userId}-other`).expect(200);
    expect(list.body).toEqual([]);
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', `${userId}-other`).expect(404);
    await request(app).delete(`/api/watchlist/${item.id}`).set('x-user-id', `${userId}-other`).expect(404);
    expect(chart).not.toHaveBeenCalled();
  });

  it('removes the saved item and its cached prices', async () => {
    const item = (await add()).body;
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(200);
    await request(app).delete(`/api/watchlist/${item.id}`).set('x-user-id', userId).expect(204);
    const prices = await getPool().request().input('id', sql.UniqueIdentifier, item.id)
      .query('SELECT priceDate FROM WatchlistPrices WHERE watchlistId = @id');
    expect(prices.recordset).toEqual([]);
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(404);
  });

  it('surfaces provider failures and unavailable history without caching fabricated prices', async () => {
    const item = (await add()).body;
    chart.mockRejectedValueOnce(new Error('provider failure'));
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(502);
    chart.mockResolvedValueOnce({ quotes: [] });
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(422);
    await request(app).get(`/api/watchlist/${item.id}/prices`).set('x-user-id', userId).expect(200);
    expect(chart).toHaveBeenCalledTimes(3);
  });
});
