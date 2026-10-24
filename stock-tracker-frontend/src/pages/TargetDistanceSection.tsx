import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAllStockSplits, getCurrentPrices, getDisplayLots, getHistoricalPrices,
  getPortfolioSummary, getStockTransactions, getTickerPreferences, getUserTargetSettings,
  type PortfolioReview,
} from '../api'
import { formatStockPrice4 } from '../formatters'
import { buildLatestBuyOrSellByTicker, calculateTickerTargets, getSplitAdjustedTargetBasePrice, normalizeTargetSettings } from '../targetPrices'
import { isUsMarketOpenNow } from './DashboardPage'

export type TargetDistanceInput = {
  ticker: string
  price: number | null
  buy: number | null
  sell: number | null
  priceLabel: string
}

export function getTargetDistanceRows(inputs: TargetDistanceInput[]) {
  return inputs.flatMap((input) => {
    const { price, buy, sell } = input
    if (price == null || buy == null || sell == null
      || !Number.isFinite(price) || !Number.isFinite(buy) || !Number.isFinite(sell)
      || price <= 0 || buy <= 0 || sell <= buy) return []
    const aboveBuy = (price - buy) / buy * 100
    const belowSell = (sell - price) / sell * 100
    const minimum = Math.min(aboveBuy, belowSell)
    // Allow only arithmetic roundoff at exact percentage boundaries.
    const tier = [30, 25, 20].find((threshold) => minimum >= threshold - 1e-10)
    return tier == null ? [] : [{ ...input, aboveBuy, belowSell, aboveBuyAmount: price - buy, belowSellAmount: sell - price, minimum, tier }]
  }).sort((a, b) => b.tier - a.tier || b.minimum - a.minimum || a.ticker.localeCompare(b.ticker))
}

type AcquisitionTiming = NonNullable<PortfolioReview['snapshot']['holdingReviewContext']>

