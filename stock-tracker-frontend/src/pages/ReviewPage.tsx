import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getCashTransactions,
  getPortfolioComparisonAll,
  getPortfolioReview,
  getStockTransactions,
  type CashTransaction,
  type PortfolioComparisonPoint,
  type PortfolioReview,
  type StockTransaction,
} from '../api'
import { formatCurrency2 } from '../formatters'
import { calculatePortfolioValue } from '../portfolioSnapshot'
import { formatDividendTiming, formatWeight, getWaitDayClass, LOSS_TIMING_LOT_HEADERS, lossTimingLotValues } from '../reviewMessages'
import TargetDistanceSection from './TargetDistanceSection'
import { TickerInfoBadges } from '../tickerBadges'

type ReviewHolding = NonNullable<PortfolioReview['snapshot']['holdingReviewContext']>[number]
type RecommendedLotAmount = NonNullable<PortfolioReview['snapshot']['recommendedLotAmount']>
const percent = (value: number | undefined) => value == null ? '--' : `${value.toFixed(2)}%`
const ASSUMED_LOT_SIZE = 300
const LARGEST_LOT_MULTIPLE = 5

export function getHoldingsWithLargeLots(snapshot: PortfolioReview['snapshot']) {
  const largestDisplayLots = new Map(
    (snapshot.holdingReviewContext ?? []).map((holding) => [holding.ticker, holding.largestDisplayLot])
  )
  return snapshot.holdings
    .map((holding) => {
      const largestDisplayLot = largestDisplayLots.get(holding.ticker) ?? 0
      const closePrice = holding.closePrice
      return {
        ticker: holding.ticker,
        largestDisplayLot,
        closePrice,
        marketDate: holding.marketDate,
        marketValue: closePrice == null ? null : largestDisplayLot * closePrice,
      }
    })
    .filter((holding): holding is typeof holding & { marketValue: number } => holding.marketValue != null &&
      holding.marketValue >= ASSUMED_LOT_SIZE * LARGEST_LOT_MULTIPLE)
    .sort((a, b) => b.marketValue - a.marketValue)
}

function TickerLink({ ticker }: { ticker: string }) {
  return <><Link className="link-button" to={`/stocks/${encodeURIComponent(ticker)}`}>{ticker}</Link><TickerInfoBadges ticker={ticker} /></>
}

