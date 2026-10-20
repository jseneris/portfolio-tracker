import { HistoricalPrice, StockSplitEvent, StockTransaction } from './api'

const SHARE_TOLERANCE = 1e-6

export type RedGreenPoint = {
  date: string
  up: number
  down: number
  unchanged: number
}

// Counts held tickers closing up/down versus their own previous stored close.
// Raw closes are normalized with cumulative split multipliers so splits do not register as drops.
export function buildRedGreenPoints(args: {
  transactions: StockTransaction[]
  historicalPrices: HistoricalPrice[]
  splitEvents: StockSplitEvent[]
  startDate: string
  endDate: string
}): RedGreenPoint[] {
  const { transactions, historicalPrices, splitEvents, startDate, endDate } = args

  // Saved rows can use a non-trading priceDate (weekend/holiday sync) that repeats the
  // prior session's close; key by marketDate so only actual trading sessions are plotted.
  const closesByDate = new Map<string, Map<string, number>>()
  for (const price of historicalPrices) {
    const date = String(price.marketDate || price.priceDate || '').slice(0, 10)
    const ticker = String(price.ticker || '').toUpperCase()
    const close = Number(price.closePrice)
    if (!date || date > endDate || !ticker || !Number.isFinite(close) || close <= 0) continue
    const closes = closesByDate.get(date) ?? new Map<string, number>()
    closes.set(ticker, close)
    closesByDate.set(date, closes)
  }

  const events = [
    ...transactions.map((transaction) => ({
      kind: 'transaction' as const, date: String(transaction.transactionDate || '').slice(0, 10), transaction,
    })),
    ...splitEvents
      .filter((split) => split.isActive !== false && Number.isFinite(split.multiplier) && split.multiplier > 0)
      .map((split) => ({ kind: 'split' as const, date: String(split.splitDate || '').slice(0, 10), split })),
  ]
    .filter((event) => event.date)
    .sort((first, second) => first.date.localeCompare(second.date)
      || (first.kind === second.kind ? 0 : first.kind === 'transaction' ? -1 : 1))

  const shares = new Map<string, number>()
  const multipliers = new Map<string, number>()
  const previousNormalizedClose = new Map<string, number>()
  const points: RedGreenPoint[] = []
  let eventIndex = 0

  for (const date of [...closesByDate.keys()].sort()) {
    while (eventIndex < events.length && events[eventIndex].date <= date) {
      const event = events[eventIndex++]
      if (event.kind === 'split') {
        const ticker = String(event.split.ticker || '').toUpperCase()
        multipliers.set(ticker, (multipliers.get(ticker) ?? 1) * event.split.multiplier)
        shares.set(ticker, (shares.get(ticker) ?? 0) * event.split.multiplier)
        continue
      }

      const { transaction } = event
      const ticker = String(transaction.ticker || '').toUpperCase()
      const quantity = Number(transaction.type === 'exchange' ? transaction.exchangeSourceQuantity : transaction.quantity)
      if (!ticker || !Number.isFinite(quantity) || quantity <= 0) continue
      const current = shares.get(ticker) ?? 0
      if (transaction.type === 'buy' || transaction.type === 'div') {
        shares.set(ticker, current + quantity)
      } else if (transaction.type === 'sell' || transaction.type === 'exchange') {
        shares.set(ticker, current - quantity)
      }
    }

    const closes = closesByDate.get(date)!
    if (date >= startDate) {
      const point: RedGreenPoint = { date, up: 0, down: 0, unchanged: 0 }
      for (const [ticker, close] of closes) {
        const previous = previousNormalizedClose.get(ticker)
        if ((shares.get(ticker) ?? 0) <= SHARE_TOLERANCE || previous == null) continue
        const change = close * (multipliers.get(ticker) ?? 1) - previous
        // Ignore floating-point noise from split normalization.
        if (Math.abs(change) <= previous * 1e-9) point.unchanged += 1
        else if (change > 0) point.up += 1
        else point.down += 1
      }
      points.push(point)
    }

    for (const [ticker, close] of closes) {
      previousNormalizedClose.set(ticker, close * (multipliers.get(ticker) ?? 1))
    }
  }

  return points
}
