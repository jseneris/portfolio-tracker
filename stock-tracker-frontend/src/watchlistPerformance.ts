import type { WatchlistItem, WatchlistPrice } from './api'

export type WatchlistLine = {
  id: string
  label: string
  color: string
  points: { date: string; value: number }[]
}

export function buildWatchlistPoints(
  item: WatchlistItem, prices: WatchlistPrice[], periodStart: string, periodEnd: string
): { date: string; value: number }[] {
  const quotes = prices.filter((quote) => quote.date >= item.startDate && Number.isFinite(quote.close) && quote.close > 0)
    .sort((first, second) => first.date.localeCompare(second.date))
  const baseline = quotes[0]
  if (!baseline || baseline.date > periodEnd) return []
  const start = periodStart > baseline.date ? periodStart : baseline.date
  const visible = quotes.filter((quote) => quote.date >= start && quote.date <= periodEnd)
  const priorQuotes = quotes.filter((quote) => quote.date <= start)
  const prior = priorQuotes[priorQuotes.length - 1]
  if (prior && !visible.some((quote) => quote.date === start)) visible.unshift({ ...prior, date: start })
  const last = visible[visible.length - 1]
  if (last && last.date < periodEnd) visible.push({ ...last, date: periodEnd })
  return visible.map((quote) => ({ date: quote.date, value: (quote.close / baseline.close - 1) * 100 }))
}
