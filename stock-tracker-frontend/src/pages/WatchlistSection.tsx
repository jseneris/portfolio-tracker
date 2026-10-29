import { useEffect, useState, type FormEvent } from 'react'
import { addWatchlistItem, getStockProfileByTicker, getWatchlist, getWatchlistPrices, removeWatchlistItem, type WatchlistItem, type WatchlistPrice } from '../api'
import { buildWatchlistPoints, type WatchlistLine } from '../watchlistPerformance'
import { TickerInfoBadges } from '../tickerBadges'

const COLORS = ['#0891b2', '#ea580c', '#4f46e5', '#db2777', '#65a30d', '#0d9488']

export default function WatchlistSection({ selectedYear, refreshKey, onItemsChange, onLinesChange }: {
  selectedYear: number | 'all' | null
  refreshKey: number
  onItemsChange: (items: WatchlistItem[]) => void
  onLinesChange: (lines: WatchlistLine[]) => void
}) {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [prices, setPrices] = useState<Record<string, WatchlistPrice[]>>({})
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({})
  const [ticker, setTicker] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({})
  const [tickerName, setTickerName] = useState<string | null>(null)
  const [tickerNameError, setTickerNameError] = useState<string | null>(null)
  const [lookingUpName, setLookingUpName] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTickerName(null)
    setTickerNameError(null)
    const symbol = ticker.trim().toUpperCase()
    if (!symbol) {
      setLookingUpName(false)
      return
    }
    setLookingUpName(true)
    const timer = window.setTimeout(() => {
      getStockProfileByTicker(symbol).then((profile) => {
        if (cancelled) return
        setTickerName(profile.companyName || 'Name unavailable')
      }).catch((err: unknown) => {
        if (!cancelled) setTickerNameError(err instanceof Error ? err.message : 'Unable to look up ticker name.')
      }).finally(() => { if (!cancelled) setLookingUpName(false) })
    }, 500)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [ticker])

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled(items.map((item) => getStockProfileByTicker(item.ticker))).then((results) => {
      if (cancelled) return
      const nextNames: Record<string, string> = {}
      const errors: Record<string, string> = {}
      results.forEach((result, index) => {
        const symbol = items[index].ticker
        if (result.status === 'fulfilled') nextNames[symbol] = result.value.companyName || 'Name unavailable'
        else errors[symbol] = result.reason instanceof Error ? result.reason.message : 'Unable to load ticker name.'
      })
      setNames(nextNames)
      setNameErrors(errors)
    })
    return () => { cancelled = true }
  }, [items])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWatchlist().then((result) => {
      if (!cancelled) setItems(result)
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load watchlist.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { onItemsChange(items) }, [items, onItemsChange])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const chosen = items.filter((item) => selected.has(item.id))
    setPrices({})
    setPriceErrors({})
    setLoadingPrices(chosen.length > 0)
    void Promise.allSettled(chosen.map((item) => getWatchlistPrices(item.id, controller.signal))).then((results) => {
      if (cancelled) return
      const nextPrices: Record<string, WatchlistPrice[]> = {}
      const errors: Record<string, string> = {}
      results.forEach((result, index) => {
        const id = chosen[index].id
        if (result.status === 'fulfilled') nextPrices[id] = result.value
        else errors[id] = result.reason instanceof Error ? result.reason.message : 'Unable to load price history.'
      })
      setPrices(nextPrices)
      setPriceErrors(errors)
      setLoadingPrices(false)
    })
    return () => { cancelled = true; controller.abort() }
  }, [items, selected, refreshKey])

  const today = new Date().toISOString().slice(0, 10)
  const periodEnd = selectedYear === 'all' || selectedYear == null ? today : `${selectedYear}-12-31` < today ? `${selectedYear}-12-31` : today
  const periodStart = selectedYear === 'all' || selectedYear == null ? '' : `${selectedYear}-01-01`
  useEffect(() => {
    onLinesChange(selectedYear == null ? [] : items.filter((item) => selected.has(item.id) && prices[item.id]).map((item) => ({
      id: item.id,
      label: `${item.ticker} watchlist (since ${item.startDate})`,
      color: COLORS[items.indexOf(item) % COLORS.length],
      points: buildWatchlistPoints(item, prices[item.id], periodStart, periodEnd),
    })))
  }, [items, selected, prices, periodStart, periodEnd, selectedYear, onLinesChange])

  async function add(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const item = await addWatchlistItem(ticker, startDate)
      setItems((previous) => [...previous, item].sort((a, b) => a.ticker.localeCompare(b.ticker)))
      setTicker('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to add watchlist ticker.')
    } finally { setPending(false) }
  }

  async function remove(item: WatchlistItem) {
    if (!window.confirm(`Remove ${item.ticker} from the watchlist?`)) return
    setPending(true)
    setError(null)
    try {
      await removeWatchlistItem(item.id)
      setSelected((previous) => { const next = new Set(previous); next.delete(item.id); return next })
      setItems((previous) => previous.filter((row) => row.id !== item.id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to remove watchlist ticker.')
    } finally { setPending(false) }
  }

  return (
    <section className="watchlist-section" aria-labelledby="watchlist-heading">
      <h3 id="watchlist-heading">Watchlist</h3>
      <p className="hint">Select a ticker to add its dotted price-performance line to the chart. Returns begin at the first available close on or after its saved watch date and are clipped to the displayed period, carrying the last available close across days without quotes. Prices are split-adjusted, exclude distributions, and are cached daily. Selections are not saved.</p>
      <form className="inline-actions watchlist-form" onSubmit={(event) => void add(event)}>
        <label>Ticker<input value={ticker} maxLength={10} required disabled={pending || loading} onChange={(event) => setTicker(event.target.value.toUpperCase())} />
          {lookingUpName ? <span className="hint" role="status">Looking up name...</span> : null}
          {tickerName ? <span className="hint" role="status">{tickerName}</span> : null}
          {tickerNameError ? <span className="status status-error" role="alert">{tickerNameError}</span> : null}
        </label>
        <label>Watch start date<input type="date" value={startDate} max={today} required disabled={pending || loading} onChange={(event) => setStartDate(event.target.value)} /></label>
        <button className="button button-primary" type="submit" disabled={pending || loading}>Add to watchlist</button>
      </form>
      {error ? <p className="status status-error" role="alert">{error}</p> : null}
      {loading ? <p role="status">Loading watchlist...</p> : items.length === 0 ? <p>No watchlist tickers yet.</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Show</th><th>Ticker</th><th>Name</th><th>Watch start</th><th>Return since watch start</th><th>Actions</th></tr></thead>
            <tbody>{items.map((item, index) => {
              const points = prices[item.id] ? buildWatchlistPoints(item, prices[item.id], periodStart, periodEnd) : []
              const last = points[points.length - 1]
              const availableQuotes = prices[item.id]?.filter((quote) => quote.date <= periodEnd) ?? []
              const latestQuote = availableQuotes[availableQuotes.length - 1]
              return <tr key={item.id}>
                <td><input type="checkbox" aria-label={`Show ${item.ticker} watchlist line`} checked={selected.has(item.id)}
                  disabled={selectedYear == null} onChange={() => setSelected((previous) => {
                    const next = new Set(previous)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })} /></td>
                <td><i className="legend-dot" style={{ backgroundColor: COLORS[index % COLORS.length] }} /> {item.ticker}<TickerInfoBadges ticker={item.ticker} /></td>
                <td>
                  {names[item.ticker] || (nameErrors[item.ticker] ? 'Name unavailable' : 'Loading name...')}
                  {nameErrors[item.ticker] ? <p className="status status-error" role="alert">{nameErrors[item.ticker]}</p> : null}
                </td>
                <td>{item.startDate}</td>
                <td>
                  {last ? `${last.value.toFixed(2)}%` : '--'}
                  {last && latestQuote ? <p className="hint">Last close: {latestQuote.date}</p> : null}
                  {selected.has(item.id) && prices[item.id] && !points.length ? <p className="hint">No prices in the displayed period.</p> : null}
                  {priceErrors[item.id] ? <p className="status status-error" role="alert">{priceErrors[item.id]}</p> : null}
                </td>
                <td><button className="button button-danger" type="button" disabled={pending} onClick={() => void remove(item)}>Remove</button></td>
              </tr>
            })}</tbody>
          </table>
        </div>
      )}
      {loadingPrices ? <p role="status">Loading selected watchlist prices...</p> : null}
    </section>
  )
}
