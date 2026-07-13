import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  CreateStockInput,
  Lot,
  StockTransaction,
  StockTransactionType,
  createStockTransaction,
  emitPortfolioUpdated,
  getLotsByTicker,
  getStockTransactions,
} from '../api'

type StockFormState = {
  ticker: string
  type: StockTransactionType
  quantity: string
  price: string
  transactionDate: string
}

const ALLOCATION_TOLERANCE = 1e-6

const EMPTY_STOCK_FORM: StockFormState = {
  ticker: '',
  type: 'buy',
  quantity: '',
  price: '',
  transactionDate: new Date().toISOString().slice(0, 10),
}

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
  return date.toLocaleDateString()
}

function toUpperTicker(value: string) {
  return value.trim().toUpperCase()
}

function validateStockForm(form: StockFormState): string | null {
  if (!toUpperTicker(form.ticker)) {
    return 'Ticker is required.'
  }

  const quantity = Number(form.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 'Quantity must be greater than 0.'
  }

  const price = Number(form.price)
  if (!Number.isFinite(price) || price <= 0) {
    return 'Price must be greater than 0.'
  }

  if (!form.transactionDate) {
    return 'Transaction date is required.'
  }

  const selectedDate = new Date(form.transactionDate)
  if (Number.isNaN(selectedDate.getTime())) {
    return 'Transaction date is invalid.'
  }

  const now = new Date()
  const selectedUtc = Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate())
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (selectedUtc > nowUtc) {
    return 'Transaction date cannot be in the future.'
  }

  return null
}

