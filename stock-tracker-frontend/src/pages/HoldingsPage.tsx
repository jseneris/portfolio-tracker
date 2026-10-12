import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CashTransaction,
  getAllStockSplits,
  getCashTransactions,
  getHistoricalPrices,
  getStockTransactions,
  HistoricalPrice,
  PORTFOLIO_UPDATED_EVENT,
  StockSplitEvent,
  StockTransaction,
} from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'
import { calculatePortfolioSnapshot, calculatePortfolioValue } from '../portfolioSnapshot'
import { buildStockPerformance } from '../stockPerformance'

export type HoldingRow = {
  ticker: string
  shares: number
  price: number | null
  value: number | null
  performance: number | null
  initial: number | null
  result: number | null
  closed: boolean
}

export function sortHoldingsByResult(holdings: HoldingRow[], direction: 'asc' | 'desc'): HoldingRow[] {
  return [...holdings].sort((first, second) => {
    if (first.result == null && second.result == null) return first.ticker.localeCompare(second.ticker)
    if (first.result == null) return 1
    if (second.result == null) return -1
    return (direction === 'asc' ? first.result - second.result : second.result - first.result)
      || first.ticker.localeCompare(second.ticker)
  })
}

function toDateOnly(value: string): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : ''
}

function subtractDaysFromDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function formatShares(value: number) {
  return Number(value.toFixed(6)).toString()
}

function gainClassName(value: number | null) {
  if (value == null || !Number.isFinite(value)) return undefined
  return value > 0 ? 'value-positive' : value < 0 ? 'value-negative' : undefined
}

