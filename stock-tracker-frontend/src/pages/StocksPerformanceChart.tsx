import { useEffect, useMemo, useState } from 'react'
import { getAllStockSplits, getHistoricalPrices, StockTransaction } from '../api'
import { buildStockPerformance, getCombinedStockBasis, getCombinedStockGain, StockPerformancePoint, toGainPercent } from '../stockPerformance'

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '--' : `${value.toFixed(2)}%`
}

const COLORS = ['#2563eb', '#dc2626', '#15803d', '#9333ea', '#c2410c', '#0e7490', '#be185d', '#4d7c0f']
const WIDTH = 920
const HEIGHT = 360
const LEFT = 85
const TOP = 18
const PLOT_WIDTH = WIDTH - LEFT - 16
const PLOT_HEIGHT = HEIGHT - TOP - 56

export function StocksGainLossChart({ tickers, points, hasInitialBuys = false, showInitialBuys = true }: {
  tickers: string[]
  points: StockPerformancePoint[]
  hasInitialBuys?: boolean
  showInitialBuys?: boolean
}) {
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set())
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const visibleTickers = tickers.filter((ticker) => selectedTickers.has(ticker))
  const series = [
    { label: 'Combined holdings', color: '#0f172a', width: 1.5, value: (point: StockPerformancePoint) => toGainPercent(getCombinedStockGain(point, tickers), getCombinedStockBasis(point, tickers)) },
    ...(showInitialBuys && hasInitialBuys ? [{
      label: 'Initial buys (buy and hold)', color: '#9333ea', width: 1.5,
      value: (point: StockPerformancePoint) => toGainPercent(point.initialBuysGain, point.initialBuysBasis),
    }] : []),
    ...visibleTickers.map((ticker) => ({
      label: ticker, color: COLORS[tickers.indexOf(ticker) % COLORS.length], width: 1,
      value: (point: StockPerformancePoint) => toGainPercent(point.gains[ticker], point.bases[ticker]),
    })),
  ]
  const chart = useMemo(() => {
    let min = 0
    let max = 0
    for (const point of points) {
      for (const line of series) {
        const gain = line.value(point)
        if (gain != null) {
          min = Math.min(min, gain)
          max = Math.max(max, gain)
        }
      }
    }
    if (min === max) { min -= 1; max += 1 }
    const firstDate = Date.parse(`${points[0]?.date}T00:00:00Z`)
    const lastDate = Date.parse(`${points[points.length - 1]?.date}T00:00:00Z`)
    const x = (date: string) => LEFT + ((Date.parse(`${date}T00:00:00Z`) - firstDate) / Math.max(lastDate - firstDate, 1)) * PLOT_WIDTH
    const y = (gain: number) => TOP + PLOT_HEIGHT - ((gain - min) / (max - min)) * PLOT_HEIGHT
    return { min, max, x, y }
  }, [points, series])

  if (!points.length || !tickers.length) return <p>No stock transactions available for this period.</p>
  const hovered = hoveredIndex == null ? null : points[hoveredIndex]
  const lastPoint = points[points.length - 1]
  const tickStep = Math.max(1, Math.ceil(points.length / 7))

  return (
    <div className="comparison-chart-wrap">
      <svg className="comparison-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
        aria-label="Combined percentage gain/loss with optional individual stock lines, relative to value at the start of the period"
        onMouseLeave={() => setHoveredIndex(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          if (bounds.width <= 0) return
          const pointerX = (event.clientX - bounds.left) / bounds.width * WIDTH
          let nearest = 0
          for (let index = 1; index < points.length; index++) {
            if (Math.abs(chart.x(points[index].date) - pointerX) < Math.abs(chart.x(points[nearest].date) - pointerX)) nearest = index
          }
          setHoveredIndex(nearest)
        }}>
        {Array.from({ length: 5 }, (_, index) => {
          const value = chart.max - index / 4 * (chart.max - chart.min)
          return <g key={index}>
            <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={chart.y(value)} y2={chart.y(value)} stroke="#e2e8f0" />
            <text x={LEFT - 8} y={chart.y(value) + 4} textAnchor="end" fontSize="11" fill="#475569">{formatPercent(value)}</text>
          </g>
        })}
        <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={chart.y(0)} y2={chart.y(0)} stroke="#64748b" strokeDasharray="4 3" />
        {points.filter((_, index) => index % tickStep === 0 || index === points.length - 1).map((point) => (
          <text key={point.date} x={chart.x(point.date)} y={TOP + PLOT_HEIGHT + 22} textAnchor="middle" fontSize="11" fill="#475569">{point.date}</text>
        ))}
        {series.map((line) => {
          let connected = false
          const path = points.map((point) => {
            const gain = line.value(point)
            if (gain == null) { connected = false; return '' }
            const command = `${connected ? 'L' : 'M'} ${chart.x(point.date).toFixed(2)} ${chart.y(gain).toFixed(2)}`
            connected = true
            return command
          }).join(' ')
          return <path key={line.label} d={path} fill="none" stroke={line.color} strokeWidth={line.width}>
            <title>{line.label}</title>
          </path>
        })}
        {hovered ? <line x1={chart.x(hovered.date)} x2={chart.x(hovered.date)} y1={TOP} y2={TOP + PLOT_HEIGHT} className="comparison-hover-crosshair" /> : null}
      </svg>
      <p className="hint">{hovered ? hovered.date : lastPoint.date}: % gain/loss relative to value at start of period (plus buys during the period). Select tickers to show or hide their lines.</p>
      <div className="comparison-legend">
        <span>
          <i className="legend-dot" style={{ backgroundColor: '#0f172a' }} />
          <strong>Combined holdings: {formatPercent(series[0].value(hovered ?? lastPoint))}</strong>
        </span>
        {showInitialBuys && hasInitialBuys ? (
          <span>
            <i className="legend-dot" style={{ backgroundColor: '#9333ea' }} />
            Initial buys (buy and hold): {formatPercent(toGainPercent((hovered ?? lastPoint).initialBuysGain, (hovered ?? lastPoint).initialBuysBasis))}
          </span>
        ) : showInitialBuys ? <span>No purchases marked as Initial Purchases for this period.</span> : null}
        {tickers.map((ticker, index) => (
          <label className="checkbox-label" key={ticker}>
            <input type="checkbox" checked={selectedTickers.has(ticker)} onChange={() => setSelectedTickers((previous) => {
              const next = new Set(previous)
              if (next.has(ticker)) next.delete(ticker)
              else next.add(ticker)
              return next
            })} />
            <i className="legend-dot" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            {ticker}: {formatPercent(toGainPercent((hovered ?? lastPoint).gains[ticker], (hovered ?? lastPoint).bases[ticker]))}
          </label>
        ))}
      </div>
    </div>
  )
}