export function TargetDistanceTable({ inputs, acquisitionTiming }: { inputs: TargetDistanceInput[]; acquisitionTiming?: AcquisitionTiming }) {
  const rows = getTargetDistanceRows(inputs)
  const timingByTicker = new Map(acquisitionTiming?.map((holding) => [holding.ticker.toUpperCase(), holding]))
  function timingLabel(ticker: string) {
    const holding = timingByTicker.get(ticker.toUpperCase())
    const days = holding?.daysUntilPriorAcquisitionWindowClears
    if (days == null) return 'Unknown'
    if (days === 0) return 'Prior window clear (0 days remaining)'
    return `Within prior acquisition window - ${days} ${days === 1 ? 'day' : 'days'} until clear${holding?.priorAcquisitionWindowClearsOn ? ` (${holding.priorAcquisitionWindowClearsOn})` : ''}`
  }
  return <>
    {[30, 25, 20].map((tier) => {
      const group = rows.filter((row) => row.tier === tier)
      return <div key={tier}>
        <h4>{tier === 30 ? '30% or more' : `${tier}% to under ${tier + 5}%`} from both targets ({group.length})</h4>
        {group.length ? <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Ticker</th><th>Price</th><th>Price as of</th><th>Buy target</th><th>Above buy target</th><th>Sell target</th><th>Below sell target</th><th>Prior acquisition window</th></tr></thead>
            <tbody>{group.map((row) => <tr key={row.ticker}>
              <td><Link to={`/stocks/${encodeURIComponent(row.ticker)}`}>{row.ticker}</Link></td>
              <td>{formatStockPrice4(row.price)}</td><td>{row.priceLabel}</td>
              <td>{formatStockPrice4(row.buy)}</td><td>{formatStockPrice4(row.aboveBuyAmount)} ({row.aboveBuy.toFixed(2)}%)</td>
              <td>{formatStockPrice4(row.sell)}</td><td>{formatStockPrice4(row.belowSellAmount)} ({row.belowSell.toFixed(2)}%)</td>
              <td>{timingLabel(row.ticker)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p>No qualifying tickers in this tier.</p>}
      </div>
    })}
  </>
}

export async function loadTargetDistances() {
  const [summary, transactions, rawSettings, displayLots, splits, preferences] = await Promise.all([
    getPortfolioSummary(), getStockTransactions(), getUserTargetSettings(),
    getDisplayLots(), getAllStockSplits(), getTickerPreferences(),
  ])
  const tickers = summary.stocks.filter((stock) => stock.totalShares > 0).map((stock) => stock.ticker.toUpperCase())
  if (!tickers.length) return { inputs: [], excluded: [], warning: null }
  const today = new Date().toISOString().slice(0, 10)
  const historical = await getHistoricalPrices(today, today, tickers, true)
  const prices = new Map<string, { price: number; priceLabel: string; date: string }>()
  for (const row of historical) {
    const ticker = row.ticker.toUpperCase()
    const date = row.priceDate.slice(0, 10)
    const existing = prices.get(ticker)
    if (date <= today && Number.isFinite(row.closePrice) && row.closePrice > 0
      && (!existing || date > existing.date)) {
      prices.set(ticker, { price: row.closePrice, priceLabel: `Stored close ${date}`, date })
    }
  }
  let warning: string | null = null
  if (isUsMarketOpenNow()) {
    try {
      const live = await getCurrentPrices(tickers)
      const liveTickers = new Set<string>()
      for (const row of live.prices) {
        if (Number.isFinite(row.price) && row.price > 0) {
          const ticker = row.ticker.toUpperCase()
          liveTickers.add(ticker)
          prices.set(ticker, { price: row.price, priceLabel: `Live ${row.asOf}`, date: row.asOf })
        }
      }
      const missing = tickers.filter((ticker) => !liveTickers.has(ticker))
      if (missing.length) warning = `Live prices unavailable for ${missing.join(', ')}; using stored closes where available.`
    } catch (err: unknown) {
      warning = `Live prices unavailable: ${err instanceof Error ? err.message : 'Unable to load quotes.'} Using stored closes where available.`
    }
  }
  const settings = normalizeTargetSettings(rawSettings)
  const latest = buildLatestBuyOrSellByTicker(transactions)
  const lotCounts = new Map<string, number>()
  for (const lot of displayLots) {
    const ticker = lot.ticker.toUpperCase()
    lotCounts.set(ticker, (lotCounts.get(ticker) || 0) + Number(lot.lotCount ?? lot.lots.length))
  }
  const preferencesByTicker = new Map(preferences.map((preference) => [preference.ticker.toUpperCase(), preference]))
  const inputs: TargetDistanceInput[] = tickers.map((ticker) => ({
    ticker,
    ...calculateTickerTargets(getSplitAdjustedTargetBasePrice(latest.get(ticker), splits, today),
      lotCounts.get(ticker) || 0, settings, preferencesByTicker.get(ticker)),
    price: prices.get(ticker)?.price ?? null,
    priceLabel: prices.get(ticker)?.priceLabel ?? 'Unavailable',
  }))
  const excluded = inputs.filter((row) => row.price == null || row.buy == null || row.sell == null
    || !Number.isFinite(row.buy) || !Number.isFinite(row.sell) || row.buy <= 0 || row.sell <= row.buy).map((row) => row.ticker)
  return { inputs, excluded, warning }
}

export default function TargetDistanceSection({ acquisitionTiming }: { acquisitionTiming?: AcquisitionTiming }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadTargetDistances>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await loadTargetDistances()
        if (!cancelled) { setResult(next); setError(null) }
      } catch (err: unknown) {
        if (!cancelled) { setResult(null); setError(err instanceof Error ? err.message : 'Unable to load target distances.') }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])
  return <section className="panel">
    <div className="row-between insights-section-heading">
      <h3>Distance from buy and sell targets</h3>
    </div>
    <p className="muted-text">Current holdings at least 20% above their buy target AND 20% below their sell target.
      Each percentage is measured from its target price. Each ticker appears once in its highest qualifying tier,
      based on the smaller of the two distances, largest first. Uses live prices during the regular US market session
      when available, otherwise the latest stored close. As of page load; reload the page to update.</p>
    <p className="muted-text">Prior acquisition timing uses the latest tracked buy or dividend reinvestment and clears on day 31.
      Zero means the prior window is clear, not confirmed wash-sale eligibility. Future purchases, outside accounts,
      and substantially identical securities remain unknown. Missing timing data is shown as Unknown.</p>
    {loading ? <p role="status">Loading target distances...</p> : null}
    {error ? <p className="status status-error" role="alert">{error}</p> : null}
    {result?.warning ? <p className="status status-warning" role="status">{result.warning}</p> : null}
    {result?.excluded.length ? <p className="status status-warning">Excluded (missing price or valid targets): {result.excluded.join(', ')}.</p> : null}
    {result ? <TargetDistanceTable inputs={result.inputs} acquisitionTiming={acquisitionTiming} /> : null}
  </section>
}