export default function StocksPage() {
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [form, setForm] = useState<StockFormState>(EMPTY_STOCK_FORM)
  const [availableLots, setAvailableLots] = useState<Lot[]>([])
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [loadingTransactions, setLoadingTransactions] = useState(true)
  const [loadingLots, setLoadingLots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isSell = form.type === 'sell'
  const normalizedTicker = useMemo(() => toUpperTicker(form.ticker), [form.ticker])

  const allocationTotal = useMemo(() => {
    return Object.values(allocations).reduce((sum, value) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? sum + parsed : sum
    }, 0)
  }, [allocations])

  const quantityValue = Number(form.quantity)
  const allocationMatches = Number.isFinite(quantityValue)
    ? Math.abs(allocationTotal - quantityValue) <= ALLOCATION_TOLERANCE
    : false

  async function loadTransactions() {
    setLoadingTransactions(true)
    try {
      const result = await getStockTransactions()
      setTransactions(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load stock transactions.')
    } finally {
      setLoadingTransactions(false)
    }
  }

  useEffect(() => {
    loadTransactions()
  }, [])

  useEffect(() => {
    if (!isSell || !normalizedTicker) {
      setAvailableLots([])
      setAllocations({})
      return
    }

    let cancelled = false

    async function loadLots() {
      setLoadingLots(true)
      try {
        const lots = await getLotsByTicker(normalizedTicker)
        if (!cancelled) {
          setAvailableLots(lots)
          setAllocations((prev) => {
            const next: Record<string, string> = {}
            for (const lot of lots) {
              next[lot.id] = prev[lot.id] ?? ''
            }
            return next
          })
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load lots for ticker.')
          setAvailableLots([])
        }
      } finally {
        if (!cancelled) {
          setLoadingLots(false)
        }
      }
    }

    loadLots()

    return () => {
      cancelled = true
    }
  }, [isSell, normalizedTicker])

  function resetForm() {
    setForm(EMPTY_STOCK_FORM)
    setAvailableLots([])
    setAllocations({})
  }

  function setAllocation(lotId: string, value: string) {
    setAllocations((prev) => ({ ...prev, [lotId]: value }))
  }

  function buildAllocationPayload() {
    return availableLots
      .map((lot) => ({
        lotId: lot.id,
        quantity: Number(allocations[lot.id] || 0),
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const validationError = validateStockForm(form)
    if (validationError) {
      setError(validationError)
      return
    }

    const payload: CreateStockInput = {
      ticker: normalizedTicker,
      type: form.type,
      quantity: Number(form.quantity),
      price: Number(form.price),
      transactionDate: new Date(form.transactionDate).toISOString(),
    }

    if (form.type === 'sell') {
      if (availableLots.length === 0) {
        setError('No open lots are available for this ticker.')
        return
      }

      const allocationPayload = buildAllocationPayload()
      const allocatedQuantity = allocationPayload.reduce((sum, row) => sum + row.quantity, 0)
      if (Math.abs(allocatedQuantity - Number(form.quantity)) > ALLOCATION_TOLERANCE) {
        setError(`Allocated quantity (${allocatedQuantity.toFixed(6)}) must equal sell quantity (${Number(form.quantity).toFixed(6)}).`)
        return
      }

      payload.allocations = allocationPayload
    }

    setSaving(true)
    try {
      await createStockTransaction(payload)
      setSuccess('Stock transaction created.')
      resetForm()
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save stock transaction.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="panel">
        <h2>Stocks (MVP)</h2>
        <p>Create buy, dividend, and sell transactions. Sell requires explicit lot allocation.</p>
      </div>

      <div className="panel">
        <h3>Add Stock Transaction</h3>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Type
            <select
              value={form.type}
              onChange={(event) => {
                const nextType = event.target.value as StockTransactionType
                setForm((prev) => ({ ...prev, type: nextType }))
                setError(null)
                setSuccess(null)
              }}
              disabled={saving}
            >
              <option value="buy">Buy</option>
              <option value="div">Dividend</option>
              <option value="sell">Sell</option>
            </select>
          </label>

          <label>
            Ticker
            <input
              type="text"
              placeholder="AAPL"
              value={form.ticker}
              onChange={(event) => setForm((prev) => ({ ...prev, ticker: event.target.value.toUpperCase() }))}
              disabled={saving}
            />
          </label>

          <label>
            Quantity
            <input
              type="number"
              min="0.00000001"
              step="0.00000001"
              value={form.quantity}
              onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
              disabled={saving}
            />
          </label>

          <label>
            Price Per Share
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              value={form.price}
              onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
              disabled={saving}
            />
          </label>

          <label>
            Transaction Date
            <input
              type="date"
              value={form.transactionDate}
              onChange={(event) => setForm((prev) => ({ ...prev, transactionDate: event.target.value }))}
              disabled={saving}
            />
          </label>

          <div className="form-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={saving || (isSell && !allocationMatches)}
            >
              {saving ? 'Saving...' : 'Add Transaction'}
            </button>
            <button className="button" type="button" onClick={resetForm} disabled={saving}>
              Reset
            </button>
          </div>
        </form>

        {isSell ? (
          <div className="allocation-panel">
            <div className="allocation-header">
              <h4>Lot Allocation</h4>
              <span className={allocationMatches ? 'pill pill-good' : 'pill pill-warn'}>
                Allocated {allocationTotal.toFixed(6)} / {Number.isFinite(quantityValue) ? quantityValue.toFixed(6) : '0.000000'}
              </span>
            </div>

            {loadingLots ? <p>Loading lots for {normalizedTicker || 'ticker'}...</p> : null}

            {!loadingLots && normalizedTicker && availableLots.length === 0 ? (
              <p>No open lots found for {normalizedTicker}. Enter another ticker or create a buy/dividend lot first.</p>
            ) : null}

            {!loadingLots && availableLots.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Lot Id</th>
                    <th>Source</th>
                    <th>Purchase Date</th>
                    <th>Remaining</th>
                    <th>Unit Cost</th>
                    <th>Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {availableLots.map((lot) => (
                    <tr key={lot.id}>
                      <td className="mono">{lot.id.slice(0, 8)}...</td>
                      <td>{lot.sourceType}</td>
                      <td>{formatDate(lot.purchaseDate)}</td>
                      <td>{formatNumber(lot.remainingQuantity, 6)}</td>
                      <td>{formatMoney(lot.unitCost)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.00000001"
                          max={Number(lot.remainingQuantity).toString()}
                          value={allocations[lot.id] ?? ''}
                          onChange={(event) => setAllocation(lot.id, event.target.value)}
                          disabled={saving}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="status status-error">{error}</div> : null}
        {success ? <div className="status status-success">{success}</div> : null}
      </div>

      <div className="panel">
        <div className="row-between">
          <h3>Stock Transactions</h3>
          <button className="button" type="button" onClick={loadTransactions} disabled={loadingTransactions}>
            {loadingTransactions ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {loadingTransactions ? (
          <p>Loading stock transactions...</p>
        ) : transactions.length === 0 ? (
          <p>No stock transactions yet.</p>
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
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transactionDate)}</td>
                  <td>{transaction.ticker}</td>
                  <td>{transaction.type}</td>
                  <td>{formatNumber(transaction.quantity, 6)}</td>
                  <td>{formatMoney(transaction.price)}</td>
                  <td>{formatMoney(transaction.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
