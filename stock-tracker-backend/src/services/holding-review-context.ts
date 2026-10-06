import sql from 'mssql';
import { getPool } from '../db/connection.js';

type Transaction = {
  ticker: string; type: string; quantity: number | null; amount: number | null;
  transactionDate: string; exchangeSourceQuantity: number;
};
type Split = { ticker: string; splitDate: string; multiplier: number };
type Holding = { ticker: string; marketValue: number | null };
type ContextRow = {
  ticker: string; lotsCsv: string | null; yearEndClose: number | null;
  yearEndPriceDate: string | null; lastAcquisitionDate: string | null;
  lastDividendDate: string | null;
  nextDeclaredDividendDate?: string | null;
};

export function buildHoldingReviewContext(
  holdings: Holding[], transactions: Transaction[], splits: Split[], context: ContextRow[], today: string
) {
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
  return holdings.map((holding) => {
    const row = context.find((item) => item.ticker === holding.ticker);
    const events = transactions.filter((item) => item.ticker === holding.ticker);
    let yearEndShares = 0;
    let netCurrentYearInvested = 0;
    for (const event of events) {
      const date = event.transactionDate.slice(0, 10);
      if (date > today) continue;
      if (date >= yearStart) {
        const amount = Number(event.amount ?? 0);
        if (event.type === 'buy' || event.type === 'div') netCurrentYearInvested += amount;
        if (event.type === 'sell') netCurrentYearInvested -= amount;
      }
      if (date > yearEnd) continue;
      let quantity = Number(event.type === 'exchange' ? event.exchangeSourceQuantity : event.quantity ?? 0);
      for (const split of splits) {
        if (split.ticker === holding.ticker && split.splitDate >= date && split.splitDate <= yearEnd) {
          quantity *= Number(split.multiplier);
        }
      }
      if (event.type === 'buy' || event.type === 'div') yearEndShares += quantity;
      if (event.type === 'sell' || event.type === 'exchange') yearEndShares -= quantity;
    }
    yearEndShares = Math.max(0, yearEndShares);
    const yearEndValue = yearEndShares <= 1e-6 ? 0
      : row?.yearEndClose == null ? null : yearEndShares * Number(row.yearEndClose);
    const yearlyGainLoss = holding.marketValue == null || yearEndValue == null
      ? null : holding.marketValue - yearEndValue - netCurrentYearInvested;
    const displayLotCount = row?.lotsCsv == null ? 0 : row.lotsCsv.split(',')
      .filter((part) => Number.isFinite(Number(part)) && Number(part) > 1e-6).length;
    const lastAcquisitionDate = row?.lastAcquisitionDate ?? null;
    const windowDate = lastAcquisitionDate == null ? null : new Date(`${lastAcquisitionDate}T00:00:00Z`);
    if (windowDate) windowDate.setUTCDate(windowDate.getUTCDate() + 31);
    const priorAcquisitionWindowClearsOn = windowDate?.toISOString().slice(0, 10) ?? null;
    const daysUntilPriorAcquisitionWindowClears = windowDate == null ? null
      : Math.max(0, Math.ceil((windowDate.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000));
    const lastDividendDate = row?.lastDividendDate ?? null;
    const nextDeclaredDividendDate = row?.nextDeclaredDividendDate && row.nextDeclaredDividendDate >= today
      ? row.nextDeclaredDividendDate : null;
    const daysSinceLastDividend = lastDividendDate == null ? null
      : Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastDividendDate}T00:00:00Z`).getTime()) / 86400000);
    const daysUntilNextDividend = nextDeclaredDividendDate == null ? null
      : Math.ceil((new Date(`${nextDeclaredDividendDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
    return {
      ticker: holding.ticker, displayLotCount, yearlyGainLoss,
      yearEndMarketValue: yearEndValue, yearEndPriceDate: row?.yearEndPriceDate ?? null,
      netCurrentYearInvested,
      matchesLossReviewFilter: yearlyGainLoss == null ? null : yearlyGainLoss < 0 && displayLotCount > 3,
      lastTrackedAcquisitionDate: lastAcquisitionDate,
      priorAcquisitionWindowClearsOn, daysUntilPriorAcquisitionWindowClears,
      washSaleEligibility: 'Cannot be established. Only prior tracked same-ticker acquisitions are checked; outside accounts, substantially identical securities, and purchases in the 30 days after a sale are unknown.',
      lastTrackedDividendDate: lastDividendDate,
      daysSinceLastDividend,
      nextDeclaredDividendDate,
      daysUntilNextDividend,
      dividendDateAvailability: nextDeclaredDividendDate == null
        ? 'No verified future dividend date is available. Use daysSinceLastDividend instead; null means no tracked dividend.'
        : 'Verified future dividend date supplied.',
    };
  });
}

export async function loadHoldingReviewContext(userId: string, holdings: Holding[], today: string) {
  const result = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .input('yearEnd', sql.Date, `${Number(today.slice(0, 4)) - 1}-12-31`)
    .input('today', sql.Date, today)
    .query(`
      SELECT st.ticker, st.type, st.quantity, st.amount,
        CONVERT(varchar(10), st.transactionDate, 23) AS transactionDate,
        COALESCE(exchangeSource.quantity, 0) AS exchangeSourceQuantity
      FROM StockTransactions st
      OUTER APPLY (
        SELECT SUM(mapping.sourceRemainingBefore) AS quantity
        FROM StockExchangeLotMappings mapping
        INNER JOIN StockExchanges exchangeEvent ON exchangeEvent.id = mapping.exchangeId
        WHERE exchangeEvent.exchangeTransactionId = st.id AND mapping.userId = @userId
      ) exchangeSource
      WHERE st.userId = @userId;

      SELECT ss.ticker, CONVERT(varchar(10), ss.splitDate, 23) AS splitDate, ss.multiplier
      FROM StockSplits ss
      INNER JOIN UserSplitActivations usa ON usa.splitId = ss.id AND usa.userId = @userId;

      SELECT DISTINCT pl.ticker, dl.lotsCsv, baseline.closePrice AS yearEndClose,
        CONVERT(varchar(10), baseline.priceDate, 23) AS yearEndPriceDate,
        CONVERT(varchar(10), acquisition.lastAcquisitionDate, 23) AS lastAcquisitionDate,
        CONVERT(varchar(10), dividend.lastDividendDate, 23) AS lastDividendDate
      FROM PurchaseLots pl
      LEFT JOIN DisplayLots dl ON dl.userId = @userId AND dl.ticker = pl.ticker
      OUTER APPLY (
        SELECT TOP 1 hp.closePrice, hp.priceDate FROM HistoricalPrices hp
        WHERE hp.ticker = pl.ticker AND hp.priceDate <= @yearEnd ORDER BY hp.priceDate DESC
      ) baseline
      OUTER APPLY (
        SELECT MAX(transactionDate) AS lastAcquisitionDate FROM StockTransactions acquisitions
        WHERE acquisitions.userId = @userId AND acquisitions.ticker = pl.ticker
          AND acquisitions.type IN ('buy', 'div')
          AND acquisitions.transactionDate < DATEADD(day, 1, @today)
      ) acquisition
      OUTER APPLY (
        SELECT MAX(transactionDate) AS lastDividendDate FROM StockTransactions dividends
        WHERE dividends.userId = @userId AND dividends.ticker = pl.ticker AND dividends.type = 'div'
          AND dividends.transactionDate < DATEADD(day, 1, @today)
      ) dividend
      WHERE pl.userId = @userId AND pl.remainingQuantity > 0;
    `);
  const recordsets = result.recordsets;
  if (!Array.isArray(recordsets) || recordsets.length !== 3) throw new Error('Incomplete holding review context.');
  return buildHoldingReviewContext(holdings, recordsets[0], recordsets[1], recordsets[2], today);
}
