import { useEffect, useMemo, useState } from 'react'
import {
  combineDisplayLots,
  CreateDisplayLotInput,
  DisplayLot,
  DisplayLotComposition,
  PortfolioSummary,
  PurchaseLot,
  splitDisplayLot,
  StockTransaction,
  getPortfolioSummary,
  getUserTargetSettings,
  getStockTransactionsByTicker,
  getDisplayLotsByTicker,
  getDisplayLotComposition,
  getPurchaseLotsByTicker,
  deleteDisplayLot,
  createDisplayLot,
  SplitDisplayLotInput,
} from '../api'

const SPLIT_TOLERANCE = 1e-6
const DEFAULT_SALE_TARGET_PERCENT = 10

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
  const [displayLots, setDisplayLots] = useState<DisplayLot[]>([])
  const [purchaseLots, setPurchaseLots] = useState<PurchaseLot[]>([])
  const [displayLotCompositions, setDisplayLotCompositions] = useState<Record<string, DisplayLotComposition[]>>({})
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [combining, setCombining] = useState(false)
  const [selectedDisplayLotIds, setSelectedDisplayLotIds] = useState<string[]>([])
  const [splitLotTarget, setSplitLotTarget] = useState<DisplayLot | null>(null)
  const [splitQuantitiesInput, setSplitQuantitiesInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saleTargetPercent, setSaleTargetPercent] = useState<number>(DEFAULT_SALE_TARGET_PERCENT)

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
      setDisplayLotCompositions({})
      setTransactions([])
      setSelectedDisplayLotIds([])
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
          setSelectedDisplayLotIds([])
          
          // Load composition for each display lot
          const compositions: Record<string, DisplayLotComposition[]> = {}
          for (const lot of displayLotsResult) {
            const comp = await getDisplayLotComposition(lot.id)
            compositions[lot.id] = comp
          }
          setDisplayLotCompositions(compositions)
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

  function openSplitModal(lot: DisplayLot) {
    setError(null)
    setSuccess(null)
    setSplitLotTarget(lot)
    setSplitQuantitiesInput('')
  }

  function toggleDisplayLotSelection(lotId: string) {
    setSelectedDisplayLotIds((prev) => {
      if (prev.includes(lotId)) {
        return prev.filter((id) => id !== lotId)
      }
      return [...prev, lotId]
    })
  }

  async function submitCombineDisplayLots() {
    if (selectedDisplayLotIds.length < 2 || !selectedTicker) {
      setError('Select at least two display lots to combine.')
      return
    }

    setError(null)
    setSuccess(null)
    setCombining(true)
    try {
      const targetLotId = selectedDisplayLotIds[0]
      const otherLotIds = selectedDisplayLotIds.slice(1)
      const response = await combineDisplayLots(targetLotId, otherLotIds)
      setSuccess(`Combined ${otherLotIds.length + 1} display lots into one lot of ${formatNumber(response.totalQuantity)} shares.`)
      setSelectedDisplayLotIds([])
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
      const payload: SplitDisplayLotInput = {
        splits: quantities.map((q) => ({ quantityAllocated: q })),
      }
      await splitDisplayLot(splitLotTarget.id, payload)
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

  async function deleteDisplayLot(lotId: string) {
    const confirmed = window.confirm('Delete this display lot?')
    if (!confirmed) {
      return
    }

    setError(null)
    setSuccess(null)

    try {
      await deleteDisplayLot(lotId)
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
                disabled={combining || detailsLoading || selectedDisplayLotIds.length < 2 || splitting}
              >
                {combining ? 'Combining...' : `Combine Selected (${selectedDisplayLotIds.length})`}
              </button>
            </div>
            {detailsLoading ? (
              <p>Loading display lots...</p>
            ) : displayLots.length === 0 ? (
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
                  {displayLots.map((lot) => (
                    <tr key={lot.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedDisplayLotIds.includes(lot.id)}
                          onChange={() => toggleDisplayLotSelection(lot.id)}
                          disabled={combining || splitting}
                        />
                      </td>
                      <td className="mono">{lot.id.slice(0, 8)}...</td>
                      <td>{formatNumber(lot.totalQuantity)}</td>
                      <td>{formatDate(lot.createdAt)}</td>
                      <td>
                        <div className="inline-actions">
                          <button className="button" type="button" onClick={() => openSplitModal(lot)} disabled={splitting || combining}>
                            Split
                          </button>
                          <button className="button button-danger" type="button" onClick={() => deleteDisplayLot(lot.id)} disabled={splitting || combining}>
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
                      <td>{formatMoney(lot.unitCost)}</td>
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
              Latest buy/sell price: {formatMoney(latestBuyOrSellTransaction ? Number(latestBuyOrSellTransaction.price) : null)}
              {' | '}
              Sale target: {formatMoney(saleTargetPrice)}
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
