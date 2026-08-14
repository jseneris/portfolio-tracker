import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';
import YahooFinance from 'yahoo-finance2';

const router = Router();
const yahooFinance = new YahooFinance();

const ALLOCATION_TOLERANCE = 1e-6;
const SPLIT_TOLERANCE = 1e-6;
const HISTORICAL_PRICE_SOURCE = 'yahoo-finance';
const HISTORICAL_2021_START_DATE = '2021-01-01';
const HISTORICAL_2021_END_DATE = '2021-12-31';
const HISTORICAL_SYNC_2021_MAX_ROWS_PER_RUN = 10000;
const DOW_BENCHMARK_TICKER = '^DJI';
const NASDAQ_BENCHMARK_TICKER = '^IXIC';
const SP500_BENCHMARK_TICKER = '^GSPC';

interface IAllocation {
  lotId: string;
  quantity: number;
}

interface IOpenLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
}

interface IPurchaseLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
  sourceType?: string;
}

interface IExchangeSourceLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
  unitCost: number;
  purchaseDate: Date;
}

interface IExistingSplit {
  id: string;
  multiplier: number;
}

interface IPricePoint {
  marketDate: string;
  close: number;
}

interface IHistoricalClosePoint {
  priceDate: string;
  close: number;
}

interface ISplitPoint {
  splitDate: string;
  ratioNumerator: number;
  ratioDenominator: number;
  multiplier: number;
}

interface IBackdatedMarketDataSyncSummary {
  backdatedCheckPerformed: boolean;
  splitCheckPerformed: boolean;
  historicalPricesInserted: number;
  splitsDiscovered: number;
  splitsInserted: number;
}

interface ISplitSyncSummary {
  splitCheckPerformed: boolean;
  splitsDiscovered: number;
  splitsInserted: number;
}

interface IComparisonPoint {
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

function parseDisplayLotsCsv(lotsCsv: string): number[] {
  if (!lotsCsv || !lotsCsv.trim()) {
    return [];
  }

  return lotsCsv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > ALLOCATION_TOLERANCE);
}

function serializeDisplayLotsCsv(lots: number[]): string {
  return lots.map((value) => Number(value.toFixed(8))).join(',');
}

async function getDisplayLotsCsvForTicker(
  tx: sql.Transaction,
  userId: string,
  ticker: string
): Promise<{ id: string; lots: number[] } | null> {
  const result = await new sql.Request(tx)
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .query(`
      SELECT TOP 1 id, lotsCsv
      FROM DisplayLots
      WHERE userId = @userId AND ticker = @ticker
    `);

  if (result.recordset.length === 0) {
    return null;
  }

  const row = result.recordset[0] as any;
  return {
    id: String(row.id),
    lots: parseDisplayLotsCsv(String(row.lotsCsv || '')),
  };
}

