import { useState } from 'react'
import { generatePortfolioInsights, PortfolioInsightsReport } from '../api'
import { formatCurrency2 } from '../formatters'

function formatPercent(value: number | undefined) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '--'
}

function formatDate(value: string | undefined) {
  if (!value) return '--'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export default function PortfolioInsightsPage() {
  const [report, setReport] = useState<PortfolioInsightsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runReview() {
    setLoading(true)
    setError(null)
    try {
      setReport(await generatePortfolioInsights())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to generate portfolio review.')
    } finally {
      setLoading(false)
    }
  }

  const explanationById = new Map(report?.explanations.map((item) => [item.factId, item.explanation]) || [])
  const concentrationFacts = report?.facts.filter((fact) => fact.type === 'concentration') || []
  const lossFacts = report?.facts.filter((fact) => fact.type === 'unrealized_loss_lot') || []
  const missingPriceFacts = report?.facts.filter((fact) => fact.type === 'missing_price') || []

  function explanation(factId: string) {
    return explanationById.get(factId) || 'No additional model explanation was returned for this item.'
  }

  return (
    <div className="portfolio-insights-page">
      <header className="row-between insights-heading">
        <div>
          <p className="eyebrow">Portfolio review</p>
          <h2>Holdings & tax considerations</h2>
          <p className="muted-text">Fact-based portfolio observations for your review.</p>
        </div>
        <button className="button button-primary" onClick={() => void runReview()} disabled={loading}>
          {loading ? 'Reviewing...' : report ? 'Refresh review' : 'Generate review'}
        </button>
      </header>

      {error ? <div className="status status-error" role="alert">{error}</div> : null}
      {!report && !loading ? (
        <section className="panel insights-empty-state">
          <h3>Review your portfolio</h3>
          <p>Generate a review to see holding concentration and open lots with estimated unrealized losses.</p>
        </section>
      ) : null}
      {loading ? <section className="panel" aria-live="polite">Generating your portfolio review...</section> : null}

      {report ? (
        <>
          <p className="insights-timestamp">Generated {new Date(report.generatedAt).toLocaleString()}</p>

          <section className="panel">
            <div className="row-between insights-section-heading">
              <div>
                <p className="eyebrow">Equity allocation</p>
                <h3>Largest concentrations</h3>
              </div>
              <span className="muted-text">Share of priced equities</span>
            </div>
            {concentrationFacts.length ? (
              <div className="insights-list">
                {concentrationFacts.map((fact) => (
                  <article className="insight-row" key={fact.id}>
                    <div className="insight-values">
                      <strong>{fact.ticker}</strong>
                      <span>{formatPercent(fact.percentOfEquities)}</span>
                      <span>{formatCurrency2(fact.marketValue)}</span>
                    </div>
                    <p>{explanation(fact.id)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-text">No holding reached the 20% concentration review threshold.</p>
            )}
          </section>

          <section className="panel">
            <div className="insights-section-heading">
              <p className="eyebrow">Open lots</p>
              <h3>Unrealized loss items to review</h3>
            </div>
            {lossFacts.length ? (
              <div className="table-scroll">
                <table className="table insights-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Acquired</th>
                      <th>Shares</th>
                      <th>Cost basis</th>
                      <th>Estimated value</th>
                      <th>Estimated loss</th>
                      <th>Tracked acquisitions in prior 30 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lossFacts.map((fact) => (
                      <tr key={fact.id}>
                        <td>{fact.ticker}</td>
                        <td>{formatDate(fact.acquisitionDate)}</td>
                        <td>{fact.quantity?.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                        <td>{formatCurrency2(fact.costBasis)}</td>
                        <td>{formatCurrency2(fact.estimatedValue)}</td>
                        <td className="value-negative">{formatCurrency2(fact.unrealizedLoss)}</td>
                        <td>{fact.recentAcquisitionCount ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted-text">No open lots with an estimated loss were found at the latest stored closes.</p>
            )}
            {lossFacts.map((fact) => (
              <p className="insight-commentary" key={`${fact.id}-explanation`}>
                <strong>{fact.ticker} lot:</strong> {explanation(fact.id)}
              </p>
            ))}
          </section>

          {missingPriceFacts.length ? (
            <section className="panel">
              <p className="eyebrow">Data coverage</p>
              <h3>Holdings without a stored close</h3>
              <p>{missingPriceFacts.map((fact) => fact.ticker).join(', ')}</p>
              {missingPriceFacts.map((fact) => (
                <p className="insight-commentary" key={fact.id}>{explanation(fact.id)}</p>
              ))}
            </section>
          ) : null}

          <section className="panel insights-limitations">
            <h3>Important limitations</h3>
            <ul>
              {report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}