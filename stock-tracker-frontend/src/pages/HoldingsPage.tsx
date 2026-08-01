import { useEffect, useMemo, useState } from 'react'
import {
  combineDisplayLots,
  DisplayLot,
  PortfolioSummary,
  PurchaseLot,
  splitDisplayLot,
  StockTransaction,
  getPortfolioSummary,
  getUserTargetSettings,
  getStockTransactionsByTicker,
  getDisplayLotsByTicker,
  getPurchaseLotsByTicker,
  deleteDisplayLotIndex,
} from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'

const SPLIT_TOLERANCE = 1e-6
const DEFAULT_SALE_TARGET_PERCENT = 10

type DisplayLotEntry = {
  id: string
  rowId: string
  index: number
  totalQuantity: number
  createdAt: string
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
  const [displayLots, setDisplayLots] = useState<DisplayLot[]>([])
  const [purchaseLots, setPurchaseLots] = useState<PurchaseLot[]>([])
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [combining, setCombining] = useState(false)
  const [selectedDisplayLotEntryIds, setSelectedDisplayLotEntryIds] = useState<string[]>([])
  const [splitLotTarget, setSplitLotTarget] = useState<DisplayLotEntry | null>(null)
  const [splitQuantitiesInput, setSplitQuantitiesInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saleTargetPercent, setSaleTargetPercent] = useState<number>(DEFAULT_SALE_TARGET_PERCENT)

  const tickers = useMemo(() => {
    return (portfolio?.stocks ?? []).map((stock) => stock.ticker)
  }, [portfolio])

  const displayLotEntries = useMemo<DisplayLotEntry[]>(() => {
    const entries: DisplayLotEntry[] = []
    for (const row of displayLots) {
      const lots = Array.isArray(row.lots) ? row.lots : []
      lots.forEach((qty, index) => {
        entries.push({
          id: `${row.id}:${index}`,
          rowId: row.id,
          index,
          totalQuantity: Number(qty),
          createdAt: row.createdAt,
        })
      })
    }
    return entries
  }, [displayLots])

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
    let cancelled = false

    async function loadUserTargetSettings() {
      try {
        const settings = await getUserTargetSettings()
        if (!cancelled) {
          const percent = Number(settings.saleTargetPercent)
          if (Number.isFinite(percent) && percent > 0) {
            setSaleTargetPercent(percent)
          }
        }
      } catch {
        // Keep default when settings are unavailable.
      }
    }

    loadUserTargetSettings()

    return () => {
      cancelled = true
    }
  }, [])

  const latestBuyOrSellTransaction = useMemo(() => {
    const candidates = transactions
      .filter((tx) => (tx.type === 'buy' || tx.type === 'sell') && Number.isFinite(Number(tx.price)))
      .slice()
      .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime())

    return candidates[0] ?? null
  }, [transactions])

  const saleTargetPrice = useMemo(() => {
    if (!latestBuyOrSellTransaction) {
      return null
    }

    const basePrice = Number(latestBuyOrSellTransaction.price)
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      return null
    }

    return basePrice * (1 + saleTargetPercent / 100)
  }, [latestBuyOrSellTransaction, saleTargetPercent])

  useEffect(() => {
    if (!selectedTicker) {
      setDisplayLots([])
      setPurchaseLots([])
      setTransactions([])
      setSelectedDisplayLotEntryIds([])
      return
    }

    let cancelled = false

    async function loadTickerDetails() {
      setDetailsLoading(true)
      setError(null)
      try {
        const [displayLotsResult, purchaseLotsResult, txResult] = await Promise.all([
          getDisplayLotsByTicker(selectedTicker),
          getPurchaseLotsByTicker(selectedTicker),
          getStockTransactionsByTicker(selectedTicker),
        ])
        if (!cancelled) {
          setDisplayLots(displayLotsResult)
          setPurchaseLots(purchaseLotsResult)
          setTransactions(txResult)
          setSelectedDisplayLotEntryIds([])
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

  function openSplitModal(lot: DisplayLotEntry) {
    setError(null)
    setSuccess(null)
    setSplitLotTarget(lot)
    setSplitQuantitiesInput('')
  }

  function toggleDisplayLotSelection(entryId: string) {
    setSelectedDisplayLotEntryIds((prev) => {
      if (prev.includes(entryId)) {
        return prev.filter((id) => id !== entryId)
      }
      return [...prev, entryId]
    })
  }

  async function submitCombineDisplayLots() {
    if (selectedDisplayLotEntryIds.length < 2 || !selectedTicker) {
      setError('Select at least two display lots to combine.')
      return
    }

    setError(null)
    setSuccess(null)
    setCombining(true)
    try {
      const selectedEntries = displayLotEntries.filter((entry) => selectedDisplayLotEntryIds.includes(entry.id))
      const rowIds = new Set(selectedEntries.map((entry) => entry.rowId))
      if (rowIds.size !== 1 || selectedEntries.length < 2) {
        setError('Selected entries must belong to the same ticker row.')
        return
      }

      const rowId = selectedEntries[0].rowId
      const indices = selectedEntries.map((entry) => entry.index).sort((a, b) => a - b)
      const response = await combineDisplayLots(rowId, indices)
      setSuccess(`Combined ${indices.length} display lots into one lot of ${formatNumber(response.totalQuantity)} shares.`)
      setSelectedDisplayLotEntryIds([])
      await Promise.all([
        loadPortfolio(),
      ])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to combine display lots.')
    } finally {
      setCombining(false)
    }
  }

  function closeDisplayLotSplitModal() {
    if (splitting) {
      return
    }
    setSplitLotTarget(null)
    setSplitQuantitiesInput('')
  }

  function parseDisplayLotSplitQuantities(input: string) {
    return input
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => Number(value))
  }

  async function submitDisplayLotSplit() {
    if (!splitLotTarget) {
      return
    }

    setError(null)
    setSuccess(null)

    const quantities = parseDisplayLotSplitQuantities(splitQuantitiesInput)
    if (quantities.length < 2) {
      setError('Enter at least two comma-separated quantities.')
      return
    }

    if (quantities.some((value) => !Number.isFinite(value) || value <= 0)) {
      setError('Each split quantity must be greater than 0.')
      return
    }

    const total = quantities.reduce((sum, value) => sum + value, 0)
    if (Math.abs(total - Number(splitLotTarget.totalQuantity)) > SPLIT_TOLERANCE) {
      setError(`Split total (${total.toFixed(6)}) must equal display lot total (${Number(splitLotTarget.totalQuantity).toFixed(6)}).`)
      return
    }

    setSplitting(true)
    try {
      await splitDisplayLot(splitLotTarget.rowId, {
        index: splitLotTarget.index,
        quantities,
      })
      setSuccess(`Display lot split into ${quantities.length} lots.`)
      setSplitLotTarget(null)
      setSplitQuantitiesInput('')
      await loadPortfolio()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to split display lot.')
    } finally {
      setSplitting(false)
    }
  }

  async function onDeleteDisplayLot(entry: DisplayLotEntry) {
    const confirmed = window.confirm('Delete this display lot?')
    if (!confirmed) {
      return
    }

    setError(null)
    setSuccess(null)

    try {
      await deleteDisplayLotIndex(entry.rowId, entry.index)
      setSuccess('Display lot deleted.')
      await loadPortfolio()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete display lot.')
    }
  }

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
      {success ? <div className="panel status status-success">{success}</div> : null}

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
            <div className="row-between">
              <h3>Display Lots</h3>
              <button
                className="button"
                type="button"
                onClick={submitCombineDisplayLots}
                  disabled={combining || detailsLoading || selectedDisplayLotEntryIds.length < 2 || splitting}
              >
                  {combining ? 'Combining...' : `Combine Selected (${selectedDisplayLotEntryIds.length})`}
              </button>
            </div>
            {detailsLoading ? (
              <p>Loading display lots...</p>
            ) : displayLotEntries.length === 0 ? (
              <p>No display lots for {selectedTicker}. Create display lots from purchase lots to organize your holdings.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Lot ID</th>
                    <th>Total Quantity</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLotEntries.map((lot) => (
                    <tr key={lot.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedDisplayLotEntryIds.includes(lot.id)}
                          onChange={() => toggleDisplayLotSelection(lot.id)}
                          disabled={combining || splitting}
                        />
                      </td>
                      <td className="mono">{lot.rowId.slice(0, 8)}:{lot.index}</td>
                      <td>{formatNumber(lot.totalQuantity)}</td>
                      <td>{formatDate(lot.createdAt)}</td>
                      <td>
                        <div className="inline-actions">
                          <button className="button" type="button" onClick={() => openSplitModal(lot)} disabled={splitting || combining}>
                            Split
                          </button>
                          <button className="button button-danger" type="button" onClick={() => onDeleteDisplayLot(lot)} disabled={splitting || combining}>
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

          <div className="panel">
            <h3>Purchase Lots (Source)</h3>
            {detailsLoading ? (
              <p>Loading purchase lots...</p>
            ) : purchaseLots.length === 0 ? (
              <p>No purchase lots for {selectedTicker}.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Lot ID</th>
                    <th>Source</th>
                    <th>Purchase Date</th>
                    <th>Original</th>
                    <th>Remaining</th>
                    <th>Unit Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseLots.map((lot) => (
                    <tr key={lot.id}>
                      <td className="mono">{lot.id.slice(0, 8)}...</td>
                      <td>{lot.sourceType}</td>
                      <td>{formatDate(lot.purchaseDate)}</td>
                      <td>{formatNumber(lot.originalQuantity)}</td>
                      <td>{formatNumber(lot.remainingQuantity)}</td>
                      <td>{formatStockPrice4(lot.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <h3>Transactions ({selectedTicker})</h3>
            <p>
              Sale target uses the most recent buy/sell price and your configured percentage ({saleTargetPercent.toFixed(2)}%).
            </p>
            <p>
              Latest buy/sell price: {formatStockPrice4(latestBuyOrSellTransaction ? Number(latestBuyOrSellTransaction.price) : null)}
              {' | '}
              Sale target: {formatStockPrice4(saleTargetPrice)}
            </p>
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
                      <td>{formatStockPrice4(transaction.price)}</td>
                      <td>{formatCurrency2(transaction.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}

      {splitLotTarget ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="split-lot-title">
          <div className="modal-card">
            <h3 id="split-lot-title">Split Display Lot</h3>
            <p>
              Total shares: {formatNumber(splitLotTarget.totalQuantity)}. Enter comma-separated quantities (example: 2,1).
            </p>

            <label className="stacked-label">
              Split Quantities
              <input
                type="text"
                placeholder="2,1"
                value={splitQuantitiesInput}
                onChange={(event) => setSplitQuantitiesInput(event.target.value)}
                disabled={splitting}
              />
            </label>

            <div className="form-actions">
              <button className="button button-primary" type="button" onClick={submitDisplayLotSplit} disabled={splitting}>
                {splitting ? 'Splitting...' : 'Split Display Lot'}
              </button>
              <button className="button" type="button" onClick={closeDisplayLotSplitModal} disabled={splitting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Holdings Page</div>
    </section>
  )
}