async function persistDisplayLotsCsvForTicker(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  lots: number[]
): Promise<void> {
  const existing = await getDisplayLotsCsvForTicker(tx, userId, ticker);
  const normalizedLots = lots.filter((value) => value > ALLOCATION_TOLERANCE);

  if (normalizedLots.length === 0) {
    if (existing) {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, existing.id)
        .input('userId', sql.NVarChar, userId)
        .query('DELETE FROM DisplayLots WHERE id = @id AND userId = @userId');
    }
    return;
  }

  const lotsCsv = serializeDisplayLotsCsv(normalizedLots);
  if (existing) {
    await new sql.Request(tx)
      .input('id', sql.UniqueIdentifier, existing.id)
      .input('userId', sql.NVarChar, userId)
      .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
      .query(`
        UPDATE DisplayLots
        SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    return;
  }

  await new sql.Request(tx)
    .input('id', sql.UniqueIdentifier, uuidv4())
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
    .query(`
      INSERT INTO DisplayLots (id, userId, ticker, lotsCsv)
      VALUES (@id, @userId, @ticker, @lotsCsv)
    `);
}

async function appendDisplayLotQuantity(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  quantity: number
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= ALLOCATION_TOLERANCE) {
    return;
  }
  const existing = await getDisplayLotsCsvForTicker(tx, userId, ticker);
  const nextLots = [...(existing?.lots ?? []), Number(quantity.toFixed(8))];
  await persistDisplayLotsCsvForTicker(tx, userId, ticker, nextLots);
}

async function consumeDisplayLotQuantitySmallestFirst(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  quantityToConsume: number
): Promise<void> {
  if (!Number.isFinite(quantityToConsume) || quantityToConsume <= ALLOCATION_TOLERANCE) {
    return;
  }

  const existing = await getDisplayLotsCsvForTicker(tx, userId, ticker);
  if (!existing) {
    return;
  }

  const lots = [...existing.lots].sort((a, b) => a - b);
  let remaining = quantityToConsume;
  const nextLots: number[] = [];

  for (const lot of lots) {
    if (remaining <= ALLOCATION_TOLERANCE) {
      nextLots.push(lot);
      continue;
    }

    const consumed = Math.min(lot, remaining);
    const leftover = lot - consumed;
    remaining -= consumed;
    if (leftover > ALLOCATION_TOLERANCE) {
      nextLots.push(Number(leftover.toFixed(8)));
    }
  }

  await persistDisplayLotsCsvForTicker(tx, userId, ticker, nextLots);
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
            SUM(pl.remainingQuantity * pl.unitCost) AS totalStockCostBasis,
            COUNT(DISTINCT ticker) AS stockCount
          FROM PurchaseLots pl
          WHERE pl.userId = @userId AND pl.remainingQuantity > 0
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
          pl.ticker,
          SUM(pl.remainingQuantity) AS totalShares,
          SUM(pl.remainingQuantity * pl.unitCost) AS costBasis,
          SUM(CASE WHEN pl.sourceType = 'purchase' THEN 1 ELSE 0 END) AS lotCount
        FROM PurchaseLots pl
        WHERE pl.userId = @userId AND pl.remainingQuantity > 0
        GROUP BY pl.ticker
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
      .query(`
        WITH LockedTransactions AS (
          SELECT sourceTransactionId AS transactionId
          FROM StockExchangeLotMappings
          WHERE userId = @userId
          UNION
          SELECT targetTransactionId AS transactionId
          FROM StockExchangeLotMappings
          WHERE userId = @userId
        )
        SELECT
          st.*,
          CASE WHEN lt.transactionId IS NOT NULL
            OR (
              st.type <> 'exchange'
              AND EXISTS (
                SELECT 1
                FROM StockExchanges sourceExchange
                WHERE sourceExchange.userId = @userId
                  AND sourceExchange.sourceTicker = st.ticker
                  AND sourceExchange.transactionDate >= st.transactionDate
              )
            )
            THEN 1 ELSE 0 END AS isDeletionLocked,
          COALESCE(exchangeSource.exchangeSourceQuantity, 0) AS exchangeSourceQuantity
        FROM StockTransactions st
        LEFT JOIN LockedTransactions lt ON lt.transactionId = st.id
        LEFT JOIN StockExchanges exchangeEvent
          ON exchangeEvent.exchangeTransactionId = st.id
          AND exchangeEvent.userId = @userId
        OUTER APPLY (
          SELECT SUM(mapping.sourceRemainingBefore) AS exchangeSourceQuantity
          FROM StockExchangeLotMappings mapping
          WHERE mapping.exchangeId = exchangeEvent.id
            AND mapping.userId = @userId
        ) exchangeSource
        WHERE st.userId = @userId
        ORDER BY st.transactionDate DESC, st.ticker ASC
      `);

    res.json((result.recordset ?? []).map((row: any) => ({
      ...row,
      isDeletionLocked: Number(row.isDeletionLocked || 0) === 1,
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Sync historical closes for a requested year in priority order:
// 1) any cash or stock transaction dates in the year, 2) year-end date, 3) remaining dates in the year.
// Runs are capped so repeated clicks incrementally backfill without aggressive API usage.
// HistoricalPrices are global (shared across users).
router.post('/historical-prices/sync-year', async (req: Request, res: Response) => {
  try {
    const requestedYear = parseSupportedComparisonYear(req.query.year);
    if (requestedYear == null) {
      return res.status(400).json({ error: 'Query parameter year must be a valid 4-digit year.' });
    }

    const userId = req.user?.id!;
    const pool = getPool();
    const { startDate: targetStartDate, endDate: targetEndDate } = getYearRange(requestedYear);

    const priorityDates = await getYearPriorityDates(pool, userId, targetStartDate, targetEndDate);

    const firstAnchorDate = targetStartDate;

    const priorityDateSet = new Set<string>(priorityDates);
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

    for (const dateText of priorityDates) {
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
        year: requestedYear,
        targetEndDate,
        requestedDates: [],
        syncedDates: [],
        remainingDates: 0,
        tickers,
        storedRows: 0,
        missingPrices: [],
        splitCheckPerformed: false,
        splitTickersChecked: 0,
        splitsDiscovered: 0,
        splitsInserted: 0,
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
        year: requestedYear,
        targetEndDate,
        requestedDates: [],
        syncedDates: [],
        remainingDates: 0,
        tickers,
        storedRows: 0,
        missingPrices: [],
        splitCheckPerformed: false,
        splitTickersChecked: 0,
        splitsDiscovered: 0,
        splitsInserted: 0,
      });
    }

    const earliestRequestedDate = requestedDates[0];
    const latestRequestedDate = requestedDates[requestedDates.length - 1];
    const missingPrices: Array<{ ticker: string; priceDate: string }> = [];
    const failedTickers: Array<{ ticker: string; error: string }> = [];
    let storedRows = 0;

    for (const ticker of tickers) {
      const missingDatesForTicker = requestedDates.filter((priceDate) => {
        const coveredTickers = coverageByDate.get(priceDate);
        return !coveredTickers || !coveredTickers.has(ticker);
      });

      if (missingDatesForTicker.length === 0) {
        continue;
      }

      const earliestMissingDate = missingDatesForTicker[0];
      const latestMissingDate = missingDatesForTicker[missingDatesForTicker.length - 1];

      try {
        const quotes = await fetchYahooDailyCloses(ticker, earliestMissingDate, latestMissingDate);

        for (const priceDate of missingDatesForTicker) {
          const matched = resolveClosestPriceOnOrBefore(quotes, priceDate);
          if (!matched) {
            missingPrices.push({ ticker, priceDate });
            continue;
          }

          const insertResult = await pool.request()
            .input('ticker', sql.NVarChar, ticker)
            .input('priceDate', sql.Date, parseDateOnly(priceDate))
            .input('marketDate', sql.Date, parseDateOnly(matched.marketDate))
            .input('closePrice', sql.Decimal(18, 8), matched.close)
            .input('source', sql.NVarChar, HISTORICAL_PRICE_SOURCE)
            .query(`
              INSERT INTO HistoricalPrices (id, ticker, priceDate, marketDate, closePrice, source)
              SELECT NEWID(), @ticker, @priceDate, @marketDate, @closePrice, @source
              WHERE NOT EXISTS (
                SELECT 1
                FROM HistoricalPrices
                WHERE ticker = @ticker
                  AND priceDate = @priceDate
                  AND source = @source
              );
            `);

          storedRows += insertResult.rowsAffected?.[0] ?? 0;
        }
      } catch (tickerError) {
        failedTickers.push({
          ticker,
          error: tickerError instanceof Error ? tickerError.message : String(tickerError),
        });
      }
    }

    res.json({
      source: HISTORICAL_PRICE_SOURCE,
      year: requestedYear,
      targetEndDate,
      requestedDates,
      syncedDates: requestedDates,
      remainingDates: Math.max(0, unsyncedDates.length - requestedDates.length),
      tickers,
      storedRows,
      missingPrices,
      failedTickers,
      splitCheckPerformed: false,
      splitTickersChecked: 0,
      splitsDiscovered: 0,
      splitsInserted: 0,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/historical-prices/sync-2021', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const pool = getPool();
    const targetEndDate = HISTORICAL_2021_END_DATE;

    const priorityDates = await getYearPriorityDates(pool, userId, HISTORICAL_2021_START_DATE, targetEndDate);

    const firstAnchorDate = HISTORICAL_2021_START_DATE;

    const priorityDateSet = new Set<string>(priorityDates);
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

    for (const dateText of priorityDates) {
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
    const failedTickers: Array<{ ticker: string; error: string }> = [];
    let storedRows = 0;

    for (const ticker of tickers) {
      const missingDatesForTicker = requestedDates.filter((priceDate) => {
        const coveredTickers = coverageByDate.get(priceDate);
        return !coveredTickers || !coveredTickers.has(ticker);
      });

      if (missingDatesForTicker.length === 0) {
        continue;
      }

      const earliestMissingDate = missingDatesForTicker[0];
      const latestMissingDate = missingDatesForTicker[missingDatesForTicker.length - 1];

      try {
        const quotes = await fetchYahooDailyCloses(ticker, earliestMissingDate, latestMissingDate);

        for (const priceDate of missingDatesForTicker) {
          const matched = resolveClosestPriceOnOrBefore(quotes, priceDate);
          if (!matched) {
            missingPrices.push({ ticker, priceDate });
            continue;
          }

          const insertResult = await pool.request()
            .input('ticker', sql.NVarChar, ticker)
            .input('priceDate', sql.Date, parseDateOnly(priceDate))
            .input('marketDate', sql.Date, parseDateOnly(matched.marketDate))
            .input('closePrice', sql.Decimal(18, 8), matched.close)
            .input('source', sql.NVarChar, HISTORICAL_PRICE_SOURCE)
            .query(`
              INSERT INTO HistoricalPrices (id, ticker, priceDate, marketDate, closePrice, source)
              SELECT NEWID(), @ticker, @priceDate, @marketDate, @closePrice, @source
              WHERE NOT EXISTS (
                SELECT 1
                FROM HistoricalPrices
                WHERE ticker = @ticker
                  AND priceDate = @priceDate
                  AND source = @source
              );
            `);

          storedRows += insertResult.rowsAffected?.[0] ?? 0;
        }
      } catch (tickerError) {
        failedTickers.push({
          ticker,
          error: tickerError instanceof Error ? tickerError.message : String(tickerError),
        });
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
      missingPrices,
      failedTickers
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Read stored historical closes for the requested date range.
router.get('/historical-prices', async (req: Request, res: Response) => {
  try {
    const startDateQuery = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
    const endDateQuery = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';
    const hasRangeQuery = startDateQuery.length > 0 || endDateQuery.length > 0;

    // Backward-compatible mode for dashboard/stock-history consumers.
    // When startDate/endDate are supplied, return raw historical rows.
    if (hasRangeQuery) {
      if (!startDateQuery || !endDateQuery) {
        return res.status(400).json({ error: 'Query parameters startDate and endDate are both required when using date range mode.' });
      }

      if (!isValidDateOnlyString(startDateQuery) || !isValidDateOnlyString(endDateQuery)) {
        return res.status(400).json({ error: 'Query parameters startDate and endDate must be in YYYY-MM-DD format.' });
      }

      if (startDateQuery > endDateQuery) {
        return res.status(400).json({ error: 'Query parameter startDate must be on or before endDate.' });
      }

      const pool = getPool();
      const rows = await pool.request()
        .input('startDate', sql.Date, parseDateOnly(startDateQuery))
        .input('endDate', sql.Date, parseDateOnly(endDateQuery))
        .query(`
          SELECT
            ticker,
            CONVERT(VARCHAR(10), priceDate, 23) AS priceDate,
            CONVERT(VARCHAR(10), marketDate, 23) AS marketDate,
            closePrice,
            source
          FROM HistoricalPrices
          WHERE priceDate >= @startDate
            AND priceDate <= @endDate
          ORDER BY priceDate ASC, ticker ASC
        `);

      return res.json((rows.recordset ?? []).map((row: any) => ({
        ticker: String(row.ticker || '').toUpperCase(),
        priceDate: String(row.priceDate || ''),
        marketDate: String(row.marketDate || ''),
        closePrice: Number(row.closePrice || 0),
        source: String(row.source || HISTORICAL_PRICE_SOURCE),
      })));
    }

    const requestedYear = parseSupportedComparisonYear(req.query.year);
    if (requestedYear == null) {
      return res.status(400).json({ error: 'Query parameter year must be a valid 4-digit year.' });
    }

    const userId = req.user?.id!;
    const pool = getPool();
    const { startDate: targetStartDate, endDate: targetEndDate } = getYearRange(requestedYear);

    const bounds = await getComparisonTimelineBounds(pool, userId);
    if (!bounds.referenceStartDate || !bounds.effectiveEndDate) {
      return res.json({
        source: HISTORICAL_PRICE_SOURCE,
        year: requestedYear,
        points: [] as IComparisonPoint[]
      });
    }
    const effectiveEndDate = bounds.effectiveEndDate < targetEndDate ? bounds.effectiveEndDate : targetEndDate;
    if (effectiveEndDate < targetStartDate) {
      return res.json({
        source: HISTORICAL_PRICE_SOURCE,
        year: requestedYear,
        points: [] as IComparisonPoint[]
      });
    }

    const allPoints = await buildPortfolioComparisonPoints(
      pool,
      userId,
      {
        startDate: bounds.referenceStartDate,
        endDate: effectiveEndDate,
      },
      {
        markCashFlowsFromDate: targetStartDate,
      }
    );

    const points = allPoints.filter((point) => point.date >= targetStartDate && point.date <= effectiveEndDate);

    res.json({
      source: HISTORICAL_PRICE_SOURCE,
      year: requestedYear,
      points
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/portfolio/comparison-2021', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const pool = getPool();

    const bounds = await getComparisonTimelineBounds(pool, userId);
    if (!bounds.referenceStartDate || !bounds.effectiveEndDate) {
      return res.json({
        source: HISTORICAL_PRICE_SOURCE,
        points: [] as IComparisonPoint[]
      });
    }
    const points = await buildPortfolioComparisonPoints(pool, userId, {
      startDate: bounds.referenceStartDate,
      endDate: bounds.effectiveEndDate,
    });

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
        WITH LockedTransactions AS (
          SELECT sourceTransactionId AS transactionId
          FROM StockExchangeLotMappings
          WHERE userId = @userId
          UNION
          SELECT targetTransactionId AS transactionId
          FROM StockExchangeLotMappings
          WHERE userId = @userId
        )
        SELECT
          st.*,
          CASE WHEN lt.transactionId IS NOT NULL
            OR (
              st.type <> 'exchange'
              AND EXISTS (
                SELECT 1
                FROM StockExchanges sourceExchange
                WHERE sourceExchange.userId = @userId
                  AND sourceExchange.sourceTicker = st.ticker
                  AND sourceExchange.transactionDate >= st.transactionDate
              )
            )
            THEN 1 ELSE 0 END AS isDeletionLocked
        FROM StockTransactions st
        LEFT JOIN LockedTransactions lt ON lt.transactionId = st.id
        WHERE st.userId = @userId AND st.ticker = @ticker
        ORDER BY st.transactionDate DESC
      `);

    res.json((result.recordset ?? []).map((row: any) => ({
      ...row,
      isDeletionLocked: Number(row.isDeletionLocked || 0) === 1,
    })));
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
          SUM(pl.remainingQuantity) as totalShares,
          COUNT(*) as numberOfLots,
          SUM(pl.remainingQuantity * pl.unitCost) as costBasis
        FROM PurchaseLots pl
        WHERE pl.userId = @userId AND pl.ticker = @ticker AND pl.remainingQuantity > 0
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
    const { ticker, type, quantity, price, transactionDate, allocations, newTicker, exchangeRate } = req.body as {
      ticker: string;
      type: string;
      quantity?: number;
      price?: number;
      transactionDate: string;
      allocations?: IAllocation[];
      newTicker?: string;
      exchangeRate?: number;
    };
    const userId = req.user?.id!;    

    if (!ticker || !type || !transactionDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const pool = getPool();
    const parsedTransactionDate = new Date(transactionDate);

    if (Number.isNaN(parsedTransactionDate.getTime())) {
      return res.status(400).json({ error: 'Invalid transactionDate' });
    }

    // For a newly-entered ticker with a backdated transaction, fetch and store
    // any missing split events between the transaction date and today.
    const existingTickerTransaction = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .query(`
        SELECT TOP 1 id
        FROM StockTransactions
        WHERE userId = @userId
          AND ticker = @ticker
      `);

    const isFirstTransactionForTicker = existingTickerTransaction.recordset.length === 0;
    if (isFirstTransactionForTicker) {
      try {
        await ensureBackfilledMarketDataForBackdatedTransaction(
          pool,
          userId,
          normalizedTicker,
          parsedTransactionDate
        );
      } catch (splitSyncError) {
        // Split discovery should not block transaction entry if market data fetch fails.
        console.warn('Backdated split discovery failed during stock creation:', splitSyncError);
      }
    }

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

    let normalizedNewTicker = '';
    let parsedExchangeRate = 0;
    if (type === 'exchange') {
      normalizedNewTicker = String(newTicker || '').trim().toUpperCase();
      parsedExchangeRate = Number(exchangeRate);

      if (!normalizedNewTicker) {
        return res.status(400).json({ error: 'Exchange transactions require newTicker' });
      }
      if (normalizedNewTicker === normalizedTicker) {
        return res.status(400).json({ error: 'Exchange target ticker must be different from source ticker' });
      }
      if (!Number.isFinite(parsedExchangeRate) || parsedExchangeRate <= 0) {
        return res.status(400).json({ error: 'Exchange transactions require exchangeRate > 0' });
      }
    }

    let sellConsumptionPlan: IAllocation[] = [];
    let purchaseAttributionPlan: IAllocation[] = [];
    let sellPurchaseLots: Array<IPurchaseLot & { purchaseDate: Date }> = [];
    let createdPurchaseLotId: string | null = null;
    const createdPurchaseAllocationIds: string[] = [];

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
      } as IPurchaseLot & { purchaseDate: Date }));
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
        .input('transactionDate', sql.DateTime2, parsedTransactionDate)
        .query(`
          INSERT INTO StockTransactions 
          (id, userId, ticker, type, quantity, price, amount, transactionDate)
          VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
        `);
      

      // If it's a buy transaction, create a purchase lot and a matching display lot
      if (type === 'buy') {
        const lotId = uuidv4();
        createdPurchaseLotId = lotId;
        await new sql.Request(tx)
          .input('lotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('quantity', sql.Decimal(18, 8), quantity)
          .input('price', sql.Decimal(18, 8), price)
          .input('transactionDate', sql.DateTime2, parsedTransactionDate)
          .query(`
            INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
            VALUES (@lotId, @userId, @ticker, @transactionId, 'purchase', @quantity, @quantity, @price, @transactionDate)
          `);

        await appendDisplayLotQuantity(tx, userId, normalizedTicker, Number(quantity || 0));
      }

      // Dividends create only a purchase lot (sourceType=dividend).
      if (type === 'div') {
        const lotId = uuidv4();
        createdPurchaseLotId = lotId;
        await new sql.Request(tx)
          .input('lotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('quantity', sql.Decimal(18, 8), quantity)
          .input('price', sql.Decimal(18, 8), price)
          .input('transactionDate', sql.DateTime2, parsedTransactionDate)
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
          createdPurchaseAllocationIds.push(purchaseAllocationId);
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

        if (displayQuantityToConsume > ALLOCATION_TOLERANCE) {
          await consumeDisplayLotQuantitySmallestFirst(tx, userId, normalizedTicker, displayQuantityToConsume);
        }
      }

      if (type === 'exchange') {
        const sourceOpenLotsResult = await new sql.Request(tx)
          .input('userId', sql.NVarChar, userId)
          .input('sourceTicker', sql.NVarChar, normalizedTicker)
          .query(`
            SELECT id, transactionId, remainingQuantity, unitCost, purchaseDate
            FROM PurchaseLots
            WHERE userId = @userId
              AND ticker = @sourceTicker
              AND sourceType = 'purchase'
              AND remainingQuantity > 0
            ORDER BY purchaseDate ASC, id ASC
          `);

        const sourceOpenLots = (sourceOpenLotsResult.recordset ?? []).map((row) => ({
          id: String((row as any).id),
          transactionId: String((row as any).transactionId),
          remainingQuantity: Number((row as any).remainingQuantity),
          unitCost: Number((row as any).unitCost),
          purchaseDate: new Date((row as any).purchaseDate),
        } as IExchangeSourceLot));

        if (sourceOpenLots.length === 0) {
          throw new Error(`VALIDATION:No open purchase lots available to exchange for ${normalizedTicker}`);
        }

        const sourceDisplayBefore = await getDisplayLotsCsvForTicker(tx, userId, normalizedTicker);
        const targetDisplayBefore = await getDisplayLotsCsvForTicker(tx, userId, normalizedNewTicker);
        const sourceDisplayLotsCsvBefore = sourceDisplayBefore ? serializeDisplayLotsCsv(sourceDisplayBefore.lots) : null;
        const targetDisplayLotsCsvBefore = targetDisplayBefore ? serializeDisplayLotsCsv(targetDisplayBefore.lots) : null;

        const exchangeId = uuidv4();
        await new sql.Request(tx)
          .input('exchangeId', sql.UniqueIdentifier, exchangeId)
          .input('userId', sql.NVarChar, userId)
          .input('exchangeTransactionId', sql.UniqueIdentifier, id)
          .input('sourceTicker', sql.NVarChar, normalizedTicker)
          .input('targetTicker', sql.NVarChar, normalizedNewTicker)
          .input('exchangeRate', sql.Decimal(18, 8), parsedExchangeRate)
          .input('transactionDate', sql.DateTime2, parsedTransactionDate)
          .input('sourceDisplayLotsCsvBefore', sql.NVarChar(sql.MAX), sourceDisplayLotsCsvBefore)
          .input('targetDisplayLotsCsvBefore', sql.NVarChar(sql.MAX), targetDisplayLotsCsvBefore)
          .query(`
            INSERT INTO StockExchanges (
              id,
              userId,
              exchangeTransactionId,
              sourceTicker,
              targetTicker,
              exchangeRate,
              transactionDate,
              sourceDisplayLotsCsvBefore,
              targetDisplayLotsCsvBefore
            )
            VALUES (
              @exchangeId,
              @userId,
              @exchangeTransactionId,
              @sourceTicker,
              @targetTicker,
              @exchangeRate,
              @transactionDate,
              @sourceDisplayLotsCsvBefore,
              @targetDisplayLotsCsvBefore
            )
          `);

        let totalSourceConsumed = 0;

        for (const sourceLot of sourceOpenLots) {
          const sourceRemaining = Number(sourceLot.remainingQuantity);
          const sourceUnitCost = Number(sourceLot.unitCost);
          if (!Number.isFinite(sourceRemaining) || sourceRemaining <= ALLOCATION_TOLERANCE) {
            continue;
          }
          if (!Number.isFinite(sourceUnitCost) || sourceUnitCost <= 0) {
            throw new Error(`VALIDATION:Invalid source unit cost for lot ${sourceLot.id}`);
          }

          const targetQuantity = Number((sourceRemaining * parsedExchangeRate).toFixed(8));
          if (!Number.isFinite(targetQuantity) || targetQuantity <= ALLOCATION_TOLERANCE) {
            throw new Error(`VALIDATION:Exchange rate produced invalid quantity for lot ${sourceLot.id}`);
          }

          const sourceCostBasis = sourceRemaining * sourceUnitCost;
          const targetUnitCost = Number((sourceCostBasis / targetQuantity).toFixed(8));

          const targetTransactionId = uuidv4();
          const targetLotId = uuidv4();

          await new sql.Request(tx)
            .input('targetTransactionId', sql.UniqueIdentifier, targetTransactionId)
            .input('userId', sql.NVarChar, userId)
            .input('targetTicker', sql.NVarChar, normalizedNewTicker)
            .input('quantity', sql.Decimal(18, 8), targetQuantity)
            .input('price', sql.Decimal(18, 8), targetUnitCost)
            .input('amount', sql.Decimal(18, 4), sourceCostBasis)
            .input('transactionDate', sql.DateTime2, parsedTransactionDate)
            .query(`
              INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
              VALUES (@targetTransactionId, @userId, @targetTicker, 'buy', @quantity, @price, @amount, @transactionDate)
            `);

          await new sql.Request(tx)
            .input('targetLotId', sql.UniqueIdentifier, targetLotId)
            .input('userId', sql.NVarChar, userId)
            .input('targetTicker', sql.NVarChar, normalizedNewTicker)
            .input('targetTransactionId', sql.UniqueIdentifier, targetTransactionId)
            .input('quantity', sql.Decimal(18, 8), targetQuantity)
            .input('unitCost', sql.Decimal(18, 8), targetUnitCost)
            .input('purchaseDate', sql.DateTime2, sourceLot.purchaseDate)
            .query(`
              INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
              VALUES (@targetLotId, @userId, @targetTicker, @targetTransactionId, 'purchase', @quantity, @quantity, @unitCost, @purchaseDate)
            `);

          await new sql.Request(tx)
            .input('sourceLotId', sql.UniqueIdentifier, sourceLot.id)
            .input('userId', sql.NVarChar, userId)
            .query(`
              UPDATE PurchaseLots
              SET remainingQuantity = 0, updatedAt = GETUTCDATE()
              WHERE id = @sourceLotId AND userId = @userId
            `);

          await new sql.Request(tx)
            .input('id', sql.UniqueIdentifier, uuidv4())
            .input('exchangeId', sql.UniqueIdentifier, exchangeId)
            .input('userId', sql.NVarChar, userId)
            .input('sourceLotId', sql.UniqueIdentifier, sourceLot.id)
            .input('sourceTransactionId', sql.UniqueIdentifier, sourceLot.transactionId)
            .input('sourceRemainingBefore', sql.Decimal(18, 8), sourceRemaining)
            .input('sourceUnitCost', sql.Decimal(18, 8), sourceUnitCost)
            .input('sourcePurchaseDate', sql.DateTime2, sourceLot.purchaseDate)
            .input('targetTransactionId', sql.UniqueIdentifier, targetTransactionId)
            .input('targetLotId', sql.UniqueIdentifier, targetLotId)
            .input('targetQuantity', sql.Decimal(18, 8), targetQuantity)
            .input('targetUnitCost', sql.Decimal(18, 8), targetUnitCost)
            .query(`
              INSERT INTO StockExchangeLotMappings (
                id,
                exchangeId,
                userId,
                sourceLotId,
                sourceTransactionId,
                sourceRemainingBefore,
                sourceUnitCost,
                sourcePurchaseDate,
                targetTransactionId,
                targetLotId,
                targetQuantity,
                targetUnitCost
              )
              VALUES (
                @id,
                @exchangeId,
                @userId,
                @sourceLotId,
                @sourceTransactionId,
                @sourceRemainingBefore,
                @sourceUnitCost,
                @sourcePurchaseDate,
                @targetTransactionId,
                @targetLotId,
                @targetQuantity,
                @targetUnitCost
              )
            `);

          await appendDisplayLotQuantity(tx, userId, normalizedNewTicker, targetQuantity);
          totalSourceConsumed += sourceRemaining;
        }

        if (totalSourceConsumed > ALLOCATION_TOLERANCE) {
          await consumeDisplayLotQuantitySmallestFirst(tx, userId, normalizedTicker, totalSourceConsumed);
        }
      }

      await tx.commit();
      res.status(201).json({
        id,
        ticker: normalizedTicker,
        type,
        quantity,
        price,
        amount,
        transactionDate,
        newTicker: type === 'exchange' ? normalizedNewTicker : undefined,
        exchangeRate: type === 'exchange' ? parsedExchangeRate : undefined,
      });
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('VALIDATION:')) {
      return res.status(400).json({ error: error.message.replace('VALIDATION:', '') });
    }
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

    if (transactionType !== 'exchange') {
      const lockLookup = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query(`
          SELECT TOP 1 id
          FROM StockExchangeLotMappings
          WHERE userId = @userId
            AND (sourceTransactionId = @id OR targetTransactionId = @id)
        `);

      if (lockLookup.recordset.length > 0) {
        return res.status(409).json({
          error: 'This transaction is locked by an exchange event and cannot be deleted directly. Delete the exchange transaction to rollback both tickers.'
        });
      }
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      if (transactionType === 'exchange') {
        const exchangeLookup = await new sql.Request(tx)
          .input('exchangeTransactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT TOP 1 id, sourceTicker, targetTicker, sourceDisplayLotsCsvBefore, targetDisplayLotsCsvBefore
            FROM StockExchanges
            WHERE exchangeTransactionId = @exchangeTransactionId AND userId = @userId
          `);

        if (exchangeLookup.recordset.length === 0) {
          throw new Error('Exchange record not found for transaction rollback');
        }

        const exchangeRow = exchangeLookup.recordset[0] as any;
        const exchangeId = String(exchangeRow.id || '');
        const sourceTicker = String(exchangeRow.sourceTicker || '').toUpperCase();
        const targetTicker = String(exchangeRow.targetTicker || '').toUpperCase();

        const mappingRows = await new sql.Request(tx)
          .input('exchangeId', sql.UniqueIdentifier, exchangeId)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT sourceLotId, sourceRemainingBefore, targetLotId, targetTransactionId
            FROM StockExchangeLotMappings
            WHERE exchangeId = @exchangeId AND userId = @userId
            ORDER BY createdAt DESC
          `);

        for (const mapping of mappingRows.recordset as any[]) {
          await new sql.Request(tx)
            .input('sourceLotId', sql.UniqueIdentifier, mapping.sourceLotId)
            .input('sourceRemainingBefore', sql.Decimal(18, 8), Number(mapping.sourceRemainingBefore || 0))
            .input('userId', sql.NVarChar, userId)
            .query(`
              UPDATE PurchaseLots
              SET remainingQuantity = @sourceRemainingBefore, updatedAt = GETUTCDATE()
              WHERE id = @sourceLotId AND userId = @userId
            `);

          await new sql.Request(tx)
            .input('targetLotId', sql.UniqueIdentifier, mapping.targetLotId)
            .input('userId', sql.NVarChar, userId)
            .query(`
              DELETE FROM PurchaseLots
              WHERE id = @targetLotId AND userId = @userId
            `);

          await new sql.Request(tx)
            .input('targetTransactionId', sql.UniqueIdentifier, mapping.targetTransactionId)
            .input('userId', sql.NVarChar, userId)
            .query(`
              DELETE FROM StockTransactions
              WHERE id = @targetTransactionId AND userId = @userId
            `);
        }

        const sourceDisplayBeforeLots = parseDisplayLotsCsv(String(exchangeRow.sourceDisplayLotsCsvBefore || ''));
        const targetDisplayBeforeLots = parseDisplayLotsCsv(String(exchangeRow.targetDisplayLotsCsvBefore || ''));
        await persistDisplayLotsCsvForTicker(tx, userId, sourceTicker, sourceDisplayBeforeLots);
        await persistDisplayLotsCsvForTicker(tx, userId, targetTicker, targetDisplayBeforeLots);

        await new sql.Request(tx)
          .input('exchangeId', sql.UniqueIdentifier, exchangeId)
          .input('userId', sql.NVarChar, userId)
          .query(`
            DELETE FROM StockExchanges
            WHERE id = @exchangeId AND userId = @userId
          `);
      } else if (transactionType === 'sell') {
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

        // Restore display lots for purchase-sourced shares only.
        const purchaseDisplayRestore = await new sql.Request(tx)
          .input('saleTransactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT COALESCE(SUM(pla.quantityConsumed), 0) AS totalRestore
            FROM PurchaseLotAllocations pla
            JOIN PurchaseLots pl ON pl.id = pla.purchaseLotId
            JOIN StockTransactions st ON st.id = pla.saleTransactionId
            WHERE pla.saleTransactionId = @saleTransactionId
              AND pla.userId = @userId
              AND st.userId = @userId
              AND pl.sourceType = 'purchase'
          `);

        const totalRestore = Number(purchaseDisplayRestore.recordset[0]?.totalRestore || 0);
        if (totalRestore > ALLOCATION_TOLERANCE) {
          const saleRow = await new sql.Request(tx)
            .input('saleTransactionId', sql.UniqueIdentifier, id)
            .input('userId', sql.NVarChar, userId)
            .query(`
              SELECT TOP 1 ticker FROM StockTransactions
              WHERE id = @saleTransactionId AND userId = @userId
            `);

          const ticker = String(saleRow.recordset[0]?.ticker || '');
          if (ticker) {
            await appendDisplayLotQuantity(tx, userId, ticker, totalRestore);
          }
        }
      } else if (transactionType === 'buy' || transactionType === 'div') {
        // For buy/div, remove affected purchase shares from display lots then delete purchase lots.
        
        const purchaseLotsResult = await new sql.Request(tx)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT id FROM PurchaseLots
            WHERE transactionId = @transactionId AND userId = @userId
          `);

        for (const row of purchaseLotsResult.recordset) {
          const purchaseLotId = row.id;

          const lotResult = await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
            .input('userId', sql.NVarChar, userId)
            .query(`
              SELECT TOP 1 ticker, sourceType, remainingQuantity
              FROM PurchaseLots
              WHERE id = @purchaseLotId AND userId = @userId
            `);

          if (lotResult.recordset.length > 0) {
            const lotRow = lotResult.recordset[0] as any;
            const sourceType = String(lotRow.sourceType || '').toLowerCase();
            const ticker = String(lotRow.ticker || '');
            const remaining = Number(lotRow.remainingQuantity || 0);
            if (sourceType === 'purchase' && remaining > ALLOCATION_TOLERANCE && ticker) {
              await consumeDisplayLotQuantitySmallestFirst(tx, userId, ticker, remaining);
            }
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

export async function getYearPriorityDates(
  pool: sql.ConnectionPool,
  userId: string,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const rows = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('startDate', sql.Date, parseDateOnly(startDate))
    .input('endDate', sql.Date, parseDateOnly(endDate))
    .query(`
      SELECT DISTINCT CONVERT(VARCHAR(10), priorityDate, 23) AS priorityDate
      FROM (
        SELECT transactionDate AS priorityDate
        FROM CashTransactions
        WHERE userId = @userId
          AND type IN ('deposit', 'withdrawal')
          AND transactionDate >= @startDate
          AND transactionDate <= @endDate

        UNION ALL

        SELECT transactionDate AS priorityDate
        FROM StockTransactions
        WHERE userId = @userId
          AND transactionDate >= @startDate
          AND transactionDate <= @endDate
      ) allPriorityDates
      ORDER BY priorityDate ASC
    `);

  return Array.from(new Set(
    (rows.recordset ?? [])
      .map((row: any) => String(row.priorityDate || ''))
      .filter((dateText) => !!dateText)
  ));
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

function resolveClosestHistoricalCloseOnOrBefore(quotes: IHistoricalClosePoint[], requestedDate: string): IHistoricalClosePoint | null {
  const requested = parseDateOnly(requestedDate).getTime();
  let best: IHistoricalClosePoint | null = null;

  for (const quote of quotes) {
    const quoteTs = parseDateOnly(quote.priceDate).getTime();
    if (quoteTs <= requested) {
      if (!best || quoteTs > parseDateOnly(best.priceDate).getTime()) {
        best = quote;
      }
    }
  }

  return best;
}

function applyCashFlowToBenchmarkUnits(
  currentUnits: number,
  eventType: string,
  amount: number,
  eventDate: string,
  quotes: IHistoricalClosePoint[]
): number {
  if ((eventType !== 'deposit' && eventType !== 'withdrawal') || !Number.isFinite(amount) || amount <= 0) {
    return currentUnits;
  }

  const baseQuote = resolveClosestHistoricalCloseOnOrBefore(quotes, eventDate);
  const baseClose = Number(baseQuote?.close);
  if (!Number.isFinite(baseClose) || baseClose <= 0) {
    return currentUnits;
  }

  const unitsDelta = amount / baseClose;
  if (eventType === 'deposit') {
    return currentUnits + unitsDelta;
  }

  return Math.max(0, currentUnits - unitsDelta);
}

function calculateBenchmarkValueAtPoint(
  units: number,
  pointDate: string,
  quotes: IHistoricalClosePoint[]
): number {
  if (!Number.isFinite(units) || units <= ALLOCATION_TOLERANCE) {
    return 0;
  }

  const pointQuote = resolveClosestHistoricalCloseOnOrBefore(quotes, pointDate);
  const pointClose = Number(pointQuote?.close);
  if (!Number.isFinite(pointClose) || pointClose <= 0) {
    return 0;
  }

  return units * pointClose;
}

function resolveClosestPriceOnOrBefore(quotes: IPricePoint[], requestedDate: string): IPricePoint | null {
  const requested = parseDateOnly(requestedDate).getTime();
  let best: IPricePoint | null = null;

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

function getUtcTodayDateOnly(): Date {
  return parseDateOnly(toIsoDate(new Date()));
}

function isValidDateOnlyString(dateText: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return false;
  }

  const parsed = parseDateOnly(dateText);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === dateText;
}

function parseSupportedComparisonYear(rawYear: unknown): number | null {
  const year = Number(rawYear);
  if (!Number.isFinite(year) || !Number.isInteger(year)) {
    return null;
  }

  if (year < 1900 || year > 9999) {
    return null;
  }

  return year;
}

function getYearRange(year: number): { startDate: string; endDate: string } {
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`
  };
}

function getEndOfYearDate(year: number): string {
  return `${year}-12-31`;
}

function clampComparisonEndDate(latestTransactionDate: string): string {
  const latestTransactionYear = parseDateOnly(latestTransactionDate).getUTCFullYear();
  const today = toIsoDate(getUtcTodayDateOnly());
  const latestTransactionYearEnd = getEndOfYearDate(latestTransactionYear);
  return today < latestTransactionYearEnd ? today : latestTransactionYearEnd;
}

async function getComparisonTimelineBounds(
  pool: sql.ConnectionPool,
  userId: string
): Promise<{ referenceStartDate: string | null; effectiveEndDate: string | null }> {
  const boundaryRows = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .query(`
      SELECT
        (
          SELECT TOP 1 CONVERT(VARCHAR(10), transactionDate, 23)
          FROM CashTransactions
          WHERE userId = @userId
            AND type = 'deposit'
          ORDER BY transactionDate ASC
        ) AS firstDepositDate,
        (
          SELECT MAX(txDate)
          FROM (
            SELECT MAX(CONVERT(VARCHAR(10), transactionDate, 23)) AS txDate
            FROM CashTransactions
            WHERE userId = @userId

            UNION ALL

            SELECT MAX(CONVERT(VARCHAR(10), transactionDate, 23)) AS txDate
            FROM StockTransactions
            WHERE userId = @userId
          ) latestTx
        ) AS latestTransactionDate
    `);

  const firstDepositDate = String(boundaryRows.recordset?.[0]?.firstDepositDate || '');
  const latestTransactionDate = String(boundaryRows.recordset?.[0]?.latestTransactionDate || '');

  if (!latestTransactionDate) {
    return {
      referenceStartDate: null,
      effectiveEndDate: null,
    };
  }

  return {
    referenceStartDate: firstDepositDate || latestTransactionDate,
    effectiveEndDate: clampComparisonEndDate(latestTransactionDate),
  };
}

async function buildPortfolioComparisonPoints(
  pool: sql.ConnectionPool,
  userId: string,
  range: { startDate: string; endDate: string },
  options?: { markCashFlowsFromDate?: string }
): Promise<IComparisonPoint[]> {
  const datesResult = await pool.request()
    .input('startDate', sql.Date, parseDateOnly(range.startDate))
    .input('endDate', sql.Date, parseDateOnly(range.endDate))
    .query(`
      SELECT DISTINCT CONVERT(VARCHAR(10), priceDate, 23) AS priceDate
      FROM HistoricalPrices
      WHERE priceDate >= @startDate
        AND priceDate <= @endDate
      ORDER BY priceDate ASC
    `);

  const dates = (datesResult.recordset ?? [])
    .map((row: any) => String(row.priceDate || ''))
    .filter((d) => !!d);

  if (dates.length === 0) {
    return [];
  }

  const cashRows = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('endDate', sql.Date, parseDateOnly(range.endDate))
    .query(`
      SELECT type, amount, transactionDate
      FROM CashTransactions
      WHERE userId = @userId
        AND transactionDate <= DATEADD(day, 1, @endDate)
      ORDER BY transactionDate ASC
    `);

  const stockRows = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('endDate', sql.Date, parseDateOnly(range.endDate))
    .query(`
      SELECT ticker, type, quantity, amount, transactionDate
      FROM StockTransactions
      WHERE userId = @userId
        AND transactionDate <= DATEADD(day, 1, @endDate)
      ORDER BY transactionDate ASC
    `);

  const priceRows = await pool.request()
    .input('startDate', sql.Date, parseDateOnly(range.startDate))
    .input('endDate', sql.Date, parseDateOnly(range.endDate))
    .query(`
      SELECT
        ticker,
        CONVERT(VARCHAR(10), priceDate, 23) AS priceDate,
        closePrice
      FROM HistoricalPrices
      WHERE priceDate >= @startDate
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
  const benchmarkQuotesByTicker = new Map<string, Map<string, number>>();
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

    const quotesByDate = benchmarkQuotesByTicker.get(ticker) ?? new Map<string, number>();
    quotesByDate.set(date, closePrice);
    benchmarkQuotesByTicker.set(ticker, quotesByDate);
  }

  const historicalQuotesByTicker = new Map<string, IHistoricalClosePoint[]>();
  for (const [ticker, quotesByDate] of benchmarkQuotesByTicker.entries()) {
    historicalQuotesByTicker.set(
      ticker,
      Array.from(quotesByDate.entries())
        .map(([priceDate, close]) => ({ priceDate, close: Number(close) }))
        .sort((a, b) => a.priceDate.localeCompare(b.priceDate))
    );
  }

  const dowBenchmarkQuotes = historicalQuotesByTicker.get(DOW_BENCHMARK_TICKER) ?? []
  const nasdaqBenchmarkQuotes = historicalQuotesByTicker.get(NASDAQ_BENCHMARK_TICKER) ?? []
  const sp500BenchmarkQuotes = historicalQuotesByTicker.get(SP500_BENCHMARK_TICKER) ?? []

  const markCashFlowsFromDate = options?.markCashFlowsFromDate ?? range.startDate;
  let cashIndex = 0;
  let stockIndex = 0;

  let deposits = 0;
  let withdrawals = 0;
  let interest = 0;
  let fees = 0;
  let buys = 0;
  let sells = 0;

  let dowBenchmarkUnits = 0;
  let nasdaqBenchmarkUnits = 0;
  let sp500BenchmarkUnits = 0;

  const holdings = new Map<string, number>();
  const points: IComparisonPoint[] = [];

  for (const pointDate of dates) {
    let hasCashFlowEvent = false;

    while (cashIndex < cashEvents.length && cashEvents[cashIndex].date <= pointDate) {
      const event = cashEvents[cashIndex];

      if ((event.type === 'deposit' || event.type === 'withdrawal') && event.date >= markCashFlowsFromDate) {
        hasCashFlowEvent = true;
      }

      if (event.type === 'deposit') deposits += event.amount;
      else if (event.type === 'withdrawal') withdrawals += event.amount;
      else if (event.type === 'interest') interest += event.amount;
      else if (event.type === 'fee') fees += event.amount;

      dowBenchmarkUnits = applyCashFlowToBenchmarkUnits(
        dowBenchmarkUnits,
        event.type,
        event.amount,
        event.date,
        dowBenchmarkQuotes
      );
      nasdaqBenchmarkUnits = applyCashFlowToBenchmarkUnits(
        nasdaqBenchmarkUnits,
        event.type,
        event.amount,
        event.date,
        nasdaqBenchmarkQuotes
      );
      sp500BenchmarkUnits = applyCashFlowToBenchmarkUnits(
        sp500BenchmarkUnits,
        event.type,
        event.amount,
        event.date,
        sp500BenchmarkQuotes
      );

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

    let stockValue = 0;
    const missingTickers: string[] = [];

    for (const [ticker, shares] of holdings.entries()) {
      const normalizedShares = Number(shares || 0);
      if (!Number.isFinite(normalizedShares) || normalizedShares <= ALLOCATION_TOLERANCE) {
        continue;
      }
      const quotes = historicalQuotesByTicker.get(ticker) ?? [];
      const pointQuote = resolveClosestHistoricalCloseOnOrBefore(quotes, pointDate);
      const closePrice = Number(pointQuote?.close);
      if (!Number.isFinite(closePrice) || closePrice <= 0) {
        missingTickers.push(ticker);
        continue;
      }
      stockValue += normalizedShares * closePrice;
    }

    const availableCash = deposits - withdrawals + interest - fees - buys + sells;
    const cashCostBasis = deposits - withdrawals;
    const dowBenchmarkShares = dowBenchmarkUnits;
    const dowBenchmarkValue = calculateBenchmarkValueAtPoint(dowBenchmarkUnits, pointDate, dowBenchmarkQuotes);

    const nasdaqBenchmarkShares = nasdaqBenchmarkUnits;
    const nasdaqBenchmarkValue = calculateBenchmarkValueAtPoint(nasdaqBenchmarkUnits, pointDate, nasdaqBenchmarkQuotes);

    const sp500BenchmarkShares = sp500BenchmarkUnits;
    const sp500BenchmarkValue = calculateBenchmarkValueAtPoint(sp500BenchmarkUnits, pointDate, sp500BenchmarkQuotes);

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

  return points;
}

function parseSplitRatio(splitRow: any): { numerator: number; denominator: number } | null {
  const directNumerator = Number(splitRow?.numerator);
  const directDenominator = Number(splitRow?.denominator);
  if (Number.isFinite(directNumerator) && directNumerator > 0 && Number.isFinite(directDenominator) && directDenominator > 0) {
    return { numerator: directNumerator, denominator: directDenominator };
  }

  const splitRatio = splitRow?.splitRatio;
  if (typeof splitRatio === 'string') {
    const match = splitRatio.trim().match(/^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      const numerator = Number(match[1]);
      const denominator = Number(match[2]);
      if (Number.isFinite(numerator) && numerator > 0 && Number.isFinite(denominator) && denominator > 0) {
        return { numerator, denominator };
      }
    }
  }

  const numericSplitRatio = Number(splitRatio);
  if (Number.isFinite(numericSplitRatio) && numericSplitRatio > 0) {
    return { numerator: numericSplitRatio, denominator: 1 };
  }

  return null;
}

function parseSplitEventDate(splitRow: any, splitKey?: string): string | null {
  const rawDate = splitRow?.date ?? splitKey;
  let parsedDate: Date;

  if (typeof rawDate === 'number' && Number.isFinite(rawDate)) {
    parsedDate = rawDate > 1_000_000_000_000 ? new Date(rawDate) : new Date(rawDate * 1000);
  } else if (rawDate instanceof Date) {
    parsedDate = rawDate;
  } else if (typeof rawDate === 'string') {
    const numericRawDate = Number(rawDate);
    if (Number.isFinite(numericRawDate)) {
      parsedDate = numericRawDate > 1_000_000_000_000
        ? new Date(numericRawDate)
        : new Date(numericRawDate * 1000);
    } else {
      parsedDate = new Date(rawDate);
    }
  } else {
    return null;
  }

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return toIsoDate(parsedDate);
}

async function fetchYahooSplitEvents(ticker: string, startDate: string, endDate: string): Promise<ISplitPoint[]> {
  const period1 = parseDateOnly(startDate);
  const period2 = addUtcDays(parseDateOnly(endDate), 1);

  const chart = await yahooFinance.chart(ticker, {
    period1,
    period2,
    interval: '1d',
    events: 'split'
  } as any);

  const rawSplitsNode = (chart as any)?.events?.splits;
  const rawSplitEntries: Array<{ splitKey: string; splitRow: any }> = Array.isArray(rawSplitsNode)
    ? rawSplitsNode.map((splitRow: any, index: number) => ({ splitKey: String(index), splitRow }))
    : rawSplitsNode && typeof rawSplitsNode === 'object'
      ? Object.entries(rawSplitsNode).map(([splitKey, splitRow]) => ({ splitKey, splitRow }))
      : [];

  const deduped = new Map<string, ISplitPoint>();
  for (const { splitKey, splitRow } of rawSplitEntries) {
    const splitDate = parseSplitEventDate(splitRow, splitKey);
    if (!splitDate) {
      continue;
    }

    const ratio = parseSplitRatio(splitRow);
    if (!ratio) {
      continue;
    }

    const multiplier = ratio.numerator / ratio.denominator;
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      continue;
    }

    const dedupeKey = `${splitDate}|${ratio.numerator.toFixed(8)}|${ratio.denominator.toFixed(8)}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        splitDate,
        ratioNumerator: ratio.numerator,
        ratioDenominator: ratio.denominator,
        multiplier
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.splitDate.localeCompare(b.splitDate));
}

async function reconcileDisplayLotsAfterSplit(tx: sql.Transaction, ticker: string): Promise<void> {
  const userRows = await new sql.Request(tx)
    .input('ticker', sql.NVarChar, ticker)
    .query(`
      SELECT DISTINCT userId
      FROM PurchaseLots
      WHERE ticker = @ticker AND sourceType = 'purchase'
      UNION
      SELECT DISTINCT userId
      FROM DisplayLots
      WHERE ticker = @ticker
    `);

  for (const userRow of userRows.recordset as any[]) {
    const userId = String(userRow.userId || '');
    if (!userId) {
      continue;
    }

    const openPurchaseTotalRow = await new sql.Request(tx)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .query(`
        SELECT COALESCE(SUM(remainingQuantity), 0) AS total
        FROM PurchaseLots
        WHERE userId = @userId
          AND ticker = @ticker
          AND sourceType = 'purchase'
          AND remainingQuantity > 0
      `);

    const targetTotal = Number(openPurchaseTotalRow.recordset[0]?.total || 0);

    const existingDisplayLots = await getDisplayLotsCsvForTicker(tx, userId, ticker);
    const displayTotal = (existingDisplayLots?.lots ?? []).reduce((sum, qty) => sum + qty, 0);

    const delta = targetTotal - displayTotal;

    if (delta > SPLIT_TOLERANCE) {
      await appendDisplayLotQuantity(tx, userId, ticker, delta);
      continue;
    }

    if (delta < -SPLIT_TOLERANCE) {
      await consumeDisplayLotQuantitySmallestFirst(tx, userId, ticker, Math.abs(delta));
    }
  }
}

async function insertSplitAndApplyHistoricalAdjustments(
  pool: sql.ConnectionPool,
  userId: string,
  ticker: string,
  split: ISplitPoint
): Promise<boolean> {
  const splitId = uuidv4();
  const splitDate = parseDateOnly(split.splitDate);

  const insertResult = await pool.request()
    .input('id', sql.UniqueIdentifier, splitId)
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .input('ratioNumerator', sql.Decimal(18, 8), split.ratioNumerator)
    .input('ratioDenominator', sql.Decimal(18, 8), split.ratioDenominator)
    .input('multiplier', sql.Decimal(18, 8), split.multiplier)
    .input('splitDate', sql.DateTime2, splitDate)
    .query(`
      INSERT INTO StockSplits (id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
      SELECT @id, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate
      WHERE NOT EXISTS (
        SELECT 1
        FROM StockSplits
        WHERE ticker = @ticker
          AND ratioNumerator = @ratioNumerator
          AND ratioDenominator = @ratioDenominator
          AND splitDate = @splitDate
      )
    `);

  return Array.isArray(insertResult.rowsAffected) && Number(insertResult.rowsAffected[0] || 0) > 0;
}

async function fetchAndPersistMissingSplitsForTicker(
  pool: sql.ConnectionPool,
  userId: string,
  ticker: string,
  startDate: string,
  endDate: string
): Promise<ISplitSyncSummary> {
  const summary: ISplitSyncSummary = {
    splitCheckPerformed: true,
    splitsDiscovered: 0,
    splitsInserted: 0,
  };

  const yahooSplits = await fetchYahooSplitEvents(ticker, startDate, endDate);
  summary.splitsDiscovered = yahooSplits.length;
  if (yahooSplits.length === 0) {
    return summary;
  }

  const existingSplitRows = await pool.request()
    .input('ticker', sql.NVarChar, ticker)
    .input('startDate', sql.Date, parseDateOnly(startDate))
    .input('endDate', sql.Date, parseDateOnly(endDate))
    .query(`
      SELECT
        CONVERT(VARCHAR(10), splitDate, 23) AS splitDate,
        ratioNumerator,
        ratioDenominator
      FROM StockSplits
      WHERE ticker = @ticker
        AND splitDate >= @startDate
        AND splitDate <= @endDate
    `);

  const existingSplitKeys = new Set(
    (existingSplitRows.recordset ?? []).map((row: any) => {
      const splitDate = String(row.splitDate || '');
      const ratioNumerator = Number(row.ratioNumerator || 0).toFixed(8);
      const ratioDenominator = Number(row.ratioDenominator || 0).toFixed(8);
      return `${splitDate}|${ratioNumerator}|${ratioDenominator}`;
    })
  );

  for (const split of yahooSplits) {
    const splitKey = `${split.splitDate}|${split.ratioNumerator.toFixed(8)}|${split.ratioDenominator.toFixed(8)}`;
    if (existingSplitKeys.has(splitKey)) {
      continue;
    }

    const inserted = await insertSplitAndApplyHistoricalAdjustments(pool, userId, ticker, split);
    if (inserted) {
      existingSplitKeys.add(splitKey);
      summary.splitsInserted += 1;
    }
  }

  return summary;
}

async function ensureBackfilledMarketDataForBackdatedTransaction(
  pool: sql.ConnectionPool,
  userId: string,
  ticker: string,
  transactionDate: Date
): Promise<IBackdatedMarketDataSyncSummary> {
  const summary: IBackdatedMarketDataSyncSummary = {
    backdatedCheckPerformed: false,
    splitCheckPerformed: false,
    historicalPricesInserted: 0,
    splitsDiscovered: 0,
    splitsInserted: 0,
  };

  const todayUtc = getUtcTodayDateOnly();
  const startDate = toIsoDate(transactionDate);
  const endDate = toIsoDate(todayUtc);
  if (startDate > endDate) {
    return summary;
  }

  summary.backdatedCheckPerformed = true;

  // Ensure stock split rows from transaction date through today exist in DB.
  const splitSummary = await fetchAndPersistMissingSplitsForTicker(
    pool,
    userId,
    ticker,
    startDate,
    endDate
  );
  summary.splitCheckPerformed = splitSummary.splitCheckPerformed;
  summary.splitsDiscovered = splitSummary.splitsDiscovered;
  summary.splitsInserted = splitSummary.splitsInserted;

  return summary;
}

async function fetchYahooDailyCloses(ticker: string, firstRequestedDate: string, lastRequestedDate: string): Promise<IPricePoint[]> {
  const period1 = addUtcDays(parseDateOnly(firstRequestedDate), -14);
  const period2 = addUtcDays(parseDateOnly(lastRequestedDate), 1);

  const historical = await yahooFinance.historical(ticker, {
    period1,
    period2,
    interval: '1d'
  });

  const rows = Array.isArray(historical) ? (historical as any[]) : [];

  const quotes: IPricePoint[] = rows
    .map((row: any): IPricePoint => ({
      marketDate: toIsoDate(new Date(row.date)),
      close: Number(row.close)
    }))
    .filter((row: IPricePoint) => Number.isFinite(row.close) && row.close > 0)
    .sort((a: IPricePoint, b: IPricePoint) => a.marketDate.localeCompare(b.marketDate));

  return quotes;
}

function buildSmallestFirstConsumption(openLots: IOpenLot[], sellQuantity: number): IAllocation[] {
  let remainingToSell = Number(sellQuantity);
  const consumptionPlan: IAllocation[] = [];

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

async function applyAutomaticSplitCatchUpForInsertedTransaction(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  transactionDate: Date,
  stockTransactionId: string,
  _createdPurchaseLotId: string | null,
  _createdPurchaseAllocationIds: string[]
) {
  void tx;
  void userId;
  void ticker;
  void transactionDate;
  void stockTransactionId;
}

export default router;
