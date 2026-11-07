import sql from 'mssql';
import { getPool } from '../db/connection.js';

export type PriceHistoryRow = {
  ticker: string;
  marketDate: string;
  closePrice: number | string;
};

export type TickerPriceHistoryStats = {
  ticker: string;
  latestClose: number;
  latestCloseDate: string;
  oldestCloseDateInWindow: string;
  observationCount: number;
  returnsPercent: {
    oneMonth: number | null;
    threeMonths: number | null;
    sixMonths: number | null;
    yearToDate: number | null;
    oneYear: number | null;
  };
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  percentBelowFiftyTwoWeekHigh: number;
  annualizedVolatilityPercent: number | null;
  maxDrawdownPercent: number | null;
};

const WINDOW_DAYS = 400;
const MIN_RETURNS_FOR_VOLATILITY = 20;

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function returnSince(closes: { date: string; close: number }[], cutoffDate: string, latestClose: number): number | null {
  let reference: number | null = null;
  for (const point of closes) {
    if (point.date > cutoffDate) break;
    reference = point.close;
  }
  return reference != null && reference > 0 ? round((latestClose / reference - 1) * 100) : null;
}

// Computes price-performance and risk statistics per ticker from stored daily closes.
// Rows may cover roughly the last 13 months; longer-horizon stats are null when history is shorter.
export function buildPriceHistoryStats(rows: PriceHistoryRow[], asOfDate: string): TickerPriceHistoryStats[] {
  const byTicker = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const close = Number(row.closePrice);
    if (!Number.isFinite(close) || close <= 0) continue;
    const date = String(row.marketDate).slice(0, 10);
    if (date > asOfDate) continue;
    const ticker = row.ticker.toUpperCase();
    const series = byTicker.get(ticker) ?? new Map<string, number>();
    series.set(date, close);
    byTicker.set(ticker, series);
  }

  const yearAgo = shiftDate(asOfDate, -365);
  const priorYearEnd = `${Number(asOfDate.slice(0, 4)) - 1}-12-31`;
  const stats: TickerPriceHistoryStats[] = [];
  for (const [ticker, series] of byTicker) {
    const closes = Array.from(series.entries())
      .map(([date, close]) => ({ date, close }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = closes[closes.length - 1];
    const lastYear = closes.filter((point) => point.date >= yearAgo);
    if (lastYear.length === 0) continue;

    let high = -Infinity;
    let low = Infinity;
    let peak = -Infinity;
    let maxDrawdown = 0;
    const dailyReturns: number[] = [];
    let previousClose: number | null = null;
    for (const point of lastYear) {
      high = Math.max(high, point.close);
      low = Math.min(low, point.close);
      peak = Math.max(peak, point.close);
      maxDrawdown = Math.min(maxDrawdown, point.close / peak - 1);
      if (previousClose != null && previousClose > 0) dailyReturns.push(point.close / previousClose - 1);
      previousClose = point.close;
    }

    let annualizedVolatilityPercent: number | null = null;
    if (dailyReturns.length >= MIN_RETURNS_FOR_VOLATILITY) {
      const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1);
      annualizedVolatilityPercent = round(Math.sqrt(variance) * Math.sqrt(252) * 100);
    }

    stats.push({
      ticker,
      latestClose: latest.close,
      latestCloseDate: latest.date,
      oldestCloseDateInWindow: closes[0].date,
      observationCount: closes.length,
      returnsPercent: {
        oneMonth: returnSince(closes, shiftDate(asOfDate, -30), latest.close),
        threeMonths: returnSince(closes, shiftDate(asOfDate, -91), latest.close),
        sixMonths: returnSince(closes, shiftDate(asOfDate, -182), latest.close),
        yearToDate: returnSince(closes, priorYearEnd, latest.close),
        oneYear: returnSince(closes, yearAgo, latest.close),
      },
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekLow: low,
      percentBelowFiftyTwoWeekHigh: round((1 - latest.close / high) * 100),
      annualizedVolatilityPercent,
      maxDrawdownPercent: round(maxDrawdown * 100),
    });
  }
  return stats.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// Loads stored closes for the user's open-lot tickers and computes per-ticker statistics.
export async function loadPriceHistoryStats(userId: string, asOfDate: string): Promise<TickerPriceHistoryStats[]> {
  const result = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query<PriceHistoryRow>(`
      SELECT hp.ticker, CONVERT(varchar(10), hp.marketDate, 23) AS marketDate, hp.closePrice
      FROM HistoricalPrices hp
      WHERE hp.ticker IN (
        SELECT DISTINCT pl.ticker FROM PurchaseLots pl
        WHERE pl.userId = @userId AND pl.remainingQuantity > 0
      )
        AND hp.marketDate >= DATEADD(day, -${WINDOW_DAYS}, CAST(GETUTCDATE() AS date))
      ORDER BY hp.ticker, hp.marketDate
    `);
  return buildPriceHistoryStats(result.recordset ?? [], asOfDate);
}
