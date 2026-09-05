import { useEffect, useMemo, useState } from 'react'
import {
  CashTransaction,
  CompanyProfile,
  HistoricalPrice,
  PORTFOLIO_UPDATED_EVENT,
  StockSplitEvent,
  StockTransaction,
  getAllStockSplits,
  getCashTransactions,
  getCurrentPrices,
  getHistoricalPrices,
  getStockProfileByTicker,
  getStockTransactions,
} from '../api'
import { formatCurrency2 } from '../formatters'
import { calculatePortfolioSnapshot } from '../portfolioSnapshot'

export type AllocationGroupBy = 'ticker' | 'industry' | 'size'

export type AllocationSlice = {
  key: string
  label: string
  value: number
  percent: number
  color: string
  isCash: boolean
}

export type AllocationChartData = {
  slices: AllocationSlice[]
  total: number
  excludedTickers: string[]
  availableCash: number
  isCashNegative: boolean
}

const CASH_SLICE_KEY = 'available-cash'
const CASH_SLICE_LABEL = 'Available Cash'
const CASH_SLICE_COLOR = '#16a34a'
const UNKNOWN_INDUSTRY_LABEL = 'Unknown Industry'
const UNKNOWN_SIZE_LABEL = 'Unknown Size'

const SLICE_COLORS = [
  '#1d4ed8',
  '#db2777',
  '#ea580c',
  '#0891b2',
  '#7c3aed',
  '#65a30d',
  '#e11d48',
  '#0d9488',
  '#ca8a04',
  '#4f46e5',
  '#9333ea',
  '#0284c7',
]

const SIZE_CLASSIFICATION_ORDER = [
  'Mega Cap',
  'Large Cap',
  'Mid Cap',
  'Small Cap',
  'Micro Cap',
  'Nano Cap',
]

function sizeClassificationRank(label: string): number {
  const index = SIZE_CLASSIFICATION_ORDER.indexOf(label)
  return index === -1 ? SIZE_CLASSIFICATION_ORDER.length : index
}

function toDateOnly(value: string): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : ''
}

function subtractDaysFromDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function formatDateTime(value: Date | null) {
  return value ? value.toLocaleString() : 'Never'
}

function formatPercent2(value: number) {
  return `${value.toFixed(2)}%`
}

export type AllocationSortColumn = 'default' | 'label' | 'value' | 'percent'
export type AllocationSortDirection = 'asc' | 'desc'

export function sortAllocationSlices(
  slices: AllocationSlice[],
  column: AllocationSortColumn,
  direction: AllocationSortDirection
): AllocationSlice[] {
  if (column === 'default') {
    return [...slices]
  }

  const directionMultiplier = direction === 'asc' ? 1 : -1

  const compare = (first: AllocationSlice, second: AllocationSlice) => {
    if (column === 'label') {
      return first.label.localeCompare(second.label) || second.value - first.value
    }

    const firstValue = column === 'value' ? first.value : first.percent
    const secondValue = column === 'value' ? second.value : second.percent
    return firstValue - secondValue || first.label.localeCompare(second.label)
  }

  const cashSlices = slices.filter((slice) => slice.isCash)
  const stockSlices = slices.filter((slice) => !slice.isCash)
  stockSlices.sort((first, second) => compare(first, second) * directionMultiplier)

  return [...cashSlices, ...stockSlices]
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDegrees: number) {
  const angleRadians = ((angleDegrees - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians),
  }
}

function describeDonutSlice(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle)
  const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle)
  const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle)

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ')
}

export function buildAllocationSlices(args: {
  groupBy: AllocationGroupBy
  holdings: Array<{ ticker: string; marketValue: number | null }>
  profilesByTicker: Record<string, CompanyProfile | null>
  availableCash: number
}): AllocationChartData {
  const { groupBy, holdings, profilesByTicker, availableCash } = args

  const excludedTickers: string[] = []
  const valueByKey = new Map<string, { label: string; value: number }>()

  for (const holding of holdings) {
    const marketValue = Number(holding.marketValue)
    if (!Number.isFinite(marketValue) || marketValue <= 0) {
      excludedTickers.push(holding.ticker)
      continue
    }

    const profile = profilesByTicker[holding.ticker]
    let key: string
    if (groupBy === 'industry') {
      key = String(profile?.industry || '').trim() || UNKNOWN_INDUSTRY_LABEL
    } else if (groupBy === 'size') {
      key = String(profile?.sizeClassification || '').trim() || UNKNOWN_SIZE_LABEL
    } else {
      key = holding.ticker
    }

    const existing = valueByKey.get(key)
    if (existing) {
      existing.value += marketValue
    } else {
      valueByKey.set(key, { label: key, value: marketValue })
    }
  }

  const groups = Array.from(valueByKey.entries()).map(([key, group]) => ({
    key,
    label: group.label,
    value: group.value,
  }))

  if (groupBy === 'size') {
    groups.sort((first, second) =>
      sizeClassificationRank(first.key) - sizeClassificationRank(second.key) || second.value - first.value
    )
  } else {
    groups.sort((first, second) => second.value - first.value || first.label.localeCompare(second.label))
  }

  const cashValue = availableCash > 0 ? availableCash : 0
  const total = groups.reduce((sum, group) => sum + group.value, 0) + cashValue

  const slices: AllocationSlice[] = []

  if (cashValue > 0) {
    slices.push({
      key: CASH_SLICE_KEY,
      label: CASH_SLICE_LABEL,
      value: cashValue,
      percent: total > 0 ? (cashValue / total) * 100 : 0,
      color: CASH_SLICE_COLOR,
      isCash: true,
    })
  }

  groups.forEach((group, index) => {
    slices.push({
      key: group.key,
      label: group.label,
      value: group.value,
      percent: total > 0 ? (group.value / total) * 100 : 0,
      color: SLICE_COLORS[index % SLICE_COLORS.length],
      isCash: false,
    })
  })

  return {
    slices,
    total,
    excludedTickers,
    availableCash,
    isCashNegative: availableCash < 0,
  }
}

