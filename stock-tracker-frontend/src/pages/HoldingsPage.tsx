import { useEffect, useMemo, useState } from 'react'
import {
  Lot,
  PortfolioSummary,
  StockTransaction,
  getLotsByTicker,
  getPortfolioSummary,
  getStockTransactionsByTicker,
} from '../api'

function formatMoney(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return `$${Number(value).toFixed(2)}`
}

function formatNumber(value: number | null, digits = 6) {
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

export default function HoldingsPage() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [selectedTicker, setSelectedTicker] = useState<string>('')
  const [lots, setLots] = useState<Lot[]>([])
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tickers = useMemo(() => {
    return (portfolio?.stocks ?? []).map((stock) => stock.ticker)
  }, [portfolio])

  async function loadPortfolio() {
    setLoading(true)
    setError(null)
    try {
      const data = await getPortfolioSummary()
      setPortfolio(data)
      if (data.stocks.length > 0 && !selectedTicker) {
        setSelectedTicker(data.stocks[0].ticker)
      }
      if (data.stocks.length === 0) {
        setSelectedTicker('')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load holdings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPortfolio()
  }, [])

  useEffect(() => {
    if (!selectedTicker) {
      setLots([])
      setTransactions([])
      return
    }

    let cancelled = false

    async function loadTickerDetails() {
      setDetailsLoading(true)
      setError(null)
      try {
        const [lotsResult, txResult] = await Promise.all([
          getLotsByTicker(selectedTicker),
          getStockTransactionsByTicker(selectedTicker),
        ])
        if (!cancelled) {
          setLots(lotsResult)
          setTransactions(txResult)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load ticker details.')
        }
      } finally {
        if (!cancelled) {
          setDetailsLoading(false)
        }
      }
    }

    loadTickerDetails()

    return () => {
      cancelled = true
    }
  }, [selectedTicker])

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Holdings (MVP)</h2>
          <p>Review per-ticker lot details and transaction history.</p>
        </div>
        <button className="button" type="button" onClick={loadPortfolio} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}

      {loading ? <div className="panel">Loading holdings...</div> : null}

      {!loading && (portfolio?.stocks.length ?? 0) === 0 ? (
        <div className="panel">No active holdings yet. Add buy or dividend transactions first.</div>
      ) : null}

      {!loading && (portfolio?.stocks.length ?? 0) > 0 ? (
        <>
          <div className="panel">
            <label className="stacked-label">
              Ticker
              <select value={selectedTicker} onChange={(event) => setSelectedTicker(event.target.value)}>
                {tickers.map((ticker) => (
                  <option key={ticker} value={ticker}>
                    {ticker}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="panel">
            <h3>Open Lots</h3>
            {detailsLoading ? (
              <p>Loading lots...</p>
            ) : lots.length === 0 ? (
              <p>No open lots for {selectedTicker}.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Lot Id</th>
                    <th>Source</th>
                    <th>Purchase Date</th>
                    <th>Original</th>
                    <th>Remaining</th>
                    <th>Unit Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot) => (
                    <tr key={lot.id}>
                      <td className="mono">{lot.id.slice(0, 8)}...</td>
                      <td>{lot.sourceType}</td>
                      <td>{formatDate(lot.purchaseDate)}</td>
                      <td>{formatNumber(lot.originalQuantity)}</td>
                      <td>{formatNumber(lot.remainingQuantity)}</td>
                      <td>{formatMoney(lot.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <h3>Transactions ({selectedTicker})</h3>
            {detailsLoading ? (
              <p>Loading transactions...</p>
            ) : transactions.length === 0 ? (
              <p>No transactions recorded for {selectedTicker}.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{formatDate(transaction.transactionDate)}</td>
                      <td>{transaction.type}</td>
                      <td>{formatNumber(transaction.quantity)}</td>
                      <td>{formatMoney(transaction.price)}</td>
                      <td>{formatMoney(transaction.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