export default function StocksPerformanceChart({ transactions, selectedYear, refreshKey }: {
  transactions: StockTransaction[]
  selectedYear: number | 'all' | null
  refreshKey: number
}) {
  const [data, setData] = useState<ReturnType<typeof buildStockPerformance> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setData(null)
    setError(null)
    if (selectedYear == null || transactions.length === 0) {
      setLoading(false)
      return
    }
    setLoading(true)
    const firstDate = transactions.reduce((first, transaction) => {
      const date = transaction.transactionDate.slice(0, 10)
      return date < first ? date : first
    }, transactions[0].transactionDate.slice(0, 10))
    const startDate = selectedYear === 'all' ? firstDate : `${selectedYear}-01-01`
    const today = new Date().toISOString().slice(0, 10)
    const endDate = selectedYear === 'all' ? today : `${selectedYear}-12-31` < today ? `${selectedYear}-12-31` : today
    const tickers = [...new Set(transactions.map((transaction) => transaction.ticker.toUpperCase()))]
    Promise.all([getHistoricalPrices(startDate, endDate, tickers, true, controller.signal), getAllStockSplits()])
      .then(([historicalPrices, splitEvents]) => {
        if (!cancelled) setData(buildStockPerformance({
          transactions, historicalPrices, splitEvents, startDate, endDate, includeInitialBuys: selectedYear === 'all',
        }))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load stock performance.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [transactions, selectedYear, refreshKey])

  if (loading) return <p role="status">Loading stock performance...</p>
  if (error) return <p className="status status-error" role="alert">{error}</p>
  if (!data) return <p>No stock performance data available.</p>
  return <>
    {data.missingTickers.length > 0 ? <p className="status status-warning">Missing historical prices for {data.missingTickers.join(', ')}. Unavailable gains are shown as gaps; use Recalculate to backfill prices.</p> : null}
    <StocksGainLossChart tickers={data.tickers} points={data.points} hasInitialBuys={data.hasInitialBuys} showInitialBuys={selectedYear === 'all'} />
  </>
}
