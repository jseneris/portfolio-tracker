import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';
import YahooFinance from 'yahoo-finance2';

const router = Router();
const yahooFinance = new YahooFinance();

const ALLOCATION_TOLERANCE = 1e-6;
const HISTORICAL_PRICE_SOURCE = 'yahoo-finance';
const GLOBAL_HISTORICAL_PRICE_USER_ID = 'GLOBAL';
const HISTORICAL_2021_START_DATE = '2021-01-01';
const HISTORICAL_2021_END_DATE = '2021-12-31';
const HISTORICAL_SYNC_2021_MAX_ROWS_PER_RUN = 10000;
const DOW_BENCHMARK_TICKER = '^DJI';
const NASDAQ_BENCHMARK_TICKER = '^IXIC';
const SP500_BENCHMARK_TICKER = '^GSPC';

interface Allocation {
  lotId: string;
  quantity: number;
}

interface OpenLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
}

interface PurchaseLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
  sourceType?: string;
}

interface PricePoint {
  marketDate: string;
  close: number;
}

interface ComparisonPoint {
  date: string;
  hasCashFlowEvent: boolean;
  availableCash: number;
  cashCostBasis: number;
  stockValue: number;
  portfolioValue: number;
  dowBenchmarkValue: number;
  dowBenchmarkShares: number;
  nasdaqBenchmarkValue: number;
  nasdaqBenchmarkShares: number;
  sp500BenchmarkValue: number;
  sp500BenchmarkShares: number;
  missingTickers: string[];
}

