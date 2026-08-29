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
    const holdingsByTicker = new Map<string, number>()
    const activeSplits = splitEvents
      .filter((split) => split.isActive !== false)
      .map((split) => ({
        ticker: String(split.ticker || '').toUpperCase(),
        date: toDateOnly(split.splitDate),
        multiplier: Number(split.multiplier),
      }))
      .filter((split) => split.ticker && split.date && split.date <= snapshotDate && split.multiplier > 0)

    function splitMultiplierFor(ticker: string, transactionDate: string): number {
      return activeSplits.reduce((multiplier, split) => (
        split.ticker === ticker && transactionDate <= split.date
          ? multiplier * split.multiplier
          : multiplier
      ), 1)
    }

    for (const transaction of stockTransactions) {
      const transactionDate = toDateOnly(transaction.transactionDate)
      const ticker = String(transaction.ticker || '').toUpperCase()
      const quantity = Number(transaction.quantity)
      if (!transactionDate || transactionDate > snapshotDate || !ticker || !Number.isFinite(quantity) || quantity <= 0) {
        continue
      }

      const adjustedQuantity = quantity * splitMultiplierFor(ticker, transactionDate)
      const currentShares = holdingsByTicker.get(ticker) ?? 0
      if (transaction.type === 'buy' || transaction.type === 'div') {
        holdingsByTicker.set(ticker, currentShares + adjustedQuantity)
      } else if (transaction.type === 'sell') {
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

    const holdings: HoldingRow[] = Array.from(holdingsByTicker.entries())
      .filter(([, shares]) => shares > 1e-6)
      .map(([ticker, shares]) => {
        const price = priceByTicker.get(ticker)?.price ?? null
        return {
          ticker,
          shares,
          price,
          value: price == null ? null : shares * price,
        }
      })
      .sort((first, second) => first.ticker.localeCompare(second.ticker))

    const cashFromCashTransactions = cashTransactions.reduce((total, transaction) => {
      const transactionDate = toDateOnly(transaction.transactionDate)
      const amount = Number(transaction.amount)
      if (!transactionDate || transactionDate > snapshotDate || !Number.isFinite(amount)) {
        return total
      }
      if (transaction.type === 'deposit' || transaction.type === 'interest') {
        return total + amount
      }
      return transaction.type === 'withdrawal' || transaction.type === 'fee' ? total - amount : total
    }, 0)

    const cashFromStockTransactions = stockTransactions.reduce((total, transaction) => {
      const transactionDate = toDateOnly(transaction.transactionDate)
      const amount = Number(transaction.amount)
      if (!transactionDate || transactionDate > snapshotDate || !Number.isFinite(amount)) {
        return total
      }
      if (transaction.type === 'buy') {
        return total - amount
      }
      return transaction.type === 'sell' ? total + amount : total
    }, 0)

    const stockValue = holdings.some((holding) => holding.value == null)
      ? null
      : holdings.reduce((total, holding) => total + (holding.value ?? 0), 0)
    const availableCash = cashFromCashTransactions + cashFromStockTransactions

    return {
      holdings,
      availableCash,
      stockValue,
      portfolioValue: stockValue == null ? null : availableCash + stockValue,
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