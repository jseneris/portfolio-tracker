import { describe, expect, it } from 'vitest';
import { buildPriceHistoryStats } from '../src/services/price-history-stats.js';
import { mapYahooFundamentals } from '../src/services/company-fundamentals.js';

const asOfDate = '2026-11-07';

describe('price history performance statistics', () => {
  it('computes trailing returns, 52-week range, and max drawdown from stored closes', () => {
    const rows = [
      { ticker: 'abc', marketDate: '2025-11-07', closePrice: '100' },
      { ticker: 'ABC', marketDate: '2025-12-31', closePrice: 110 },
      { ticker: 'ABC', marketDate: '2026-05-08', closePrice: 120 },
      { ticker: 'ABC', marketDate: '2026-08-08', closePrice: 150 },
      { ticker: 'ABC', marketDate: '2026-10-08', closePrice: 160 },
      { ticker: 'ABC', marketDate: '2026-11-06', closePrice: 140 },
    ];
    const [stats] = buildPriceHistoryStats(rows, asOfDate);
    expect(stats).toMatchObject({
      ticker: 'ABC', latestClose: 140, latestCloseDate: '2026-11-06',
      oldestCloseDateInWindow: '2025-11-07', observationCount: 6,
      fiftyTwoWeekHigh: 160, fiftyTwoWeekLow: 100,
      percentBelowFiftyTwoWeekHigh: 12.5,
      maxDrawdownPercent: -12.5,
      annualizedVolatilityPercent: null,
    });
    expect(stats.returnsPercent).toEqual({
      oneMonth: -12.5,
      threeMonths: -6.67,
      sixMonths: 16.67,
      yearToDate: 27.27,
      oneYear: 40,
    });
  });

  it('returns null for horizons without enough history instead of inventing values', () => {
    const [stats] = buildPriceHistoryStats([
      { ticker: 'NEW', marketDate: '2026-10-20', closePrice: 50 },
      { ticker: 'NEW', marketDate: '2026-11-06', closePrice: 55 },
    ], asOfDate);
    expect(stats.returnsPercent).toEqual({
      oneMonth: null, threeMonths: null, sixMonths: null, yearToDate: null, oneYear: null,
    });
    expect(stats.annualizedVolatilityPercent).toBeNull();
    expect(stats.fiftyTwoWeekHigh).toBe(55);
    expect(stats.fiftyTwoWeekLow).toBe(50);
  });

  it('computes annualized volatility once enough daily observations exist', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ticker: 'FLAT',
      marketDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
      closePrice: 100,
    }));
    const [stats] = buildPriceHistoryStats(rows, asOfDate);
    expect(stats.annualizedVolatilityPercent).toBe(0);
    expect(stats.maxDrawdownPercent).toBe(0);
    expect(stats.percentBelowFiftyTwoWeekHigh).toBe(0);
  });

  it('ignores invalid, non-positive, duplicate-date, and future-dated closes', () => {
    const [stats, ...rest] = buildPriceHistoryStats([
      { ticker: 'ABC', marketDate: '2026-11-05', closePrice: 'invalid' },
      { ticker: 'ABC', marketDate: '2026-11-05', closePrice: 0 },
      { ticker: 'ABC', marketDate: '2026-11-06', closePrice: 100 },
      { ticker: 'ABC', marketDate: '2026-11-06', closePrice: 105 },
      { ticker: 'ABC', marketDate: '2026-12-01', closePrice: 500 },
      { ticker: 'OLD', marketDate: '2020-01-02', closePrice: 10 },
    ], asOfDate);
    expect(rest).toHaveLength(0);
    expect(stats).toMatchObject({
      ticker: 'ABC', latestClose: 105, latestCloseDate: '2026-11-06', observationCount: 1,
    });
  });

  it('sorts results by ticker and returns an empty list without rows', () => {
    const stats = buildPriceHistoryStats([
      { ticker: 'ZZZ', marketDate: '2026-11-06', closePrice: 10 },
      { ticker: 'AAA', marketDate: '2026-11-06', closePrice: 20 },
    ], asOfDate);
    expect(stats.map((item) => item.ticker)).toEqual(['AAA', 'ZZZ']);
    expect(buildPriceHistoryStats([], asOfDate)).toEqual([]);
  });
});

describe('Yahoo fundamentals mapping', () => {
  it('maps metrics, converting fractional ratios to percentages', () => {
    const metrics = mapYahooFundamentals({
      summaryDetail: {
        trailingPE: 24.5, forwardPE: 21.1, priceToSalesTrailing12Months: 5.2, beta: 1.15,
        dividendYield: 0.0042, dividendRate: 1.04, payoutRatio: 0.153, fiveYearAvgDividendYield: 0.55,
        exDividendDate: new Date('2026-08-11T00:00:00Z'),
      },
      defaultKeyStatistics: {
        pegRatio: 2.1, priceToBook: 48.3, enterpriseToRevenue: 8.6, enterpriseToEbitda: 24.9,
        forwardPE: 20.9, sharesOutstanding: 15000000000,
      },
      financialData: {
        grossMargins: 0.456, operatingMargins: 0.302, profitMargins: 0.253,
        returnOnEquity: 1.475, returnOnAssets: 0.21, revenueGrowth: 0.061, earningsGrowth: 0.112,
        totalRevenue: 391000000000, ebitda: 134000000000, operatingCashflow: 118000000000,
        freeCashflow: 109000000000, totalCash: 65000000000, totalDebt: 106000000000,
        debtToEquity: 145.0, currentRatio: 0.87, quickRatio: 0.83,
      },
    });
    expect(metrics).toMatchObject({
      trailingPE: 24.5, forwardPE: 21.1, pegRatio: 2.1, priceToBook: 48.3,
      enterpriseToEbitda: 24.9, beta: 1.15,
      dividendYieldPercent: 0.42, payoutRatioPercent: 15.3, fiveYearAvgDividendYieldPercent: 0.55,
      exDividendDate: '2026-08-11',
      grossMarginsPercent: 45.6, operatingMarginsPercent: 30.2, profitMarginsPercent: 25.3,
      returnOnEquityPercent: 147.5, returnOnAssetsPercent: 21,
      revenueGrowthPercent: 6.1, earningsGrowthPercent: 11.2,
      totalDebt: 106000000000, debtToEquity: 145, currentRatio: 0.87,
      sharesOutstanding: 15000000000,
    });
  });

  it('prefers the summary-detail forward PE and falls back to key statistics', () => {
    expect(mapYahooFundamentals({ defaultKeyStatistics: { forwardPE: 19.4 } }).forwardPE).toBe(19.4);
  });

  it('returns null for missing modules and non-numeric values instead of guessing', () => {
    const metrics = mapYahooFundamentals(null);
    expect(Object.values(metrics).every((value) => value === null)).toBe(true);
    const partial = mapYahooFundamentals({
      summaryDetail: { trailingPE: 'n/a', dividendYield: Infinity, exDividendDate: 'soon' },
    });
    expect(partial.trailingPE).toBeNull();
    expect(partial.dividendYieldPercent).toBeNull();
    expect(partial.exDividendDate).toBeNull();
  });
});
