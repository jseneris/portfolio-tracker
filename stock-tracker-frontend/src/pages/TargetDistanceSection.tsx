import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAllStockSplits, getCurrentPrices, getDisplayLots, getHistoricalPrices,
  getPortfolioSummary, getStockTransactions, getTickerPreferences, getUserTargetSettings,
  type PortfolioReview,
} from '../api'
import { formatStockPrice4 } from '../formatters'
import { getWaitDayClass } from '../reviewMessages'
import { buildLatestBuyOrSellByTicker, calculateTickerTargets, getSplitAdjustedTargetBasePrice, normalizeTargetSettings } from '../targetPrices'
import { isUsMarketOpenNow } from './DashboardPage'
import { TickerInfoBadges } from '../tickerBadges'

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
type OpenLots = PortfolioReview['snapshot']['openLots']
type ComparisonInput = TargetDistanceInput & { acquisitionDate?: string; quantity?: number; unitCost?: number; lossPercent?: number }

function isOverOneYearOld(purchaseDate: string, referenceDate = new Date().toISOString().slice(0, 10)) {
  const purchaseDay = Date.parse(`${purchaseDate.slice(0, 10)}T00:00:00Z`)
  const referenceDay = Date.parse(`${referenceDate.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(purchaseDay) || !Number.isFinite(referenceDay)) return false
  const anniversary = new Date(purchaseDay)
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  return referenceDay > anniversary.getTime()
}

function ComparisonTable({ rows, acquisitionTiming, showLots = false }: {
  rows: ComparisonInput[]; acquisitionTiming?: AcquisitionTiming; showLots?: boolean
}) {
  const timingByTicker = new Map(acquisitionTiming?.map((holding) => [holding.ticker.toUpperCase(), holding]))
  function timingLabel(ticker: string) {
    const days = timingByTicker.get(ticker.toUpperCase())?.daysUntilPriorAcquisitionWindowClears
    if (days == null) return 'Unknown'
    if (days === 0) return 'Clear'
    return `${days} days`
  }
  return <div className="table-scroll"><table className="table">
    <thead><tr><th>Ticker</th>
      {showLots ? <><th>Acquired</th><th>Shares</th><th>Purchase price</th><th>Loss</th></> : null}
      <th>Price</th><th>Buy target</th><th>Above buy target</th><th>Sell target</th><th>Below sell target</th><th>Prior acquisition window</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={`${row.ticker}-${index}`}>
      <td><Link className="link-button" to={`/stocks/${encodeURIComponent(row.ticker)}`}>{row.ticker}</Link><TickerInfoBadges ticker={row.ticker} /></td>
      {showLots ? <><td>{row.acquisitionDate?.slice(0, 10)}{row.acquisitionDate && isOverOneYearOld(row.acquisitionDate) ? (
        <> <span className="pill pill-long-term" title="Purchase is over one year old">1y+</span></>
      ) : null}</td><td>{row.quantity}</td>
        <td>{formatStockPrice4(row.unitCost)}</td><td className="value-negative">{row.lossPercent?.toFixed(2)}%</td></> : null}
      <td>{formatStockPrice4(row.price)}</td>
      <td>{formatStockPrice4(row.buy)}</td><td>{row.price != null && row.buy != null && row.buy > 0
        ? `${formatStockPrice4(row.price - row.buy)} (${((row.price - row.buy) / row.buy * 100).toFixed(2)}%)` : '--'}</td>
      <td>{formatStockPrice4(row.sell)}</td><td>{row.price != null && row.sell != null && row.sell > 0
        ? `${formatStockPrice4(row.sell - row.price)} (${((row.sell - row.price) / row.sell * 100).toFixed(2)}%)` : '--'}</td>
      <td style={{ fontWeight: 600 }} className={getWaitDayClass(timingByTicker.get(row.ticker.toUpperCase())?.daysUntilPriorAcquisitionWindowClears ?? null)}>{timingLabel(row.ticker)}</td>
    </tr>)}</tbody>
  </table></div>
}

export function TargetDistanceTable({ inputs, acquisitionTiming }: { inputs: TargetDistanceInput[]; acquisitionTiming?: AcquisitionTiming }) {
  const rows = getTargetDistanceRows(inputs)
  return <>
    {[30, 25, 20].map((tier) => {
      const group = rows.filter((row) => row.tier === tier)
      return <div key={tier}>
        <h5>{tier === 30 ? '30% or more' : `${tier}% to under ${tier + 5}%`} from both targets ({group.length})</h5>
        {group.length ? <ComparisonTable rows={group} acquisitionTiming={acquisitionTiming} /> : <p>No qualifying tickers in this tier.</p>}
      </div>
    })}
  </>
}

export function getLargeLossRows(inputs: TargetDistanceInput[], openLots: OpenLots) {
  const byTicker = new Map(inputs.map((input) => [input.ticker.toUpperCase(), input]))
  return openLots.flatMap((lot) => {
    const input = byTicker.get(lot.ticker.toUpperCase())
    if (lot.sourceType !== 'purchase' || !Number.isFinite(lot.quantity) || lot.quantity <= 0
      || !Number.isFinite(lot.unitCost) || lot.unitCost <= 0
      || input?.price == null || !Number.isFinite(input.price) || input.price <= 0) return []
    const lossPercent = (lot.unitCost - input.price) / lot.unitCost * 100
    // Exactly 50% belongs to the lower band; losses of 40% or less are excluded.
    const tier = lossPercent > 50 + 1e-10 ? 50 : lossPercent > 40 + 1e-10 ? 40 : null
    return tier == null ? [] : [{ ...input, acquisitionDate: lot.acquisitionDate, quantity: lot.quantity, unitCost: lot.unitCost, lossPercent, tier }]
  }).sort((a, b) => a.ticker.localeCompare(b.ticker)
    || b.lossPercent - a.lossPercent
    || a.acquisitionDate.localeCompare(b.acquisitionDate))
}

export function LargeLossTable({ inputs, openLots, acquisitionTiming }: {
  inputs: TargetDistanceInput[]; openLots: OpenLots; acquisitionTiming?: AcquisitionTiming
}) {
  const rows = getLargeLossRows(inputs, openLots)
  return <>{[50, 40].map((tier) => {
    const group = rows.filter((row) => row.tier === tier)
    return <div key={tier}>
      <h5>{tier === 50 ? 'More than 50% below purchase price'
        : 'More than 40% to 50% below purchase price'} ({group.length})</h5>
      {group.length ? <ComparisonTable rows={group} acquisitionTiming={acquisitionTiming} showLots />
        : <p>No qualifying purchase lots in this tier.</p>}
    </div>
  })}</>
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

export default function TargetDistanceSection({ acquisitionTiming, openLots = [] }: { acquisitionTiming?: AcquisitionTiming; openLots?: OpenLots }) {
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
  return <details className="panel review-collapsible">
    <summary><h3>Potential Sales</h3></summary>
    <div className="review-section-content">
    <h4>Distance from buy and sell targets</h4>
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
    {result?.excluded.length ? <p className="status status-warning">Excluded from distance tables (missing price or valid targets): {result.excluded.join(', ')}.</p> : null}
    {result ? <TargetDistanceTable inputs={result.inputs} acquisitionTiming={acquisitionTiming} /> : null}
    <h4>Large Losses</h4>
    <p className="muted-text">Remaining purchase lots more than 40% below their split-adjusted purchase price,
      largest percentage loss first. Dividend lots and fully sold lots are excluded. Uses the same current prices
      as the distance section; valid targets, holding yearly loss and display-lot counts are not required.</p>
    {result ? <LargeLossTable inputs={result.inputs} openLots={openLots} acquisitionTiming={acquisitionTiming} /> : null}
    </div>
  </details>
}
