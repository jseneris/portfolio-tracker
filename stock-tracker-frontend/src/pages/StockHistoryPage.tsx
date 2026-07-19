import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CreateStockInput,
  DisplayLot,
  PurchaseLot,
  SaleAllocation,
  StockSplitEvent,
  SplitDisplayLotInput,
  StockTransaction,
  StockTransactionType,
  TickerSummary,
  combineDisplayLots,
  createDisplayLot,
  createStockTransaction,
  deleteStockTransaction,
  emitPortfolioUpdated,
  getDisplayLotsByTicker,
  getOpenPurchaseLots,
  getPurchaseLotsByTicker,
  getSaleAllocations,
  getStockSplitsByTicker,
  getStockSummaryByTicker,
  getStockTransactionsByTicker,
  getPortfolioSummary,
  splitDisplayLot,
} from '../api'

const ALLOCATION_TOLERANCE = 1e-6
const LOT_STATE_TOLERANCE = 1e-6

type PositiveTransactionState = 'full' | 'partial' | 'empty'

type StockFormState = {
  type: StockTransactionType
  quantity: string
  price: string
  totalAmount: string
  transactionDate: string
}

const EMPTY_STOCK_FORM: StockFormState = {
  type: 'buy',
  quantity: '',
  price: '',
  totalAmount: '',
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

function toUtcDayTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return Number.NaN
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function getPositiveTransactionState(lot: PurchaseLot): PositiveTransactionState {
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
  const [showLotsModal, setShowLotsModal] = useState(false)
  const [availableLots, setAvailableLots] = useState<PurchaseLot[]>([])
  const [openLots, setOpenLots] = useState<PurchaseLot[]>([])
  const [displayLots, setDisplayLots] = useState<DisplayLot[]>([])
  const [positiveTransactionStates, setPositiveTransactionStates] = useState<Record<string, PositiveTransactionState>>({})
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [selectedDisplayLotIds, setSelectedDisplayLotIds] = useState<string[]>([])
  const [splitInputs, setSplitInputs] = useState<Record<string, string>>({})
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleAllocations, setSaleAllocations] = useState<Record<string, SaleAllocation[]>>({})
  const [splitEvents, setSplitEvents] = useState<StockSplitEvent[]>([])
  const [showOriginalPreSplit, setShowOriginalPreSplit] = useState(false)
  const [availableCash, setAvailableCash] = useState<number | null>(null)
  const [loadingAllocations, setLoadingAllocations] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingLots, setLoadingLots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lotsBusy, setLotsBusy] = useState(false)
  const [lotsError, setLotsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isSell = form.type === 'sell'
  const isDividend = form.type === 'div'

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
    (isDividend ? form.totalAmount.trim() !== '' : form.price.trim() !== '')

  const hasValidNumericValues =
    Number.isFinite(quantityValue) &&
    quantityValue > 0 &&
    (isDividend
      ? Number.isFinite(Number(form.totalAmount)) && Number(form.totalAmount) > 0
      : Number.isFinite(Number(form.price)) && Number(form.price) > 0)

  const hasSellAllocationInput = availableLots.some((lot) => {
    const value = Number(allocations[lot.id] || 0)
    return Number.isFinite(value) && value > 0
  })

  const canSubmit =
    hasRequiredValues &&
    hasValidNumericValues &&
    (!isSell || (!loadingLots && availableLots.length > 0 && hasSellAllocationInput && allocationMatches))

  const buyCost = Number(form.quantity) * Number(form.price)
  const hasInsufficientCashForBuy = form.type === 'buy'
    && Number.isFinite(buyCost)
    && Number.isFinite(Number(availableCash))
    && buyCost > Number(availableCash)

  const displayLotSummary = useMemo(() => {
    if (displayLots.length === 0) {
      return '--'
    }
    return displayLots
      .map((lot) => Number(lot.totalQuantity))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((q) => Number(q.toFixed(6)).toString())
      .join(', ')
  }, [displayLots])

  const totalDisplayLotShares = useMemo(() => {
    return displayLots.reduce((sum, lot) => {
      const quantity = Number(lot.totalQuantity)
      return Number.isFinite(quantity) ? sum + quantity : sum
    }, 0)
  }, [displayLots])

  const totalOpenPurchaseShares = useMemo(() => {
    return openLots.reduce((sum, lot) => {
      const quantity = Number(lot.remainingQuantity)
      return Number.isFinite(quantity) ? sum + quantity : sum
    }, 0)
  }, [openLots])

  const displayLotShareDelta = totalDisplayLotShares - totalOpenPurchaseShares
  const displayLotsOutOfSync = Math.abs(displayLotShareDelta) > ALLOCATION_TOLERANCE

  const transactionTimeline = useMemo(() => {
    type TimelineEntry =
      | { kind: 'transaction'; date: number; transaction: StockTransaction }
      | { kind: 'split'; date: number; split: StockSplitEvent }

    const txEntries: TimelineEntry[] = transactions.map((transaction) => ({
      kind: 'transaction',
      date: new Date(transaction.transactionDate).getTime(),
      transaction,
    }))

    const splitEntries: TimelineEntry[] = splitEvents.map((split) => ({
      kind: 'split',
      date: new Date(split.splitDate).getTime(),
      split,
    }))

    return [...txEntries, ...splitEntries].sort((a, b) => b.date - a.date)
  }, [transactions, splitEvents])

  const originalTransactionValuesById = useMemo(() => {
    const splitTimeline = splitEvents
      .map((split) => ({
        day: toUtcDayTimestamp(split.splitDate),
        multiplier: Number(split.multiplier),
      }))
      .filter((entry) => Number.isFinite(entry.day) && Number.isFinite(entry.multiplier) && entry.multiplier > 0)

    const values: Record<string, { quantity: number | null; price: number | null; hadSplitAdjustments: boolean }> = {}

    for (const transaction of transactions) {
      const transactionDay = toUtcDayTimestamp(transaction.transactionDate)
      let cumulativeMultiplier = 1

      if (Number.isFinite(transactionDay)) {
        for (const split of splitTimeline) {
          if (transactionDay <= split.day) {
            cumulativeMultiplier *= split.multiplier
          }
        }
      }

      const quantity = transaction.quantity == null
        ? null
        : Number.isFinite(Number(transaction.quantity))
          ? Number(transaction.quantity) / cumulativeMultiplier
          : null

      const price = transaction.price == null
        ? null
        : Number.isFinite(Number(transaction.price))
          ? Number(transaction.price) * cumulativeMultiplier
          : null

      values[transaction.id] = {
        quantity,
        price,
        hadSplitAdjustments: Math.abs(cumulativeMultiplier - 1) > ALLOCATION_TOLERANCE,
      }
    }

    return values
  }, [transactions, splitEvents])

  function validateStockForm(formState: StockFormState): string | null {
    const quantity = Number(formState.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return 'Shares must be greater than 0.'
    }

    if (formState.type === 'div') {
      const totalAmount = Number(formState.totalAmount)
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return 'Total amount must be greater than 0.'
      }
    } else {
      const price = Number(formState.price)
      if (!Number.isFinite(price) || price <= 0) {
        return 'Price must be greater than 0.'
      }
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

  async function loadTransactions() {
    setLoading(true)
    setError(null)
    try {
      const [tickerSummaryData, txData, tickerLots, openLotsData, displayLotsData, portfolioSummaryData, splitEventsData] = await Promise.all([
        getStockSummaryByTicker(ticker),
        getStockTransactionsByTicker(ticker),
        getPurchaseLotsByTicker(ticker),
        getOpenPurchaseLots(ticker),
        getDisplayLotsByTicker(ticker),
        getPortfolioSummary(),
        getStockSplitsByTicker(ticker),
      ])
      setSummary(tickerSummaryData)

      const openBuyTransactionIds = new Set(
        tickerLots
          .filter((lot) => lot.sourceType === 'purchase')
          .map((lot) => lot.transactionId)
      )

      const openDividendTransactionIds = new Set(
        tickerLots
          .filter((lot) => lot.sourceType === 'dividend')
          .map((lot) => lot.transactionId)
      )

      const visibleTransactions = txData.filter((transaction) => {
        if (transaction.type === 'buy') {
          return openBuyTransactionIds.has(transaction.id)
        }
        if (transaction.type === 'div') {
          return openDividendTransactionIds.has(transaction.id)
        }
        return true
      })

      setTransactions(visibleTransactions)
      setOpenLots(openLotsData)
      setDisplayLots(displayLotsData)
      setAvailableCash(portfolioSummaryData.availableCash)
      setSplitEvents(splitEventsData)

      const nextStates: Record<string, PositiveTransactionState> = {}
      for (const lot of tickerLots) {
        nextStates[lot.transactionId] = getPositiveTransactionState(lot)
      }
      setPositiveTransactionStates(nextStates)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load transaction history.')
    } finally {
      setLoading(false)
    }
  }

  async function reloadDisplayLots() {
    const data = await getDisplayLotsByTicker(ticker)
    setDisplayLots(data)
    setSelectedDisplayLotIds([])
    setSplitInputs({})
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
        const lots = await getPurchaseLotsByTicker(ticker)
        if (!cancelled) {
          const selectedDate = form.transactionDate ? new Date(form.transactionDate) : null
          const dateFilteredLots = selectedDate && !Number.isNaN(selectedDate.getTime())
            ? lots.filter((lot) => new Date(lot.purchaseDate) <= selectedDate)
            : lots

          // Sort: purchases first (newest first), then dividends (newest first)
          const sorted = [...dateFilteredLots].sort((a, b) => {
            // First, sort by sourceType: 'purchase' comes before 'dividend'
            if (a.sourceType !== b.sourceType) {
              return a.sourceType === 'purchase' ? -1 : 1
            }
            // Within same sourceType, sort by purchaseDate descending (newest first)
            return new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()
          })
          setAvailableLots(sorted)
          setAllocations((prev) => {
            const next: Record<string, string> = {}
            for (const lot of sorted) {
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
  }, [isSell, showAddTransactionModal, ticker, form.transactionDate])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const validationError = validateStockForm(form)
    if (validationError) {
      setError(validationError)
      return
    }

    const qty = Number(form.quantity)
    const price = isDividend ? Number(form.totalAmount) / qty : Number(form.price)

    const payload: CreateStockInput = {
      ticker,
      type: form.type,
      quantity: qty,
      price,
      transactionDate: new Date(form.transactionDate).toISOString(),
    }

    if (form.type === 'buy') {
      const available = Number(availableCash)
      const requiredCash = Number(payload.quantity || 0) * Number(payload.price || 0)
      if (Number.isFinite(available) && Number.isFinite(requiredCash) && requiredCash > available) {
        setError(
          `Insufficient available cash. Buy requires ${formatMoney(requiredCash)} but only ${formatMoney(available)} is available.`
        )
        return
      }
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
      await createStockTransaction(payload)
      setSuccess('Transaction created.')
      emitPortfolioUpdated()
      setShowAddTransactionModal(false)
      resetForm()
      await loadTransactions()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to create transaction.')
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
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete transaction.')
    }
  }

  async function toggleSaleAllocations(transactionId: string) {
    if (expandedSaleId === transactionId) {
      setExpandedSaleId(null)
      return
    }

    if (saleAllocations[transactionId]) {
      setExpandedSaleId(transactionId)
      return
    }

    setLoadingAllocations(true)
    try {
      const allocationsData = await getSaleAllocations(transactionId)
      setSaleAllocations((prev) => ({ ...prev, [transactionId]: allocationsData }))
      setExpandedSaleId(transactionId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load allocations.')
    } finally {
      setLoadingAllocations(false)
    }
  }

  async function onInitializeDisplayLots() {
    setLotsError(null)
    setLotsBusy(true)
    try {
      // Create one display lot per open purchase lot
      for (const lot of openLots) {
        await createDisplayLot(ticker, {
          composition: [{ purchaseLotId: lot.id, quantityAllocated: Number(lot.remainingQuantity) }],
        })
      }
      await reloadDisplayLots()
    } catch (err: unknown) {
      setLotsError(err instanceof Error ? err.message : 'Unable to initialize display lots.')
    } finally {
      setLotsBusy(false)
    }
  }

  async function onCombineDisplayLots() {
    if (selectedDisplayLotIds.length < 2) {
      setLotsError('Select at least two display lots to combine.')
      return
    }
    setLotsError(null)
    setLotsBusy(true)
    try {
      const [targetId, ...otherIds] = selectedDisplayLotIds
      await combineDisplayLots(targetId, otherIds)
      await reloadDisplayLots()
    } catch (err: unknown) {
      setLotsError(err instanceof Error ? err.message : 'Unable to combine lots.')
    } finally {
      setLotsBusy(false)
    }
  }

  async function onSplitDisplayLot(lotId: string) {
    const input = splitInputs[lotId] ?? ''
    const quantities = input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)

    if (quantities.length < 2 || quantities.some((q) => !Number.isFinite(q) || q <= 0)) {
      setLotsError('Enter at least two comma-separated positive quantities.')
      return
    }

    const lot = displayLots.find((l) => l.id === lotId)
    const total = quantities.reduce((s, q) => s + q, 0)
    if (Math.abs(total - Number(lot?.totalQuantity ?? 0)) > ALLOCATION_TOLERANCE) {
      setLotsError(`Quantities must sum to ${formatNumber(lot?.totalQuantity ?? 0, 6)} (got ${total.toFixed(6)}).`)
      return
    }

    setLotsError(null)
    setLotsBusy(true)
    try {
      const payload: SplitDisplayLotInput = { splits: quantities.map((q) => ({ quantityAllocated: q })) }
      await splitDisplayLot(lotId, payload)
      await reloadDisplayLots()
    } catch (err: unknown) {
      setLotsError(err instanceof Error ? err.message : 'Unable to split lot.')
    } finally {
      setLotsBusy(false)
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
        <>
          <div className="panel stat-grid">
            <div className="stat"><div className="label">Total Shares</div><div className="value">{formatNumber(summary.totalShares, 6)}</div></div>
            <button
              className="stat stat-clickable"
              type="button"
              onClick={() => { setLotsError(null); setShowLotsModal(true) }}
            >
              <div className="label">Display Lots ({displayLots.length})</div>
              <div className="value">{displayLotSummary}</div>
              <div className="hint">click to manage</div>
            </button>
            <div className="stat"><div className="label">Cost Basis</div><div className="value">{formatMoney(summary.costBasis)}</div></div>
          </div>

          {displayLotsOutOfSync ? (
            <div className="panel status status-warning">
              Display lots are out of sync by {formatNumber(Math.abs(displayLotShareDelta), 6)} shares.
              Display lots total {formatNumber(totalDisplayLotShares, 6)} while open purchase lots total {formatNumber(totalOpenPurchaseShares, 6)}.
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && !error ? (
        <div className="panel">
          {splitEvents.length > 0 ? (
            <div className="row-between" style={{ marginBottom: '0.75rem' }}>
              <p style={{ margin: 0, color: '#5b6472' }}>
                Toggle between split-adjusted values and original pre-split values for quantity and price.
              </p>
              <button
                className="button"
                type="button"
                onClick={() => setShowOriginalPreSplit((prev) => !prev)}
              >
                {showOriginalPreSplit ? 'Showing: Original Pre-Split' : 'Showing: Current Split-Adjusted'}
              </button>
            </div>
          ) : null}

          {transactionTimeline.length === 0 ? (
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
                {transactionTimeline.map((entry) => {
                  if (entry.kind === 'split') {
                    return (
                      <tr key={`split-${entry.split.id}`} style={{ backgroundColor: '#fff7e6' }}>
                        <td>{formatDate(entry.split.splitDate)}</td>
                        <td colSpan={6}>
                          <strong>Stock Split</strong> {entry.split.ratioNumerator}:{entry.split.ratioDenominator}
                          {' '}({formatNumber(entry.split.multiplier, 8)}x). Older transactions below this row are pre-split.
                        </td>
                      </tr>
                    )
                  }

                  const transaction = entry.transaction
                  const originalValues = originalTransactionValuesById[transaction.id]
                  const displayQuantity = showOriginalPreSplit ? (originalValues?.quantity ?? transaction.quantity) : transaction.quantity
                  const displayPrice = showOriginalPreSplit ? (originalValues?.price ?? transaction.price) : transaction.price
                  return [
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
                        <td>
                          {formatNumber(displayQuantity)}
                          {showOriginalPreSplit && originalValues?.hadSplitAdjustments ? (
                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>pre-split</div>
                          ) : null}
                        </td>
                        <td>
                          {formatMoney4(displayPrice)}
                          {showOriginalPreSplit && originalValues?.hadSplitAdjustments ? (
                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>pre-split</div>
                          ) : null}
                        </td>
                        <td>{formatMoney(transaction.amount)}</td>
                        <td>
                          {transaction.type === 'sell' ? (
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => toggleSaleAllocations(transaction.id)}
                              disabled={loadingAllocations}
                            >
                              {expandedSaleId === transaction.id ? '▼' : '▶'} Lots
                            </button>
                          ) : null}
                          <button className="button button-danger" type="button" onClick={() => onDeleteTransaction(transaction.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>,
                      transaction.type === 'sell' && expandedSaleId === transaction.id ? (
                        <tr key={`${transaction.id}-allocations`}>
                          <td colSpan={7}>
                            <div style={{ padding: '1rem', backgroundColor: '#f5f5f5' }}>
                              <h4 style={{ marginTop: 0 }}>Purchase Lots Consumed</h4>
                              {saleAllocations[transaction.id] && saleAllocations[transaction.id].length > 0 ? (
                                <table style={{ width: '100%', fontSize: '0.9em', borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid #ddd' }}>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Original Type</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Purchase Date</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Unit Cost</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Quantity Consumed</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Total Cost</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {saleAllocations[transaction.id].map((alloc, index) => (
                                      <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '0.5rem' }}>{alloc.sourceType === 'purchase' ? 'buy' : 'div'}</td>
                                        <td style={{ padding: '0.5rem' }}>{formatDate(alloc.purchaseDate)}</td>
                                        <td style={{ padding: '0.5rem' }}>{formatMoney4(alloc.unitCost)}</td>
                                        <td style={{ padding: '0.5rem' }}>{formatNumber(alloc.quantity)}</td>
                                        <td style={{ padding: '0.5rem' }}>{formatMoney(alloc.unitCost * alloc.quantity)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p>No purchase lots found for this sale.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null,
                  ]
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {showAddTransactionModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-stock-history-transaction-title">
          <div className="modal-card">
            <h3 id="add-stock-history-transaction-title">Add Transaction ({ticker})</h3>
            <p>Enter date, transaction type, shares, and price.</p>

            <form className="form-grid" onSubmit={onSubmit}>
              <label>
                Date
                <input
                  type="date"
                  min="1980-01-01"
                  max={new Date().toISOString().slice(0, 10)}
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

              {isDividend ? (
                <label>
                  Total Amount
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={form.totalAmount}
                    onChange={(event) => setForm((prev) => ({ ...prev, totalAmount: event.target.value }))}
                    disabled={saving}
                  />
                </label>
              ) : (
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
              )}

              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={saving || !canSubmit || hasInsufficientCashForBuy}>
                  {saving ? 'Saving...' : 'Add Transaction'}
                </button>
                <button className="button" type="button" onClick={closeAddTransactionModal} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>

            {hasInsufficientCashForBuy ? (
              <div className="status status-error">
                Insufficient available cash. Buy requires {formatMoney(buyCost)} and available cash is {formatMoney(Number(availableCash || 0))}.
              </div>
            ) : null}

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
                        <th>Type</th>
                        <th>Date</th>
                        <th>Remaining</th>
                        <th>Unit Cost</th>
                        <th>Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableLots.map((lot) => (
                        <tr key={lot.id}>
                          <td>{lot.sourceType === 'purchase' ? 'Buy' : 'Dividend'}</td>
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

      {showLotsModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="lots-modal-title">
          <div className="modal-card">
            <div className="row-between">
              <h3 id="lots-modal-title">Display Lots — {ticker}</h3>
              <button className="button" type="button" onClick={() => setShowLotsModal(false)} disabled={lotsBusy}>
                Close
              </button>
            </div>
            <p>Check lots to combine them, or enter comma-separated quantities to split a lot.</p>

            {displayLotsOutOfSync ? (
              <div className="status status-warning">
                Display lots are out of sync by {formatNumber(Math.abs(displayLotShareDelta), 6)} shares.
                You can still combine or split display lots, but totals may not match purchase lots until corrected.
              </div>
            ) : null}

            {lotsError ? <div className="status status-error">{lotsError}</div> : null}

            {displayLots.length === 0 ? (
              <>
                <p>No display lots exist yet for {ticker}. You have {openLots.length} open purchase lot{openLots.length !== 1 ? 's' : ''} with the following share counts:</p>
                {openLots.length > 0 ? (
                  <ul>
                    {openLots.map((lot) => (
                      <li key={lot.id}>{formatNumber(lot.remainingQuantity, 6)} shares</li>
                    ))}
                  </ul>
                ) : null}
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={onInitializeDisplayLots}
                    disabled={lotsBusy || openLots.length === 0}
                  >
                    {lotsBusy ? 'Creating...' : `Create one display lot per purchase lot (${openLots.length})`}
                  </button>
                </div>
              </>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Select to Combine</th>
                    <th>Quantity</th>
                    <th>Split Into (comma-separated)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {displayLots.map((lot) => (
                    <tr key={lot.id}>
                      <td>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selectedDisplayLotIds.includes(lot.id)}
                            onChange={() => setSelectedDisplayLotIds((prev) =>
                              prev.includes(lot.id) ? prev.filter((id) => id !== lot.id) : [...prev, lot.id]
                            )}
                            disabled={lotsBusy}
                          />
                          {selectedDisplayLotIds.includes(lot.id) ? '✓' : ''}
                        </label>
                      </td>
                      <td>{formatNumber(lot.totalQuantity, 6)}</td>
                      <td>
                        <input
                          type="text"
                          placeholder={`e.g. ${(Number(lot.totalQuantity) / 2).toFixed(2)},${(Number(lot.totalQuantity) / 2).toFixed(2)}`}
                          value={splitInputs[lot.id] ?? ''}
                          onChange={(e) => setSplitInputs((prev) => ({ ...prev, [lot.id]: e.target.value }))}
                          disabled={lotsBusy}
                        />
                      </td>
                      <td>
                        <button
                          className="button"
                          type="button"
                          onClick={() => onSplitDisplayLot(lot.id)}
                          disabled={lotsBusy || !splitInputs[lot.id]?.trim()}
                        >
                          Split
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="form-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={onCombineDisplayLots}
                disabled={lotsBusy || selectedDisplayLotIds.length < 2}
              >
                {lotsBusy ? 'Working...' : `Combine Selected (${selectedDisplayLotIds.length})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Stock History Page</div>
    </section>
  )
}
