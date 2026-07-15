import { useEffect, useMemo, useState } from 'react'
import {
  combineLots,
  Lot,
  PortfolioSummary,
  StockTransaction,
  getLotsByTicker,
  getPortfolioSummary,
  getStockTransactionsByTicker,
  splitLot,
} from '../api'

const SPLIT_TOLERANCE = 1e-6

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
  const [splitting, setSplitting] = useState(false)
  const [combining, setCombining] = useState(false)
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([])
  const [splitLotTarget, setSplitLotTarget] = useState<Lot | null>(null)
  const [splitQuantitiesInput, setSplitQuantitiesInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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

  async function loadTickerDetails(ticker: string) {
    setDetailsLoading(true)
    setError(null)
    try {
      const [lotsResult, txResult] = await Promise.all([
        getLotsByTicker(ticker),
        getStockTransactionsByTicker(ticker),
      ])
      setLots(lotsResult)
      setTransactions(txResult)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load ticker details.')
    } finally {
      setDetailsLoading(false)
    }
  }

  useEffect(() => {
    loadPortfolio()
  }, [])

  useEffect(() => {
    if (!selectedTicker) {
      setLots([])
      setTransactions([])
      setSelectedLotIds([])
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
          setSelectedLotIds([])
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

  function openSplitModal(lot: Lot) {
    setError(null)
    setSuccess(null)
    setSplitLotTarget(lot)
    setSplitQuantitiesInput('')
  }

  function toggleLotSelection(lotId: string) {
    setSelectedLotIds((prev) => {
      if (prev.includes(lotId)) {
        return prev.filter((id) => id !== lotId)
      }
      return [...prev, lotId]
    })
  }

  async function submitCombineLots() {
    if (selectedLotIds.length < 2 || !selectedTicker) {
      setError('Select at least two lots to combine.')
      return
    }

    setError(null)
    setSuccess(null)
    setCombining(true)
    try {
      const response = await combineLots(selectedLotIds)
      setSuccess(`Combined ${response.lotIds.length} lots into one lot of ${formatNumber(response.combinedQuantity)} shares.`)
      setSelectedLotIds([])
      await Promise.all([
        loadTickerDetails(selectedTicker),
        loadPortfolio(),
      ])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to combine lots.')
    } finally {
      setCombining(false)
    }
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

  async function submitSplitLot() {
    if (!splitLotTarget) {
      return
    }

    setError(null)
    setSuccess(null)

    const quantities = parseSplitQuantities(splitQuantitiesInput)
    if (quantities.length < 2) {
      setError('Enter at least two comma-separated quantities.')
      return
    }

    if (quantities.some((value) => !Number.isFinite(value) || value <= 0)) {
      setError('Each split quantity must be greater than 0.')
      return
    }

    const total = quantities.reduce((sum, value) => sum + value, 0)
    if (Math.abs(total - Number(splitLotTarget.remainingQuantity)) > SPLIT_TOLERANCE) {
      setError(`Split total (${total.toFixed(6)}) must equal lot remaining (${Number(splitLotTarget.remainingQuantity).toFixed(6)}).`)
      return
    }

    setSplitting(true)
    try {
      await splitLot(splitLotTarget.id, quantities)
      setSuccess(`Lot split into ${quantities.length} lots.`)
      setSplitLotTarget(null)
      setSplitQuantitiesInput('')
      await Promise.all([
        loadTickerDetails(selectedTicker),
        loadPortfolio(),
      ])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to split lot.')
    } finally {
      setSplitting(false)
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
              <h3>Open Lots</h3>
              <button
                className="button"
                type="button"
                onClick={submitCombineLots}
                disabled={combining || detailsLoading || selectedLotIds.length < 2 || splitting}
              >
                {combining ? 'Combining...' : `Combine Selected (${selectedLotIds.length})`}
              </button>
            </div>
            {detailsLoading ? (
              <p>Loading lots...</p>
            ) : lots.length === 0 ? (
              <p>No open lots for {selectedTicker}.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Lot Id</th>
                    <th>Source</th>
                    <th>Purchase Date</th>
                    <th>Original</th>
                    <th>Remaining</th>
                    <th>Unit Cost</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot) => (
                    <tr key={lot.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedLotIds.includes(lot.id)}
                          onChange={() => toggleLotSelection(lot.id)}
                          disabled={combining || splitting}
                        />
                      </td>
                      <td className="mono">{lot.id.slice(0, 8)}...</td>
                      <td>{lot.sourceType}</td>
                      <td>{formatDate(lot.purchaseDate)}</td>
                      <td>{formatNumber(lot.originalQuantity)}</td>
                      <td>{formatNumber(lot.remainingQuantity)}</td>
                      <td>{formatMoney(lot.unitCost)}</td>
                      <td>
                        <button className="button" type="button" onClick={() => openSplitModal(lot)} disabled={splitting || combining}>
                          Split Lot
                        </button>
                      </td>
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

      {splitLotTarget ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="split-lot-title">
          <div className="modal-card">
            <h3 id="split-lot-title">Split Lot</h3>
            <p>
              Remaining shares: {formatNumber(splitLotTarget.remainingQuantity)}. Enter comma-separated quantities (example: 2,1).
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
              <button className="button button-primary" type="button" onClick={submitSplitLot} disabled={splitting}>
                {splitting ? 'Splitting...' : 'Split Lot'}
              </button>
              <button className="button" type="button" onClick={closeSplitModal} disabled={splitting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