function formatResult(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatCurrency2(Math.abs(value))}`
}

function formatDateTime(value: Date | null) {
  return value ? value.toLocaleString() : 'Never'
}

export default function HoldingsPage() {
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().slice(0, 10))
  const [draftSnapshotDate, setDraftSnapshotDate] = useState(snapshotDate)
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([])
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPrice[]>([])
  const [splitEvents, setSplitEvents] = useState<StockSplitEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [showClosedHoldings, setShowClosedHoldings] = useState(false)
  const [resultSortDirection, setResultSortDirection] = useState<'asc' | 'desc' | null>(null)

  async function loadHoldings() {
    setLoading(true)
    setError(null)

    try {
      const [transactionsResult, cashTransactionsResult, splitEventsResult] = await Promise.all([
        getStockTransactions(),
        getCashTransactions(),
        getAllStockSplits(),
      ])
      const earliestTransactionDate = transactionsResult.reduce((earliest, transaction) => {
        const transactionDate = toDateOnly(transaction.transactionDate)
        return transactionDate && (!earliest || transactionDate < earliest) ? transactionDate : earliest
      }, '')
      const historicalStartDate = earliestTransactionDate
        ? subtractDaysFromDateOnly(earliestTransactionDate, 14)
        : snapshotDate
      const pricesResult = transactionsResult.length > 0
        ? await getHistoricalPrices(historicalStartDate, snapshotDate)
        : []

      setStockTransactions(transactionsResult)
      setCashTransactions(cashTransactionsResult)
      setSplitEvents(splitEventsResult)
      setHistoricalPrices(pricesResult)
      setLastUpdatedAt(new Date())
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load historical holdings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadHoldings()
  }, [snapshotDate])

  function applySnapshotDate() {
    if (draftSnapshotDate && draftSnapshotDate !== snapshotDate) {
      setSnapshotDate(draftSnapshotDate)
    }
  }

  useEffect(() => {
    const handlePortfolioUpdated = () => {
      void loadHoldings()
    }

    window.addEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
    return () => window.removeEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
  }, [])

  const snapshot = useMemo(() => {
    const coreSnapshot = calculatePortfolioSnapshot({
      stockTransactions,
      cashTransactions,
      historicalPrices,
      splitEvents,
      snapshotDate,
    })
    const startDate = stockTransactions.reduce((earliest, transaction) => {
      const date = toDateOnly(transaction.transactionDate)
      return date && date < earliest ? date : earliest
    }, snapshotDate)
    const performance = buildStockPerformance({
      transactions: stockTransactions,
      historicalPrices,
      splitEvents,
      startDate,
      endDate: snapshotDate,
    })
    const lastPoint = performance.points[performance.points.length - 1]
    const activeHoldings = new Map(coreSnapshot.holdings.map((holding) => [holding.ticker, holding]))
    const tickers = [...new Set([...activeHoldings.keys(), ...performance.tickers])].sort()

    return {
      holdings: tickers.map((ticker): HoldingRow => {
        const holding = activeHoldings.get(ticker)
        const gain = lastPoint?.gains[ticker] ?? null
        const initial = lastPoint && (lastPoint.initialBases[ticker] ?? 0) > 1e-6
          ? lastPoint.initialGains[ticker] : null
        return {
          ticker,
          shares: holding?.totalShares ?? 0,
          price: holding?.latestPrice ?? null,
          value: holding ? holding.marketValue : 0,
          performance: gain,
          initial,
          result: gain == null || initial == null ? null : gain - initial,
          closed: !holding,
        }
      }),
      availableCash: coreSnapshot.availableCash,
      holdingsMarketValue: coreSnapshot.holdingsMarketValue,
      portfolioValue: calculatePortfolioValue(coreSnapshot.availableCash, coreSnapshot.holdingsMarketValue),
    }
  }, [cashTransactions, historicalPrices, snapshotDate, splitEvents, stockTransactions])
  const visibleHoldings = useMemo(() => {
    const holdings = snapshot.holdings.filter((holding) => showClosedHoldings || !holding.closed)
    return resultSortDirection ? sortHoldingsByResult(holdings, resultSortDirection) : holdings
  }, [snapshot.holdings, showClosedHoldings, resultSortDirection])

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Holdings</h2>
          <p>Portfolio holdings and values for the selected date.</p>
        </div>
        <div className="stack-right">
          <div className="inline-actions">
            <label>
              Date
              <input
                type="date"
                min="1980-01-01"
                max={new Date().toISOString().slice(0, 10)}
                value={draftSnapshotDate}
                onChange={(event) => setDraftSnapshotDate(event.target.value)}
                onBlur={applySnapshotDate}
                disabled={loading}
                style={{ marginLeft: '0.5rem' }}
              />
            </label>
            <button className="button" type="button" onClick={() => void loadHoldings()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <small>Last updated: {formatDateTime(lastUpdatedAt)}</small>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}

      {loading ? (
        <>
          <div className="panel skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="panel">Loading holdings...</div>
        </>
      ) : (
        <>
          <div className="panel">
            <h3>Summary</h3>
            <div className="stat-grid">
              <div className="stat"><div className="label">Portfolio Value</div><div className="value">{formatCurrency2(snapshot.portfolioValue)}</div></div>
              <div className="stat"><div className="label">Available Cash</div><div className="value">{formatCurrency2(snapshot.availableCash)}</div></div>
              <div className="stat"><div className="label">Holdings Market Value</div><div className="value">{formatCurrency2(snapshot.holdingsMarketValue)}</div></div>
            </div>
          </div>

          <div className="panel">
            <div className="row-between">
              <h3>Holdings</h3>
              <button className="button" type="button" aria-pressed={showClosedHoldings}
                onClick={() => setShowClosedHoldings((current) => !current)}>
                {showClosedHoldings ? 'Hide closed holdings' : 'Show closed holdings'}
              </button>
            </div>
            <p>Performance is the all-time dollar gain/loss through the selected date, including realized gains and reinvested dividends. Initial is the buy-and-hold dollar gain/loss of purchases marked as Initial Purchases, excluding later sales and reinvested dividends. Result is Performance minus Initial. Positive gains are green, losses are red, and unavailable values are shown as --.</p>
            {visibleHoldings.length === 0 ? (
              <p>{showClosedHoldings ? 'No holdings for this date.' : 'No active holdings for this date.'}</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Stock Ticker</th>
                    <th>Shares</th>
                    <th>Price</th>
                    <th>Value</th>
                    <th>Performance</th>
                    <th>Initial</th>
                    <th aria-sort={resultSortDirection === 'asc' ? 'ascending' : resultSortDirection === 'desc' ? 'descending' : 'none'}>
                      <button className="link-button" type="button"
                        onClick={() => setResultSortDirection((current) => current === 'desc' ? 'asc' : 'desc')}>
                        Result{resultSortDirection ? ` (${resultSortDirection === 'asc' ? 'ascending' : 'descending'})` : ''}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHoldings.map((holding) => (
                    <tr key={holding.ticker}>
                      <td><Link className="link-button" to={`/stocks/${encodeURIComponent(holding.ticker)}`}>{holding.ticker}</Link>{holding.closed ? ' (Closed)' : ''}</td>
                      <td>{formatShares(holding.shares)}</td>
                      <td>{formatStockPrice4(holding.price)}</td>
                      <td>{formatCurrency2(holding.value)}</td>
                      <td className={gainClassName(holding.performance)}><strong>{formatCurrency2(holding.performance)}</strong></td>
                      <td className={gainClassName(holding.initial)}><strong>{formatCurrency2(holding.initial)}</strong></td>
                      <td className={gainClassName(holding.result)}><strong>{formatResult(holding.result)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  )
}