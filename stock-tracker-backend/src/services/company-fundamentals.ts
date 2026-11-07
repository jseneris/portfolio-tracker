import sql from 'mssql';
import YahooFinance from 'yahoo-finance2';
import { getPool } from '../db/connection.js';

const yahooFinance = new YahooFinance();
const FUNDAMENTALS_CACHE_MS = 20 * 60 * 60 * 1000;
const FETCH_CONCURRENCY = 4;

export type FundamentalMetrics = Record<string, number | string | null>;

export type CompanyFundamentals = {
  ticker: string;
  updatedAt: string | null;
  metrics: FundamentalMetrics | null;
};

export type FundamentalsRefreshSummary = {
  tickersChecked: number;
  refreshed: number;
  skippedFresh: number;
  failedTickers: Array<{ ticker: string; error: string }>;
};

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toPercent(value: unknown): number | null {
  const number = toNumber(value);
  return number == null ? null : Math.round(number * 10000) / 100;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

// Maps a Yahoo quoteSummary result to flat, named metrics. Fractional ratios are
// converted to percentages; missing or non-numeric values become null.
export function mapYahooFundamentals(summary: {
  summaryDetail?: Record<string, unknown>;
  defaultKeyStatistics?: Record<string, unknown>;
  financialData?: Record<string, unknown>;
} | null | undefined): FundamentalMetrics {
  const detail = summary?.summaryDetail ?? {};
  const keyStats = summary?.defaultKeyStatistics ?? {};
  const financial = summary?.financialData ?? {};
  return {
    trailingPE: toNumber(detail.trailingPE),
    forwardPE: toNumber(detail.forwardPE ?? keyStats.forwardPE),
    pegRatio: toNumber(keyStats.pegRatio),
    priceToSalesTrailing12Months: toNumber(detail.priceToSalesTrailing12Months),
    priceToBook: toNumber(keyStats.priceToBook),
    enterpriseToRevenue: toNumber(keyStats.enterpriseToRevenue),
    enterpriseToEbitda: toNumber(keyStats.enterpriseToEbitda),
    beta: toNumber(detail.beta),
    dividendYieldPercent: toPercent(detail.dividendYield),
    dividendRate: toNumber(detail.dividendRate),
    payoutRatioPercent: toPercent(detail.payoutRatio),
    fiveYearAvgDividendYieldPercent: toNumber(detail.fiveYearAvgDividendYield),
    exDividendDate: toIsoDate(detail.exDividendDate),
    grossMarginsPercent: toPercent(financial.grossMargins),
    operatingMarginsPercent: toPercent(financial.operatingMargins),
    profitMarginsPercent: toPercent(financial.profitMargins),
    returnOnEquityPercent: toPercent(financial.returnOnEquity),
    returnOnAssetsPercent: toPercent(financial.returnOnAssets),
    revenueGrowthPercent: toPercent(financial.revenueGrowth),
    earningsGrowthPercent: toPercent(financial.earningsGrowth),
    totalRevenue: toNumber(financial.totalRevenue),
    ebitda: toNumber(financial.ebitda),
    operatingCashflow: toNumber(financial.operatingCashflow),
    freeCashflow: toNumber(financial.freeCashflow),
    totalCash: toNumber(financial.totalCash),
    totalDebt: toNumber(financial.totalDebt),
    debtToEquity: toNumber(financial.debtToEquity),
    currentRatio: toNumber(financial.currentRatio),
    quickRatio: toNumber(financial.quickRatio),
    sharesOutstanding: toNumber(keyStats.sharesOutstanding),
  };
}

function parseMetricsJson(json: unknown): FundamentalMetrics | null {
  if (typeof json !== 'string' || !json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed as FundamentalMetrics : null;
  } catch {
    return null;
  }
}

async function fetchAndStoreFundamentals(ticker: string): Promise<void> {
  const summary = await yahooFinance.quoteSummary(ticker, {
    modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'],
  }) as any;
  const metrics = mapYahooFundamentals(summary);
  await getPool().request()
    .input('ticker', sql.NVarChar, ticker)
    .input('metricsJson', sql.NVarChar, JSON.stringify(metrics))
    .query(`
      MERGE CompanyFundamentals WITH (HOLDLOCK) AS target
      USING (SELECT @ticker AS ticker) AS source
      ON target.ticker = source.ticker
      WHEN MATCHED THEN UPDATE SET
        metricsJson = @metricsJson,
        source = 'yahoo-finance',
        updatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (ticker, metricsJson, source)
        VALUES (@ticker, @metricsJson, 'yahoo-finance');
    `);
}

// Refreshes cached fundamentals for the given tickers from Yahoo with limited
// concurrency, skipping recently refreshed entries. Used by the daily EOD job;
// individual ticker failures are reported, not thrown. Safe to re-run.
export async function refreshCompanyFundamentals(tickers: string[]): Promise<FundamentalsRefreshSummary> {
  const normalized = Array.from(new Set(
    tickers.map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => ticker && !ticker.startsWith('^'))
  )).sort();
  const summary: FundamentalsRefreshSummary = {
    tickersChecked: normalized.length, refreshed: 0, skippedFresh: 0, failedTickers: [],
  };
  if (normalized.length === 0) return summary;

  const request = getPool().request();
  const placeholders = normalized.map((ticker, index) => {
    request.input(`ticker${index}`, sql.NVarChar, ticker);
    return `@ticker${index}`;
  });
  const cached = await request.query<{ ticker: string; updatedAt: string }>(`
    SELECT ticker, CONVERT(varchar(33), updatedAt, 126) AS updatedAt
    FROM CompanyFundamentals
    WHERE ticker IN (${placeholders.join(', ')})
  `);
  const now = Date.now();
  const freshTickers = new Set((cached.recordset ?? [])
    .filter((row) => now - new Date(`${String(row.updatedAt).replace(/Z$/, '')}Z`).getTime() <= FUNDAMENTALS_CACHE_MS)
    .map((row) => row.ticker.toUpperCase()));
  const staleTickers = normalized.filter((ticker) => !freshTickers.has(ticker));
  summary.skippedFresh = normalized.length - staleTickers.length;

  let nextIndex = 0;
  async function refreshWorker() {
    while (nextIndex < staleTickers.length) {
      const ticker = staleTickers[nextIndex++];
      try {
        await fetchAndStoreFundamentals(ticker);
        summary.refreshed += 1;
      } catch (error) {
        summary.failedTickers.push({ ticker, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, staleTickers.length) }, refreshWorker));
  return summary;
}

// Read-only, user-scoped lookup of cached fundamentals for the user's open-lot
// tickers. Never contacts the provider; tickers without a cached row are omitted.
export async function loadCompanyFundamentalsForUser(userId: string): Promise<CompanyFundamentals[]> {
  const result = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query<{ ticker: string; metricsJson: string; updatedAt: string }>(`
      SELECT cf.ticker, cf.metricsJson, CONVERT(varchar(33), cf.updatedAt, 126) AS updatedAt
      FROM CompanyFundamentals cf
      WHERE cf.ticker IN (
        SELECT DISTINCT pl.ticker FROM PurchaseLots pl
        WHERE pl.userId = @userId AND pl.remainingQuantity > 0
      )
      ORDER BY cf.ticker
    `);
  return (result.recordset ?? []).map((row) => ({
    ticker: row.ticker.toUpperCase(),
    updatedAt: row.updatedAt ? String(row.updatedAt) : null,
    metrics: parseMetricsJson(row.metricsJson),
  }));
}
