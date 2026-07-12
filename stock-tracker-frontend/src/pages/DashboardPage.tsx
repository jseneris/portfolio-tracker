import { useEffect, useState } from 'react'
import { getPortfolioSummary } from '../api'

type PortfolioSummary = {
  availableCash: number
  cashBasis: number
  adjustments: number
  totalStockCostBasis: number
  stockCount: number
  stocks: Array<{ ticker: string; totalShares: number; costBasis: number; lotCount: number }>
}

export default function DashboardPage() {
  const [data, setData] = useState<PortfolioSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getPortfolioSummary()
      .then((summary) => {
        if (!cancelled) {
          setData(summary)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load summary')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section>
      <div className="panel">
        <h2>Dashboard (MVP)</h2>
        <p>This page is wired to the backend portfolio summary endpoint.</p>
      </div>

      {error ? <div className="panel">Error: {error}</div> : null}

      {data ? (
        <>
          <div className="panel stat-grid">
            <div className="stat"><div className="label">Available Cash</div><div className="value">${data.availableCash.toFixed(2)}</div></div>
            <div className="stat"><div className="label">Cash Basis</div><div className="value">${data.cashBasis.toFixed(2)}</div></div>
            <div className="stat"><div className="label">Adjustments</div><div className="value">${data.adjustments.toFixed(2)}</div></div>
            <div className="stat"><div className="label">Stock Cost Basis</div><div className="value">${data.totalStockCostBasis.toFixed(2)}</div></div>
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
                    <td>{row.totalShares}</td>
                    <td>${row.costBasis.toFixed(2)}</td>
                    <td>{row.lotCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="panel">Loading summary...</div>
      )}
    </section>
  )
}
