import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { getCashSummary } from './cash-summary.js';
import { loadAiPreferences } from './ai-preferences.js';
import { loadHoldingReviewContext } from './holding-review-context.js';

export type PortfolioLotRow = {
  ticker: string;
  sourceType: string;
  purchaseDate: string | Date;
  remainingQuantity: number | string;
  unitCost: number | string;
  closePrice: number | string | null;
  marketDate: string | null;
  recentAcquisitionCount: number | string;
  companyName?: string | null;
  sector?: string | null;
  industry?: string | null;
  sizeClassification?: string | null;
  profileUpdatedAt?: string | null;
};

type CashSummary = Awaited<ReturnType<typeof getCashSummary>>;

function numeric(value: number | string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Invalid portfolio snapshot value.');
  return number;
}

export function buildPortfolioSnapshot(rows: PortfolioLotRow[], cash: CashSummary, generatedAt: string) {
  const openLots = rows.map((row) => {
    const quantity = numeric(row.remainingQuantity);
    const unitCost = numeric(row.unitCost);
    const closePrice = row.closePrice == null ? null : numeric(row.closePrice);
    const costBasis = quantity * unitCost;
    const marketValue = closePrice == null ? null : quantity * closePrice;
    return {
      ticker: row.ticker.toUpperCase(),
      sourceType: row.sourceType,
      acquisitionDate: new Date(row.purchaseDate).toISOString().slice(0, 10),
      quantity, unitCost, costBasis, closePrice, marketValue,
      unrealizedGainLoss: marketValue == null ? null : marketValue - costBasis,
      marketDate: row.marketDate,
      recentAcquisitionCount: numeric(row.recentAcquisitionCount),
    };
  });
  const byTicker = new Map<string, {
    ticker: string; quantity: number; costBasis: number;
    closePrice: number | null; marketDate: string | null;
    marketValue: number | null; unrealizedGainLoss: number | null;
    companyName: string | null; sector: string | null; industry: string | null;
    sizeClassification: string | null; profileUpdatedAt: string | null;
  }>();
  openLots.forEach((lot, index) => {
    const existing = byTicker.get(lot.ticker);
    if (existing) {
      existing.quantity += lot.quantity;
      existing.costBasis += lot.costBasis;
      existing.marketValue = existing.marketValue == null || lot.marketValue == null
        ? null : existing.marketValue + lot.marketValue;
      existing.unrealizedGainLoss = existing.marketValue == null
        ? null : existing.marketValue - existing.costBasis;
    } else {
      const row = rows[index];
      byTicker.set(lot.ticker, {
        ticker: lot.ticker, quantity: lot.quantity, costBasis: lot.costBasis,
        closePrice: lot.closePrice, marketDate: lot.marketDate,
        marketValue: lot.marketValue, unrealizedGainLoss: lot.unrealizedGainLoss,
        companyName: row.companyName ?? null, sector: row.sector ?? null,
        industry: row.industry ?? null, sizeClassification: row.sizeClassification ?? null,
        profileUpdatedAt: row.profileUpdatedAt ?? null,
      });
    }
  });
  const values = Array.from(byTicker.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const missingPriceTickers = values.filter((holding) => holding.marketValue == null).map((holding) => holding.ticker);
  const pricedEquityValue = values.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const equityCostBasis = values.reduce((sum, holding) => sum + holding.costBasis, 0);
  const equityValue = missingPriceTickers.length ? null : pricedEquityValue;
  const portfolioValue = equityValue == null ? null : equityValue + cash.availableCash;
  const holdings = values.map((holding) => ({
    ...holding,
    percentOfPricedEquities: holding.marketValue != null && pricedEquityValue > 0
      ? holding.marketValue / pricedEquityValue * 100 : null,
    percentOfPortfolio: holding.marketValue != null && portfolioValue != null && portfolioValue > 0
      ? holding.marketValue / portfolioValue * 100 : null,
  }));
  return {
    generatedAt,
    valuationBasis: 'latest_stored_close',
    holdings, openLots, cash,
    totals: {
      holdingCount: holdings.length, openLotCount: openLots.length,
      equityCostBasis, pricedEquityValue, equityValue, portfolioValue,
      unrealizedGainLoss: equityValue == null ? null : equityValue - equityCostBasis,
      cashPercentOfPortfolio: portfolioValue != null && portfolioValue > 0
        ? cash.availableCash / portfolioValue * 100 : null,
    },
    missingPriceTickers,
  };
}

export type PortfolioSnapshot = ReturnType<typeof buildPortfolioSnapshot> & {
  assumptions?: Awaited<ReturnType<typeof loadAiPreferences>>;
  holdingReviewContext?: Awaited<ReturnType<typeof loadHoldingReviewContext>>;
};

export async function loadPortfolioSnapshot(userId: string) {
  const result = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query<PortfolioLotRow>(`
      SELECT pl.ticker, pl.sourceType, pl.purchaseDate, pl.remainingQuantity, pl.unitCost,
        price.closePrice, CONVERT(varchar(10), price.marketDate, 23) AS marketDate,
        recent.recentAcquisitionCount,
        cp.companyName, cp.sector, cp.industry, cp.sizeClassification,
        CONVERT(varchar(33), cp.updatedAt, 126) AS profileUpdatedAt
      FROM PurchaseLots pl
      LEFT JOIN CompanyProfiles cp ON cp.ticker = pl.ticker
      OUTER APPLY (
        SELECT TOP 1 hp.closePrice, hp.marketDate
        FROM HistoricalPrices hp WHERE hp.ticker = pl.ticker
        ORDER BY hp.marketDate DESC
      ) price
      OUTER APPLY (
        SELECT COUNT(*) AS recentAcquisitionCount
        FROM PurchaseLots recent
        WHERE recent.userId = pl.userId AND recent.ticker = pl.ticker
          AND recent.purchaseDate >= DATEADD(day, -30, SYSUTCDATETIME())
      ) recent
      WHERE pl.userId = @userId AND pl.remainingQuantity > 0
      ORDER BY pl.ticker, pl.purchaseDate
    `);
  const cash = await getCashSummary(userId);
  const snapshot: PortfolioSnapshot = buildPortfolioSnapshot(result.recordset, cash, new Date().toISOString());
  snapshot.assumptions = await loadAiPreferences(userId);
  if (snapshot.assumptions) {
    snapshot.holdingReviewContext = await loadHoldingReviewContext(userId, snapshot.holdings, snapshot.generatedAt.slice(0, 10));
  }
  return {
    rows: result.recordset,
    snapshot,
  };
}
