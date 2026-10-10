import { HistoricalPrice, StockSplitEvent, StockTransaction } from './api'

export type StockPerformancePoint = {
  date: string
  gains: Record<string, number | null>
  priceReturns: Record<string, number | null>
  initialBuysGain: number | null
  // Percentage denominators: value at period start plus buys made during the period.
  bases: Record<string, number | null>
  initialBuysBasis: number | null
}

export function getCombinedStockGain(point: Pick<StockPerformancePoint, 'gains'>, tickers: string[]): number | null {
  let total = 0
  for (const ticker of tickers) {
    const gain = point.gains[ticker]
    if (gain == null) return null
    total += gain
  }
  return total
}

export function getCombinedStockBasis(point: Pick<StockPerformancePoint, 'bases'>, tickers: string[]): number | null {
  let total = 0
  for (const ticker of tickers) {
    const basis = point.bases[ticker]
    if (basis == null) return null
    total += basis
  }
  return total
}

export function toGainPercent(gain: number | null, basis: number | null): number | null {
  if (gain == null || basis == null || !Number.isFinite(basis) || basis <= 1e-6) return null
  return (gain / basis) * 100
}

export function buildStockPerformance(args: {
  transactions: StockTransaction[]
  historicalPrices: HistoricalPrice[]
  splitEvents: StockSplitEvent[]
  startDate: string
  endDate: string
  includeInitialBuys?: boolean
}): { tickers: string[]; points: StockPerformancePoint[]; missingTickers: string[]; hasInitialBuys: boolean } {
  const { transactions, historicalPrices, splitEvents, startDate, endDate, includeInitialBuys = true } = args
  const baseline = new Date(`${startDate}T00:00:00Z`)
  baseline.setUTCDate(baseline.getUTCDate() - 1)
  const baselineDate = baseline.toISOString().slice(0, 10)
  const periodTransactions = transactions.filter((transaction) => transaction.transactionDate.slice(0, 10) <= endDate)
  const initialBuys = periodTransactions.filter((transaction) => includeInitialBuys && transaction.type === 'buy'
    && transaction.isInitialPurchase === true && transaction.isExchangeGenerated !== true)
  const tickers = [...new Set(periodTransactions.map((transaction) => transaction.ticker.toUpperCase()))].sort()
  const dates = new Set([baselineDate, endDate])
  for (const row of [...historicalPrices.map((price) => price.priceDate), ...periodTransactions.map((transaction) => transaction.transactionDate)]) {
    const date = row.slice(0, 10)
    if (date >= startDate && date <= endDate) dates.add(date)
  }

  const sortedPrices = [...historicalPrices].sort((first, second) => first.priceDate.localeCompare(second.priceDate))
  const latestPrices = new Map<string, HistoricalPrice>()
  const heldTickers = new Set<string>()
  let priceIndex = 0
  const activeSplits = splitEvents.filter((split) => split.isActive !== false
    && Number.isFinite(split.multiplier) && split.multiplier > 0)
  const events = [
    ...periodTransactions.map((transaction) => ({
      kind: 'transaction' as const, date: transaction.transactionDate.slice(0, 10), transaction,
    })),
    ...activeSplits.map((split) => ({ kind: 'split' as const, date: split.splitDate.slice(0, 10), split })),
  ].sort((first, second) => first.date.localeCompare(second.date)
    || (first.kind === second.kind ? 0 : first.kind === 'transaction' ? -1 : 1))
  const balances = new Map<string, {
    shares: number; invested: number; initialShares: number; initialInvested: number
    buyTotal: number; initialBuyTotal: number; lastSplitDate: string; splitMultiplier: number
  }>()
  for (const ticker of tickers) {
    balances.set(ticker, { shares: 0, invested: 0, initialShares: 0, initialInvested: 0, buyTotal: 0, initialBuyTotal: 0, lastSplitDate: '', splitMultiplier: 1 })
  }
  let eventIndex = 0
  for (const split of activeSplits) {
    const date = split.splitDate.slice(0, 10)
    if (date >= startDate && date <= endDate) dates.add(date)
  }

  function totalGains(date: string) {
    while (priceIndex < sortedPrices.length && sortedPrices[priceIndex].priceDate.slice(0, 10) <= date) {
      const price = sortedPrices[priceIndex++]
      latestPrices.set(price.ticker.toUpperCase(), price)
    }
    while (eventIndex < events.length && events[eventIndex].date <= date) {
      const event = events[eventIndex++]
      const ticker = (event.kind === 'split' ? event.split.ticker : event.transaction.ticker).toUpperCase()
      const balance = balances.get(ticker)
      if (!balance) continue
      if (event.date >= startDate && balance.shares > 1e-6) heldTickers.add(ticker)
      if (event.kind === 'split') {
        balance.shares *= event.split.multiplier
        balance.initialShares *= event.split.multiplier
        balance.splitMultiplier *= event.split.multiplier
        balance.lastSplitDate = event.date
        continue
      }
      const transaction = event.transaction
      const amount = Number(transaction.amount ?? 0)
      const quantity = Number(transaction.type === 'exchange' ? transaction.exchangeSourceQuantity : transaction.quantity)
      const isAcquisition = transaction.type === 'buy' || transaction.type === 'div'
      const isInitialBuy = includeInitialBuys && transaction.type === 'buy' && transaction.isInitialPurchase === true && transaction.isExchangeGenerated !== true
      // Reinvested dividends add shares without adding external capital.
      balance.invested += transaction.type === 'buy' ? amount : transaction.type === 'div' ? 0 : -amount
      if (transaction.type === 'buy' && Number.isFinite(amount)) balance.buyTotal += amount
      if (isInitialBuy) {
        balance.initialInvested += amount
        if (Number.isFinite(amount)) balance.initialBuyTotal += amount
      }
      if (Number.isFinite(quantity) && quantity > 0) {
        balance.shares += isAcquisition ? quantity : -quantity
        if (isInitialBuy) balance.initialShares += quantity
      }
      if (event.date >= startDate && balance.shares > 1e-6) heldTickers.add(ticker)
    }
    const gains: Record<string, number | null> = {}
    const initialGains: Record<string, number | null> = {}
    const values: Record<string, number | null> = {}
    const initialValues: Record<string, number | null> = {}
    const buyTotals: Record<string, number> = {}
    const initialBuyTotals: Record<string, number> = {}
    const prices: Record<string, number | null> = {}
    for (const [ticker, balance] of balances) {
      const quote = latestPrices.get(ticker)
      const quoteDate = (quote?.marketDate ?? quote?.priceDate ?? '').slice(0, 10)
      const usableQuote = quote != null && Number.isFinite(quote.closePrice) && quote.closePrice > 0 && balance.lastSplitDate <= quoteDate
      prices[ticker] = usableQuote ? quote.closePrice * balance.splitMultiplier : null
      function marketValue(shares: number): number | null {
        if (shares <= 1e-6) return 0
        return usableQuote && quote ? shares * quote.closePrice : null
      }
      function gain(shares: number, invested: number): number | null {
        const value = marketValue(shares)
        return value == null ? null : value - invested
      }
      gains[ticker] = gain(balance.shares, balance.invested)
      initialGains[ticker] = gain(balance.initialShares, balance.initialInvested)
      values[ticker] = marketValue(balance.shares)
      initialValues[ticker] = marketValue(balance.initialShares)
      buyTotals[ticker] = balance.buyTotal
      initialBuyTotals[ticker] = balance.initialBuyTotal
    }
    return { gains, initialGains, values, initialValues, buyTotals, initialBuyTotals, prices }
  }

  const {
    gains: baselineGains, initialGains: baselineInitialGains,
    values: baselineValues, initialValues: baselineInitialValues,
    buyTotals: baselineBuyTotals, initialBuyTotals: baselineInitialBuyTotals,
    prices: baselinePrices,
  } = totalGains(baselineDate)
  for (const [ticker, balance] of balances) {
    if (balance.shares > 1e-6) heldTickers.add(ticker)
  }
  const missingTickers = new Set<string>()
  const points = [...dates].sort().map((date) => {
    const { gains, initialGains, buyTotals, initialBuyTotals, prices } = totalGains(date)
    const bases: Record<string, number | null> = {}
    const initialBases: Record<string, number | null> = {}
    const priceReturns: Record<string, number | null> = {}
    for (const ticker of tickers) {
      // Use the prior close, or the opening day's close if no prior quote exists.
      if (date === startDate && baselinePrices[ticker] == null) baselinePrices[ticker] = prices[ticker]
      const openingPrice = baselinePrices[ticker]
      const currentPrice = prices[ticker]
      priceReturns[ticker] = openingPrice == null || currentPrice == null
        ? null
        : toGainPercent(currentPrice - openingPrice, openingPrice)
      if (date >= startDate && priceReturns[ticker] == null) missingTickers.add(ticker)
      const baselineValue = baselineValues[ticker]
      bases[ticker] = baselineValue == null ? null : baselineValue + (buyTotals[ticker] - baselineBuyTotals[ticker])
      const baselineInitialValue = baselineInitialValues[ticker]
      initialBases[ticker] = baselineInitialValue == null
        ? null
        : baselineInitialValue + (initialBuyTotals[ticker] - baselineInitialBuyTotals[ticker])
      const gain = gains[ticker]
      const baselineGain = baselineGains[ticker]
      if (gain == null || baselineGain == null) {
        gains[ticker] = null
        missingTickers.add(ticker)
      } else {
        gains[ticker] = gain - baselineGain
      }
      const initialGain = initialGains[ticker]
      const baselineInitialGain = baselineInitialGains[ticker]
      if (initialGain == null || baselineInitialGain == null) {
        initialGains[ticker] = null
        missingTickers.add(ticker)
      } else {
        initialGains[ticker] = initialGain - baselineInitialGain
      }
    }
    return {
      date,
      gains,
      priceReturns,
      initialGains,
      bases,
      initialBases,
    }
  })
  const visibleTickers = tickers.filter((ticker) => heldTickers.has(ticker))
  return {
    tickers: visibleTickers,
    points: points.map(({ initialGains, initialBases, ...point }) => ({
      ...point,
      initialBuysGain: getCombinedStockGain({ gains: initialGains }, visibleTickers),
      initialBuysBasis: getCombinedStockBasis({ bases: initialBases }, visibleTickers),
    })),
    missingTickers: visibleTickers.filter((ticker) => missingTickers.has(ticker)),
    hasInitialBuys: initialBuys.some((transaction) => heldTickers.has(transaction.ticker.toUpperCase())),
  }
}
