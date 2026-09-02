import { CashTransaction, HistoricalPrice, StockSplitEvent, StockTransaction } from './api'

const HOLDING_TOLERANCE = 1e-6

function toDateOnly(value: string): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : ''
}

export type PortfolioSnapshotHolding = {
  ticker: string
  totalShares: number
  latestPrice: number | null
  marketValue: number | null
}

export type PortfolioSnapshot = {
  holdings: PortfolioSnapshotHolding[]
  availableCash: number
  cashBasis: number
  adjustments: number
  holdingsMarketValue: number | null
  stockValue: number | null
  portfolioValue: number | null
  stockCount: number
}

export function calculatePortfolioValue(availableCash: number, holdingsMarketValue: number | null): number | null {
  return holdingsMarketValue == null ? null : availableCash + holdingsMarketValue
}

export function createSplitMultiplierResolver(splitEvents: StockSplitEvent[], snapshotDate: string) {
  const activeSplits = splitEvents
    .filter((split) => split.isActive !== false)
    .map((split) => ({
      ticker: String(split.ticker || '').toUpperCase(),
      splitDate: toDateOnly(split.splitDate),
      multiplier: Number(split.multiplier),
    }))
    .filter((split) => split.ticker && split.splitDate && Number.isFinite(split.multiplier) && split.multiplier > 0 && split.splitDate <= snapshotDate)

  return function getCumulativeSplitMultiplierForDate(ticker: string, transactionDate: string): number {
    let cumulativeMultiplier = 1
    const normalizedTicker = String(ticker || '').toUpperCase()

    for (const split of activeSplits) {
      if (split.ticker === normalizedTicker && transactionDate <= split.splitDate) {
        cumulativeMultiplier *= split.multiplier
      }
    }

    return cumulativeMultiplier
  }
}

export function calculatePortfolioSnapshot(args: {
  stockTransactions: StockTransaction[]
  cashTransactions: CashTransaction[]
  historicalPrices: HistoricalPrice[]
  splitEvents: StockSplitEvent[]
  snapshotDate: string
  currentPricesByTicker?: Record<string, number>
}): PortfolioSnapshot {
  const {
    stockTransactions,
    cashTransactions,
    historicalPrices,
    splitEvents,
    snapshotDate,
    currentPricesByTicker = {},
  } = args

  const holdingsByTicker = new Map<string, number>()
  const getCumulativeSplitMultiplierForDate = createSplitMultiplierResolver(splitEvents, snapshotDate)

  for (const transaction of stockTransactions) {
    const transactionDate = toDateOnly(transaction.transactionDate)
    const ticker = String(transaction.ticker || '').toUpperCase()
    const quantity = Number(transaction.quantity)
    const exchangeSourceQuantity = Number(transaction.exchangeSourceQuantity)
    const quantityToApply = transaction.type === 'exchange'
      ? exchangeSourceQuantity
      : quantity
    if (!transactionDate || transactionDate > snapshotDate || !ticker || !Number.isFinite(quantityToApply) || quantityToApply <= 0) {
      continue
    }

    const adjustedQuantity = quantityToApply * getCumulativeSplitMultiplierForDate(ticker, transactionDate)
    if (!Number.isFinite(adjustedQuantity) || adjustedQuantity <= 0) {
      continue
    }

    const currentShares = holdingsByTicker.get(ticker) ?? 0
    if (transaction.type === 'buy' || transaction.type === 'div') {
      holdingsByTicker.set(ticker, currentShares + adjustedQuantity)
    } else if (transaction.type === 'sell' || transaction.type === 'exchange') {
      holdingsByTicker.set(ticker, currentShares - adjustedQuantity)
    }
  }

  const priceByTicker = new Map<string, { date: string; price: number }>()
  for (const historicalPrice of historicalPrices) {
    const ticker = String(historicalPrice.ticker || '').toUpperCase()
    const priceDate = toDateOnly(historicalPrice.priceDate)
    const closePrice = Number(historicalPrice.closePrice)
    if (!ticker || !priceDate || priceDate > snapshotDate || !Number.isFinite(closePrice)) {
      continue
    }

    const existingPrice = priceByTicker.get(ticker)
    if (!existingPrice || priceDate > existingPrice.date) {
      priceByTicker.set(ticker, { date: priceDate, price: closePrice })
    }
  }

  for (const [ticker, price] of Object.entries(currentPricesByTicker)) {
    const normalizedTicker = String(ticker || '').toUpperCase()
    const currentPrice = Number(price)
    if (normalizedTicker && Number.isFinite(currentPrice) && currentPrice > 0) {
      priceByTicker.set(normalizedTicker, { date: snapshotDate, price: currentPrice })
    }
  }

  const holdings = Array.from(holdingsByTicker.entries())
    .map(([ticker, totalShares]) => ({ ticker, totalShares: Number(totalShares) }))
    .filter((holding) => Number.isFinite(holding.totalShares) && holding.totalShares > HOLDING_TOLERANCE)
    .sort((first, second) => first.ticker.localeCompare(second.ticker))
    .map((holding) => {
      const latestPrice = Number(priceByTicker.get(holding.ticker)?.price)
      const hasPrice = Number.isFinite(latestPrice)
      return {
        ...holding,
        latestPrice: hasPrice ? latestPrice : null,
        marketValue: hasPrice ? holding.totalShares * latestPrice : null,
      }
    })

  const deposits = cashTransactions
    .filter((transaction) => transaction.type === 'deposit' && toDateOnly(transaction.transactionDate) <= snapshotDate)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
  const withdrawals = cashTransactions
    .filter((transaction) => transaction.type === 'withdrawal' && toDateOnly(transaction.transactionDate) <= snapshotDate)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
  const interest = cashTransactions
    .filter((transaction) => transaction.type === 'interest' && toDateOnly(transaction.transactionDate) <= snapshotDate)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
  const fees = cashTransactions
    .filter((transaction) => transaction.type === 'fee' && toDateOnly(transaction.transactionDate) <= snapshotDate)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
  const buys = stockTransactions
    .filter((transaction) => transaction.type === 'buy'
      && transaction.isExchangeGenerated !== true
      && toDateOnly(transaction.transactionDate) <= snapshotDate)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)
  const sells = stockTransactions
    .filter((transaction) => transaction.type === 'sell' && toDateOnly(transaction.transactionDate) <= snapshotDate)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)

  const availableCash = deposits - withdrawals + interest - fees - buys + sells
  const cashBasis = deposits - withdrawals
  const adjustments = interest - fees
  const missingPrices = holdings.some((holding) => holding.latestPrice == null)
  const holdingsMarketValue = missingPrices
    ? null
    : holdings.reduce((sum, holding) => sum + Number(holding.marketValue || 0), 0)

  return {
    holdings,
    availableCash,
    cashBasis,
    adjustments,
    holdingsMarketValue,
    stockValue: holdingsMarketValue,
    portfolioValue: calculatePortfolioValue(availableCash, holdingsMarketValue),
    stockCount: holdings.length,
  }
}