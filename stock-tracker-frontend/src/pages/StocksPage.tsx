import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  CreateStockInput,
  Lot,
  StockTransaction,
  StockTransactionType,
  UpdateStockInput,
  createStockTransaction,
  deleteStockTransaction,
  emitPortfolioUpdated,
  getLots,
  getLotsByTicker,
  getStockTransactions,
  updateStockTransaction,
} from '../api'

type StockFormState = {
  ticker: string
  type: StockTransactionType
  quantity: string
  price: string
  transactionDate: string
}

const ALLOCATION_TOLERANCE = 1e-6
const LOT_STATE_TOLERANCE = 1e-6

type PositiveTransactionState = 'full' | 'partial' | 'empty'

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
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

function toInputDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toISOString().slice(0, 10)
}

function toUpperTicker(value: string) {
  return value.trim().toUpperCase()
}

function getPositiveTransactionState(lot: Lot): PositiveTransactionState {
  const original = Number(lot.originalQuantity)
  const remaining = Number(lot.remainingQuantity)
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(remaining)) {
    return 'empty'
  }
  if (remaining <= LOT_STATE_TOLERANCE) {
    return 'empty'
  }
  if (remaining >= original - LOT_STATE_TOLERANCE) {
    return 'full'
  }
  return 'partial'
}

function getStatePillClassName(state: PositiveTransactionState) {
  if (state === 'full') {
    return 'pill pill-full'
  }
  if (state === 'partial') {
    return 'pill pill-partial'
  }
  return 'pill pill-empty'
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
  const [showAddTransactionModal, setShowAddTransactionModal] = useState(false)
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null)
  const [availableLots, setAvailableLots] = useState<Lot[]>([])
  const [positiveTransactionStates, setPositiveTransactionStates] = useState<Record<string, PositiveTransactionState>>({})
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

  const hasRequiredValues =
    Boolean(normalizedTicker) &&
    Boolean(form.transactionDate) &&
    form.quantity.trim() !== '' &&
    form.price.trim() !== ''

  const hasValidNumericValues =
    Number.isFinite(quantityValue) &&
    quantityValue > 0 &&
    Number.isFinite(Number(form.price)) &&
    Number(form.price) > 0

  const hasSellAllocationInput = availableLots.some((lot) => {
    const value = Number(allocations[lot.id] || 0)
    return Number.isFinite(value) && value > 0
  })

  const canSubmit =
    hasRequiredValues &&
    hasValidNumericValues &&
    (!isSell || (!loadingLots && availableLots.length > 0 && hasSellAllocationInput && allocationMatches))

  async function loadTransactions() {
    setLoadingTransactions(true)
    try {
      const [result, lotsData] = await Promise.all([getStockTransactions(), getLots()])
      setTransactions(result)

      const nextStates: Record<string, PositiveTransactionState> = {}
      for (const lot of lotsData) {
        nextStates[lot.transactionId] = getPositiveTransactionState(lot)
      }
      setPositiveTransactionStates(nextStates)
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
    setEditingTransactionId(null)
    setAvailableLots([])
    setAllocations({})
  }

  function openAddTransactionModal() {
    setError(null)
    setSuccess(null)
    resetForm()
    setShowAddTransactionModal(true)
  }

  function closeAddTransactionModal() {
    setShowAddTransactionModal(false)
    resetForm()
  }

  function beginEdit(transaction: StockTransaction) {
    setError(null)
    setSuccess(null)
    setEditingTransactionId(transaction.id)
    setForm({
      ticker: transaction.ticker,
      type: transaction.type,
      quantity: transaction.quantity == null ? '' : String(transaction.quantity),
      price: transaction.price == null ? '' : String(transaction.price),
      transactionDate: toInputDate(transaction.transactionDate),
    })
    setShowAddTransactionModal(true)
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
      if (editingTransactionId) {
        const updatePayload: UpdateStockInput = {
          ticker: payload.ticker,
          type: payload.type,
          quantity: payload.quantity,
          price: payload.price,
          transactionDate: payload.transactionDate,
        }
        await updateStockTransaction(editingTransactionId, updatePayload)
        setSuccess('Stock transaction updated.')
      } else {
        await createStockTransaction(payload)
        setSuccess('Stock transaction created.')
      }
      resetForm()
      setShowAddTransactionModal(false)
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save stock transaction.')
    } finally {
      setSaving(false)
    }
  }

  async function onDeleteTransaction(id: string) {
    const confirmed = window.confirm('Delete this stock transaction?')
    if (!confirmed) {
      return
    }

    setError(null)
    setSuccess(null)

    try {
      await deleteStockTransaction(id)
      setSuccess('Stock transaction deleted.')
      if (editingTransactionId === id) {
        closeAddTransactionModal()
      }
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete stock transaction.')
    }
  }

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Stocks (MVP)</h2>
          <p>Create buy, dividend, and sell transactions. Sell requires explicit lot allocation.</p>
        </div>
        <button className="button button-primary" type="button" onClick={openAddTransactionModal}>
          Add Transaction
        </button>
      </div>

      {success ? <div className="panel status status-success">{success}</div> : null}
      {error && !showAddTransactionModal ? <div className="panel status status-error">{error}</div> : null}

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
                <th>Lot State</th>
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
                  <td>{transaction.ticker}</td>
                  <td>{transaction.type}</td>
                  <td>
                    {transaction.type === 'buy' || transaction.type === 'div' ? (
                      positiveTransactionStates[transaction.id] ? (
                        <span className={getStatePillClassName(positiveTransactionStates[transaction.id])}>
                          {positiveTransactionStates[transaction.id]}
                        </span>
                      ) : (
                        <span className="pill pill-muted">--</span>
                      )
                    ) : (
                      <span className="pill pill-muted">--</span>
                    )}
                  </td>
                  <td>{formatNumber(transaction.quantity, 6)}</td>
                  <td>{formatMoney(transaction.price)}</td>
                  <td>{formatMoney(transaction.amount)}</td>
                  <td>
                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => beginEdit(transaction)}>
                        Edit
                      </button>
                      <button className="button button-danger" type="button" onClick={() => onDeleteTransaction(transaction.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddTransactionModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-transaction-title">
          <div className="modal-card">
            <h3 id="add-transaction-title">{editingTransactionId ? 'Edit Transaction' : 'Add Transaction'}</h3>
            <p>Enter date, transaction type, shares, and price.</p>

            <form className="form-grid" onSubmit={onSubmit}>
              <label>
                Date
                <input
                  type="date"
                  value={form.transactionDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, transactionDate: event.target.value }))}
                  disabled={saving}
                />
              </label>

              <label>
                Transaction Type
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
                Shares
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
                Price
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
                Ticker
                <input
                  type="text"
                  placeholder="AAPL"
                  value={form.ticker}
                  onChange={(event) => setForm((prev) => ({ ...prev, ticker: event.target.value.toUpperCase() }))}
                  disabled={saving}
                />
              </label>

              <div className="form-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={saving || !canSubmit}
                >
                  {saving ? 'Saving...' : editingTransactionId ? 'Save Changes' : 'Add Transaction'}
                </button>
                <button className="button" type="button" onClick={closeAddTransactionModal} disabled={saving}>
                  Cancel
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
                        <th>Purchase Date</th>
                        <th>Remaining</th>
                        <th>Unit Cost</th>
                        <th>Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableLots.map((lot) => (
                        <tr key={lot.id}>
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
          </div>
        </div>
      ) : null}
    </section>
  )
}