export function RecommendedLotAmountSection({ recommendation }: { recommendation: RecommendedLotAmount }) {
  const needed = recommendation.holdings.filter((holding) => holding.lotsNeeded > 0)
  const aboveTarget = recommendation.holdings.filter((holding) => holding.lotsAbovePlusOne > 0)
  return <details className="panel review-collapsible">
    <summary className="review-section-summary"><h3>Recommended lot amount</h3></summary>
    <div className="review-section-content">
    <p>{recommendation.totalLotsAbovePlusOne} lots above +1 base across {aboveTarget.length} {aboveTarget.length === 1 ? 'ticker' : 'tickers'}.</p>
    {aboveTarget.length ? <div className="table-scroll"><table className="table">
      <thead><tr><th>Ticker</th><th>Weight</th><th>Lots above +1 base</th></tr></thead>
      <tbody>{aboveTarget.map((holding) => <tr key={holding.ticker}>
        <td><strong><TickerLink ticker={holding.ticker} /></strong></td><td>{formatWeight(holding.weight)}</td><td>{holding.lotsAbovePlusOne}</td>
      </tr>)}</tbody>
    </table></div> : null}
    {!needed.length ? <p>Every holding is already at {formatWeight(recommendation.targetWeight)} weight or above; no cash is needed.</p>
      : recommendation.lotAmount == null ? <p>Available cash ({formatCurrency2(recommendation.availableCash)}) cannot cover the minimum {formatCurrency2(250)} lot amount
        for every holding below {formatWeight(recommendation.targetWeight)} weight.</p>
      : <>
        <p className="insight-values"><strong>{formatCurrency2(recommendation.lotAmount)}</strong>
          <span>Cash needed: {formatCurrency2(recommendation.totalCost)} of {formatCurrency2(recommendation.availableCash)}</span></p>
        <div className="table-scroll"><table className="table">
          <thead><tr><th>Ticker</th><th>Weight</th><th>Lots needed</th><th>Price</th><th>Shares per lot</th><th>Cost per lot</th><th>Total</th></tr></thead>
          <tbody>{needed.map((holding) => <tr key={holding.ticker}>
            <td><strong><TickerLink ticker={holding.ticker} /></strong></td><td>{formatWeight(holding.weight)}</td><td>{holding.lotsNeeded}</td>
            <td>{formatCurrency2(holding.closePrice)}</td><td>{holding.sharesPerLot ?? '--'}</td>
            <td>{formatCurrency2(holding.costPerLot)}</td><td>{formatCurrency2(holding.totalCost)}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    {recommendation.nextSteps.length ? <>
      <h4>Next steps</h4><div className="table-scroll"><table className="table">
        <thead><tr><th>Lot amount</th><th>Cash needed</th><th>Additional cash needed</th></tr></thead>
        <tbody>{recommendation.nextSteps.map((step) => <tr key={step.lotAmount}>
          <td><strong>{formatCurrency2(step.lotAmount)}</strong></td><td>{formatCurrency2(step.totalCost)}</td>
          <td className={step.shortfall > 0 ? 'value-negative' : undefined}>{formatCurrency2(step.shortfall)}</td>
        </tr>)}</tbody>
      </table></div>
    </> : null}
    {recommendation.unpricedTickers.length ? <p className="status status-warning">Excluded (no stored price): {recommendation.unpricedTickers.map((ticker, index) =>
      <Fragment key={ticker}>{index ? ', ' : ''}<TickerLink ticker={ticker} /></Fragment>)}.</p> : null}
    <p className="muted-text">Recommended amounts start at $250 and increase in $50 steps. Weight is display lots minus base size.
      Lots above +1 base count each additional lot (for example, +2 contributes one; +3 contributes two).
      Holdings at {formatWeight(recommendation.targetWeight)} or above need no cash;
      0 needs one lot, -1 needs two, and so on. A lot is one share when the price is above the lot amount,
      otherwise the fewest whole shares reaching it. Uses latest stored closes.</p>
    </div>
  </details>
}

export function LossTimingTable({ holdings }: { holdings: ReviewHolding[] }) {
  return <table className="table">
    <thead><tr><th>Ticker</th><th>Yearly Gain/Loss</th><th>Days to wait (prior buy/div window)</th><th>Dividend timing</th></tr></thead>
    <tbody>{holdings.filter((holding) => holding.matchesLossReviewFilter === true).map((holding) => <Fragment key={holding.ticker}>
      <tr>
        <td className={getWaitDayClass(holding.daysUntilPriorAcquisitionWindowClears)}><strong><TickerLink ticker={holding.ticker} /></strong></td>
        <td className="value-negative">{formatCurrency2(holding.yearlyGainLoss)}</td>
        <td>{holding.daysUntilPriorAcquisitionWindowClears ?? 'Unknown'}</td><td>{formatDividendTiming(holding)}</td>
      </tr>
      {holding.qualifyingLossLots?.length ? <tr className="loss-timing-lots"><td colSpan={4}>
        <table className="table">
          <thead><tr>{LOSS_TIMING_LOT_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{holding.qualifyingLossLots.map((lot, index) => <tr key={index}>
            {lossTimingLotValues(lot).map((value, column) => <td key={column} className={column >= 7 ? 'value-negative' : undefined}>{value}</td>)}
          </tr>)}</tbody>
        </table>
      </td></tr> : null}
    </Fragment>)}</tbody>
  </table>
}

type TransactionSummary = Record<string, { count: number; amount: number }>
type PerformanceTransactions = Array<{ type: string; amount: number | null; transactionDate: string }>

function summarizeTransactions(transactions: PerformanceTransactions, year: number | null, types: string[]): TransactionSummary {
  const summary: TransactionSummary = Object.fromEntries(types.map((type) => [type, { count: 0, amount: 0 }]))

  for (const transaction of transactions) {
    const date = new Date(transaction.transactionDate)
    if (Number.isNaN(date.getTime()) || (year != null && date.getUTCFullYear() !== year)) {
      continue
    }

    const type = String(transaction.type || '').toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(summary, type)) {
      continue
    }

    const amount = Number(transaction.amount)
    summary[type].count += 1
    summary[type].amount += Number.isFinite(amount) ? amount : 0
  }

  return summary
}

function formatComparisonDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

function PerformancePeriod({
  label,
  year,
  stockTransactions,
  cashTransactions,
  points,
}: {
  label: string
  year: number | null
  stockTransactions: StockTransaction[]
  cashTransactions: CashTransaction[]
  points: PortfolioComparisonPoint[]
}) {
  const stockSummary = summarizeTransactions(stockTransactions, year, ['buy', 'sell', 'div'])
  const cashSummary = summarizeTransactions(cashTransactions, year, ['deposit', 'withdrawal', 'interest', 'fee'])
  const comparisonPoints = points
    .filter((point) => year == null || point.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date))

  return <>
    <h4>{label} Stock Transaction Summary</h4>
    <div className="table-scroll"><table className="table">
      <thead><tr><th>Type</th><th>Count</th><th>Total Amount</th></tr></thead>
      <tbody>
        <tr><td>Purchases</td><td>{stockSummary.buy.count}</td><td>{formatCurrency2(stockSummary.buy.amount)}</td></tr>
        <tr><td>Sales</td><td>{stockSummary.sell.count}</td><td>{formatCurrency2(stockSummary.sell.amount)}</td></tr>
        <tr><td>Dividends</td><td>{stockSummary.div.count}</td><td>{formatCurrency2(stockSummary.div.amount)}</td></tr>
      </tbody>
    </table></div>
    <h4>{label} Cash Transaction Summary</h4>
    <div className="table-scroll"><table className="table">
      <thead><tr><th>Type</th><th>Count</th><th>Total Amount</th></tr></thead>
      <tbody>
        <tr><td>Deposits</td><td>{cashSummary.deposit.count}</td><td>{formatCurrency2(cashSummary.deposit.amount)}</td></tr>
        <tr><td>Withdrawals</td><td>{cashSummary.withdrawal.count}</td><td>{formatCurrency2(cashSummary.withdrawal.amount)}</td></tr>
        <tr><td>Interest</td><td>{cashSummary.interest.count}</td><td>{formatCurrency2(cashSummary.interest.amount)}</td></tr>
        <tr><td>Fees</td><td>{cashSummary.fee.count}</td><td>{formatCurrency2(cashSummary.fee.amount)}</td></tr>
      </tbody>
    </table></div>
    {comparisonPoints.length === 0 ? <p>No comparison summary available yet.</p> : (() => {
      const startPoint = comparisonPoints[0]
      const endPoint = comparisonPoints[comparisonPoints.length - 1]
      return <div className="table-scroll"><table className="table">
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          <tr>
            <td>Portfolio Starting Value (Prior Close: {formatComparisonDate(startPoint.date)})</td>
            <td>{formatCurrency2(startPoint.portfolioValue)}</td>
          </tr>
          <tr><td>Portfolio Ending Value ({formatComparisonDate(endPoint.date)})</td><td>{formatCurrency2(endPoint.portfolioValue)}</td></tr>
          <tr><td>Cash Basis in DOW Benchmark ({formatComparisonDate(endPoint.date)})</td><td>{formatCurrency2(endPoint.dowBenchmarkValue)}</td></tr>
          <tr><td>Cash Basis in Nasdaq Benchmark ({formatComparisonDate(endPoint.date)})</td><td>{formatCurrency2(endPoint.nasdaqBenchmarkValue)}</td></tr>
          <tr><td>Cash Basis in S&amp;P 500 Benchmark ({formatComparisonDate(endPoint.date)})</td><td>{formatCurrency2(endPoint.sp500BenchmarkValue)}</td></tr>
        </tbody>
      </table></div>
    })()}
  </>
}

export function PerformanceSection({
  stockTransactions,
  cashTransactions,
  comparisonPoints,
}: {
  stockTransactions: StockTransaction[]
  cashTransactions: CashTransaction[]
  comparisonPoints: PortfolioComparisonPoint[]
}) {
  const alignedPoints = comparisonPoints.map((point) => ({
    ...point,
    portfolioValue: calculatePortfolioValue(point.availableCash, point.stockValue) ?? 0,
  }))
  const transactionYears = [...stockTransactions, ...cashTransactions]
    .map((transaction) => new Date(transaction.transactionDate))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map((date) => date.getUTCFullYear())
  const firstYear = transactionYears.length > 0
    ? transactionYears.reduce((earliest, year) => Math.min(earliest, year))
    : null
  const currentYear = new Date().getUTCFullYear()
  const years = firstYear == null || firstYear > currentYear
    ? []
    : Array.from({ length: currentYear - firstYear + 1 }, (_, index) => currentYear - index)

  return <details className="panel review-collapsible">
    <summary className="review-section-summary"><h3>Performance</h3></summary>
    <div className="review-section-content">
      <details className="review-collapsible review-performance-period">
        <summary><h4>All Time</h4></summary>
        <PerformancePeriod
          label="All Time"
          year={null}
          stockTransactions={stockTransactions}
          cashTransactions={cashTransactions}
          points={alignedPoints}
        />
      </details>
      {years.map((year) => <details className="review-collapsible review-performance-period" key={year}>
        <summary><h4>{year}</h4></summary>
        <PerformancePeriod
          label={String(year)}
          year={year}
          stockTransactions={stockTransactions}
          cashTransactions={cashTransactions}
          points={alignedPoints}
        />
      </details>)}
    </div>
  </details>
}

export function ReviewSections({
  review,
  performanceData,
}: {
  review: PortfolioReview
  performanceData?: {
    stockTransactions: StockTransaction[]
    cashTransactions: CashTransaction[]
    comparisonPoints: PortfolioComparisonPoint[]
  }
}) {
  const concentrations = review.facts.filter((fact) => fact.type === 'concentration')
  const missing = review.facts.filter((fact) => fact.type === 'missing_price')
  const largeLots = getHoldingsWithLargeLots(review.snapshot)
  return <>
    <p className="insights-timestamp">Updated {new Date(review.generatedAt).toLocaleString()}</p>
    {performanceData ? <PerformanceSection {...performanceData} /> : null}
    {review.snapshot.recommendedLotAmount ? <RecommendedLotAmountSection recommendation={review.snapshot.recommendedLotAmount} /> : null}
    <details className="panel review-collapsible">
      <summary><h3>Largest concentrations</h3></summary>
      <div className="review-section-content"><p className="muted-text">Holdings representing at least 20% of priced equities.</p>
      {concentrations.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>Ticker</th><th>Share of priced equities</th><th>Market value</th></tr></thead>
        <tbody>{concentrations.map((fact) => <tr key={fact.id}><td><strong><TickerLink ticker={fact.ticker} /></strong></td>
          <td>{percent(fact.percentOfEquities)}</td><td>{formatCurrency2(fact.marketValue)}</td></tr>)}</tbody>
      </table></div> : <p>No holding reached the 20% concentration review threshold.</p>}
      <h4>Largest display-lot value at least 5× a $300 lot size ($1,500)</h4>
      <p className="muted-text">Values use the largest individual display lot × latest stored close. The price date is shown for verification.</p>
      {largeLots.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>Ticker</th><th>Largest display lot (shares)</th><th>Stored close</th><th>Price as of</th><th>Largest display-lot value</th></tr></thead>
        <tbody>{largeLots.map((lot) => <tr key={lot.ticker}>
          <td><strong><TickerLink ticker={lot.ticker} /></strong></td>
          <td>{lot.largestDisplayLot}</td>
          <td>{formatCurrency2(lot.closePrice)}</td><td>{lot.marketDate ?? 'Unknown'}</td>
          <td>{formatCurrency2(lot.marketValue)}</td>
        </tr>)}</tbody>
      </table></div> : <p>No largest individual display lot is valued at $1,500 or more.</p>}
      </div>
    </details>
    <TargetDistanceSection acquisitionTiming={review.snapshot.holdingReviewContext} openLots={review.snapshot.openLots} />
    {missing.length ? <details className="panel review-collapsible"><summary><h3>Holdings without a stored close</h3></summary>
      <div className="review-section-content"><p>{missing.map((fact, index) =>
        <Fragment key={fact.id}>{index ? ', ' : ''}<TickerLink ticker={fact.ticker} /></Fragment>)}</p></div>
    </details> : null}
  </>
}

export default function ReviewPage() {
  const [review, setReview] = useState<PortfolioReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [performanceData, setPerformanceData] = useState<{
    stockTransactions: StockTransaction[]
    cashTransactions: CashTransaction[]
    comparisonPoints: PortfolioComparisonPoint[]
  } | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPortfolioReview().then((next) => {
      if (!cancelled) { setReview(next); setError(null) }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load portfolio review.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    Promise.all([getStockTransactions(), getCashTransactions(), getPortfolioComparisonAll()])
      .then(([stockTransactions, cashTransactions, comparison]) => {
        if (!cancelled) {
          setPerformanceData({
            stockTransactions,
            cashTransactions,
            comparisonPoints: comparison.points ?? [],
          })
          setPerformanceError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setPerformanceError(err instanceof Error ? err.message : 'Unable to load performance summaries.')
      })
      .finally(() => {
        if (!cancelled) setPerformanceLoading(false)
      })
    return () => { cancelled = true }
  }, [])
  return <div className="portfolio-insights-page">
    <header className="row-between insights-heading">
      <div><p className="eyebrow">Calculated portfolio review</p><h2>Review</h2><p className="muted-text">Performance, holdings, cash deployment, targets, and potential sales. No AI required. As of page load; reload the page to update.</p></div>
    </header>
    {error ? <p className="status status-error" role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading portfolio review...</p> : null}
    {review ? <>
      {performanceLoading ? <p role="status">Loading performance summaries...</p>
        : performanceError ? <p className="status status-error" role="alert">{performanceError}</p>
          : null}
      <ReviewSections review={review} performanceData={performanceData ?? undefined} />
    </> : null}
  </div>
}
