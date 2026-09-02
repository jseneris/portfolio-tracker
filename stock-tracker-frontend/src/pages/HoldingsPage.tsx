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
import { calculatePortfolioSnapshot } from '../portfolioSnapshot'

type HoldingRow = {
  ticker: string
  shares: number
  price: number | null
  value: number | null
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

    return {
      holdings: coreSnapshot.holdings.map((holding): HoldingRow => ({
        ticker: holding.ticker,
        shares: holding.totalShares,
        price: holding.latestPrice,
        value: holding.marketValue,
      })),
      availableCash: coreSnapshot.availableCash,
      stockValue: coreSnapshot.stockValue,
      portfolioValue: coreSnapshot.portfolioValue,
    }
  }, [cashTransactions, historicalPrices, snapshotDate, splitEvents, stockTransactions])

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
              <div className="stat"><div className="label">Stock Value</div><div className="value">{formatCurrency2(snapshot.stockValue)}</div></div>
            </div>
          </div>

          <div className="panel">
            <h3>Holdings</h3>
            {snapshot.holdings.length === 0 ? (
              <p>No active holdings for this date.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Stock Ticker</th>
                    <th>Shares</th>
                    <th>Price</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.holdings.map((holding) => (
                    <tr key={holding.ticker}>
                      <td><Link className="link-button" to={`/stocks/${encodeURIComponent(holding.ticker)}`}>{holding.ticker}</Link></td>
                      <td>{formatShares(holding.shares)}</td>
                      <td>{formatStockPrice4(holding.price)}</td>
                      <td>{formatCurrency2(holding.value)}</td>
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