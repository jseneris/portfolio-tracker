import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../src/routes/simulation.js';

const mocks = vi.hoisted(() => ({ chart: vi.fn() }));
vi.mock('yahoo-finance2', () => ({
  default: class { chart = mocks.chart; },
}));

const app = express();
app.use(express.json());
app.use('/simulation', router);
const body = { tickers: ['AAA'], startDate: '2026-01-01', endDate: '2026-01-10' };
const quote = (date: string) => ({ date: new Date(date), open: 50, high: 55, low: 45, close: 52 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
  mocks.chart.mockReset();
  mocks.chart.mockResolvedValue({ meta: { currency: 'USD' }, quotes: [quote('2025-12-31'), quote('2026-01-02')] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('read-only simulation OHLC endpoint (no database imports)', () => {
  it('deduplicates symbols and fetches seed history plus splits through now', async () => {
    const response = await request(app).post('/simulation/prices').send({ ...body, tickers: ['AAA', 'AAA'] }).expect(200);
    expect(response.body.bars).toHaveLength(2);
    expect(response.body.bars[1]).toEqual({ ticker: 'AAA', date: '2026-01-02', open: 50, high: 55, low: 45, close: 52 });
    expect(mocks.chart).toHaveBeenCalledTimes(1);
    expect(mocks.chart).toHaveBeenCalledWith('AAA', expect.objectContaining({
      period1: new Date('2025-12-18'), interval: '1d', events: 'split',
    }));
  });

  it('restores nominal OHLC using later splits, including splits after the requested end', async () => {
    mocks.chart.mockResolvedValue({ meta: { currency: 'USD' },
      quotes: [quote('2025-12-31'), quote('2026-01-05'), quote('2026-01-20')],
      events: { splits: [
        { date: new Date('2026-01-05'), numerator: 2, denominator: 1 },
        { date: new Date('2026-01-20'), numerator: 3, denominator: 1 },
      ] },
    });
    const { body: result } = await request(app).post('/simulation/prices').send(body).expect(200);
    expect(result.bars).toHaveLength(2);
    expect(result.bars.map((bar: { open: number }) => bar.open)).toEqual([300, 150]);
    expect(result.marketSplits).toEqual([{ ticker: 'AAA', date: '2026-01-05', multiplier: 2 }]);
  });

  it('allows newly listed actual-only tickers without a pre-start quote', async () => {
    mocks.chart.mockResolvedValue({ meta: { currency: 'USD' }, quotes: [quote('2026-01-05')] });
    await request(app).post('/simulation/prices').send(body).expect(200);
  });

  it('reports omitted invalid bars rather than silently presenting complete history', async () => {
    mocks.chart.mockResolvedValue({ meta: { currency: 'USD' }, quotes: [
      quote('2025-12-31'), { ...quote('2026-01-02'), low: null },
    ] });
    const response = await request(app).post('/simulation/prices').send(body).expect(200);
    expect(response.body.bars).toHaveLength(1);
    expect(response.body.warnings[0]).toContain('1 invalid OHLC bar(s) omitted');
  });

  it.each([
    { tickers: [] }, { tickers: ['aaa'] }, { tickers: ['bad/symbol'] }, { tickers: Array(201).fill('AAA') },
    { startDate: '2026-02-30' }, { startDate: '2026-01-11' }, { endDate: '2026-02-01' }, { startDate: '2024-01-01' },
  ])('rejects invalid input without calling the provider: %j', async (changes) => {
    await request(app).post('/simulation/prices').send({ ...body, ...changes }).expect(400);
    expect(mocks.chart).not.toHaveBeenCalled();
  });

  it.each([
    { meta: { currency: 'EUR' }, quotes: [quote('2026-01-05')] },
    { meta: { currency: 'USD' }, quotes: [] },
    { meta: { currency: 'USD' }, quotes: [{ ...quote('2026-01-05'), low: null }] },
    { meta: { currency: 'USD' }, quotes: [{ ...quote('2026-01-05'), high: 49 }] },
  ])('surfaces unsupported currency and unavailable usable history', async (chart) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.chart.mockResolvedValue(chart);
    const response = await request(app).post('/simulation/prices').send(body).expect(502);
    expect(response.body.error).toBeTruthy();
    expect(console.error).toHaveBeenCalled();
  });

  it('surfaces provider errors instead of returning partial results', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.chart.mockRejectedValue(new Error('Provider unavailable'));
    const response = await request(app).post('/simulation/prices').send(body).expect(502);
    expect(response.body).toEqual({ error: 'Provider unavailable' });
  });
});
