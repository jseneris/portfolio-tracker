import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CombineLotsResponse,
  CreateStockInput,
  Lot,
  SplitLotResponse,
  StockTransaction,
  StockTransactionType,
  TickerSummary,
  UpdateStockInput,
  combineLots,
  createStockTransaction,
  deleteStockTransaction,
  emitPortfolioUpdated,
  getLots,
  getLotsByTicker,
  getStockSummaryByTicker,
  getStockTransactionsByTicker,
  splitLot,
  updateStockTransaction,
} from '../api'

const ALLOCATION_TOLERANCE = 1e-6
const LOT_STATE_TOLERANCE = 1e-6

type PositiveTransactionState = 'full' | 'partial' | 'empty'

type StockFormState = {
  type: StockTransactionType
  quantity: string
  price: string
  transactionDate: string
}

const EMPTY_STOCK_FORM: StockFormState = {
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

function formatMoney4(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return `$${Number(value).toFixed(4)}`
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

function toInputDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toISOString().slice(0, 10)
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

export default function StockHistoryPage() {
  const { ticker: tickerParam } = useParams<{ ticker: string }>()
  const ticker = useMemo(() => decodeURIComponent(tickerParam ?? '').trim().toUpperCase(), [tickerParam])
  const [summary, setSummary] = useState<TickerSummary | null>(null)
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [form, setForm] = useState<StockFormState>(EMPTY_STOCK_FORM)
  const [showAddTransactionModal, setShowAddTransactionModal] = useState(false)
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null)
  const [availableLots, setAvailableLots] = useState<Lot[]>([])
  const [openLots, setOpenLots] = useState<Lot[]>([])
  const [positiveTransactionStates, setPositiveTransactionStates] = useState<Record<string, PositiveTransactionState>>({})
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([])
  const [splitLotTarget, setSplitLotTarget] = useState<Lot | null>(null)
  const [splitQuantitiesInput, setSplitQuantitiesInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingLots, setLoadingLots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [combining, setCombining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isSell = form.type === 'sell'

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

  const openLotSummary = useMemo(() => {
    if (openLots.length === 0) {
      return '--'
    }
    const quantities = openLots
      .map((lot) => Number(lot.remainingQuantity))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
      .map((value) => Number(value.toFixed(6)).toString())
    return quantities.length > 0 ? quantities.join(',') : '--'
  }, [openLots])

  function validateStockForm(formState: StockFormState): string | null {
    const quantity = Number(formState.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return 'Shares must be greater than 0.'
    }

    const price = Number(formState.price)
    if (!Number.isFinite(price) || price <= 0) {
      return 'Price must be greater than 0.'
    }

    if (!formState.transactionDate) {
      return 'Date is required.'
    }

    const selectedDate = new Date(formState.transactionDate)
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

  function toggleLotSelection(lotId: string) {
    setSelectedLotIds((prev) => {
      if (prev.includes(lotId)) {
        return prev.filter((id) => id !== lotId)
      }
      return [...prev, lotId]
    })
  }

  function openSplitModal(lot: Lot) {
    setError(null)
    setSuccess(null)
    setSplitLotTarget(lot)
    setSplitQuantitiesInput('')
  }

  function closeSplitModal() {
    if (splitting) {
      return
    }
    setSplitLotTarget(null)
    setSplitQuantitiesInput('')
  }

  function parseSplitQuantities(input: string) {
    return input
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => Number(value))
  }

  function buildAllocationPayload() {
    return availableLots
      .map((lot) => ({
        lotId: lot.id,
        quantity: Number(allocations[lot.id] || 0),
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
  }

  async function loadTransactions() {
    setLoading(true)
    setError(null)
    try {
      const [summaryData, txData, lotsData, openLotsData] = await Promise.all([
        getStockSummaryByTicker(ticker),
        getStockTransactionsByTicker(ticker),
        getLots(),
        getLotsByTicker(ticker),
      ])
      setSummary(summaryData)
      setTransactions(txData)
      setOpenLots(openLotsData)

      const tickerLots = lotsData.filter((lot) => lot.ticker.toUpperCase() === ticker)
      const nextStates: Record<string, PositiveTransactionState> = {}
      for (const lot of tickerLots) {
        nextStates[lot.transactionId] = getPositiveTransactionState(lot)
      }
      setPositiveTransactionStates(nextStates)
      setSelectedLotIds((prev) => prev.filter((id) => openLotsData.some((lot) => lot.id === id)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load transaction history.')
    } finally {
      setLoading(false)
    }
  }

  async function submitCombineLots() {
    if (selectedLotIds.length < 2) {
      setError('Select at least two open lots to combine.')
      return
    }

    setError(null)
    setSuccess(null)
    setCombining(true)
    try {
      const response: CombineLotsResponse = await combineLots(selectedLotIds)
      setSuccess(`Combined ${response.lotIds.length} lots into one lot of ${formatNumber(response.combinedQuantity)} shares.`)
      setSelectedLotIds([])
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to combine lots.')
    } finally {
      setCombining(false)
    }
  }

  async function submitSplitLot() {
    if (!splitLotTarget) {
      return
    }

    setError(null)
    setSuccess(null)

    const quantities = parseSplitQuantities(splitQuantitiesInput)
    if (quantities.length < 2) {
      setError('Enter at least two comma-separated split quantities.')
      return
    }

    if (quantities.some((value) => !Number.isFinite(value) || value <= 0)) {
      setError('All split quantities must be numeric and greater than 0.')
      return
    }

    const requestedTotal = quantities.reduce((sum, value) => sum + value, 0)
    if (Math.abs(requestedTotal - Number(splitLotTarget.remainingQuantity)) > ALLOCATION_TOLERANCE) {
      setError(
        `Split total (${requestedTotal.toFixed(6)}) must equal lot remaining (${Number(splitLotTarget.remainingQuantity).toFixed(6)}).`
      )
      return
    }

    setSplitting(true)
    try {
      const response: SplitLotResponse = await splitLot(splitLotTarget.id, quantities)
      setSuccess(`Split lot into ${response.createdLots.length} lots.`)
      setSplitLotTarget(null)
      setSplitQuantitiesInput('')
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to split lot.')
    } finally {
      setSplitting(false)
    }
  }

  useEffect(() => {
    if (!ticker) {
      setLoading(false)
      setError('Ticker is required.')
      return
    }

    loadTransactions()
  }, [ticker])

  useEffect(() => {
    if (!isSell || !showAddTransactionModal || !ticker) {
      setAvailableLots([])
      setAllocations({})
      return
    }

    let cancelled = false

    async function loadLots() {
      setLoadingLots(true)
      try {
        const lots = await getLotsByTicker(ticker)
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
  }, [isSell, showAddTransactionModal, ticker])

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
      ticker,
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
        setError(`Allocated quantity (${allocatedQuantity.toFixed(6)}) must equal sell shares (${Number(form.quantity).toFixed(6)}).`)
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
        setSuccess('Transaction updated.')
      } else {
        await createStockTransaction(payload)
        setSuccess('Transaction created.')
      }
      emitPortfolioUpdated()
      setShowAddTransactionModal(false)
      resetForm()
      await loadTransactions()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save transaction.')
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
      setSuccess('Transaction deleted.')
      if (editingTransactionId === id) {
        closeAddTransactionModal()
      }
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete transaction.')
    }
  }

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>{ticker || 'Ticker'} Transaction History</h2>
          <p>All stock transactions recorded for this ticker.</p>
        </div>
        <div className="inline-actions">
          <button className="button button-primary" type="button" onClick={openAddTransactionModal} disabled={!ticker}>
            Add Transaction
          </button>
          <Link className="button" to="/">
            Back to Dashboard
          </Link>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}
      {success ? <div className="panel status status-success">{success}</div> : null}

      {loading ? <div className="panel">Loading transactions...</div> : null}

      {!loading && !error && summary ? (
        <div className="panel stat-grid">
          <div className="stat"><div className="label">Total Shares</div><div className="value">{formatNumber(summary.totalShares, 6)}</div></div>
          <div className="stat"><div className="label">Open Lots</div><div className="value">{openLotSummary}</div></div>
          <div className="stat"><div className="label">Cost Basis</div><div className="value">{formatMoney(summary.costBasis)}</div></div>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="panel">
          {transactions.length === 0 ? (
            <p>No transactions found for {ticker}.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
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
                    <td>{formatNumber(transaction.quantity)}</td>
                    <td>{formatMoney4(transaction.price)}</td>
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
      ) : null}

      {!loading && !error ? (
        <div className="panel">
          <div className="row-between">
            <h3>Open Lot Tools</h3>
            <button
              className="button"
              type="button"
              onClick={submitCombineLots}
              disabled={combining || splitting || selectedLotIds.length < 2}
            >
              {combining ? 'Combining...' : `Combine Selected (${selectedLotIds.length})`}
            </button>
          </div>

          {openLots.length === 0 ? (
            <p>No open lots for {ticker}.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Purchase Date</th>
                  <th>Source</th>
                  <th>Remaining</th>
                  <th>Unit Cost</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {openLots.map((lot) => (
                  <tr key={lot.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedLotIds.includes(lot.id)}
                        onChange={() => toggleLotSelection(lot.id)}
                        disabled={combining || splitting}
                      />
                    </td>
                    <td>{formatDate(lot.purchaseDate)}</td>
                    <td>{lot.sourceType}</td>
                    <td>{formatNumber(lot.remainingQuantity, 6)}</td>
                    <td>{formatMoney(lot.unitCost)}</td>
                    <td>
                      <button className="button" type="button" onClick={() => openSplitModal(lot)} disabled={combining || splitting}>
                        Split Lot
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {showAddTransactionModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-stock-history-transaction-title">
          <div className="modal-card">
            <h3 id="add-stock-history-transaction-title">{editingTransactionId ? 'Edit Transaction' : 'Add Transaction'} ({ticker})</h3>
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

              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={saving || !canSubmit}>
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

                {loadingLots ? <p>Loading lots for {ticker}...</p> : null}

                {!loadingLots && availableLots.length === 0 ? (
                  <p>No open lots found for {ticker}. Create a buy/dividend lot first.</p>
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

      {splitLotTarget ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="split-lot-title">
          <div className="modal-card">
            <h3 id="split-lot-title">Split Lot ({ticker})</h3>
            <p>
              Remaining shares: {formatNumber(splitLotTarget.remainingQuantity, 6)}. Enter comma-separated split quantities
              that add up exactly.
            </p>

            <div className="form-grid">
              <label>
                Quantities
                <input
                  type="text"
                  placeholder="Example: 1, 2"
                  value={splitQuantitiesInput}
                  onChange={(event) => setSplitQuantitiesInput(event.target.value)}
                  disabled={splitting}
                />
              </label>
              <div className="form-actions">
                <button className="button button-primary" type="button" onClick={submitSplitLot} disabled={splitting}>
                  {splitting ? 'Splitting...' : 'Split Lot'}
                </button>
                <button className="button" type="button" onClick={closeSplitModal} disabled={splitting}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
