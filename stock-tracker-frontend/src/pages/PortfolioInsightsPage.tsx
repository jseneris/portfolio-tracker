import { useEffect, useState } from 'react'
import { askPortfolioInsights, getAiAvailability, type PortfolioInsightsChatTurn } from '../api'

export default function PortfolioInsightsPage() {
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [messages, setMessages] = useState<PortfolioInsightsChatTurn[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let checking = false
    async function check() {
      if (checking) return
      checking = true
      try {
        const status = await getAiAvailability()
        if (!cancelled) { setAvailability(status); setStatusError(null) }
      } catch (err: unknown) {
        if (!cancelled) {
          setAvailability({ available: false })
          setStatusError(err instanceof Error ? err.message : 'Unable to check AI availability.')
        }
      } finally {
        checking = false
      }
    }
    function checkIfVisible() {
      if (document.visibilityState === 'visible') void check()
    }
    void check()
    const timer = window.setInterval(checkIfVisible, 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', checkIfVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', checkIfVisible)
    }
  }, [])

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if (!text || loading || !availability?.available) return
    setLoading(true)
    setError(null)
    try {
      const answer = await askPortfolioInsights(undefined, text, messages.slice(-12))
      setMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: answer }])
      setQuestion('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to answer this question.')
    } finally {
      setLoading(false)
    }
  }

  const status = availability == null ? 'Checking AI availability...' : availability.available ? 'AI available' : 'AI unavailable'
  return <div className="portfolio-insights-page">
    <header className="row-between insights-heading">
      <h2>Insights</h2>
      <span className="ai-availability" role="status">
        <span aria-hidden="true" className={`ai-status-light${availability == null ? '' : availability.available ? ' ai-status-available' : ' ai-status-unavailable'}`} />
        {status}
      </span>
    </header>
    {statusError || availability?.reason ? <p role="alert" className="status status-error">{statusError || availability?.reason}</p> : null}
    <section className="panel insights-chat">
      <p className="muted-text">Ask about your tracked portfolio. Each question uses a fresh read-only snapshot of holdings,
        open lots, cash, and available company classifications, plus recent conversation and any saved AI assumptions.
        Prices are stored closes, not live quotes. The AI cannot edit your portfolio.</p>
      <p className="muted-text">Portfolio data and your question are sent to the configured AI provider through your local Copilot CLI.
        Local-only access does not mean the AI runs offline. Tax estimates cannot establish wash-sale eligibility.</p>
      <div className="insights-chat-transcript" aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => <article className={`insights-chat-message insights-chat-${message.role}`} key={index}>
          <strong>{message.role === 'user' ? 'You' : 'AI'}</strong><p>{message.content}</p>
        </article>)}
        {loading ? <p role="status">Preparing an answer...</p> : null}
      </div>
      {error ? <p className="status status-error" role="alert">{error}</p> : null}
      <form className="insights-chat-form" onSubmit={(event) => void ask(event)}>
        <label htmlFor="insights-question">Your question</label>
        <textarea id="insights-question" value={question} onChange={(event) => setQuestion(event.target.value)}
          maxLength={2000} rows={4} disabled={loading} aria-describedby="insights-question-limit" />
        <small id="insights-question-limit">Up to 2,000 characters. Older exchanges may be omitted from AI context.</small>
        <button type="submit" className="button button-primary" disabled={loading || !availability?.available || !question.trim()}>
          {loading ? 'Asking...' : 'Ask AI'}
        </button>
      </form>
    </section>
  </div>
}