function parseDateOnly(dateText: string): Date {
  return new Date(`${dateText}T00:00:00.000Z`);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function buildDateRangeInclusive(startDate: string, endDate: string): string[] {
  const range: string[] = [];
  let cursor = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  while (cursor.getTime() <= end.getTime()) {
    range.push(toIsoDate(cursor));
    cursor = addUtcDays(cursor, 1);
  }

  return range;
}

function resolveClosestPriceOnOrBefore(quotes: PricePoint[], requestedDate: string): PricePoint | null {
  const requested = parseDateOnly(requestedDate).getTime();
  let best: PricePoint | null = null;

  for (const quote of quotes) {
    const quoteTs = parseDateOnly(quote.marketDate).getTime();
    if (quoteTs <= requested) {
      if (!best || quoteTs > parseDateOnly(best.marketDate).getTime()) {
        best = quote;
      }
    }
  }

  return best;
}

async function fetchYahooDailyCloses(ticker: string, firstRequestedDate: string, lastRequestedDate: string): Promise<PricePoint[]> {
  const period1 = addUtcDays(parseDateOnly(firstRequestedDate), -14);
  const period2 = addUtcDays(parseDateOnly(lastRequestedDate), 1);

  const historical = await yahooFinance.historical(ticker, {
    period1,
    period2,
    interval: '1d'
  });

  const rows = Array.isArray(historical) ? (historical as any[]) : [];

  const quotes: PricePoint[] = rows
    .map((row: any): PricePoint => ({
      marketDate: toIsoDate(new Date(row.date)),
      close: Number(row.close)
    }))
    .filter((row: PricePoint) => Number.isFinite(row.close) && row.close > 0)
    .sort((a: PricePoint, b: PricePoint) => a.marketDate.localeCompare(b.marketDate));

  return quotes;
}

function buildSmallestFirstConsumption(openLots: OpenLot[], sellQuantity: number): Allocation[] {
  let remainingToSell = Number(sellQuantity);
  const consumptionPlan: Allocation[] = [];

  for (const lot of openLots) {
    if (remainingToSell <= ALLOCATION_TOLERANCE) {
      break;
    }

    const lotRemaining = Number(lot.remainingQuantity);
    if (!Number.isFinite(lotRemaining) || lotRemaining <= ALLOCATION_TOLERANCE) {
      continue;
    }

    const quantityToConsume = Math.min(lotRemaining, remainingToSell);
    if (quantityToConsume > ALLOCATION_TOLERANCE) {
      consumptionPlan.push({ lotId: lot.id, quantity: quantityToConsume });
      remainingToSell -= quantityToConsume;
    }
  }

  return consumptionPlan;
}

// GET portfolio summary in one database call (cash summary + stock rollup)
router.get('/portfolio/summary', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const summaryResult = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        ;WITH CashAgg AS (
          SELECT
            SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) AS deposits,
            SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) AS withdrawals,
            SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END) AS interest,
            SUM(CASE WHEN type = 'fee' THEN amount ELSE 0 END) AS fees
          FROM CashTransactions
          WHERE userId = @userId
        ),
        StockCashAgg AS (
          SELECT
            SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END) AS buys,
            SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END) AS sells
          FROM StockTransactions
          WHERE userId = @userId
        ),
        StockTotals AS (
          SELECT
            SUM(remainingQuantity * unitCost) AS totalStockCostBasis,
            COUNT(DISTINCT ticker) AS stockCount
          FROM PurchaseLots
          WHERE userId = @userId AND remainingQuantity > 0
        )
        SELECT
          COALESCE(c.deposits, 0) AS deposits,
          COALESCE(c.withdrawals, 0) AS withdrawals,
          COALESCE(c.interest, 0) AS interest,
          COALESCE(c.fees, 0) AS fees,
          COALESCE(s.buys, 0) AS buys,
          COALESCE(s.sells, 0) AS sells,
          COALESCE(c.deposits, 0) - COALESCE(c.withdrawals, 0) + COALESCE(c.interest, 0) - COALESCE(c.fees, 0) - COALESCE(s.buys, 0) + COALESCE(s.sells, 0) AS availableCash,
          COALESCE(c.deposits, 0) - COALESCE(c.withdrawals, 0) AS cashBasis,
          COALESCE(c.interest, 0) - COALESCE(c.fees, 0) AS adjustments,
          COALESCE(t.totalStockCostBasis, 0) AS totalStockCostBasis,
          COALESCE(t.stockCount, 0) AS stockCount
        FROM CashAgg c
        CROSS JOIN StockCashAgg s
        CROSS JOIN StockTotals t;
      `);

    const stocksResult = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT
          ticker,
          SUM(remainingQuantity) AS totalShares,
          SUM(remainingQuantity * unitCost) AS costBasis,
          SUM(CASE WHEN sourceType = 'purchase' THEN 1 ELSE 0 END) AS lotCount
        FROM PurchaseLots
        WHERE userId = @userId AND remainingQuantity > 0
        GROUP BY ticker
        ORDER BY ticker ASC;
      `);

    const summaryRow = (summaryResult.recordset[0] ?? {}) as any;
    const stocks = (stocksResult.recordset ?? []) as any[];

    res.json({
      deposits: Number(summaryRow.deposits || 0),
      withdrawals: Number(summaryRow.withdrawals || 0),
      interest: Number(summaryRow.interest || 0),
      fees: Number(summaryRow.fees || 0),
      buys: Number(summaryRow.buys || 0),
      sells: Number(summaryRow.sells || 0),
      availableCash: Number(summaryRow.availableCash || 0),
      cashBasis: Number(summaryRow.cashBasis || 0),
      adjustments: Number(summaryRow.adjustments || 0),
      totalStockCostBasis: Number(summaryRow.totalStockCostBasis || 0),
      stockCount: Number(summaryRow.stockCount || 0),
      stocks: stocks.map((row: any) => ({
        ticker: row.ticker,
        totalShares: Number(row.totalShares || 0),
        costBasis: Number(row.costBasis || 0),
        lotCount: Number(row.lotCount || 0)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET all stock transactions for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM StockTransactions WHERE userId = @userId ORDER BY transactionDate DESC, ticker ASC');
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Sync historical closes for 2021 comparison in priority order:
// 1) cash deposit/withdrawal dates, 2) 2021-12-31, 3) remaining 2021 dates.
// Runs are capped so repeated clicks incrementally backfill without aggressive API usage.
// HistoricalPrices are global (shared across users).
router.post('/historical-prices/sync-2021', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const pool = getPool();
    const targetEndDate = HISTORICAL_2021_END_DATE;

    const dateRows = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('targetStartDate', sql.Date, parseDateOnly(HISTORICAL_2021_START_DATE))
      .input('targetEndDate', sql.Date, parseDateOnly(targetEndDate))
      .query(`
        SELECT DISTINCT CONVERT(VARCHAR(10), transactionDate, 23) AS priceDate
        FROM CashTransactions
        WHERE userId = @userId
          AND type IN ('deposit', 'withdrawal')
          AND transactionDate >= @targetStartDate
          AND transactionDate <= @targetEndDate
      `);

    const cashPriorityDates = (dateRows.recordset ?? [])
      .map((row: any) => String(row.priceDate))
      .filter((d) => !!d)
      .sort();

    const firstAnchorDate = cashPriorityDates[0] ?? targetEndDate;

    const priorityDateSet = new Set<string>(
      (dateRows.recordset ?? [])
        .map((row: any) => String(row.priceDate))
        .filter((d) => !!d)
    );
    priorityDateSet.add(targetEndDate);

    const remainingYearDates = buildDateRangeInclusive(firstAnchorDate, targetEndDate)
      .filter((d) => !priorityDateSet.has(d));

    const prioritizedDates: string[] = [];
    const seenPriorityDates = new Set<string>();
    const pushPriorityDate = (dateText: string) => {
      if (!seenPriorityDates.has(dateText)) {
        prioritizedDates.push(dateText);
        seenPriorityDates.add(dateText);
      }
    };

    for (const dateText of cashPriorityDates) {
      pushPriorityDate(dateText);
    }
    pushPriorityDate(targetEndDate);
    for (const dateText of remainingYearDates) {
      pushPriorityDate(dateText);
    }

    const tickerRows = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('targetEndDate', sql.Date, parseDateOnly(targetEndDate))
      .query(`
        SELECT DISTINCT ticker
        FROM StockTransactions
        WHERE userId = @userId
          AND transactionDate <= @targetEndDate
        ORDER BY ticker ASC
      `);

    const userTickers = (tickerRows.recordset ?? [])
      .map((row: any) => String(row.ticker || '').toUpperCase())
      .filter((t) => !!t);

    const tickers = Array.from(new Set([
      ...userTickers,
      DOW_BENCHMARK_TICKER,
      NASDAQ_BENCHMARK_TICKER,
      SP500_BENCHMARK_TICKER
    ])).sort();

    if (tickers.length === 0 || prioritizedDates.length === 0) {
      return res.json({
        source: HISTORICAL_PRICE_SOURCE,
        targetEndDate,
        requestedDates: [],
        syncedDates: [],
        remainingDates: 0,
        tickers,
        storedRows: 0,
        missingPrices: []
      });
    }

    const existingRows = await pool.request()
      .input('startDate', sql.Date, parseDateOnly(firstAnchorDate))
      .input('endDate', sql.Date, parseDateOnly(targetEndDate))
      .input('source', sql.NVarChar, HISTORICAL_PRICE_SOURCE)
      .query(`
        SELECT
          CONVERT(VARCHAR(10), priceDate, 23) AS priceDate,
          ticker
        FROM HistoricalPrices
        WHERE source = @source
          AND priceDate >= @startDate
          AND priceDate <= @endDate
      `);

    const tickerSet = new Set(tickers);
    const coverageByDate = new Map<string, Set<string>>();
    for (const row of existingRows.recordset ?? []) {
      const priceDate = String((row as any).priceDate || '');
      const ticker = String((row as any).ticker || '').toUpperCase();
      if (!priceDate || !tickerSet.has(ticker)) {
        continue;
      }
      const coveredTickers = coverageByDate.get(priceDate) ?? new Set<string>();
      coveredTickers.add(ticker);
      coverageByDate.set(priceDate, coveredTickers);
    }

    const unsyncedDates = prioritizedDates.filter((priceDate) => {
      const coveredTickers = coverageByDate.get(priceDate);
      return !coveredTickers || coveredTickers.size < tickers.length;
    });

    const maxDatesPerRun = Math.max(1, Math.floor(HISTORICAL_SYNC_2021_MAX_ROWS_PER_RUN / tickers.length));
    const requestedDates = unsyncedDates.slice(0, maxDatesPerRun);

    if (requestedDates.length === 0) {
      return res.json({
        source: HISTORICAL_PRICE_SOURCE,
        targetEndDate,
        requestedDates: [],
        syncedDates: [],
        remainingDates: 0,
        tickers,
        storedRows: 0,
        missingPrices: []
      });
    }

    const earliestRequestedDate = requestedDates[0];
    const latestRequestedDate = requestedDates[requestedDates.length - 1];
    const missingPrices: Array<{ ticker: string; priceDate: string }> = [];
    let storedRows = 0;

    for (const ticker of tickers) {
      const quotes = await fetchYahooDailyCloses(ticker, earliestRequestedDate, latestRequestedDate);

      for (const priceDate of requestedDates) {
        const matched = resolveClosestPriceOnOrBefore(quotes, priceDate);
        if (!matched) {
          missingPrices.push({ ticker, priceDate });
          continue;
        }

        await pool.request()
          .input('globalUserId', sql.NVarChar, GLOBAL_HISTORICAL_PRICE_USER_ID)
          .input('ticker', sql.NVarChar, ticker)
          .input('priceDate', sql.Date, parseDateOnly(priceDate))
          .input('marketDate', sql.Date, parseDateOnly(matched.marketDate))
          .input('closePrice', sql.Decimal(18, 8), matched.close)
          .input('source', sql.NVarChar, HISTORICAL_PRICE_SOURCE)
          .query(`
            MERGE HistoricalPrices AS target
            USING (
              SELECT
                @globalUserId AS userId,
                @ticker AS ticker,
                @priceDate AS priceDate,
                @source AS source
            ) AS sourceRow
            ON target.userId = sourceRow.userId
               AND target.ticker = sourceRow.ticker
               AND target.priceDate = sourceRow.priceDate
               AND target.source = sourceRow.source
            WHEN MATCHED THEN
              UPDATE SET
                marketDate = @marketDate,
                closePrice = @closePrice,
                updatedAt = GETUTCDATE()
            WHEN NOT MATCHED THEN
              INSERT (id, userId, ticker, priceDate, marketDate, closePrice, source)
              VALUES (NEWID(), @globalUserId, @ticker, @priceDate, @marketDate, @closePrice, @source);
          `);

        storedRows += 1;
      }
    }

    res.json({
      source: HISTORICAL_PRICE_SOURCE,
      targetEndDate,
      requestedDates,
      syncedDates: requestedDates,
      remainingDates: Math.max(0, unsyncedDates.length - requestedDates.length),
      tickers,
      storedRows,
      missingPrices
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Read stored historical closes for the requested date range.
router.get('/historical-prices', async (req: Request, res: Response) => {
  try {
    const startDate = String(req.query.startDate || '2021-01-01');
    const endDate = String(req.query.endDate || HISTORICAL_2021_END_DATE);

    const result = await getPool().request()
      .input('startDate', sql.Date, parseDateOnly(startDate))
      .input('endDate', sql.Date, parseDateOnly(endDate))
      .query(`
        SELECT
          ticker,
          CONVERT(VARCHAR(10), priceDate, 23) AS priceDate,
          CONVERT(VARCHAR(10), marketDate, 23) AS marketDate,
          closePrice,
          source,
          createdAt,
          updatedAt
        FROM HistoricalPrices
        WHERE priceDate >= @startDate
          AND priceDate <= @endDate
        ORDER BY priceDate ASC, ticker ASC
      `);

    res.json(result.recordset.map((row: any) => ({
      ticker: row.ticker,
      priceDate: row.priceDate,
      marketDate: row.marketDate,
      closePrice: Number(row.closePrice),
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Build chart points for 2021 using stored historical prices.
// X-axis dates are whatever was synced into HistoricalPrices
// (deposit/withdrawal dates + 2021-12-31).
router.get('/portfolio/comparison-2021', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const pool = getPool();

    const dateRows = await pool.request()
      .input('endDate', sql.Date, parseDateOnly(HISTORICAL_2021_END_DATE))
      .input('source', sql.NVarChar, HISTORICAL_PRICE_SOURCE)
      .query(`
        SELECT DISTINCT CONVERT(VARCHAR(10), priceDate, 23) AS priceDate
        FROM HistoricalPrices
        WHERE source = @source
          AND priceDate <= @endDate
        ORDER BY priceDate ASC
      `);

    const dates = (dateRows.recordset ?? [])
      .map((row: any) => String(row.priceDate || ''))
      .filter((d) => !!d);

    if (dates.length === 0) {
      return res.json({
        source: HISTORICAL_PRICE_SOURCE,
        points: [] as ComparisonPoint[]
      });
    }

    const earliestDate = dates[0];
    const latestDate = dates[dates.length - 1];

    const cashRows = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('startDate', sql.Date, parseDateOnly(earliestDate))
      .input('endDate', sql.Date, parseDateOnly(latestDate))
      .query(`
        SELECT type, amount, transactionDate
        FROM CashTransactions
        WHERE userId = @userId
          AND transactionDate >= @startDate
          AND transactionDate <= DATEADD(day, 1, @endDate)
        ORDER BY transactionDate ASC
      `);

    const stockRows = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('startDate', sql.Date, parseDateOnly(earliestDate))
      .input('endDate', sql.Date, parseDateOnly(latestDate))
      .query(`
        SELECT ticker, type, quantity, amount, transactionDate
        FROM StockTransactions
        WHERE userId = @userId
          AND transactionDate >= @startDate
          AND transactionDate <= DATEADD(day, 1, @endDate)
        ORDER BY transactionDate ASC
      `);

    const priceRows = await pool.request()
      .input('startDate', sql.Date, parseDateOnly(earliestDate))
      .input('endDate', sql.Date, parseDateOnly(latestDate))
      .input('source', sql.NVarChar, HISTORICAL_PRICE_SOURCE)
      .query(`
        SELECT
          ticker,
          CONVERT(VARCHAR(10), priceDate, 23) AS priceDate,
          closePrice
        FROM HistoricalPrices
        WHERE source = @source
          AND priceDate >= @startDate
          AND priceDate <= @endDate
      `);

    const cashEvents = (cashRows.recordset ?? []).map((row: any) => ({
      date: toIsoDate(new Date(row.transactionDate)),
      type: String(row.type || '').toLowerCase(),
      amount: Number(row.amount || 0)
    }));

    const stockEvents = (stockRows.recordset ?? []).map((row: any) => ({
      date: toIsoDate(new Date(row.transactionDate)),
      ticker: String(row.ticker || '').toUpperCase(),
      type: String(row.type || '').toLowerCase(),
      quantity: Number(row.quantity || 0),
      amount: Number(row.amount || 0)
    }));

    const pricesByDate = new Map<string, Map<string, number>>();
    for (const row of priceRows.recordset ?? []) {
      const date = String((row as any).priceDate || '');
      const ticker = String((row as any).ticker || '').toUpperCase();
      const closePrice = Number((row as any).closePrice || 0);
      if (!date || !ticker || !Number.isFinite(closePrice) || closePrice <= 0) {
        continue;
      }
      const byTicker = pricesByDate.get(date) ?? new Map<string, number>();
      byTicker.set(ticker, closePrice);
      pricesByDate.set(date, byTicker);
    }

    let cashIndex = 0;
    let stockIndex = 0;

    let deposits = 0;
    let withdrawals = 0;
    let interest = 0;
    let fees = 0;
    let buys = 0;
    let sells = 0;

    type BenchmarkLot = { shares: number };
    const dowBenchmarkLots: BenchmarkLot[] = [];
    const nasdaqBenchmarkLots: BenchmarkLot[] = [];
    const sp500BenchmarkLots: BenchmarkLot[] = [];

    const holdings = new Map<string, number>();
    const points: ComparisonPoint[] = [];

    for (const pointDate of dates) {
      let hasCashFlowEvent = false;

      while (cashIndex < cashEvents.length && cashEvents[cashIndex].date <= pointDate) {
        const event = cashEvents[cashIndex];

        if (event.type === 'deposit' || event.type === 'withdrawal') {
          hasCashFlowEvent = true;
        }

        const pricesForEventDate = pricesByDate.get(event.date) ?? new Map<string, number>();
        const dowBenchmarkPrice = Number(pricesForEventDate.get(DOW_BENCHMARK_TICKER));
        const nasdaqBenchmarkPrice = Number(pricesForEventDate.get(NASDAQ_BENCHMARK_TICKER));
        const sp500BenchmarkPrice = Number(pricesForEventDate.get(SP500_BENCHMARK_TICKER));

        if (event.type === 'deposit') deposits += event.amount;
        else if (event.type === 'withdrawal') withdrawals += event.amount;
        else if (event.type === 'interest') interest += event.amount;
        else if (event.type === 'fee') fees += event.amount;

        if (Number.isFinite(dowBenchmarkPrice) && dowBenchmarkPrice > 0) {
          if (event.type === 'deposit') {
            const purchasedShares = Number(event.amount || 0) / dowBenchmarkPrice;
            if (purchasedShares > ALLOCATION_TOLERANCE) {
              dowBenchmarkLots.push({ shares: purchasedShares });
            }
          } else if (event.type === 'withdrawal') {
            let sharesToSell = Number(event.amount || 0) / dowBenchmarkPrice;
            while (sharesToSell > ALLOCATION_TOLERANCE && dowBenchmarkLots.length > 0) {
              const lot = dowBenchmarkLots[0];
              const consumedShares = Math.min(lot.shares, sharesToSell);
              lot.shares -= consumedShares;
              sharesToSell -= consumedShares;
              if (lot.shares <= ALLOCATION_TOLERANCE) {
                dowBenchmarkLots.shift();
              }
            }
          }
        }

        if (Number.isFinite(nasdaqBenchmarkPrice) && nasdaqBenchmarkPrice > 0) {
          if (event.type === 'deposit') {
            const purchasedShares = Number(event.amount || 0) / nasdaqBenchmarkPrice;
            if (purchasedShares > ALLOCATION_TOLERANCE) {
              nasdaqBenchmarkLots.push({ shares: purchasedShares });
            }
          } else if (event.type === 'withdrawal') {
            let sharesToSell = Number(event.amount || 0) / nasdaqBenchmarkPrice;
            while (sharesToSell > ALLOCATION_TOLERANCE && nasdaqBenchmarkLots.length > 0) {
              const lot = nasdaqBenchmarkLots[0];
              const consumedShares = Math.min(lot.shares, sharesToSell);
              lot.shares -= consumedShares;
              sharesToSell -= consumedShares;
              if (lot.shares <= ALLOCATION_TOLERANCE) {
                nasdaqBenchmarkLots.shift();
              }
            }
          }
        }

        if (Number.isFinite(sp500BenchmarkPrice) && sp500BenchmarkPrice > 0) {
          if (event.type === 'deposit') {
            const purchasedShares = Number(event.amount || 0) / sp500BenchmarkPrice;
            if (purchasedShares > ALLOCATION_TOLERANCE) {
              sp500BenchmarkLots.push({ shares: purchasedShares });
            }
          } else if (event.type === 'withdrawal') {
            let sharesToSell = Number(event.amount || 0) / sp500BenchmarkPrice;
            while (sharesToSell > ALLOCATION_TOLERANCE && sp500BenchmarkLots.length > 0) {
              const lot = sp500BenchmarkLots[0];
              const consumedShares = Math.min(lot.shares, sharesToSell);
              lot.shares -= consumedShares;
              sharesToSell -= consumedShares;
              if (lot.shares <= ALLOCATION_TOLERANCE) {
                sp500BenchmarkLots.shift();
              }
            }
          }
        }

        cashIndex += 1;
      }

      while (stockIndex < stockEvents.length && stockEvents[stockIndex].date <= pointDate) {
        const event = stockEvents[stockIndex];
        const currentShares = Number(holdings.get(event.ticker) ?? 0);
        if (event.type === 'buy' || event.type === 'div') {
          holdings.set(event.ticker, currentShares + Number(event.quantity || 0));
          if (event.type === 'buy') buys += Number(event.amount || 0);
        } else if (event.type === 'sell') {
          holdings.set(event.ticker, currentShares - Number(event.quantity || 0));
          sells += Number(event.amount || 0);
        }
        stockIndex += 1;
      }

      const pricesForDate = pricesByDate.get(pointDate) ?? new Map<string, number>();
      let stockValue = 0;
      const missingTickers: string[] = [];

      for (const [ticker, shares] of holdings.entries()) {
        const normalizedShares = Number(shares || 0);
        if (!Number.isFinite(normalizedShares) || normalizedShares <= ALLOCATION_TOLERANCE) {
          continue;
        }
        const closePrice = pricesForDate.get(ticker);
        if (!Number.isFinite(closePrice)) {
          missingTickers.push(ticker);
          continue;
        }
        stockValue += normalizedShares * Number(closePrice);
      }

      const availableCash = deposits - withdrawals + interest - fees - buys + sells;
      const cashCostBasis = deposits - withdrawals;
      const dowBenchmarkShares = dowBenchmarkLots.reduce((sum, lot) => sum + lot.shares, 0);
      const dowPriceOnPointDate = Number(pricesForDate.get(DOW_BENCHMARK_TICKER));
      const dowBenchmarkValue = Number.isFinite(dowPriceOnPointDate)
        ? dowBenchmarkShares * dowPriceOnPointDate
        : 0;

      const nasdaqBenchmarkShares = nasdaqBenchmarkLots.reduce((sum, lot) => sum + lot.shares, 0);
      const nasdaqPriceOnPointDate = Number(pricesForDate.get(NASDAQ_BENCHMARK_TICKER));
      const nasdaqBenchmarkValue = Number.isFinite(nasdaqPriceOnPointDate)
        ? nasdaqBenchmarkShares * nasdaqPriceOnPointDate
        : 0;

      const sp500BenchmarkShares = sp500BenchmarkLots.reduce((sum, lot) => sum + lot.shares, 0);
      const sp500PriceOnPointDate = Number(pricesForDate.get(SP500_BENCHMARK_TICKER));
      const sp500BenchmarkValue = Number.isFinite(sp500PriceOnPointDate)
        ? sp500BenchmarkShares * sp500PriceOnPointDate
        : 0;

      points.push({
        date: pointDate,
        hasCashFlowEvent,
        availableCash,
        cashCostBasis,
        stockValue,
        portfolioValue: availableCash + stockValue,
        dowBenchmarkValue,
        dowBenchmarkShares,
        nasdaqBenchmarkValue,
        nasdaqBenchmarkShares,
        sp500BenchmarkValue,
        sp500BenchmarkShares,
        missingTickers: Array.from(new Set(missingTickers)).sort()
      });
    }

    res.json({
      source: HISTORICAL_PRICE_SOURCE,
      points
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET transactions for specific ticker
router.get('/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT * FROM StockTransactions 
        WHERE userId = @userId AND ticker = @ticker 
        ORDER BY transactionDate DESC
      `);
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET summary for ticker (total shares, lots, etc.)
router.get('/:ticker/summary', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const lotsResult = await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT 
          SUM(remainingQuantity) as totalShares,
          COUNT(*) as numberOfLots,
          SUM(remainingQuantity * unitCost) as costBasis
        FROM PurchaseLots
        WHERE userId = @userId AND ticker = @ticker AND remainingQuantity > 0
      `);
    
    const lot = lotsResult.recordset[0] || {};
    
    res.json({
      ticker: ticker.toUpperCase(),
      totalShares: lot.totalShares || 0,
      numberOfLots: lot.numberOfLots || 0,
      costBasis: lot.costBasis || 0
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET allocations for a specific sale transaction (which purchase lots it affected)
router.get('/:transactionId/allocations', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user?.id!;

    const result = await getPool().request()
      .input('transactionId', sql.UniqueIdentifier, transactionId)
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT 
          pla.purchaseLotId as lotId,
          pla.quantityConsumed as quantity,
          pl.ticker,
          pl.sourceType,
          pl.purchaseDate,
          pl.unitCost
        FROM PurchaseLotAllocations pla
        JOIN PurchaseLots pl ON pla.purchaseLotId = pl.id
        WHERE pla.saleTransactionId = @transactionId AND pla.userId = @userId
        ORDER BY pl.purchaseDate ASC
      `);

    res.json(result.recordset.map((row: any) => ({
      lotId: row.lotId,
      quantity: Number(row.quantity || 0),
      ticker: row.ticker,
      sourceType: row.sourceType,
      purchaseDate: row.purchaseDate,
      unitCost: Number(row.unitCost || 0)
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// CREATE stock transaction
router.post('/', async (req: Request, res: Response) => {
  try {
    const { ticker, type, quantity, price, transactionDate, allocations } = req.body as {
      ticker: string;
      type: string;
      quantity?: number;
      price?: number;
      transactionDate: string;
      allocations?: Allocation[];
    };
    const userId = req.user?.id!;    

    if (!ticker || !type || !transactionDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const pool = getPool();

    // Calculate amount based on transaction type
    let amount: number | null = null;
    let finalQuantity = quantity;
    let finalPrice = price;
    
    if (type === 'buy' || type === 'sell' || type === 'div') {
      if (quantity == null || price == null) {
        return res.status(400).json({ error: `${type} transactions require quantity and price` });
      }
      amount = quantity * price;
    }

    let sellConsumptionPlan: Allocation[] = [];
    let purchaseAttributionPlan: Allocation[] = [];
    let sellPurchaseLots: Array<PurchaseLot & { purchaseDate: Date }> = [];

    // Sell transactions require explicit allocations in the request, but matching is applied
    // smallest-lot-first to close out full lots whenever possible.
    if (type === 'sell') {
      if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ error: 'Sell transactions require explicit lot allocations' });
      }

      for (const allocation of allocations) {
        const requested = Number(allocation.quantity);
        if (!allocation?.lotId || !Number.isFinite(requested) || requested <= 0) {
          return res.status(400).json({ error: 'Each sell allocation must include lotId and quantity > 0' });
        }
      }

      const allocatedTotal = allocations.reduce((sum, a) => sum + Number(a.quantity), 0);
      if (Math.abs(allocatedTotal - Number(quantity)) > ALLOCATION_TOLERANCE) {
        return res.status(400).json({
          error: `Allocated quantity (${allocatedTotal}) does not match sell quantity (${quantity})`
        });
      }

      purchaseAttributionPlan = allocations.map((allocation) => ({
        lotId: String(allocation.lotId),
        quantity: Number(allocation.quantity),
      }));

      const openLotsResult = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .query(`
          SELECT id, transactionId, remainingQuantity
          FROM PurchaseLots
          WHERE userId = @userId AND ticker = @ticker AND remainingQuantity > 0
          ORDER BY remainingQuantity ASC, purchaseDate ASC, id ASC
        `);

      const openLots = (openLotsResult.recordset ?? []).map((lot) => ({
        id: String(lot.id),
        transactionId: String(lot.transactionId),
        remainingQuantity: Number(lot.remainingQuantity),
      }));

      const totalOpenShares = openLots.reduce((sum, lot) => sum + Number(lot.remainingQuantity), 0);
      if (totalOpenShares + ALLOCATION_TOLERANCE < Number(quantity)) {
        return res.status(400).json({
          error: `Not enough shares to sell ${quantity} from ${normalizedTicker}`
        });
      }

      const purchaseLotsResult = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .query(`
        SELECT id, transactionId, remainingQuantity, purchaseDate, sourceType
        FROM PurchaseLots
        WHERE userId = @userId
          AND ticker = @ticker
      `);

      const purchaseLots = (purchaseLotsResult.recordset ?? []).map((lot) => ({
        id: String(lot.id),
        transactionId: String(lot.transactionId),
        remainingQuantity: Number(lot.remainingQuantity),
        purchaseDate: new Date(lot.purchaseDate),
        sourceType: String(lot.sourceType || ''),
      } as PurchaseLot & { purchaseDate: Date }));
      sellPurchaseLots = purchaseLots;

      // Validate that all allocated purchase lots have a purchase date on or before the sale date
      const saleDate = new Date(transactionDate);
      for (const allocation of allocations) {
        const purchaseLot = purchaseLots.find((lot) => lot.id === allocation.lotId);
        if (!purchaseLot) {
          return res.status(400).json({ error: `Purchase lot ${allocation.lotId} not found for ${normalizedTicker}` });
        }
        if (purchaseLot.purchaseDate > saleDate) {
          return res.status(400).json({
            error: `Cannot allocate purchase lot dated ${purchaseLot.purchaseDate.toISOString().slice(0, 10)} to sale dated ${transactionDate}. Purchases must occur before or on the sale date.`
          });
        }
      }

      const openLotsById = new Map(openLots.map((lot) => [lot.id, lot]));
      const purchaseLotsById = new Map(purchaseLots.map((lot) => [lot.id, lot]));
      const purchaseLotIdByTransactionId = new Map<string, string>();
      for (const purchaseLot of purchaseLots) {
        if (!purchaseLotIdByTransactionId.has(purchaseLot.transactionId)) {
          purchaseLotIdByTransactionId.set(purchaseLot.transactionId, purchaseLot.id);
        }
      }

      // Allow allocation lotIds to reference either purchase lots (attribution layer)
      // or open lots (operational layer). Open-lot IDs are mapped back to the
      // corresponding purchase lot by transactionId.
      purchaseAttributionPlan = purchaseAttributionPlan.map((allocation) => {
        const directPurchaseLot = purchaseLotsById.get(allocation.lotId);
        if (directPurchaseLot) {
          return allocation;
        }

        const openLot = openLotsById.get(allocation.lotId);
        if (!openLot) {
          return allocation;
        }

        const mappedPurchaseLotId = purchaseLotIdByTransactionId.get(openLot.transactionId);
        if (!mappedPurchaseLotId) {
          return allocation;
        }

        return {
          lotId: mappedPurchaseLotId,
          quantity: allocation.quantity,
        };
      });

      const remainingByPurchaseLotId = new Map<string, number>();
      for (const purchaseLot of purchaseLots) {
        remainingByPurchaseLotId.set(purchaseLot.id, Number(purchaseLot.remainingQuantity));
      }

      const requestedByPurchaseLotId = new Map<string, number>();
      for (const allocation of purchaseAttributionPlan) {
        if (!remainingByPurchaseLotId.has(allocation.lotId)) {
          return res.status(400).json({ error: `Purchase lot ${allocation.lotId} not found for ${normalizedTicker}` });
        }
        requestedByPurchaseLotId.set(
          allocation.lotId,
          Number(requestedByPurchaseLotId.get(allocation.lotId) ?? 0) + Number(allocation.quantity)
        );
      }

      for (const [purchaseLotId, requestedQuantity] of requestedByPurchaseLotId.entries()) {
        const lotRemaining = remainingByPurchaseLotId.get(purchaseLotId);
        if (lotRemaining == null) {
          return res.status(400).json({ error: `Purchase lot ${purchaseLotId} not found for ${normalizedTicker}` });
        }
        if (lotRemaining + ALLOCATION_TOLERANCE < Number(requestedQuantity)) {
          return res.status(400).json({
            error: `Purchase lot ${purchaseLotId} has only ${lotRemaining} remaining shares`
          });
        }
      }

      sellConsumptionPlan = buildSmallestFirstConsumption(openLots, Number(quantity));
      const consumedTotal = sellConsumptionPlan.reduce((sum, row) => sum + Number(row.quantity), 0);
      if (Math.abs(consumedTotal - Number(quantity)) > ALLOCATION_TOLERANCE) {
        return res.status(400).json({
          error: `Unable to match sell quantity (${quantity}) against open lots`
        });
      }
    }
    
    const id = uuidv4();

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('type', sql.NVarChar, type)
        .input('quantity', sql.Decimal(18, 8), finalQuantity ?? null)
        .input('price', sql.Decimal(18, 8), finalPrice ?? null)
        .input('amount', sql.Decimal(18, 4), amount)
        .input('transactionDate', sql.DateTime2, new Date(transactionDate))
        .query(`
          INSERT INTO StockTransactions 
          (id, userId, ticker, type, quantity, price, amount, transactionDate)
          VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
        `);
      

      // If it's a buy transaction, create a purchase lot and a matching display lot
      if (type === 'buy') {
        const lotId = uuidv4();
        await new sql.Request(tx)
          .input('lotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('quantity', sql.Decimal(18, 8), quantity)
          .input('price', sql.Decimal(18, 8), price)
          .input('transactionDate', sql.DateTime2, new Date(transactionDate))
          .query(`
            INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
            VALUES (@lotId, @userId, @ticker, @transactionId, 'purchase', @quantity, @quantity, @price, @transactionDate)
          `);

        const displayLotId = uuidv4();
        await new sql.Request(tx)
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('totalQuantity', sql.Decimal(18, 8), quantity)
          .query(`
            INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
            VALUES (@displayLotId, @userId, @ticker, @totalQuantity)
          `);

        await new sql.Request(tx)
          .input('compositionId', sql.UniqueIdentifier, uuidv4())
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('purchaseLotId', sql.UniqueIdentifier, lotId)
          .input('quantityAllocated', sql.Decimal(18, 8), quantity)
          .query(`
            INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
            VALUES (@compositionId, @displayLotId, @purchaseLotId, @quantityAllocated)
          `);
      }

      // Dividends create only a purchase lot (sourceType=dividend).
      if (type === 'div') {
        const lotId = uuidv4();
        await new sql.Request(tx)
          .input('lotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('quantity', sql.Decimal(18, 8), quantity)
          .input('price', sql.Decimal(18, 8), price)
          .input('transactionDate', sql.DateTime2, new Date(transactionDate))
          .query(`
            INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
            VALUES (@lotId, @userId, @ticker, @transactionId, 'dividend', @quantity, @quantity, @price, @transactionDate)
          `);
      }

      // Sells consume lots smallest-first, recording the actual allocation for auditability.
      if (type === 'sell') {
        for (const allocation of purchaseAttributionPlan) {
          await new sql.Request(tx)
            .input('lotId', sql.UniqueIdentifier, allocation.lotId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantity)
            .query(`
              UPDATE PurchaseLots
              SET remainingQuantity = remainingQuantity - @quantity, updatedAt = GETUTCDATE()
              WHERE id = @lotId AND userId = @userId
            `);

          const purchaseAllocationId = uuidv4();
          await new sql.Request(tx)
            .input('allocationId', sql.UniqueIdentifier, purchaseAllocationId)
            .input('userId', sql.NVarChar, userId)
            .input('saleTransactionId', sql.UniqueIdentifier, id)
            .input('purchaseLotId', sql.UniqueIdentifier, allocation.lotId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantity)
            .query(`
              INSERT INTO PurchaseLotAllocations (id, userId, saleTransactionId, purchaseLotId, quantityConsumed)
              VALUES (@allocationId, @userId, @saleTransactionId, @purchaseLotId, @quantity)
            `);
        }

        // Consume display lots only for shares sold from purchase-source lots.
        // Shares sold from dividend lots must not change display-lot totals.
        const purchaseLotTypeById = new Map(sellPurchaseLots.map((lot) => [lot.id, String(lot.sourceType || '').toLowerCase()]));
        const displayQuantityToConsume = purchaseAttributionPlan.reduce((sum, allocation) => {
          const sourceType = purchaseLotTypeById.get(allocation.lotId);
          if (sourceType === 'purchase') {
            return sum + Number(allocation.quantity);
          }
          return sum;
        }, 0);

        // Also consume display lots smallest-first to keep display state in sync
        const displayLotsResult = await new sql.Request(tx)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .query(`
            SELECT id, totalQuantity FROM DisplayLots
            WHERE userId = @userId AND ticker = @ticker AND totalQuantity > 0
            ORDER BY totalQuantity ASC, createdAt ASC
          `);

        let displayRemaining = Number(displayQuantityToConsume);
        for (const row of displayLotsResult.recordset as any[]) {
          if (displayRemaining <= ALLOCATION_TOLERANCE) break;
          const dlId = String(row.id);
          const dlQty = Number(row.totalQuantity);
          const consume = Math.min(dlQty, displayRemaining);
          displayRemaining -= consume;

          await new sql.Request(tx)
            .input('allocationId', sql.UniqueIdentifier, uuidv4())
            .input('userId', sql.NVarChar, userId)
            .input('saleTransactionId', sql.UniqueIdentifier, id)
            .input('displayLotId', sql.UniqueIdentifier, dlId)
            .input('quantity', sql.Decimal(18, 8), consume)
            .query(`
              INSERT INTO DisplayLotAllocations (id, userId, saleTransactionId, displayLotId, quantityConsumed)
              VALUES (@allocationId, @userId, @saleTransactionId, @displayLotId, @quantity)
            `);

          // Update DisplayLot quantity (don't delete to preserve foreign key references to DisplayLotAllocations)
          await new sql.Request(tx)
            .input('displayLotId', sql.UniqueIdentifier, dlId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), consume)
            .query(`
              UPDATE DisplayLots
              SET totalQuantity = totalQuantity - @quantity, updatedAt = GETUTCDATE()
              WHERE id = @displayLotId AND userId = @userId
            `);
        }
      }

      await tx.commit();
      res.status(201).json({ id, ticker: normalizedTicker, type, quantity, price, amount, transactionDate });
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { ticker, type, quantity, price, transactionDate } = req.body;
    const userId = req.user?.id!;
    
    const request = getPool().request();
    
    let amount = null;
    if (type === 'buy' || type === 'sell') {
      amount = quantity * price;
    } else if (type === 'div') {
      amount = quantity;
    }
    
    await request
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('type', sql.NVarChar, type)
      .input('quantity', sql.Decimal(18, 8), quantity || null)
      .input('price', sql.Decimal(18, 8), price || null)
      .input('amount', sql.Decimal(18, 4), amount)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        UPDATE StockTransactions 
        SET type = @type, quantity = @quantity, price = @price, amount = @amount,
            transactionDate = @transactionDate, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    
    res.json({ id, ticker, type, quantity, price, transactionDate });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// DELETE stock transaction
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;

    const pool = getPool();
    const transactionLookup = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT TOP 1 id, type FROM StockTransactions WHERE id = @id AND userId = @userId');

    if (transactionLookup.recordset.length === 0) {
      return res.status(404).json({ error: 'Stock transaction not found' });
    }

    const transactionType = String(transactionLookup.recordset[0].type || '').toLowerCase();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      if (transactionType === 'sell') {
        // All allocations handled via PurchaseLotAllocations below

        const purchaseAllocations = await new sql.Request(tx)
          .input('saleTransactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT purchaseLotId, quantityConsumed
            FROM PurchaseLotAllocations
            WHERE saleTransactionId = @saleTransactionId AND userId = @userId
          `);

        for (const allocation of purchaseAllocations.recordset) {
          await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, allocation.purchaseLotId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantityConsumed)
            .query(`
              UPDATE PurchaseLots
              SET remainingQuantity = remainingQuantity + @quantity, updatedAt = GETUTCDATE()
              WHERE id = @purchaseLotId AND userId = @userId
            `);
        }

        // Restore DisplayLots quantities (reversible display lot allocations)
        const displayAllocations = await new sql.Request(tx)
          .input('saleTransactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT displayLotId, quantityConsumed
            FROM DisplayLotAllocations
            WHERE saleTransactionId = @saleTransactionId AND userId = @userId
          `);

        for (const allocation of displayAllocations.recordset) {
          await new sql.Request(tx)
            .input('displayLotId', sql.UniqueIdentifier, allocation.displayLotId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantityConsumed)
            .query(`
              UPDATE DisplayLots
              SET totalQuantity = totalQuantity + @quantity, updatedAt = GETUTCDATE()
              WHERE id = @displayLotId AND userId = @userId
            `);
        }
      } else if (transactionType === 'buy' || transactionType === 'div') {
        // For buy/div, delete the associated DisplayLotComposition, DisplayLots, and PurchaseLot
        
        const purchaseLotsResult = await new sql.Request(tx)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT id FROM PurchaseLots
            WHERE transactionId = @transactionId AND userId = @userId
          `);

        for (const row of purchaseLotsResult.recordset) {
          const purchaseLotId = row.id;
          
          // Find and delete all DisplayLotComposition records that reference this PurchaseLot
          const compositionsResult = await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
            .query(`
              SELECT displayLotId FROM DisplayLotComposition
              WHERE purchaseLotId = @purchaseLotId
            `);

          for (const comp of compositionsResult.recordset) {
            const displayLotId = comp.displayLotId;
            
            // Delete the composition record
            await new sql.Request(tx)
              .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
              .query(`
                DELETE FROM DisplayLotComposition
                WHERE purchaseLotId = @purchaseLotId
              `);

            // Delete the DisplayLot
            await new sql.Request(tx)
              .input('displayLotId', sql.UniqueIdentifier, displayLotId)
              .input('userId', sql.NVarChar, userId)
              .query(`
                DELETE FROM DisplayLots
                WHERE id = @displayLotId AND userId = @userId
              `);
          }

          // Delete the PurchaseLot
          await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
            .input('userId', sql.NVarChar, userId)
            .query(`
              DELETE FROM PurchaseLots
              WHERE id = @purchaseLotId AND userId = @userId
            `);
        }
      }

      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query('DELETE FROM StockTransactions WHERE id = @id AND userId = @userId');

      await tx.commit();
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
