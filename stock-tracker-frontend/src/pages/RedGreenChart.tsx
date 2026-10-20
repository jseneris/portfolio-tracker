import { useEffect, useMemo, useState } from 'react'
import { getAllStockSplits, getHistoricalPrices, StockTransaction } from '../api'
import { buildRedGreenPoints, RedGreenPoint } from '../redGreen'

const WIDTH = 920
const HEIGHT = 360
const LEFT = 60
const RIGHT = 16
const TOP = 18
const BOTTOM = 56
const PLOT_WIDTH = WIDTH - LEFT - RIGHT
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
const MID_Y = TOP + PLOT_HEIGHT / 2
const GREEN = '#16a34a'
const RED = '#dc2626'
const NET = '#2563eb'

export function formatNet(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

export function getRedGreenTicks(maxCount: number): number[] {
  const half = maxCount / 2
  const positive = Number.isInteger(half) && half > 0 ? [maxCount, half] : [maxCount]
  return [...positive, 0, ...[...positive].reverse().map((value) => -value)]
}

export function buildRedGreenGeometry(points: RedGreenPoint[]) {
  const maxCount = Math.max(1, ...points.map((point) => Math.max(point.up, point.down)))
  const scale = (PLOT_HEIGHT / 2) / maxCount
  const x = (index: number) => LEFT + (points.length > 1 ? (index * PLOT_WIDTH) / (points.length - 1) : PLOT_WIDTH / 2)
  const greenY = (point: RedGreenPoint) => MID_Y - point.up * scale
  const redY = (point: RedGreenPoint) => MID_Y + point.down * scale
  const netY = (point: RedGreenPoint) => MID_Y - (point.up - point.down) * scale

  function paths(y: (point: RedGreenPoint) => number) {
    if (!points.length) return { line: '', area: '' }
    const coordinates = points.map((point, index) => `${x(index).toFixed(2)} ${y(point).toFixed(2)}`)
    const line = `M ${coordinates.join(' L ')}`
    const area = `M ${x(0).toFixed(2)} ${MID_Y.toFixed(2)} L ${coordinates.join(' L ')} L ${x(points.length - 1).toFixed(2)} ${MID_Y.toFixed(2)} Z`
    return { line, area }
  }

  return { maxCount, scale, x, greenY, redY, netY, green: paths(greenY), red: paths(redY), net: paths(netY) }
}

export function RedGreenChartView({ points }: { points: RedGreenPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const geometry = useMemo(() => buildRedGreenGeometry(points), [points])

  if (!points.length) return <p>No daily closes for held stocks in this period.</p>

  const hovered = hoveredIndex == null ? null : points[hoveredIndex]
  const tickStep = Math.max(1, Math.ceil(points.length / 7))
  const totals = points.reduce((sum, point) => ({ up: sum.up + point.up, down: sum.down + point.down }), { up: 0, down: 0 })
  const greenDays = points.filter((point) => point.up > point.down).length
  const redDays = points.filter((point) => point.down > point.up).length
  const tooltipWidth = 150
  const tooltipX = hovered ? Math.min(WIDTH - tooltipWidth - 8, geometry.x(hoveredIndex!) + 12) : 0

  return (
    <div className="comparison-chart-wrap">
      <svg className="comparison-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
        aria-label="Daily count of held stocks closing up (green, above zero), down (red, below zero), and the net difference (blue)"
        onMouseLeave={() => setHoveredIndex(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          if (bounds.width <= 0) return
          const pointerX = (event.clientX - bounds.left) / bounds.width * WIDTH
          const ratio = Math.max(0, Math.min(1, (pointerX - LEFT) / PLOT_WIDTH))
          const next = points.length > 1 ? Math.round(ratio * (points.length - 1)) : 0
          setHoveredIndex((previous) => previous === next ? previous : next)
        }}>
        {getRedGreenTicks(geometry.maxCount).map((value) => {
          const y = MID_Y - value * geometry.scale
          return <g key={value}>
            <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={y} y2={y} stroke="#e2e8f0" />
            <text x={LEFT - 8} y={y + 4} textAnchor="end" fontSize="11" fill={value > 0 ? GREEN : value < 0 ? RED : '#475569'}>{Math.abs(value)}</text>
          </g>
        })}
        {points.map((point, index) => {
          const isLast = index === points.length - 1
          // Skip a regular tick that would crowd the always-shown final date.
          if (!isLast && (index % tickStep !== 0 || points.length - 1 - index < tickStep * 0.75)) return null
          return <text key={point.date} x={geometry.x(index)} y={TOP + PLOT_HEIGHT + 22} textAnchor={isLast && points.length > 1 ? 'end' : 'middle'} fontSize="11" fill="#475569">{point.date}</text>
        })}
        <path d={geometry.green.area} fill={GREEN} fillOpacity="0.18" stroke="none" />
        <path d={geometry.red.area} fill={RED} fillOpacity="0.18" stroke="none" />
        <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={MID_Y} y2={MID_Y} stroke="#475569" strokeWidth="1.5" />
        <path d={geometry.green.line} fill="none" stroke={GREEN} strokeWidth="1.5" strokeLinejoin="round"><title>Stocks up</title></path>
        <path d={geometry.red.line} fill="none" stroke={RED} strokeWidth="1.5" strokeLinejoin="round"><title>Stocks down</title></path>
        <path d={geometry.net.line} fill="none" stroke={NET} strokeWidth="2" strokeLinejoin="round"><title>Net (up minus down)</title></path>
        {hovered ? <>
          <line className="comparison-hover-crosshair" x1={geometry.x(hoveredIndex!)} x2={geometry.x(hoveredIndex!)} y1={TOP} y2={TOP + PLOT_HEIGHT} />
          <circle cx={geometry.x(hoveredIndex!)} cy={geometry.greenY(hovered)} r="3.5" fill={GREEN} />
          <circle cx={geometry.x(hoveredIndex!)} cy={geometry.redY(hovered)} r="3.5" fill={RED} />
          <circle cx={geometry.x(hoveredIndex!)} cy={geometry.netY(hovered)} r="3.5" fill={NET} />
          <g className="comparison-hover-tooltip" transform={`translate(${tooltipX}, ${TOP + 8})`}>
            <rect width={tooltipWidth} height="96" rx="8" />
            <text x="12" y="18">Date: {hovered.date}</text>
            <text x="12" y="36">Up: {hovered.up}</text>
            <text x="12" y="54">Down: {hovered.down}</text>
            <text x="12" y="72">Net: {formatNet(hovered.up - hovered.down)}</text>
            <text x="12" y="90">Unchanged: {hovered.unchanged}</text>
          </g>
        </> : null}
      </svg>
      <div className="comparison-legend">
        <span><i className="legend-dot" style={{ backgroundColor: GREEN }} />Stocks up (above 0)</span>
        <span><i className="legend-dot" style={{ backgroundColor: RED }} />Stocks down (below 0)</span>
        <span><i className="legend-dot" style={{ backgroundColor: NET }} />Net (up − down)</span>
        <span>Green days: {greenDays} · Red days: {redDays} · Trading days: {points.length}</span>
        <span>Average up/down/net: {(totals.up / points.length).toFixed(1)} / {(totals.down / points.length).toFixed(1)} / {formatNet(Number(((totals.up - totals.down) / points.length).toFixed(1)))}</span>
      </div>
      <p className="hint">Each trading day counts tickers held at that day's close as up or down versus their own previous close, adjusting for splits. The blue line is the net difference (up minus down). Unchanged tickers and those without a previous close are not plotted.</p>
    </div>
  )
}

export default function RedGreenChart({ transactions, selectedYear, refreshKey }: {
  transactions: StockTransaction[]
  selectedYear: number | 'all' | null
  refreshKey: number
}) {
  const [points, setPoints] = useState<RedGreenPoint[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPoints(null)
    setError(null)
    if (selectedYear == null) {
      setLoading(false)
      return
    }
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const firstDate = transactions.reduce((first, transaction) => {
      const date = transaction.transactionDate.slice(0, 10)
      return date < first ? date : first
    }, transactions[0]?.transactionDate.slice(0, 10) ?? today)
    const startDate = selectedYear === 'all' ? firstDate : `${selectedYear}-01-01`
    const endDate = selectedYear === 'all' || `${selectedYear}-12-31` >= today ? today : `${selectedYear}-12-31`
    const tickers = [...new Set(transactions.map((transaction) => transaction.ticker.toUpperCase()))]
    Promise.all([
      tickers.length ? getHistoricalPrices(startDate, endDate, tickers, true, controller.signal) : Promise.resolve([]),
      getAllStockSplits(),
    ])
      .then(([historicalPrices, splitEvents]) => {
        if (!cancelled) setPoints(buildRedGreenPoints({ transactions, historicalPrices, splitEvents, startDate, endDate }))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load daily stock changes.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [transactions, selectedYear, refreshKey])

  return <>
    {loading ? <p role="status">Loading daily stock changes...</p> : null}
    {error ? <p className="status status-error" role="alert">{error}</p> : null}
    {points ? <RedGreenChartView points={points} /> : null}
  </>
}
