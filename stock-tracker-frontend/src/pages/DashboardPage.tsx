import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CreateStockInput,
  PORTFOLIO_UPDATED_EVENT,
  PortfolioSummary,
  createStockTransaction,
  emitPortfolioUpdated,
  getPortfolioSummary,
} from '../api'

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`
}

type AddStockFormState = {
  ticker: string
  shares: string
  price: string
  transactionDate: string
}

const EMPTY_ADD_STOCK_FORM: AddStockFormState = {
  ticker: '',
  shares: '',
  price: '',
  transactionDate: new Date().toISOString().slice(0, 10),
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function formatShares(value: number) {
  return value.toFixed(6)
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return 'Never'
  }
  return value.toLocaleString()
}

export default function DashboardPage() {
  const [data, setData] = useState<PortfolioSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addStockError, setAddStockError] = useState<string | null>(null)
  const [addStockSaving, setAddStockSaving] = useState(false)
  const [showAddStockModal, setShowAddStockModal] = useState(false)
  const [addStockForm, setAddStockForm] = useState<AddStockFormState>(EMPTY_ADD_STOCK_FORM)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

  const buyShares = Number(addStockForm.shares)
  const buyPrice = Number(addStockForm.price)
  const buyTotalCost = Number.isFinite(buyShares) && Number.isFinite(buyPrice)
    ? buyShares * buyPrice
    : NaN
  const hasInsufficientCashForBuy = Boolean(
    data && Number.isFinite(buyTotalCost) && buyTotalCost > Number(data.availableCash)
  )

  async function loadSummary(backgroundRefresh = false) {
    if (backgroundRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const summary = await getPortfolioSummary()
      setData(summary)
      setLastUpdatedAt(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load summary')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadSummary()

    const handlePortfolioUpdated = () => {
      loadSummary(true)
    }

    window.addEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)

    return () => {
      window.removeEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
    }
  }, [])

  function openAddStockModal() {
    setAddStockError(null)
    setAddStockForm(EMPTY_ADD_STOCK_FORM)
    setShowAddStockModal(true)
  }

  function closeAddStockModal() {
    setShowAddStockModal(false)
    setAddStockSaving(false)
    setAddStockError(null)
    setAddStockForm(EMPTY_ADD_STOCK_FORM)
  }

  function validateAddStockForm(form: AddStockFormState): string | null {
    const ticker = normalizeTicker(form.ticker)
    if (!ticker) {
      return 'Ticker is required.'
    }

    const shares = Number(form.shares)
    if (!Number.isFinite(shares) || shares <= 0) {
      return 'Shares must be greater than 0.'
    }

    const price = Number(form.price)
    if (!Number.isFinite(price) || price <= 0) {
      return 'Price must be greater than 0.'
    }

    if (!form.transactionDate) {
      return 'Date is required.'
    }

    const selectedDate = new Date(form.transactionDate)
    if (Number.isNaN(selectedDate.getTime())) {
      return 'Date is invalid.'
    }

    const now = new Date()
    const selectedUtc = Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate())
    const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    if (selectedUtc > nowUtc) {
      return 'Date cannot be in the future.'
    }

    return null
  }

  async function onAddStockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAddStockError(null)

    const validationError = validateAddStockForm(addStockForm)
    if (validationError) {
      setAddStockError(validationError)
      return
    }

    const payload: CreateStockInput = {
      ticker: normalizeTicker(addStockForm.ticker),
      type: 'buy',
      quantity: Number(addStockForm.shares),
      price: Number(addStockForm.price),
      transactionDate: new Date(addStockForm.transactionDate).toISOString(),
    }

    const availableCash = Number(data?.availableCash)
    const buyCost = Number(payload.quantity || 0) * Number(payload.price || 0)
    if (Number.isFinite(availableCash) && Number.isFinite(buyCost) && buyCost > availableCash) {
      setAddStockError(
        `Insufficient available cash. Buy requires ${formatMoney(buyCost)} but only ${formatMoney(availableCash)} is available.`
      )
      return
    }

    setAddStockSaving(true)
    try {
      await createStockTransaction(payload)
      emitPortfolioUpdated()
      await loadSummary(true)
      closeAddStockModal()
    } catch (err: unknown) {
      setAddStockError(err instanceof Error ? err.message : 'Unable to add stock.')
      setAddStockSaving(false)
    }
  }

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Dashboard (MVP)</h2>
          <p>Portfolio summary from a single backend endpoint. Refreshes after cash and stock mutations.</p>
        </div>
        <div className="stack-right">
          <div className="inline-actions">
            <button className="button button-primary" type="button" onClick={openAddStockModal}>
              Add Stock
            </button>
            <button className="button" type="button" onClick={() => loadSummary(true)} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
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
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="panel">Loading summary...</div>
        </>
      ) : null}

      {!loading && data ? (
        <>
          <div className="panel stat-grid">
            <div className="stat"><div className="label">Available Cash</div><div className="value">{formatMoney(data.availableCash)}</div></div>
            <div className="stat"><div className="label">Cash Basis</div><div className="value">{formatMoney(data.cashBasis)}</div></div>
            <div className="stat"><div className="label">Adjustments</div><div className="value">{formatMoney(data.adjustments)}</div></div>
            <div className="stat"><div className="label">Stock Cost Basis</div><div className="value">{formatMoney(data.totalStockCostBasis)}</div></div>
            <div className="stat"><div className="label">Stock Count</div><div className="value">{data.stockCount}</div></div>
          </div>

          <div className="panel">
            <h3>Holdings</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Total Shares</th>
                  <th>Cost Basis</th>
                  <th>Lots</th>
                </tr>
              </thead>
              <tbody>
                {data.stocks.map((row) => (
                  <tr key={row.ticker}>
                    <td>
                      <Link className="link-button" to={`/stocks/${encodeURIComponent(row.ticker)}`}>
                        {row.ticker}
                      </Link>
                    </td>
                    <td>{formatShares(row.totalShares)}</td>
                    <td>{formatMoney(row.costBasis)}</td>
                    <td>{row.lotCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {showAddStockModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-stock-title">
          <div className="modal-card">
            <h3 id="add-stock-title">Add Stock</h3>
            <p>Create a buy transaction with ticker, shares, and price.</p>

            <form className="form-grid" onSubmit={onAddStockSubmit}>
              <label>
                Date
                <input
                  type="date"
                  min="1980-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={addStockForm.transactionDate}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, transactionDate: event.target.value }))}
                  disabled={addStockSaving}
                />
              </label>

              <label>
                Stock Ticker
                <input
                  type="text"
                  placeholder="AAPL"
                  value={addStockForm.ticker}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, ticker: event.target.value.toUpperCase() }))}
                  disabled={addStockSaving}
                />
              </label>

              <label>
                Shares
                <input
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={addStockForm.shares}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, shares: event.target.value }))}
                  disabled={addStockSaving}
                />
              </label>

              <label>
                Price
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={addStockForm.price}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, price: event.target.value }))}
                  disabled={addStockSaving}
                />
              </label>

              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={addStockSaving || hasInsufficientCashForBuy}>
                  {addStockSaving ? 'Saving...' : 'Add Stock'}
                </button>
                <button className="button" type="button" onClick={closeAddStockModal} disabled={addStockSaving}>
                  Cancel
                </button>
              </div>
            </form>

            {hasInsufficientCashForBuy ? (
              <div className="status status-error">
                Insufficient available cash. Buy requires {formatMoney(buyTotalCost)} and available cash is {formatMoney(Number(data?.availableCash || 0))}.
              </div>
            ) : null}
            {addStockError ? <div className="status status-error">{addStockError}</div> : null}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Dashboard Page</div>
    </section>
  )
}
