import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  StockTransaction,
  deleteStockTransaction,
  emitPortfolioUpdated,
  getStockTransactions,
} from '../api'

function formatMoney(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return `$${Number(value).toFixed(2)}`
}

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

export default function StocksPage() {
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadTransactions() {
    setLoading(true)
    setError(null)
    try {
      const result = await getStockTransactions()
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
                    <Link className="link-button" to={/stocks/}>
                      {transaction.ticker}
                    </Link>
                  </td>
                  <td>{transaction.type}</td>
                  <td>{formatNumber(transaction.quantity, 6)}</td>
                  <td>{formatMoney(transaction.price)}</td>
                  <td>{formatMoney(transaction.amount)}</td>
                  <td>
                    <button className="button button-danger" type="button" onClick={() => onDeleteTransaction(transaction.id)}>
                      Delete
                    </button>
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
