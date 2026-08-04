import { useEffect, useMemo, useState } from 'react'
import {
  CashTransaction,
  getPortfolioComparisonByYear,
  PortfolioComparisonPoint,
  StockTransaction,
  getCashTransactions,
  getStockTransactions,
  syncHistoricalPricesByYear,
} from '../api'
import { formatCurrency2 } from '../formatters'

type YearSelection = number | 'all'

const SUPPORTED_COMPARISON_YEARS = [2021, 2022] as const

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
  const [selectedYear, setSelectedYear] = useState<YearSelection | null>(null)
  const [points, setPoints] = useState<PortfolioComparisonPoint[]>([])
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([])
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [missingPriceWarning, setMissingPriceWarning] = useState<string | null>(null)
  const [startingReferencePoint, setStartingReferencePoint] = useState<{ date: string; portfolioValue: number } | null>(null)

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const transaction of stockTransactions) {
      const date = new Date(transaction.transactionDate)
      if (!Number.isNaN(date.getTime())) {
        years.add(date.getUTCFullYear())
      }
    }
    return Array.from(years).sort((a, b) => b - a)
  }, [stockTransactions])

  const comparisonYears = useMemo(() => {
    const supported = new Set<number>(SUPPORTED_COMPARISON_YEARS)
    return availableYears.filter((year) => supported.has(year)).sort((a, b) => b - a)
  }, [availableYears])

  const yearlyStockTransactionSummary = useMemo(() => {
    const summary = {
      buy: { count: 0, amount: 0 },
      sell: { count: 0, amount: 0 },
      div: { count: 0, amount: 0 },
    }

    for (const transaction of stockTransactions) {
      const date = new Date(transaction.transactionDate)
      if (selectedYear == null || Number.isNaN(date.getTime())) {
        continue
      }
      if (selectedYear !== 'all' && date.getUTCFullYear() !== selectedYear) {
        continue
      }

      const type = String(transaction.type || '').toLowerCase()
      const amount = Number(transaction.amount)
      const safeAmount = Number.isFinite(amount) ? amount : 0

      if (type === 'buy' || type === 'sell' || type === 'div') {
        summary[type].count += 1
        summary[type].amount += safeAmount
      }
    }

    return summary
  }, [stockTransactions, selectedYear])

  const yearlyCashTransactionSummary = useMemo(() => {
    const summary = {
      deposit: { count: 0, amount: 0 },
      withdrawal: { count: 0, amount: 0 },
      interest: { count: 0, amount: 0 },
      fee: { count: 0, amount: 0 },
    }

    for (const transaction of cashTransactions) {
      const date = new Date(transaction.transactionDate)
      if (selectedYear == null || Number.isNaN(date.getTime())) {
        continue
      }
      if (selectedYear !== 'all' && date.getUTCFullYear() !== selectedYear) {
        continue
      }

      const type = String(transaction.type || '').toLowerCase()
      const amount = Number(transaction.amount)
      const safeAmount = Number.isFinite(amount) ? amount : 0

      if (type === 'deposit' || type === 'withdrawal' || type === 'interest' || type === 'fee') {
        summary[type].count += 1
        summary[type].amount += safeAmount
      }
    }

    return summary
  }, [cashTransactions, selectedYear])

  const comparisonSummary = useMemo(() => {
    if (points.length === 0) {
      return null
    }

    const startPoint = points[0]
    const endPoint = points[points.length - 1]
    const startingPortfolioValue = startingReferencePoint?.portfolioValue ?? startPoint.portfolioValue
    const startingPortfolioDate = startingReferencePoint?.date ?? startPoint.date

    return {
      startPoint,
      endPoint,
      startingPortfolioValue,
      startingPortfolioDate,
    }
  }, [points, startingReferencePoint])

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

  async function loadTransactions() {
    try {
      const [stockRows, cashRows] = await Promise.all([
        getStockTransactions(),
        getCashTransactions(),
      ])
      setStockTransactions(stockRows)
      setCashTransactions(cashRows)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load transactions.')
    }
  }

  function withBenchmarkCarry(
    basePoints: PortfolioComparisonPoint[],
    carry: { dowBenchmarkValue: number; nasdaqBenchmarkValue: number; sp500BenchmarkValue: number } | null
  ): PortfolioComparisonPoint[] {
    if (!carry || basePoints.length === 0) {
      return basePoints
    }

    const firstPoint = basePoints[0]
    const dowOffset = Number(carry.dowBenchmarkValue || 0) - Number(firstPoint.dowBenchmarkValue || 0)
    const nasdaqOffset = Number(carry.nasdaqBenchmarkValue || 0) - Number(firstPoint.nasdaqBenchmarkValue || 0)
    const sp500Offset = Number(carry.sp500BenchmarkValue || 0) - Number(firstPoint.sp500BenchmarkValue || 0)

    return basePoints.map((point) => ({
      ...point,
      dowBenchmarkValue: Number(point.dowBenchmarkValue || 0) + dowOffset,
      nasdaqBenchmarkValue: Number(point.nasdaqBenchmarkValue || 0) + nasdaqOffset,
      sp500BenchmarkValue: Number(point.sp500BenchmarkValue || 0) + sp500Offset,
    }))
  }

  function updateMissingPriceWarning(year: number, nextPoints: PortfolioComparisonPoint[]) {
    const missingDates = new Set<string>()
    const missingTickers = new Set<string>()

    for (const point of nextPoints) {
      if (Array.isArray(point.missingTickers) && point.missingTickers.length > 0) {
        missingDates.add(point.date)
        point.missingTickers.forEach((ticker) => missingTickers.add(ticker))
      }
    }

    if (missingDates.size > 0) {
      setMissingPriceWarning(
        `Missing historical prices for ${year}: ${missingTickers.size} ticker(s) across ${missingDates.size} date(s). Click Recalculate to fetch prices for this year.`
      )
      return
    }

    setMissingPriceWarning(null)
  }

  async function loadComparison(yearSelection: YearSelection) {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      if (yearSelection === 'all') {
        const yearsAscending = [...comparisonYears].sort((a, b) => a - b)
        if (yearsAscending.length === 0) {
          setPoints([])
          setMissingPriceWarning(null)
          setSuccess('No supported comparison years available yet.')
          return
        }

        const combinedPoints: PortfolioComparisonPoint[] = []
        let carry: { dowBenchmarkValue: number; nasdaqBenchmarkValue: number; sp500BenchmarkValue: number } | null = null
        const missingDates = new Set<string>()
        const missingTickers = new Set<string>()

        for (const year of yearsAscending) {
          const response = await getPortfolioComparisonByYear(year)
          const adjustedYearPoints = withBenchmarkCarry(response.points ?? [], carry)

          for (const point of adjustedYearPoints) {
            combinedPoints.push(point)
            if (Array.isArray(point.missingTickers) && point.missingTickers.length > 0) {
              missingDates.add(point.date)
              point.missingTickers.forEach((ticker) => missingTickers.add(ticker))
            }
          }

          if (adjustedYearPoints.length > 0) {
            const lastPoint = adjustedYearPoints[adjustedYearPoints.length - 1]
            carry = {
              dowBenchmarkValue: Number(lastPoint.dowBenchmarkValue || 0),
              nasdaqBenchmarkValue: Number(lastPoint.nasdaqBenchmarkValue || 0),
              sp500BenchmarkValue: Number(lastPoint.sp500BenchmarkValue || 0),
            }
          }
        }

        setPoints(combinedPoints)
        setStartingReferencePoint(null)
        if (missingDates.size > 0) {
          setMissingPriceWarning(
            `Missing historical prices across selected years: ${missingTickers.size} ticker(s) across ${missingDates.size} date(s). Run Recalculate by year to backfill gaps.`
          )
        } else {
          setMissingPriceWarning(null)
        }

        if (combinedPoints.length === 0) {
          setSuccess('No comparison points found yet. Run sync first.')
        }
        return
      }

      const response = await getPortfolioComparisonByYear(yearSelection)

      const previousYear = yearSelection - 1
      let carry: { dowBenchmarkValue: number; nasdaqBenchmarkValue: number; sp500BenchmarkValue: number } | null = null
      let previousYearEndPortfolioValueRef: { date: string; portfolioValue: number } | null = null
      if (previousYear >= Math.min(...SUPPORTED_COMPARISON_YEARS)) {
        try {
          const previousYearResponse = await getPortfolioComparisonByYear(previousYear)
          const previousYearPoints = previousYearResponse.points ?? []
          if (previousYearPoints.length > 0) {
            const previousYearEnd = previousYearPoints[previousYearPoints.length - 1]
            carry = {
              dowBenchmarkValue: Number(previousYearEnd.dowBenchmarkValue || 0),
              nasdaqBenchmarkValue: Number(previousYearEnd.nasdaqBenchmarkValue || 0),
              sp500BenchmarkValue: Number(previousYearEnd.sp500BenchmarkValue || 0),
            }
            previousYearEndPortfolioValueRef = {
              date: String(previousYearEnd.date || ''),
              portfolioValue: Number(previousYearEnd.portfolioValue || 0),
            }
          }
        } catch {
          carry = null
          previousYearEndPortfolioValueRef = null
        }
      }

      const adjustedPoints = withBenchmarkCarry(response.points ?? [], carry)
      setPoints(adjustedPoints)
      setStartingReferencePoint(previousYearEndPortfolioValueRef)
      updateMissingPriceWarning(yearSelection, adjustedPoints)
      if (adjustedPoints.length === 0) {
        setSuccess(`No comparison points found yet for ${yearSelection}. Run sync first.`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load comparison data.')
    } finally {
      setLoading(false)
    }
  }

  async function syncAndLoad() {
    if (selectedYear == null) {
      return
    }

    setSyncing(true)
    setError(null)
    setSuccess(null)
    try {
      if (selectedYear === 'all') {
        const yearsAscending = [...comparisonYears].sort((a, b) => a - b)
        let totalRows = 0
        let totalDatesProcessed = 0
        let totalDatesRemaining = 0

        for (const year of yearsAscending) {
          const syncResult = await syncHistoricalPricesByYear(year)
          totalRows += Number(syncResult.storedRows || 0)
          totalDatesProcessed += Number(syncResult.syncedDates?.length ?? syncResult.requestedDates.length ?? 0)
          totalDatesRemaining += Number(syncResult.remainingDates ?? 0)
        }

        await loadComparison('all')

        setSuccess(
          totalDatesRemaining > 0
            ? `Synced ${totalRows} price points across ${yearsAscending.length} year(s) and ${totalDatesProcessed} date batches. ${totalDatesRemaining} dates remain to backfill.`
            : `Synced ${totalRows} price points across ${yearsAscending.length} year(s) and ${totalDatesProcessed} date batches. Backfill is complete.`
        )
      } else {
        const syncResult = await syncHistoricalPricesByYear(selectedYear)
        await loadComparison(selectedYear)
        const processedDateCount = syncResult.syncedDates?.length ?? syncResult.requestedDates.length
        const remainingDates = Number(syncResult.remainingDates ?? 0)
        const splitSummary = syncResult.splitCheckPerformed
          ? ` Split check: ${Number(syncResult.splitsInserted ?? 0)} inserted from ${Number(syncResult.splitsDiscovered ?? 0)} discovered across ${Number(syncResult.splitTickersChecked ?? 0)} ticker(s).`
          : ''
        setSuccess(
          remainingDates > 0
            ? `Synced ${syncResult.storedRows} price points for ${selectedYear} across ${syncResult.tickers.length} tickers and ${processedDateCount} dates. ${remainingDates} dates remain to backfill.${splitSummary}`
            : `Synced ${syncResult.storedRows} price points for ${selectedYear} across ${syncResult.tickers.length} tickers and ${processedDateCount} dates. Backfill is complete.${splitSummary}`
        )
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sync historical prices.')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    void loadTransactions()
  }, [])

  useEffect(() => {
    if (comparisonYears.length === 0) {
      setSelectedYear(null)
      setPoints([])
      setMissingPriceWarning(null)
      return
    }

    if (selectedYear == null) {
      setSelectedYear(comparisonYears[0])
      return
    }

    if (selectedYear !== 'all' && !comparisonYears.includes(selectedYear)) {
      setSelectedYear(comparisonYears[0])
    }
  }, [comparisonYears, selectedYear])

  useEffect(() => {
    if (selectedYear == null) {
      return
    }

    void loadComparison(selectedYear)
  }, [selectedYear])

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Portfolio vs Cash Basis ({selectedYear === 'all' ? 'All Years' : selectedYear ?? '--'})</h2>
          <p>Uses Yahoo closes on cash deposit/withdrawal dates plus the year-end date for the selected year.</p>
        </div>
        <div className="inline-actions">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            Year
            <select
              value={selectedYear ?? ''}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'all') {
                  setSelectedYear('all')
                  return
                }

                const parsedYear = Number(value)
                if (Number.isFinite(parsedYear)) {
                  setSelectedYear(parsedYear)
                }
              }}
              disabled={loading || syncing || comparisonYears.length === 0}
            >
              <option value="all">All</option>
              {comparisonYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <button className="button button-primary" type="button" onClick={syncAndLoad} disabled={loading || syncing || selectedYear == null}>
            {syncing ? 'Syncing...' : 'Recalculate'}
          </button>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}
      {missingPriceWarning ? <div className="panel status status-warning">{missingPriceWarning}</div> : null}
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
              <span>Range: {formatCurrency2(chart.minY)} to {formatCurrency2(chart.maxY)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>{selectedYear ?? '--'} Stock Transaction Summary</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Count</th>
              <th>Total Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Purchases</td>
              <td>{yearlyStockTransactionSummary.buy.count}</td>
              <td>{formatCurrency2(yearlyStockTransactionSummary.buy.amount)}</td>
            </tr>
            <tr>
              <td>Sales</td>
              <td>{yearlyStockTransactionSummary.sell.count}</td>
              <td>{formatCurrency2(yearlyStockTransactionSummary.sell.amount)}</td>
            </tr>
            <tr>
              <td>Dividends</td>
              <td>{yearlyStockTransactionSummary.div.count}</td>
              <td>{formatCurrency2(yearlyStockTransactionSummary.div.amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>{selectedYear ?? '--'} Cash Transaction Summary</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Count</th>
              <th>Total Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Deposits</td>
              <td>{yearlyCashTransactionSummary.deposit.count}</td>
              <td>{formatCurrency2(yearlyCashTransactionSummary.deposit.amount)}</td>
            </tr>
            <tr>
              <td>Withdrawals</td>
              <td>{yearlyCashTransactionSummary.withdrawal.count}</td>
              <td>{formatCurrency2(yearlyCashTransactionSummary.withdrawal.amount)}</td>
            </tr>
            <tr>
              <td>Interest</td>
              <td>{yearlyCashTransactionSummary.interest.count}</td>
              <td>{formatCurrency2(yearlyCashTransactionSummary.interest.amount)}</td>
            </tr>
            <tr>
              <td>Fees</td>
              <td>{yearlyCashTransactionSummary.fee.count}</td>
              <td>{formatCurrency2(yearlyCashTransactionSummary.fee.amount)}</td>
            </tr>
          </tbody>
        </table>
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
                <td>Portfolio Starting Value (Prior Close: {formatDate(comparisonSummary.startingPortfolioDate)})</td>
                <td>{formatCurrency2(comparisonSummary.startingPortfolioValue)}</td>
              </tr>
              <tr>
                <td>Portfolio Ending Value ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatCurrency2(comparisonSummary.endPoint.portfolioValue)}</td>
              </tr>
              <tr>
                <td>Cash Basis in DOW Benchmark ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatCurrency2(comparisonSummary.endPoint.dowBenchmarkValue)}</td>
              </tr>
              <tr>
                <td>Cash Basis in Nasdaq Benchmark ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatCurrency2(comparisonSummary.endPoint.nasdaqBenchmarkValue)}</td>
              </tr>
              <tr>
                <td>Cash Basis in S&amp;P 500 Benchmark ({formatDate(comparisonSummary.endPoint.date)})</td>
                <td>{formatCurrency2(comparisonSummary.endPoint.sp500BenchmarkValue)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
