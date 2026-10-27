import type { StockTransaction, StockSplitEvent, TickerPreference, UserTargetSettings } from './api'
import { createSplitMultiplierResolver } from './portfolioSnapshot'

export function normalizeTargetSettings(settings: UserTargetSettings): UserTargetSettings {
  const positive = (value: number, fallback: number) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
  const dip = Number(settings.buyOnDipBuyTargetPercent)
  return {
    basePurchaseSize: positive(settings.basePurchaseSize, 300),
    saleTargetPercent: positive(settings.saleTargetPercent, 10),
    buyTargetPercentUnder3DisplayLots: positive(settings.buyTargetPercentUnder3DisplayLots, 5),
    buyTargetPercentFor3DisplayLots: positive(settings.buyTargetPercentFor3DisplayLots, 10),
    buyTargetPercentFor4DisplayLots: positive(settings.buyTargetPercentFor4DisplayLots, 15),
    buyTargetPercentFor5DisplayLots: positive(settings.buyTargetPercentFor5DisplayLots, 20),
    buyTargetPercentFor6OrMoreDisplayLots: positive(settings.buyTargetPercentFor6OrMoreDisplayLots, 25),
    buyOnDipBuyTargetPercent: Number.isFinite(dip) && dip > 0 && dip < 100 ? dip : 1,
  }
}

export function buildLatestBuyOrSellByTicker(transactions: StockTransaction[]): Map<string, StockTransaction> {
  const latest = new Map<string, StockTransaction>()
  for (const tx of transactions) {
    const type = String(tx.type || '').toLowerCase()
    const ticker = String(tx.ticker || '').toUpperCase()
    if ((type !== 'buy' && type !== 'sell') || !ticker || !Number.isFinite(Number(tx.price)) || Number(tx.price) <= 0) continue
    const existing = latest.get(ticker)
    if (!existing || new Date(tx.transactionDate).getTime() > new Date(existing.transactionDate).getTime()) latest.set(ticker, tx)
  }
  return latest
}

export function getSplitAdjustedTargetBasePrice(
  transaction: StockTransaction | undefined,
  splitEvents: StockSplitEvent[],
  snapshotDate: string
): number | null {
  const originalPrice = Number(transaction?.price)
  const transactionDate = String(transaction?.transactionDate || '').slice(0, 10)
  const ticker = String(transaction?.ticker || '').toUpperCase()
  if (!Number.isFinite(originalPrice) || originalPrice <= 0 || transactionDate.length < 10 || !ticker) return null
  const multiplier = createSplitMultiplierResolver(splitEvents, snapshotDate)(ticker, transactionDate)
  const price = originalPrice / multiplier
  return Number.isFinite(price) && price > 0 ? price : null
}

export function calculateTickerTargets(
  basePrice: number | null,
  displayLotCount: number,
  settings: UserTargetSettings,
  preference: TickerPreference | undefined
): { buy: number | null; sell: number | null } {
  if (preference?.buyOnDip && preference.buyOnDipPrice != null && Number.isFinite(preference.buyOnDipPrice) && preference.buyOnDipPrice > 0) {
    return {
      buy: Number((preference.buyOnDipPrice * (1 - settings.buyOnDipBuyTargetPercent / 100)).toFixed(8)),
      sell: Number((preference.buyOnDipPrice * 1.10).toFixed(8)),
    }
  }

  const buyPercent = displayLotCount < 3 ? settings.buyTargetPercentUnder3DisplayLots
    : displayLotCount === 3 ? settings.buyTargetPercentFor3DisplayLots
    : displayLotCount === 4 ? settings.buyTargetPercentFor4DisplayLots
    : displayLotCount === 5 ? settings.buyTargetPercentFor5DisplayLots
    : settings.buyTargetPercentFor6OrMoreDisplayLots
  return {
    buy: basePrice == null ? null : basePrice * (1 - buyPercent / 100),
    sell: basePrice == null ? null : basePrice * (1 + settings.saleTargetPercent / 100),
  }
}

export function getTargetPricePosition(
  price: number | null | undefined,
  buyTarget: number | null | undefined,
  sellTarget: number | null | undefined
): number | null {
  if (price == null || buyTarget == null || sellTarget == null
    || !Number.isFinite(price) || !Number.isFinite(buyTarget) || !Number.isFinite(sellTarget)
    || price <= 0 || buyTarget <= 0 || sellTarget <= buyTarget) return null
  return Math.min(100, Math.max(0, (price - buyTarget) / (sellTarget - buyTarget) * 100))
}
