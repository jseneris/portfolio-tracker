import { Fragment, useEffect, useState } from 'react'
import { getPortfolioReview, type PortfolioReview } from '../api'
import { formatCurrency2 } from '../formatters'
import { formatDividendTiming, formatWeight, getWaitDayClass, LOSS_TIMING_CRITERIA, LOSS_TIMING_LOT_HEADERS, lossTimingLotValues } from '../reviewMessages'
import TargetDistanceSection from './TargetDistanceSection'

type ReviewHolding = NonNullable<PortfolioReview['snapshot']['holdingReviewContext']>[number]
type RecommendedLotAmount = NonNullable<PortfolioReview['snapshot']['recommendedLotAmount']>
const percent = (value: number | undefined) => value == null ? '--' : `${value.toFixed(2)}%`

export function RecommendedLotAmountSection({ recommendation }: { recommendation: RecommendedLotAmount }) {
  const needed = recommendation.holdings.filter((holding) => holding.lotsNeeded > 0)
  return <section className="panel">
    <div className="row-between insights-section-heading">
      <div><p className="eyebrow">Cash deployment</p><h3>Recommended lot amount</h3></div>
      <span className="muted-text">${recommendation.increment} increments</span>
    </div>
    {!needed.length ? <p>Every holding is already at {formatWeight(recommendation.targetWeight)} weight or above; no cash is needed.</p>
      : recommendation.lotAmount == null ? <p>Available cash ({formatCurrency2(recommendation.availableCash)}) cannot cover a {formatCurrency2(recommendation.increment)} lot
        for every holding below {formatWeight(recommendation.targetWeight)} weight.</p>
      : <>
        <p className="insight-values"><strong>{formatCurrency2(recommendation.lotAmount)}</strong>
          <span>Cash needed: {formatCurrency2(recommendation.totalCost)} of {formatCurrency2(recommendation.availableCash)}</span></p>
        <div className="table-scroll"><table className="table">
          <thead><tr><th>Ticker</th><th>Weight</th><th>Lots needed</th><th>Price</th><th>Shares per lot</th><th>Cost per lot</th><th>Total</th></tr></thead>
          <tbody>{needed.map((holding) => <tr key={holding.ticker}>
            <td><strong>{holding.ticker}</strong></td><td>{formatWeight(holding.weight)}</td><td>{holding.lotsNeeded}</td>
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
    {recommendation.unpricedTickers.length ? <p className="status status-warning">Excluded (no stored price): {recommendation.unpricedTickers.join(', ')}.</p> : null}
    <p className="muted-text">Weight is display lots minus base size. Holdings at {formatWeight(recommendation.targetWeight)} or above need no cash;
      0 needs one lot, -1 needs two, and so on. A lot is one share when the price is above the lot amount,
      otherwise the fewest whole shares reaching it. Uses latest stored closes.</p>
  </section>
}

export function LossTimingTable({ holdings }: { holdings: ReviewHolding[] }) {
  return <div className="table-scroll"><table className="table">
    <thead><tr><th>Ticker</th><th>Yearly Gain/Loss</th><th>Days to wait (prior buy/div window)</th><th>Dividend timing</th></tr></thead>
    <tbody>{holdings.filter((holding) => holding.matchesLossReviewFilter === true).map((holding) => <Fragment key={holding.ticker}>
      <tr>
        <td className={getWaitDayClass(holding.daysUntilPriorAcquisitionWindowClears)}><strong>{holding.ticker}</strong></td>
        <td className="value-negative">{formatCurrency2(holding.yearlyGainLoss)}</td>
        <td>{holding.daysUntilPriorAcquisitionWindowClears ?? 'Unknown'}</td><td>{formatDividendTiming(holding)}</td>
      </tr>
      {holding.qualifyingLossLots?.length ? <tr><td colSpan={4}>
        <h4>{holding.ticker} qualifying buy lots</h4><table className="table">
          <thead><tr>{LOSS_TIMING_LOT_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{holding.qualifyingLossLots.map((lot, index) => <tr key={index}>
            {lossTimingLotValues(lot).map((value, column) => <td key={column} className={column >= 7 ? 'value-negative' : undefined}>{value}</td>)}
          </tr>)}</tbody>
        </table>
      </td></tr> : null}
    </Fragment>)}</tbody>
  </table></div>
}

export function ReviewSections({ review }: { review: PortfolioReview }) {
  const concentrations = review.facts.filter((fact) => fact.type === 'concentration')
  const losses = review.facts.filter((fact) => fact.type === 'unrealized_loss_lot')
  const missing = review.facts.filter((fact) => fact.type === 'missing_price')
  return <>
    <p className="insights-timestamp">Updated {new Date(review.generatedAt).toLocaleString()}</p>
    <section className="panel">
      <h3>Portfolio snapshot</h3>
      <p>{review.snapshot.totals.holdingCount} holdings and {review.snapshot.totals.openLotCount} open lots.
        {' '}Available cash: {formatCurrency2(review.snapshot.cash.availableCash)}.
        {' '}Portfolio value: {review.snapshot.totals.portfolioValue == null ? 'Unavailable (missing prices)' : formatCurrency2(review.snapshot.totals.portfolioValue)}.</p>
      <p className="muted-text">Calculated from tracked portfolio data and latest stored closes. No AI is used or sent this review.</p>
    </section>
    {review.snapshot.recommendedLotAmount ? <RecommendedLotAmountSection recommendation={review.snapshot.recommendedLotAmount} /> : null}
    <section className="panel">
      <h3>Largest concentrations</h3><p className="muted-text">Holdings representing at least 20% of priced equities.</p>
      {concentrations.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>Ticker</th><th>Share of priced equities</th><th>Market value</th></tr></thead>
        <tbody>{concentrations.map((fact) => <tr key={fact.id}><td><strong>{fact.ticker}</strong></td>
          <td>{percent(fact.percentOfEquities)}</td><td>{formatCurrency2(fact.marketValue)}</td></tr>)}</tbody>
      </table></div> : <p>No holding reached the 20% concentration review threshold.</p>}
    </section>
    <section className="panel">
      <h3>Unrealized loss items to review</h3>
      <p className="muted-text">Up to eight open lots with the largest estimated losses at the latest stored closes.</p>
      {losses.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>Ticker</th><th>Acquired</th><th>Shares</th><th>Cost basis</th><th>Estimated value</th><th>Estimated loss</th><th>Tracked acquisitions in prior 30 days</th></tr></thead>
        <tbody>{losses.map((fact) => <tr key={fact.id}>
          <td>{fact.ticker}</td><td>{fact.acquisitionDate?.slice(0, 10) ?? '--'}</td>
          <td>{fact.quantity?.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
          <td>{formatCurrency2(fact.costBasis)}</td><td>{formatCurrency2(fact.estimatedValue)}</td>
          <td className="value-negative">{formatCurrency2(fact.unrealizedLoss)}</td><td>{fact.recentAcquisitionCount ?? 0}</td>
        </tr>)}</tbody>
      </table></div> : <p>No open lots with an estimated loss were found at the latest stored closes.</p>}
    </section>
    <section className="panel">
      <h3>Loss Timing Review (tracked accounts only)</h3>
      <p className="muted-text">{LOSS_TIMING_CRITERIA} Wait days are based on the latest tracked buy or dividend reinvestment:
        the prior 30-day window clears on day 31. Zero means no remaining prior-window wait, not confirmed wash-sale eligibility.
        Future purchases, outside accounts, and substantially identical securities remain unknown.
        Dividend elapsed days use tracked payments, not a prediction.</p>
      <LossTimingTable holdings={review.snapshot.holdingReviewContext ?? []} />
      {!review.snapshot.holdingReviewContext?.some((holding) => holding.matchesLossReviewFilter === true) ? <p>No holdings match the review filter with available data.</p> : null}
    </section>
    {missing.length ? <section className="panel"><h3>Holdings without a stored close</h3><p>{missing.map((fact) => fact.ticker).join(', ')}</p></section> : null}
    <section className="panel insights-limitations"><h3>Important limitations</h3><ul>{review.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
  </>
}

export default function ReviewPage() {
  const [review, setReview] = useState<PortfolioReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  return <div className="portfolio-insights-page">
    <header className="row-between insights-heading">
      <div><p className="eyebrow">Calculated portfolio review</p><h2>Review</h2><p className="muted-text">Holdings, cash deployment, targets, and loss timing. No AI required. As of page load; reload the page to update.</p></div>
    </header>
    <TargetDistanceSection />
    {error ? <p className="status status-error" role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading portfolio review...</p> : null}
    {review ? <ReviewSections review={review} /> : null}
  </div>
}
