import { useEffect, useState, type ReactNode } from 'react'
import { askPortfolioInsights, generatePortfolioInsights, PortfolioInsightsChatTurn, PortfolioInsightsReport, saveAiChatMessage } from '../api'
import { formatCurrency2 } from '../formatters'
import { MESSAGES_UPDATED_EVENT } from './MessagesPage'
import { getAiAssumptions, setAiAssumptions, saveReviewSection } from '../api'
import { buildFormattedReviewContent, formatDividendTiming, formatWeight, getWaitDayClass, type ReviewSectionTitle } from '../reviewMessages'
export { formatDividendTiming } from '../reviewMessages'

function formatPercent(value: number | undefined) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '--'
}

function formatDate(value: string | undefined) {
  if (!value) return '--'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export function ChatResponseActions({ saved, saving, disabled, error, onSend, successText = 'Question and response saved.' }: {
  saved: boolean
  saving: boolean
  disabled: boolean
  error?: string
  onSend: () => void
  successText?: string
}) {
  return (
    <div>
      <button className="button" type="button" onClick={onSend} disabled={disabled || saved || saving}>
        {saved ? 'Sent to Messages' : saving ? 'Sending...' : 'Send to Messages'}
      </button>
      {saved ? <span role="status"> {successText}</span> : null}
      {error ? <p className="status status-error" role="alert">{error}</p> : null}
    </div>
  )
}

type ReviewHolding = NonNullable<PortfolioInsightsReport['snapshot']['holdingReviewContext']>[number]
type RecommendedLotAmount = NonNullable<PortfolioInsightsReport['snapshot']['recommendedLotAmount']>

export function RecommendedLotAmountSection({ recommendation, action }: { recommendation: RecommendedLotAmount; action?: ReactNode }) {
  const needed = recommendation.holdings.filter((holding) => holding.lotsNeeded > 0)
  return (
    <section className="panel">
      <div className="row-between insights-section-heading">
        <div>
          <p className="eyebrow">Cash deployment</p>
          <h3>Recommended lot amount</h3>
        </div>
        <span className="muted-text">${recommendation.increment} increments</span>
      </div>
      {!needed.length ? (
        <p>Every holding is already at {formatWeight(recommendation.targetWeight)} weight or above; no cash is needed.</p>
      ) : recommendation.lotAmount == null ? (
        <p>Available cash ({formatCurrency2(recommendation.availableCash)}) cannot cover a {formatCurrency2(recommendation.increment)} lot
          for every holding below {formatWeight(recommendation.targetWeight)} weight.</p>
      ) : (
        <>
          <p className="insight-values">
            <strong>{formatCurrency2(recommendation.lotAmount)}</strong>
            <span>Cash needed: {formatCurrency2(recommendation.totalCost)} of {formatCurrency2(recommendation.availableCash)}</span>
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Ticker</th><th>Weight</th><th>Lots needed</th><th>Price</th><th>Shares per lot</th><th>Cost per lot</th><th>Total</th></tr></thead>
              <tbody>
                {needed.map((holding) => (
                  <tr key={holding.ticker}>
                    <td><strong>{holding.ticker}</strong></td>
                    <td>{formatWeight(holding.weight)}</td>
                    <td>{holding.lotsNeeded}</td>
                    <td>{formatCurrency2(holding.closePrice)}</td>
                    <td>{holding.sharesPerLot ?? '--'}</td>
                    <td>{formatCurrency2(holding.costPerLot)}</td>
                    <td>{formatCurrency2(holding.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {recommendation.nextSteps.length ? (
        <>
          <h4>Next steps</h4>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Lot amount</th><th>Cash needed</th><th>Additional cash needed</th></tr></thead>
              <tbody>
                {recommendation.nextSteps.map((step) => (
                  <tr key={step.lotAmount}>
                    <td><strong>{formatCurrency2(step.lotAmount)}</strong></td>
                    <td>{formatCurrency2(step.totalCost)}</td>
                    <td className={step.shortfall > 0 ? 'value-negative' : undefined}>{formatCurrency2(step.shortfall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {recommendation.unpricedTickers.length ? (
        <p className="status status-warning">Excluded (no stored price): {recommendation.unpricedTickers.join(', ')}.</p>
      ) : null}
      <p className="muted-text">Weight is display lots minus base size. Holdings at {formatWeight(recommendation.targetWeight)} or above need no cash; 0 needs one lot, -1 needs two, and so on. A lot is one share when the price is above the lot amount, otherwise the fewest whole shares reaching it. Uses latest stored closes.</p>
            {action}
          </section>
  )
}

export function LossTimingTable({ holdings }: { holdings: ReviewHolding[] }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>Ticker</th><th>Yearly Gain/Loss</th><th>Days to wait (prior buy/div window)</th><th>Dividend timing</th></tr></thead>
        <tbody>
          {holdings.filter((holding) => holding.matchesLossReviewFilter === true).map((holding) => (
            <tr key={holding.ticker}>
              <td className={getWaitDayClass(holding.daysUntilPriorAcquisitionWindowClears)}>
                <strong>{holding.ticker}</strong>
              </td>
              <td className="value-negative">{formatCurrency2(holding.yearlyGainLoss)}</td>
              <td>{holding.daysUntilPriorAcquisitionWindowClears ?? 'Unknown'}</td>
              <td>{formatDividendTiming(holding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ReviewSection = 'Largest concentrations' | 'Loss-review timing'

export function buildReviewSectionContent(report: PortfolioInsightsReport, section: ReviewSection): string {
  const lines = [`Review generated: ${new Date(report.generatedAt).toISOString()}`, '']
  if (section === 'Largest concentrations') {
    lines.push('Share of priced equities (20% review threshold).')
    const facts = report.facts.filter((fact) => fact.type === 'concentration')
    if (!facts.length) lines.push('No holding reached the 20% concentration review threshold.')
    for (const fact of facts) {
      lines.push(`${fact.ticker}: ${formatPercent(fact.percentOfEquities)}; ${formatCurrency2(fact.marketValue)}`,
        report.explanations.find((item) => item.factId === fact.id)?.explanation
          || 'No additional model explanation was returned for this item.', '')
    }
  } else {
    lines.push('Negative holding Yearly Gain/Loss and more than three display lots.',
      'Wait days reflect the latest tracked buy/dividend reinvestment; the prior window clears on day 31.',
      'Zero is no remaining prior-window wait, not confirmed wash-sale eligibility. Future purchases, outside accounts, and substantially identical securities remain unknown.',
      'Dividend elapsed days reflect tracked payments, not a prediction.', '')
    const holdings = report.snapshot.holdingReviewContext?.filter((holding) => holding.matchesLossReviewFilter === true) ?? []
    if (!holdings.length) lines.push('No holdings match the review filter with available data.')
    for (const holding of holdings) {
      lines.push(`${holding.ticker}: ${holding.daysUntilPriorAcquisitionWindowClears ?? 'Unknown'} days to wait; ${formatDividendTiming(holding)}; Yearly Gain/Loss: ${formatCurrency2(holding.yearlyGainLoss)}`)
    }
  }
  lines.push('', 'Important limitations:', ...report.limitations)
  return lines.join('\n')
}

function ReviewSectionSaveButton({ report, section, disabled, onSavingChange }: {
  report: PortfolioInsightsReport
  section: ReviewSectionTitle
  disabled: boolean
  onSavingChange: (saving: boolean) => void
}) {
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  async function send() {
    if (disabled || saved || saving) return
    setSaving(true)
    onSavingChange(true)
    setError(undefined)
    try {
      await saveReviewSection(section, buildFormattedReviewContent(report, section))
      setSaved(true)
      window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save this section to Messages.')
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }
  return <ChatResponseActions saved={saved} saving={saving} disabled={disabled} error={error}
    onSend={() => void send()} successText="Review section saved." />
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
  const [assumptionsEnabled, setAssumptionsEnabled] = useState(false)
  const [assumptionsLoading, setAssumptionsLoading] = useState(true)
  const [assumptionsError, setAssumptionsError] = useState<string | null>(null)
  const [assumptionsNotice, setAssumptionsNotice] = useState<string | null>(null)
  const [savingSection, setSavingSection] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAiAssumptions().then((enabled) => {
      if (!cancelled) setAssumptionsEnabled(enabled)
    }).catch((err: unknown) => {
      if (!cancelled) setAssumptionsError(err instanceof Error ? err.message : 'Unable to load AI assumptions.')
    }).finally(() => {
      if (!cancelled) setAssumptionsLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  async function toggleAssumptions() {
    setAssumptionsLoading(true)
    setAssumptionsError(null)
    setAssumptionsNotice(null)
    try {
      const enabled = await setAiAssumptions(!assumptionsEnabled)
      setAssumptionsEnabled(enabled)
      setAssumptionsNotice('Preferences saved. Generate or refresh the review to apply them; existing chat uses the previous snapshot.')
    } catch (err: unknown) {
      setAssumptionsError(err instanceof Error ? err.message : 'Unable to save AI assumptions.')
    } finally {
      setAssumptionsLoading(false)
    }
  }

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
        <button className="button button-primary" onClick={() => void runReview()} disabled={loading || chatLoading || savingResponse !== null || savingSection}>
          {loading ? 'Reviewing...' : report ? 'Refresh review' : 'Generate review'}
        </button>
      </header>

      <section className="panel">
        <h3>Your AI assumptions</h3>
        <ul>
          <li>Investment horizon: 10 years.</li>
          <li>Comfortable with volatility; avoid excessive single-stock concentration.</li>
          <li>Risk assessment covers tracked stocks only, not outside holdings or holistic finances.</li>
          <li>Tax-loss review: only negative holding Yearly Gain/Loss and more than three display lots. Actual open-lot losses must still be verified.</li>
          <li>Show ticker-level days remaining after the latest tracked buy or dividend reinvestment, not individual lots. This is not confirmed wash-sale eligibility. Future purchases and dividend reinvestments can change the outcome.</li>
          <li>Show days until the next dividend when its date is verified; otherwise show days since the last tracked dividend.</li>
        </ul>
        <p>{assumptionsLoading ? 'Loading or saving assumptions...' : assumptionsEnabled ? 'Saved assumptions enabled for new reviews.' : 'These assumptions are not yet enabled for your account.'}</p>
        <button className="button" type="button" onClick={() => void toggleAssumptions()} disabled={assumptionsLoading || loading || chatLoading || savingResponse !== null}>
          {assumptionsEnabled ? 'Disable these assumptions' : 'Save and enable these assumptions'}
        </button>
        {assumptionsError ? <p role="alert" className="status status-error">{assumptionsError}</p> : null}
        {assumptionsNotice ? <p role="status">{assumptionsNotice}</p> : null}
      </section>

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
          <p className="muted-text">{report.snapshot.assumptions ? 'This review uses your saved 10-year, tracked-stocks-only assumptions and loss-review filters.' : 'This review was generated without the saved assumptions.'}</p>

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

          {report.snapshot.recommendedLotAmount ? (
            <RecommendedLotAmountSection recommendation={report.snapshot.recommendedLotAmount}
              action={<ReviewSectionSaveButton key={`${report.reportId}-lot-amount`} report={report} section="Recommended lot amount"
                disabled={loading || savingSection} onSavingChange={setSavingSection} />} />
          ) : null}

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
            <ReviewSectionSaveButton key={`${report.reportId}-concentrations`} report={report} section="Largest concentrations"
              disabled={loading || savingSection} onSavingChange={setSavingSection} />
          </section>

          {!report.snapshot.assumptions ? <section className="panel">
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
              <p className="muted-text">{report.snapshot.assumptions
                ? 'No open lots with an estimated loss matched the negative holding Yearly Gain/Loss and more-than-three-display-lots filters.'
                : 'No open lots with an estimated loss were found at the latest stored closes.'}</p>
            )}
            {lossFacts.map((fact) => (
              <p className="insight-commentary" key={`${fact.id}-explanation`}>
                <strong>{fact.ticker} lot:</strong> {explanation(fact.id)}
              </p>
            ))}
          </section> : null}

          {report.snapshot.assumptions ? (
            <section className="panel">
              <h3>Loss Timing Review (tracked accounts only)</h3>
              <p className="muted-text">Only holdings with negative Yearly Gain/Loss and more than three display lots appear below. Wait days are based on the latest tracked buy or dividend reinvestment: the prior 30-day window clears on day 31. Zero means no remaining prior-window wait, not confirmed wash-sale eligibility. Future purchases, outside accounts, and substantially identical securities remain unknown. Dividend elapsed days use tracked payments, not a prediction.</p>
              <LossTimingTable holdings={report.snapshot.holdingReviewContext ?? []} />
              {!report.snapshot.holdingReviewContext?.some((holding) => holding.matchesLossReviewFilter === true) ? <p>No holdings match the review filter with available data.</p> : null}
              <ReviewSectionSaveButton key={`${report.reportId}-timing`} report={report} section="Loss-review timing"
                disabled={loading || savingSection} onSavingChange={setSavingSection} />
            </section>
          ) : null}

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
              <small id="insights-chat-question-limit">Up to 2,000 characters. Older exchanges may be omitted from AI context in longer conversations.</small>
              <textarea
                id="insights-chat-question"
                aria-describedby="insights-chat-question-limit"
                value={chatQuestion}
                maxLength={2000}
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