function AllocationDonutChart({ data }: { data: AllocationChartData }) {
  const center = 100
  const outerRadius = 90
  const innerRadius = 55

  let runningAngle = 0

  return (
    <svg
      viewBox="0 0 200 200"
      className="allocation-chart"
      role="img"
      aria-label="Portfolio allocation pie chart"
    >
      {data.slices.map((slice) => {
        const fraction = data.total > 0 ? slice.value / data.total : 0
        if (fraction <= 0) {
          return null
        }

        const tooltip = `${slice.label}: ${formatCurrency2(slice.value)} (${formatPercent2(slice.percent)})`

        if (fraction >= 0.999999) {
          return (
            <circle
              key={slice.key}
              cx={center}
              cy={center}
              r={(outerRadius + innerRadius) / 2}
              fill="none"
              stroke={slice.color}
              strokeWidth={outerRadius - innerRadius}
            >
              <title>{tooltip}</title>
            </circle>
          )
        }

        const startAngle = runningAngle
        const endAngle = runningAngle + fraction * 360
        runningAngle = endAngle

        return (
          <path
            key={slice.key}
            d={describeDonutSlice(center, center, outerRadius, innerRadius, startAngle, endAngle)}
            fill={slice.color}
            stroke="#ffffff"
            strokeWidth={1}
          >
            <title>{tooltip}</title>
          </path>
        )
      })}
      <text x={center} y={center - 6} textAnchor="middle" className="allocation-chart-center-label">
        Total
      </text>
      <text x={center} y={center + 14} textAnchor="middle" className="allocation-chart-center-value">
        {formatCurrency2(data.total)}
      </text>
    </svg>
  )
}

