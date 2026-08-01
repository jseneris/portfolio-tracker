import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { activateStockSplit, getAllStockSplits, StockSplitEvent } from '../api'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

export default function StockSplitsPage() {
  const [loadingSplits, setLoadingSplits] = useState(false)
  const [splitHistory, setSplitHistory] = useState<StockSplitEvent[]>([])
  const [activatingSplitId, setActivatingSplitId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadSplitHistory() {
    setLoadingSplits(true)
    setError(null)
    try {
      const data = await getAllStockSplits()
      const sorted = [...data].sort((a, b) => {
        const byDate = new Date(b.splitDate).getTime() - new Date(a.splitDate).getTime()
        if (byDate !== 0) {
          return byDate
        }
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      })
      setSplitHistory(sorted)
    } catch (err: unknown) {
      setSplitHistory([])
      setError(err instanceof Error ? err.message : 'Unable to load split history.')
    } finally {
      setLoadingSplits(false)
    }
  }

  async function onActivateSplit(splitId: string) {
    setActivatingSplitId(splitId)
    setError(null)
    setSuccess(null)
    try {
      const response = await activateStockSplit(splitId)
      setSuccess(response.message)
      await loadSplitHistory()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to activate stock split.')
    } finally {
      setActivatingSplitId(null)
    }
  }

  useEffect(() => {
    loadSplitHistory()
  }, [])

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Stock Split History</h2>
          <p>Stock splits are recorded globally and activated per user when eligible.</p>
        </div>
        <div className="inline-actions">
          <Link className="button" to="/">
            Back to Dashboard
          </Link>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}
      {success ? <div className="panel status status-success">{success}</div> : null}

      <div className="panel">
        <h3>Existing Splits (All Tickers)</h3>
        {loadingSplits ? <p>Loading existing splits...</p> : null}
        {!loadingSplits && splitHistory.length === 0 ? (
          <p>No recorded splits yet.</p>
        ) : null}
        {!loadingSplits && splitHistory.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Split Date</th>
                <th>Ratio</th>
                <th>Multiplier</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {splitHistory.map((split) => (
                <tr key={split.id}>
                  <td>{split.ticker}</td>
                  <td>{formatDate(split.splitDate)}</td>
                  <td>{split.ratioNumerator}:{split.ratioDenominator}</td>
                  <td>{split.multiplier.toFixed(8)}x</td>
                  <td>
                    {split.isActive
                      ? 'Active'
                      : split.canActivate
                        ? 'Inactive - Eligible'
                        : 'Inactive - Waiting'}
                  </td>
                  <td>
                    {split.isActive ? (
                      <span>--</span>
                    ) : (
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={() => onActivateSplit(split.id)}
                        disabled={!split.canActivate || activatingSplitId === split.id}
                      >
                        {activatingSplitId === split.id ? 'Activating...' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  )
}
