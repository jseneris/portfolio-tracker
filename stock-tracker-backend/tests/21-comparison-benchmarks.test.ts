import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import sql from 'mssql';
import request from 'supertest';
import app from '../src/index.js';
import { initializeDatabase, getPool } from '../src/db/connection.js';
import { getYearPriorityDates } from '../src/routes/stocks.js';
import { buyStock, clearUserData, depositCash, TEST_USER_ID } from './setup.js';

async function seedHistoricalPrice(ticker: string, priceDate: string, closePrice: number) {
  const pool = getPool();
  const date = new Date(`${priceDate}T00:00:00Z`);

  await pool.request()
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('priceDate', sql.Date, date)
    .input('marketDate', sql.Date, date)
    .input('closePrice', sql.Decimal(18, 8), closePrice)
    .input('source', sql.NVarChar, 'test')
    .query(`
      MERGE HistoricalPrices AS target
      USING (
        SELECT @ticker AS ticker, @priceDate AS priceDate, @source AS source
      ) AS sourceRow
      ON target.ticker = sourceRow.ticker
         AND target.priceDate = sourceRow.priceDate
         AND target.source = sourceRow.source
      WHEN MATCHED THEN
        UPDATE SET
          marketDate = @marketDate,
          closePrice = @closePrice,
          updatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, ticker, priceDate, marketDate, closePrice, source)
        VALUES (NEWID(), @ticker, @priceDate, @marketDate, @closePrice, @source);
    `);
}

