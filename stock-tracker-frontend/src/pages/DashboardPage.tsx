import { useEffect, useState } from 'react'
import { PORTFOLIO_UPDATED_EVENT, PortfolioSummary, getPortfolioSummary } from '../api'

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`
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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

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

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Dashboard (MVP)</h2>
          <p>Portfolio summary from a single backend endpoint. Refreshes after cash and stock mutations.</p>
        </div>
        <div className="stack-right">
          <button className="button" type="button" onClick={() => loadSummary(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
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
                    <td>{row.ticker}</td>
                    <td>{row.totalShares.toFixed(6)}</td>
                    <td>{formatMoney(row.costBasis)}</td>
                    <td>{row.lotCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}
