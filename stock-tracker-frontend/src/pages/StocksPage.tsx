import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  StockTransaction,
  deleteStockTransaction,
  emitPortfolioUpdated,
  getStockTransactions,
} from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'

const SHARE_TOLERANCE = 1e-6

function formatNumber(value: number | null, digits = 4) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return Number(value).toFixed(digits)
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

function getPerformanceClassName(value: number) {
  if (value > 0) {
    return 'value-positive'
  }
  if (value < 0) {
    return 'value-negative'
  }
  return ''
}

export default function StocksPage() {
  const [allTransactions, setAllTransactions] = useState<StockTransaction[]>([])
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const closedHoldings = useMemo(() => {
    const sharesByTicker = new Map<string, number>()

    for (const transaction of allTransactions) {
      const quantity = Number(transaction.quantity)
      const exchangeSourceQuantity = Number(transaction.exchangeSourceQuantity)
      const exchangeQuantity = Number.isFinite(exchangeSourceQuantity) && exchangeSourceQuantity > 0
        ? exchangeSourceQuantity
        : 0
      const quantityToApply = transaction.type === 'exchange' ? exchangeQuantity : quantity
      if (!Number.isFinite(quantityToApply) || quantityToApply <= 0) {
        continue
      }

      const previous = sharesByTicker.get(transaction.ticker) ?? 0
      const next = transaction.type === 'sell'
        ? previous - quantityToApply
        : transaction.type === 'exchange'
          ? previous - quantityToApply
          : previous + quantityToApply
      sharesByTicker.set(transaction.ticker, next)
    }

    return Array.from(sharesByTicker.entries())
      .filter(([, shares]) => Math.abs(shares) <= SHARE_TOLERANCE)
      .map(([ticker]) => ticker)
      .sort((a, b) => a.localeCompare(b))
  }, [allTransactions])

  const closedHoldingsWithPerformance = useMemo(() => {
    const byTicker = new Map<string, { buyTotal: number; sellTotal: number }>()

    for (const transaction of allTransactions) {
      const ticker = String(transaction.ticker || '').toUpperCase()
      if (!ticker) {
        continue
      }

      const amount = Number(transaction.amount)
      const safeAmount = Number.isFinite(amount) ? amount : 0
      const existing = byTicker.get(ticker) ?? { buyTotal: 0, sellTotal: 0 }

      if (transaction.type === 'buy') {
        existing.buyTotal += safeAmount
      } else if (transaction.type === 'sell') {
        existing.sellTotal += safeAmount
      }

      byTicker.set(ticker, existing)
    }

    return closedHoldings.map((ticker) => {
      const totals = byTicker.get(ticker) ?? { buyTotal: 0, sellTotal: 0 }
      const salesPerformance = totals.sellTotal - totals.buyTotal
      return {
        ticker,
        salesPerformance,
      }
    })
  }, [allTransactions, closedHoldings])

  async function loadTransactions() {
    setLoading(true)
    setError(null)
    try {
      const result = await getStockTransactions()
      setAllTransactions(result)
      setTransactions(result.slice(0, 10))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load stock transactions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTransactions()
  }, [])

  async function onDeleteTransaction(id: string) {
    const confirmed = window.confirm('Delete this stock transaction?')
    if (!confirmed) return

    setError(null)
    setSuccess(null)
    try {
      await deleteStockTransaction(id)
      setSuccess('Transaction deleted.')
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete transaction.')
    }
  }

  return (
    <section>
      <div className="panel">
        <h2>Recent Transactions</h2>
        <p>Last 10 stock transactions. Click a ticker to view full history and add transactions.</p>
      </div>

      {success ? <div className="panel status status-success">{success}</div> : null}
      {error ? <div className="panel status status-error">{error}</div> : null}

      <div className="panel">
        <h3>Closed Holdings (0 Shares)</h3>
        <p>Tickers you no longer hold. Use links below to view full stock history.</p>
        {loading ? (
          <p>Loading closed holdings...</p>
        ) : closedHoldingsWithPerformance.length === 0 ? (
          <p>No closed holdings yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Sales Performance</th>
              </tr>
            </thead>
            <tbody>
              {closedHoldingsWithPerformance.map((holding) => (
                <tr key={holding.ticker}>
                  <td>
                    <Link className="link-button" to={`/stocks/${encodeURIComponent(holding.ticker)}`}>
                      {holding.ticker}
                    </Link>
                  </td>
                  <td className={getPerformanceClassName(holding.salesPerformance)}>
                    {formatCurrency2(holding.salesPerformance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        {loading ? (
          <p>Loading transactions...</p>
        ) : transactions.length === 0 ? (
          <p>No stock transactions yet. Click a ticker on the Dashboard to add one.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transactionDate)}</td>
                  <td>
                    <Link className="link-button" to={`/stocks/${encodeURIComponent(transaction.ticker)}`}>
                      {transaction.ticker}
                    </Link>
                  </td>
                  <td>{transaction.type}</td>
                  <td>{formatNumber(transaction.quantity, 6)}</td>
                  <td>{formatStockPrice4(transaction.price)}</td>
                  <td>{formatCurrency2(transaction.amount)}</td>
                  <td>
                    {!transaction.isDeletionLocked ? (
                      <button className="button button-danger" type="button" onClick={() => onDeleteTransaction(transaction.id)}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Stocks Page</div>    </section>
  )
}
