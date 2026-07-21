import { useEffect, useMemo, useState } from 'react'
import {
  PortfolioComparisonPoint,
  getPortfolioComparison2021,
  syncHistoricalPrices2021,
} from '../api'

function formatMoney(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return `$${Number(value).toFixed(2)}`
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

function formatDateShort(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  })
}

function formatAxisMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`
}

function buildPath(
  points: PortfolioComparisonPoint[],
  valueSelector: (point: PortfolioComparisonPoint) => number,
  width: number,
  height: number,
  minY: number,
  maxY: number,
  offsetX: number,
  offsetY: number
) {
  if (points.length === 0) {
    return ''
  }

  const xStep = points.length > 1 ? width / (points.length - 1) : 0
  const yRange = Math.max(maxY - minY, 1)

  return points
    .map((point, index) => {
      const x = offsetX + (points.length > 1 ? index * xStep : width / 2)
      const yValue = valueSelector(point)
      const y = offsetY + height - ((yValue - minY) / yRange) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export default function Comparison2021Page() {
  const [points, setPoints] = useState<PortfolioComparisonPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const comparisonSummary = useMemo(() => {
    if (points.length === 0) {
      return null
    }

    const startPoint = points[0]
    const endPoint = points[points.length - 1]

    return {
      startPoint,
      endPoint,
    }
  }, [points])

  const chart = useMemo(() => {
    if (points.length === 0) {
      return null
    }

    const values = points.flatMap((point) => [
      point.portfolioValue,
      point.cashCostBasis,
      point.dowBenchmarkValue,
      point.nasdaqBenchmarkValue,
      point.sp500BenchmarkValue,
    ])
    const minY = Math.min(...values)
    const maxY = Math.max(...values)

    const width = 920
    const height = 360
    const margin = { top: 18, right: 16, bottom: 56, left: 80 }
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom

    const portfolioPath = buildPath(
      points,
      (point) => point.portfolioValue,
      plotWidth,
      plotHeight,
      minY,
      maxY,
      margin.left,
      margin.top
    )

    const cashBasisBars = points
      .map((point, index) => {
        const previousBasis = index > 0 ? Number(points[index - 1].cashCostBasis) : 0
        const changed = Math.abs(Number(point.cashCostBasis) - previousBasis) > 1e-6
        if (!changed) {
          return null
        }

        const x =
          margin.left +
          (points.length > 1 ? (index * plotWidth) / (points.length - 1) : plotWidth / 2)
        const yRange = Math.max(maxY - minY, 1)
        const pointY = margin.top + plotHeight - ((point.cashCostBasis - minY) / yRange) * plotHeight
        const baselineY = margin.top + plotHeight
        const width = Math.max(12, Math.min(40, plotWidth / Math.max(points.length, 1) / 0.9))
        const y = Math.min(pointY, baselineY)
        const height = Math.max(1, Math.abs(baselineY - pointY))

        return {
          x: x - width / 2,
          y,
          width,
          height,
          date: point.date,
          value: point.cashCostBasis,
        }
      })
      .filter((bar): bar is NonNullable<typeof bar> => bar !== null)

    const dowPath = buildPath(
      points,
      (point) => point.dowBenchmarkValue,
      plotWidth,
      plotHeight,
      minY,
      maxY,
      margin.left,
      margin.top
    )

    const nasdaqPath = buildPath(
      points,
      (point) => point.nasdaqBenchmarkValue,
      plotWidth,
      plotHeight,
      minY,
      maxY,
      margin.left,
      margin.top
    )

    const sp500Path = buildPath(
      points,
      (point) => point.sp500BenchmarkValue,
      plotWidth,
      plotHeight,
      minY,
      maxY,
      margin.left,
      margin.top
    )

    const yTickCount = 5
    const yTicks = Array.from({ length: yTickCount }, (_, index) => {
      const ratio = index / (yTickCount - 1)
      const value = maxY - ratio * (maxY - minY)
      const y = margin.top + ratio * plotHeight
      return { value, y }
    })

    const maxXTicks = 8
    const xTickStep = Math.max(1, Math.ceil(points.length / maxXTicks))
    const xTicks = points
      .map((point, index) => {
        const x =
          margin.left +
          (points.length > 1 ? (index * plotWidth) / (points.length - 1) : plotWidth / 2)
        return { date: point.date, x, index }
      })
      .filter((tick) => tick.index % xTickStep === 0 || tick.index === points.length - 1)

    return {
      width,
      height,
      minY,
      maxY,
      margin,
      plotWidth,
      plotHeight,
      portfolioPath,
      cashBasisBars,
      dowPath,
      nasdaqPath,
      sp500Path,
      yTicks,
      xTicks,
    }
  }, [points])

  async function loadComparison() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await getPortfolioComparison2021()
      setPoints(response.points)
      if (response.points.length === 0) {
        setSuccess('No comparison points found yet. Run sync first.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load comparison data.')
    } finally {
      setLoading(false)
    }
  }

  async function syncAndLoad() {
    setSyncing(true)
    setError(null)
    setSuccess(null)
    try {
      const syncResult = await syncHistoricalPrices2021()
      await loadComparison()
      const processedDateCount = syncResult.syncedDates?.length ?? syncResult.requestedDates.length
      const remainingDates = Number(syncResult.remainingDates ?? 0)
      setSuccess(
        remainingDates > 0
          ? `Synced ${syncResult.storedRows} price points across ${syncResult.tickers.length} tickers and ${processedDateCount} dates. ${remainingDates} dates remain to backfill.`
          : `Synced ${syncResult.storedRows} price points across ${syncResult.tickers.length} tickers and ${processedDateCount} dates. Backfill is complete.`
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sync historical prices.')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    void loadComparison()
  }, [])

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Portfolio vs Cash Basis (2021)</h2>
          <p>Uses Yahoo closes on cash deposit/withdrawal dates plus 12/31/2021.</p>
        </div>
        <div className="inline-actions">
          <button className="button button-primary" type="button" onClick={syncAndLoad} disabled={loading || syncing}>
            {syncing ? 'Syncing...' : 'Recalculate'}
          </button>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}
      {success ? <div className="panel status status-success">{success}</div> : null}

      <div className="panel">
        {chart == null ? (
          <p>No chart data loaded yet.</p>
        ) : (
          <div className="comparison-chart-wrap">
            <svg
              className="comparison-chart"
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label="Portfolio value and cash basis comparison chart"
            >
              <line
                x1={chart.margin.left}
                y1={chart.margin.top}
                x2={chart.margin.left}
                y2={chart.margin.top + chart.plotHeight}
                stroke="#94a3b8"
                strokeWidth="1"
              />
              <line
                x1={chart.margin.left}
                y1={chart.margin.top + chart.plotHeight}
                x2={chart.margin.left + chart.plotWidth}
                y2={chart.margin.top + chart.plotHeight}
                stroke="#94a3b8"
                strokeWidth="1"
              />

              {chart.yTicks.map((tick) => (
                <g key={`y-${tick.y}`}>
                  <line
                    x1={chart.margin.left}
                    y1={tick.y}
                    x2={chart.margin.left + chart.plotWidth}
                    y2={tick.y}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                  <text
                    x={chart.margin.left - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="#475569"
                  >
                    {formatAxisMoney(tick.value)}
                  </text>
                </g>
              ))}

              {chart.xTicks.map((tick) => (
                <g key={`x-${tick.date}-${tick.index}`}>
                  <line
                    x1={tick.x}
                    y1={chart.margin.top + chart.plotHeight}
                    x2={tick.x}
                    y2={chart.margin.top + chart.plotHeight + 6}
                    stroke="#94a3b8"
                    strokeWidth="1"
                  />
                  <text
                    x={tick.x}
                    y={chart.margin.top + chart.plotHeight + 20}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#475569"
                  >
                    {formatDateShort(tick.date)}
                  </text>
                </g>
              ))}

              {chart.cashBasisBars.map((bar) => (
                <rect
                  key={`basis-bar-${bar.date}`}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  fill="#0ea5e9"
                  opacity="0.35"
                />
              ))}
              <path d={chart.nasdaqPath} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
              <path d={chart.sp500Path} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
              <path d={chart.dowPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
              <path d={chart.portfolioPath} fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <div className="comparison-legend">
              <span><i className="legend-dot legend-dot-portfolio" />Portfolio Value</span>
              <span><i className="legend-dot legend-dot-basis" />Cash Cost Basis (deposit/withdrawal days)</span>
              <span><i className="legend-dot legend-dot-dow" />DOW Benchmark</span>
              <span><i className="legend-dot legend-dot-nasdaq" />Nasdaq Benchmark</span>
              <span><i className="legend-dot legend-dot-sp500" />S&P 500 Benchmark</span>
              <span>Range: {formatMoney(chart.minY)} to {formatMoney(chart.maxY)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        {comparisonSummary == null ? (
          <p>No comparison summary available yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Portfolio Starting Value ({formatDate(comparisonSummary.startPoint.date)})</td>
                <td>{formatMoney(comparisonSummary.startPoint.portfolioValue)}</td>
              </tr>
              <tr>
                <td>Portfolio Ending Value ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatMoney(comparisonSummary.endPoint.portfolioValue)}</td>
              </tr>
              <tr>
                <td>Cash Basis in DOW Benchmark ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatMoney(comparisonSummary.endPoint.dowBenchmarkValue)}</td>
              </tr>
              <tr>
                <td>Cash Basis in Nasdaq Benchmark ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatMoney(comparisonSummary.endPoint.nasdaqBenchmarkValue)}</td>
              </tr>
              <tr>
                <td>Cash Basis in S&amp;P 500 Benchmark ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatMoney(comparisonSummary.endPoint.sp500BenchmarkValue)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