describe('21. Comparison Benchmarks', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('revalues benchmark lines by point date for each index using the closest prior cash-flow close', async () => {
    await seedHistoricalPrice('^DJI', '2022-01-07', 100);
    await seedHistoricalPrice('^IXIC', '2022-01-07', 200);
    await seedHistoricalPrice('^GSPC', '2022-01-07', 400);

    await seedHistoricalPrice('^DJI', '2022-01-10', 110);
    await seedHistoricalPrice('^IXIC', '2022-01-10', 250);
    await seedHistoricalPrice('^GSPC', '2022-01-10', 380);

    await seedHistoricalPrice('^DJI', '2022-01-12', 120);
    await seedHistoricalPrice('^IXIC', '2022-01-12', 240);
    await seedHistoricalPrice('^GSPC', '2022-01-12', 420);

    await depositCash(1000, new Date('2022-01-08T00:00:00Z'));

    const response = await request(app)
      .get('/api/stocks/historical-prices?year=2022')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    const points = Array.isArray(response.body?.points) ? response.body.points : [];
    const jan7 = points.find((point: any) => point.date === '2022-01-07');
    const jan10 = points.find((point: any) => point.date === '2022-01-10');
    const jan12 = points.find((point: any) => point.date === '2022-01-12');

    expect(jan7).toBeDefined();
    expect(jan10).toBeDefined();
    expect(jan12).toBeDefined();

    expect(Number(jan7.dowBenchmarkValue)).toBeCloseTo(0, 6);
    expect(Number(jan7.nasdaqBenchmarkValue)).toBeCloseTo(0, 6);
    expect(Number(jan7.sp500BenchmarkValue)).toBeCloseTo(0, 6);

    expect(Number(jan10.dowBenchmarkShares)).toBeCloseTo(10, 6);
    expect(Number(jan10.nasdaqBenchmarkShares)).toBeCloseTo(5, 6);
    expect(Number(jan10.sp500BenchmarkShares)).toBeCloseTo(2.5, 6);

    expect(Number(jan10.dowBenchmarkValue)).toBeCloseTo(1100, 6);
    expect(Number(jan10.nasdaqBenchmarkValue)).toBeCloseTo(1250, 6);
    expect(Number(jan10.sp500BenchmarkValue)).toBeCloseTo(950, 6);

    expect(Number(jan12.dowBenchmarkValue)).toBeCloseTo(1200, 6);
    expect(Number(jan12.nasdaqBenchmarkValue)).toBeCloseTo(1200, 6);
    expect(Number(jan12.sp500BenchmarkValue)).toBeCloseTo(1050, 6);
  });

  it('includes pre-period deposits when computing requested-year benchmark values', async () => {
    await seedHistoricalPrice('^DJI', '2021-12-31', 100);
    await seedHistoricalPrice('^IXIC', '2021-12-31', 200);
    await seedHistoricalPrice('^GSPC', '2021-12-31', 400);

    await seedHistoricalPrice('^DJI', '2022-01-03', 110);
    await seedHistoricalPrice('^IXIC', '2022-01-03', 220);
    await seedHistoricalPrice('^GSPC', '2022-01-03', 380);

    await seedHistoricalPrice('^DJI', '2022-01-10', 120);
    await seedHistoricalPrice('^IXIC', '2022-01-10', 240);
    await seedHistoricalPrice('^GSPC', '2022-01-10', 420);

    await depositCash(1000, new Date('2021-12-31T00:00:00Z'));

    const response = await request(app)
      .get('/api/stocks/historical-prices?year=2022')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    const points = Array.isArray(response.body?.points) ? response.body.points : [];
    const jan3 = points.find((point: any) => point.date === '2022-01-03');
    const jan10 = points.find((point: any) => point.date === '2022-01-10');

    expect(jan3).toBeDefined();
    expect(jan10).toBeDefined();

    expect(Number(jan3.dowBenchmarkValue)).toBeCloseTo(1100, 6);
    expect(Number(jan3.nasdaqBenchmarkValue)).toBeCloseTo(1100, 6);
    expect(Number(jan3.sp500BenchmarkValue)).toBeCloseTo(950, 6);

    expect(Number(jan10.dowBenchmarkValue)).toBeCloseTo(1200, 6);
    expect(Number(jan10.nasdaqBenchmarkValue)).toBeCloseTo(1200, 6);
    expect(Number(jan10.sp500BenchmarkValue)).toBeCloseTo(1050, 6);
  });

  it('prioritizes stock transaction dates when building the sync-year queue even without cash events', async () => {
    await buyStock('TEST', 1, 100, new Date('2025-02-10T00:00:00Z'));

    const priorityDates = await getYearPriorityDates(
      getPool(),
      TEST_USER_ID,
      '2025-01-01',
      '2025-12-31'
    );

    expect(priorityDates).toContain('2025-02-10');
    expect(priorityDates).not.toContain('2025-01-01');
  });

  it('returns yearly compare data as a subsection of the all-series timeline', async () => {
    await seedHistoricalPrice('^DJI', '2021-12-31', 100);
    await seedHistoricalPrice('^IXIC', '2021-12-31', 200);
    await seedHistoricalPrice('^GSPC', '2021-12-31', 400);

    await seedHistoricalPrice('^DJI', '2022-01-03', 110);
    await seedHistoricalPrice('^IXIC', '2022-01-03', 220);
    await seedHistoricalPrice('^GSPC', '2022-01-03', 380);

    await seedHistoricalPrice('^DJI', '2022-01-10', 120);
    await seedHistoricalPrice('^IXIC', '2022-01-10', 240);
    await seedHistoricalPrice('^GSPC', '2022-01-10', 420);

    await depositCash(1000, new Date('2021-12-31T00:00:00Z'));
    await depositCash(500, new Date('2022-01-10T00:00:00Z'));

    const allResponse = await request(app)
      .get('/api/stocks/portfolio/comparison-all')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    const yearResponse = await request(app)
      .get('/api/stocks/historical-prices?year=2022')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    const allPoints = Array.isArray(allResponse.body?.points) ? allResponse.body.points : [];
    const yearPoints = Array.isArray(yearResponse.body?.points) ? allResponse.body.points : [];
    const all2022Points = allPoints.filter((point: any) => String(point.date || '').startsWith('2022-'));

    expect(all2022Points.map((point: any) => point.date)).toEqual(yearPoints.map((point: any) => point.date));
    expect(all2022Points.map((point: any) => Number(point.dowBenchmarkValue))).toEqual(
      yearPoints.map((point: any) => Number(point.dowBenchmarkValue))
    );
    expect(all2022Points.map((point: any) => Number(point.nasdaqBenchmarkValue))).toEqual(
      yearPoints.map((point: any) => Number(point.nasdaqBenchmarkValue))
    );
    expect(all2022Points.map((point: any) => Number(point.sp500BenchmarkValue))).toEqual(
      yearPoints.map((point: any) => Number(point.sp500BenchmarkValue))
    );
  });

  it('carries forward stock prices on non-trading compare dates', async () => {
    await seedHistoricalPrice('TEST', '2022-12-31', 100);
    await seedHistoricalPrice('^DJI', '2022-12-31', 100);
    await seedHistoricalPrice('^IXIC', '2022-12-31', 200);
    await seedHistoricalPrice('^GSPC', '2022-12-31', 400);

    await seedHistoricalPrice('^DJI', '2023-01-01', 100);
    await seedHistoricalPrice('^IXIC', '2023-01-01', 200);
    await seedHistoricalPrice('^GSPC', '2023-01-01', 400);

    await depositCash(1000, new Date('2022-12-30T00:00:00Z'));
    await buyStock('TEST', 1, 100, new Date('2022-12-30T00:00:00Z'));

    const response = await request(app)
      .get('/api/stocks/portfolio/comparison-all')
      .set('x-user-id', TEST_USER_ID)
      .expect(200);

    const points = Array.isArray(response.body?.points) ? response.body.points : [];
    const dec31 = points.find((point: any) => point.date === '2022-12-31');
    const jan1 = points.find((point: any) => point.date === '2023-01-01');

    expect(dec31).toBeDefined();
    expect(jan1).toBeDefined();

    expect(Number(dec31.stockValue)).toBeCloseTo(100, 6);
    expect(Number(jan1.stockValue)).toBeCloseTo(100, 6);
    expect(Number(dec31.portfolioValue)).toBeCloseTo(1000, 6);
    expect(Number(jan1.portfolioValue)).toBeCloseTo(1000, 6);
  });
});