export default function AllocationsPage() {
  const [groupBy, setGroupBy] = useState<AllocationGroupBy>('ticker')
  const [sortColumn, setSortColumn] = useState<AllocationSortColumn>('default')
  const [sortDirection, setSortDirection] = useState<AllocationSortDirection>('asc')
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([])
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPrice[]>([])
  const [splitEvents, setSplitEvents] = useState<StockSplitEvent[]>([])
  const [currentPricesByTicker, setCurrentPricesByTicker] = useState<Record<string, number>>({})
  const [profilesByTicker, setProfilesByTicker] = useState<Record<string, CompanyProfile | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

  const snapshotDate = new Date().toISOString().slice(0, 10)

  async function loadAllocations() {
    setLoading(true)
    setError(null)

    try {
      const [transactionsResult, cashTransactionsResult, splitEventsResult] = await Promise.all([
        getStockTransactions(),
        getCashTransactions(),
        getAllStockSplits(),
      ])

      const tickers = Array.from(new Set(
        transactionsResult
          .map((transaction) => String(transaction.ticker || '').toUpperCase())
          .filter((ticker) => ticker.length > 0)
      )).sort()

      const earliestTransactionDate = transactionsResult.reduce((earliest, transaction) => {
        const transactionDate = toDateOnly(transaction.transactionDate)
        return transactionDate && (!earliest || transactionDate < earliest) ? transactionDate : earliest
      }, '')
      const historicalStartDate = earliestTransactionDate
        ? subtractDaysFromDateOnly(earliestTransactionDate, 14)
        : snapshotDate

      const [pricesResult, currentPricesResult, profilesResult] = await Promise.all([
        transactionsResult.length > 0
          ? getHistoricalPrices(historicalStartDate, snapshotDate)
          : Promise.resolve([] as HistoricalPrice[]),
        tickers.length > 0
          ? getCurrentPrices(tickers)
          : Promise.resolve(null),
        Promise.all(tickers.map((ticker) => getStockProfileByTicker(ticker).catch(() => null))),
      ])

      const nextCurrentPricesByTicker: Record<string, number> = {}
      for (const pricePoint of currentPricesResult?.prices ?? []) {
        const ticker = String(pricePoint.ticker || '').toUpperCase()
        const price = Number(pricePoint.price)
        if (ticker && Number.isFinite(price) && price > 0) {
          nextCurrentPricesByTicker[ticker] = price
        }
      }

      const nextProfilesByTicker: Record<string, CompanyProfile | null> = {}
      profilesResult.forEach((profile, index) => {
        nextProfilesByTicker[tickers[index]] = profile
      })

      setStockTransactions(transactionsResult)
      setCashTransactions(cashTransactionsResult)
      setSplitEvents(splitEventsResult)
      setHistoricalPrices(pricesResult)
      setCurrentPricesByTicker(nextCurrentPricesByTicker)
      setProfilesByTicker(nextProfilesByTicker)
      setLastUpdatedAt(new Date())
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load allocations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAllocations()
  }, [])

  useEffect(() => {
    const handlePortfolioUpdated = () => {
      void loadAllocations()
    }

    window.addEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
    return () => window.removeEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
  }, [])

  const allocation = useMemo(() => {
    const snapshot = calculatePortfolioSnapshot({
      stockTransactions,
      cashTransactions,
      historicalPrices,
      splitEvents,
      snapshotDate,
      currentPricesByTicker,
    })

    return buildAllocationSlices({
      groupBy,
      holdings: snapshot.holdings,
      profilesByTicker,
      availableCash: snapshot.availableCash,
    })
  }, [cashTransactions, currentPricesByTicker, groupBy, historicalPrices, profilesByTicker, snapshotDate, splitEvents, stockTransactions])

  const sortedSlices = useMemo(() => sortAllocationSlices(allocation.slices, sortColumn, sortDirection), [allocation, sortColumn, sortDirection])

  function handleSort(column: Exclude<AllocationSortColumn, 'default'>) {
    if (sortColumn === column) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortColumn(column)
    setSortDirection(column === 'label' ? 'asc' : 'desc')
  }

  function getSortIndicator(column: AllocationSortColumn) {
    if (sortColumn !== column) {
      return ''
    }
    return sortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  const groupByOptions: Array<{ value: AllocationGroupBy; label: string }> = [
    { value: 'ticker', label: 'By Ticker' },
    { value: 'industry', label: 'By Industry' },
    { value: 'size', label: 'By Size' },
  ]

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Allocations</h2>
          <p>Current portfolio allocation by ticker, industry, or size, including available cash.</p>
        </div>
        <div className="stack-right">
          <div className="inline-actions">
            <div className="inline-actions" role="group" aria-label="Group allocation by">
              {groupByOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={groupBy === option.value ? 'button button-primary' : 'button'}
                  aria-pressed={groupBy === option.value}
                  onClick={() => setGroupBy(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button className="button" type="button" onClick={() => void loadAllocations()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <small>Last updated: {formatDateTime(lastUpdatedAt)}</small>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}

      {loading ? (
        <div className="panel">Loading allocations...</div>
      ) : allocation.slices.length === 0 ? (
        <div className="panel">No allocation data available. Add cash or stock transactions to see your allocation.</div>
      ) : (
        <div className="panel">
          <h3>Allocation {groupByOptions.find((option) => option.value === groupBy)?.label}</h3>
          <div className="allocation-layout">
            <div className="allocation-chart-wrap">
              <AllocationDonutChart data={allocation} />
            </div>
            <div className="allocation-legend">
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="sortable-header" onClick={() => handleSort('label')}>
                      Slice{getSortIndicator('label')}
                    </th>
                    <th className="sortable-header" onClick={() => handleSort('value')}>
                      Value{getSortIndicator('value')}
                    </th>
                    <th className="sortable-header" onClick={() => handleSort('percent')}>
                      Allocation{getSortIndicator('percent')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSlices.map((slice) => (
                    <tr key={slice.key} className={slice.isCash ? 'allocation-cash-row' : undefined}>
                      <td>
                        <span className="legend-swatch" style={{ backgroundColor: slice.color }} />
                      </td>
                      <td>{slice.label}</td>
                      <td>{formatCurrency2(slice.value)}</td>
                      <td>{formatPercent2(slice.percent)}</td>
                    </tr>
                  ))}
                  <tr className="allocation-total-row">
                    <td></td>
                    <td>Total</td>
                    <td>{formatCurrency2(allocation.total)}</td>
                    <td>{formatPercent2(100)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          {allocation.excludedTickers.length > 0 ? (
            <p className="allocation-note">
              Excluded because no price data is available: {allocation.excludedTickers.join(', ')}
            </p>
          ) : null}
          {allocation.isCashNegative ? (
            <p className="allocation-note">
              Available cash is negative ({formatCurrency2(allocation.availableCash)}) and is not shown as a slice.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
