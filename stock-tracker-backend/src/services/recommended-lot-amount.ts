import sql from 'mssql';
import { getPool } from '../db/connection.js';

export const LOT_AMOUNT_INCREMENT = 50;
const TARGET_WEIGHT = 1;
const DEFAULT_BASE_SIZE = 3;
const NEXT_STEP_COUNT = 5;

type LotHoldingInput = {
  ticker: string;
  closePrice: number | null;
  displayLotCount: number;
  baseSize: number;
};

export type RecommendedLotHolding = {
  ticker: string;
  closePrice: number | null;
  displayLotCount: number;
  baseSize: number;
  weight: number;
  lotsNeeded: number;
  sharesPerLot: number | null;
  costPerLot: number | null;
  totalCost: number | null;
};

export type RecommendedLotAmount = {
  lotAmount: number | null;
  increment: number;
  targetWeight: number;
  availableCash: number;
  totalCost: number;
  nextSteps: Array<{ lotAmount: number; totalCost: number; shortfall: number }>;
  holdings: RecommendedLotHolding[];
  unpricedTickers: string[];
};

// A lot buys whole shares: one share when the price is at or above X, otherwise the fewest shares reaching X.
export function getLotPurchase(price: number, lotAmount: number): { shares: number; cost: number } {
  const shares = price >= lotAmount ? 1 : Math.ceil(lotAmount / price - 1e-9);
  return { shares, cost: shares * price };
}

function totalCostFor(holdings: LotHoldingInput[], lotsNeeded: Map<string, number>, lotAmount: number): number {
  return holdings.reduce((sum, holding) => {
    const lots = lotsNeeded.get(holding.ticker) ?? 0;
    if (lots === 0 || holding.closePrice == null) return sum;
    return sum + lots * getLotPurchase(holding.closePrice, lotAmount).cost;
  }, 0);
}

export function calculateRecommendedLotAmount(holdings: LotHoldingInput[], availableCash: number): RecommendedLotAmount {
  const cash = Number.isFinite(availableCash) ? Math.max(0, availableCash) : 0;
  const lotsNeeded = new Map<string, number>();
  for (const holding of holdings) {
    lotsNeeded.set(holding.ticker, Math.max(0, TARGET_WEIGHT - (holding.displayLotCount - holding.baseSize)));
  }
  const priced = holdings.filter((holding) => holding.closePrice != null && Number.isFinite(holding.closePrice) && holding.closePrice > 0);
  const unpricedTickers = holdings
    .filter((holding) => (lotsNeeded.get(holding.ticker) ?? 0) > 0 && !priced.includes(holding))
    .map((holding) => holding.ticker)
    .sort();
  const anyLotsNeeded = priced.some((holding) => (lotsNeeded.get(holding.ticker) ?? 0) > 0);

  // Total cost never decreases as X grows and is at least X per needed lot, so X never needs to exceed cash.
  let lotAmount: number | null = null;
  if (anyLotsNeeded) {
    for (let candidate = LOT_AMOUNT_INCREMENT; candidate <= cash; candidate += LOT_AMOUNT_INCREMENT) {
      if (totalCostFor(priced, lotsNeeded, candidate) > cash + 1e-9) break;
      lotAmount = candidate;
    }
  }
  // Always show five $50 steps past X.
  const nextSteps: RecommendedLotAmount['nextSteps'] = [];
  if (anyLotsNeeded) {
    for (let step = 1, amount = (lotAmount ?? 0) + LOT_AMOUNT_INCREMENT;
      step <= NEXT_STEP_COUNT;
      step++, amount += LOT_AMOUNT_INCREMENT) {
      const totalCost = totalCostFor(priced, lotsNeeded, amount);
      nextSteps.push({ lotAmount: amount, totalCost, shortfall: Math.max(0, totalCost - cash) });
    }
  }

  return {
    lotAmount,
    increment: LOT_AMOUNT_INCREMENT,
    targetWeight: TARGET_WEIGHT,
    availableCash: cash,
    totalCost: lotAmount == null ? 0 : totalCostFor(priced, lotsNeeded, lotAmount),
    nextSteps,
    holdings: holdings.map((holding) => {
      const lots = lotsNeeded.get(holding.ticker) ?? 0;
      const isPriced = priced.includes(holding);
      const purchase = isPriced && lotAmount != null ? getLotPurchase(holding.closePrice as number, lotAmount) : null;
      return {
        ticker: holding.ticker,
        closePrice: holding.closePrice,
        displayLotCount: holding.displayLotCount,
        baseSize: holding.baseSize,
        weight: holding.displayLotCount - holding.baseSize,
        lotsNeeded: lots,
        sharesPerLot: purchase?.shares ?? null,
        costPerLot: purchase?.cost ?? null,
        totalCost: lots === 0 ? 0 : purchase == null ? null : lots * purchase.cost,
      };
    }).sort((first, second) => first.weight - second.weight || first.ticker.localeCompare(second.ticker)),
    unpricedTickers,
  };
}

function countDisplayLots(lotsCsv: string | null): number {
  if (!lotsCsv) return 0;
  return lotsCsv.split(',').filter((part) => Number.isFinite(Number(part)) && Number(part) > 1e-6).length;
}

export async function loadRecommendedLotAmount(
  userId: string,
  holdings: Array<{ ticker: string; closePrice: number | null }>,
  availableCash: number,
): Promise<RecommendedLotAmount> {
  const result = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query(`
      SELECT ticker, lotsCsv FROM DisplayLots WHERE userId = @userId;
      SELECT ticker, baseSize FROM UserTickerPreferences WHERE userId = @userId;
    `);
  const recordsets = result.recordsets as Array<Array<Record<string, unknown>>>;
  const displayLots = new Map<string, number>();
  for (const row of recordsets[0] ?? []) {
    const ticker = String(row.ticker).toUpperCase();
    displayLots.set(ticker, (displayLots.get(ticker) ?? 0) + countDisplayLots(row.lotsCsv as string | null));
  }
  const baseSizes = new Map<string, number>();
  for (const row of recordsets[1] ?? []) {
    const baseSize = Number(row.baseSize);
    if (Number.isSafeInteger(baseSize) && baseSize >= 0) baseSizes.set(String(row.ticker).toUpperCase(), baseSize);
  }
  return calculateRecommendedLotAmount(holdings.map((holding) => ({
    ticker: holding.ticker,
    closePrice: holding.closePrice,
    displayLotCount: displayLots.get(holding.ticker) ?? 0,
    baseSize: baseSizes.get(holding.ticker) ?? DEFAULT_BASE_SIZE,
  })), availableCash);
}
