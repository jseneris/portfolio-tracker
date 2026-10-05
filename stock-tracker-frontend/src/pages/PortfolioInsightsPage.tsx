import { useState } from 'react'
import { askPortfolioInsights, generatePortfolioInsights, PortfolioInsightsChatTurn, PortfolioInsightsReport, saveAiChatMessage } from '../api'
import { formatCurrency2 } from '../formatters'
import { MESSAGES_UPDATED_EVENT } from './MessagesPage'

function formatPercent(value: number | undefined) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '--'
}

function formatDate(value: string | undefined) {
  if (!value) return '--'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export function ChatResponseActions({ saved, saving, disabled, error, onSend }: {
  saved: boolean
  saving: boolean
  disabled: boolean
  error?: string
  onSend: () => void
}) {
  return (
    <div>
      <button className="button" type="button" onClick={onSend} disabled={disabled || saved || saving}>
        {saved ? 'Sent to Messages' : saving ? 'Sending...' : 'Send to Messages'}
      </button>
      {saved ? <span role="status"> Question and response saved.</span> : null}
      {error ? <p className="status status-error" role="alert">{error}</p> : null}
    </div>
  )
}

export default function PortfolioInsightsPage() {
  const [report, setReport] = useState<PortfolioInsightsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<PortfolioInsightsChatTurn[]>([])
  const [chatQuestion, setChatQuestion] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [savingResponse, setSavingResponse] = useState<number | null>(null)
  const [savedResponses, setSavedResponses] = useState<Set<number>>(() => new Set())
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({})

  async function runReview() {
    setLoading(true)
    setError(null)
    try {
      const nextReport = await generatePortfolioInsights()
      setReport(nextReport)
      setChatMessages([])
      setChatQuestion('')
      setChatError(null)
      setSavedResponses(new Set())
      setSaveErrors({})
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to generate portfolio review.')
    } finally {
      setLoading(false)
    }
  }

  async function sendResponseToMessages(index: number) {
    if (savingResponse !== null || savedResponses.has(index) || loading) return
    const answer = chatMessages[index]
    const question = chatMessages[index - 1]
    if (answer?.role !== 'assistant' || question?.role !== 'user') return
    setSavingResponse(index)
    setSaveErrors((errors) => {
      const next = { ...errors }
      delete next[index]
      return next
    })
    try {
      await saveAiChatMessage(question.content, answer.content)
      setSavedResponses((saved) => new Set(saved).add(index))
      window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT))
    } catch (err: unknown) {
      setSaveErrors((errors) => ({
        ...errors,
        [index]: err instanceof Error ? err.message : 'Unable to send this response to Messages.',
      }))
    } finally {
      setSavingResponse(null)
    }
  }

  async function askQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = chatQuestion.trim()
    if (!report || !question || chatLoading) return

    setChatLoading(true)
    setChatError(null)
    try {
      const answer = await askPortfolioInsights(report.reportId, question, chatMessages.slice(-12))
      setChatMessages((messages) => [
        ...messages,
        { role: 'user', content: question },
        { role: 'assistant', content: answer },
      ])
      setChatQuestion('')
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : 'Unable to answer this question.')
    } finally {
      setChatLoading(false)
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
          <p className="muted-text">Fact-based observations and questions about your complete read-only portfolio snapshot.</p>
        </div>
        <button className="button button-primary" onClick={() => void runReview()} disabled={loading || chatLoading || savingResponse !== null}>
          {loading ? 'Reviewing...' : report ? 'Refresh review' : 'Generate review'}
        </button>
      </header>

      {error ? <div className="status status-error" role="alert">{error}</div> : null}
      {!report && !loading ? (
        <section className="panel insights-empty-state">
          <h3>Review your portfolio</h3>
          <p>Generate a review to see holding concentration and open lots with estimated unrealized losses.</p>
          <p>The AI receives all current holdings and open lots, your cash summary, and available company classifications without account identifiers.</p>
        </section>
      ) : null}
      {loading ? <section className="panel" aria-live="polite">Generating your portfolio review...</section> : null}

      {report ? (
        <>
          <p className="insights-timestamp">Generated {new Date(report.generatedAt).toLocaleString()}</p>

          <section className="panel">
            <h3>Read-only snapshot available to AI</h3>
            <p>
              {report.snapshot.totals.holdingCount} holdings and {report.snapshot.totals.openLotCount} open lots,
              including profitable and smaller positions.
              {' '}Available cash: {formatCurrency2(report.snapshot.cash.availableCash)}.
              {' '}Portfolio value: {report.snapshot.totals.portfolioValue == null
                ? 'Unavailable (missing prices)' : formatCurrency2(report.snapshot.totals.portfolioValue)}.
            </p>
            <p className="muted-text">Ask about any holding, cost basis, unrealized gain/loss, cash, or available sector/industry classification. Prices use stored closes, not live quotes. Refresh after changes; the AI cannot edit your portfolio.</p>
          </section>

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

          <section className="panel insights-chat" aria-labelledby="insights-chat-title">
            <div className="insights-section-heading">
              <p className="eyebrow">Follow-up</p>
              <h3 id="insights-chat-title">Ask about this review</h3>
            </div>
            <div className="insights-chat-transcript" aria-live="polite" aria-relevant="additions">
              {chatMessages.length === 0 ? (
                <p className="muted-text">Ask a question about the facts and explanations in this review.</p>
              ) : chatMessages.map((message, index) => (
                <article className={`insights-chat-message insights-chat-${message.role}`} key={`${index}-${message.role}`}>
                  <strong>{message.role === 'user' ? 'You' : 'Review'}</strong>
                  <p>{message.content}</p>
                  {message.role === 'assistant' ? (
                    <ChatResponseActions
                      saved={savedResponses.has(index)}
                      saving={savingResponse === index}
                      disabled={loading || savingResponse !== null}
                      error={saveErrors[index]}
                      onSend={() => void sendResponseToMessages(index)}
                    />
                  ) : null}
                </article>
              ))}
              {chatLoading ? <p className="muted-text" role="status">Preparing an answer...</p> : null}
            </div>
            {chatError ? <div className="status status-error" role="alert">{chatError}</div> : null}
            <form className="insights-chat-form" onSubmit={(event) => void askQuestion(event)}>
              <label htmlFor="insights-chat-question">Your question</label>
              <textarea
                id="insights-chat-question"
                value={chatQuestion}
                maxLength={1000}
                rows={3}
                disabled={loading || chatLoading}
                onChange={(event) => setChatQuestion(event.target.value)}
              />
              <button className="button button-primary" type="submit" disabled={loading || chatLoading || !chatQuestion.trim()}>
                {chatLoading ? 'Asking...' : 'Ask'}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  )
}