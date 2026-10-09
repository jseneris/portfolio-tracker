import { PortfolioInsightsReport } from './api'
import { formatCurrency2 } from './formatters'

export type ReviewSectionTitle = 'Largest concentrations' | 'Loss-review timing' | 'Recommended lot amount'
const REVIEW_SECTION_TITLES: string[] = ['Largest concentrations', 'Loss-review timing', 'Recommended lot amount']
const FORMAT_MARKER = 'Formatted review v1:\n'

type ReviewCell = { text: string; tone: 'neutral' | 'positive' | 'negative' }
type ReviewTable = { heading: string; headers: string[]; rows: ReviewCell[][] }
type FormattedReview = {
  version: 1
  title: ReviewSectionTitle
  generatedAt: string
  description: string
  headers: string[]
  rows: ReviewCell[][]
  commentary: Array<{ ticker: string; text: string }>
  emptyText: string
  limitations: string[]
  additionalTables?: ReviewTable[]
}

const cell = (text: string, tone: ReviewCell['tone'] = 'neutral'): ReviewCell => ({ text, tone })

export function formatWeight(weight: number) {
  return weight > 0 ? `+${weight}` : String(weight)
}

function buildRecommendedLotReview(report: PortfolioInsightsReport): FormattedReview {
  const recommendation = report.snapshot.recommendedLotAmount
  const needed = recommendation?.holdings.filter((holding) => holding.lotsNeeded > 0) ?? []
  const target = formatWeight(recommendation?.targetWeight ?? 1)
  const summary = !recommendation ? 'No recommended lot amount was calculated for this review.'
    : !needed.length ? `Every holding is already at ${target} weight or above; no cash is needed.`
      : recommendation.lotAmount == null
        ? `Available cash (${formatCurrency2(recommendation.availableCash)}) cannot cover a ${formatCurrency2(recommendation.increment)} lot for every holding below ${target} weight.`
        : `Recommended lot amount: ${formatCurrency2(recommendation.lotAmount)}. Cash needed: ${formatCurrency2(recommendation.totalCost)} of ${formatCurrency2(recommendation.availableCash)}.`
  const unpriced = recommendation?.unpricedTickers.length
    ? ` Excluded (no stored price): ${recommendation.unpricedTickers.join(', ')}.` : ''
  return {
    version: 1, title: 'Recommended lot amount', generatedAt: new Date(report.generatedAt).toISOString(),
    description: `${summary}${unpriced} Weight is display lots minus base size. Holdings at ${target} or above need no cash; 0 needs one lot, -1 needs two, and so on. A lot is one share when the price is above the lot amount, otherwise the fewest whole shares reaching it. Uses latest stored closes.`,
    headers: ['Ticker', 'Weight', 'Lots needed', 'Price', 'Shares per lot', 'Cost per lot', 'Total'],
    rows: recommendation?.lotAmount == null ? [] : needed.map((holding) => [
      cell(holding.ticker), cell(formatWeight(holding.weight)), cell(String(holding.lotsNeeded)),
      cell(formatCurrency2(holding.closePrice)), cell(String(holding.sharesPerLot ?? '--')),
      cell(formatCurrency2(holding.costPerLot)), cell(formatCurrency2(holding.totalCost)),
    ]),
    commentary: [],
    emptyText: 'No holdings to buy at a recommended lot amount.',
    limitations: report.limitations,
    additionalTables: recommendation?.nextSteps.length ? [{
      heading: 'Next steps',
      headers: ['Lot amount', 'Cash needed', 'Additional cash needed'],
      rows: recommendation.nextSteps.map((step) => [
        cell(formatCurrency2(step.lotAmount)), cell(formatCurrency2(step.totalCost)),
        cell(formatCurrency2(step.shortfall), step.shortfall > 0 ? 'negative' : 'neutral'),
      ]),
    }] : [],
  }
}

function ReviewTableView({ headers, rows }: { headers: string[]; rows: ReviewCell[][] }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr>{headers.map((header, index) => <th key={index}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>
          {row.map((item, columnIndex) => <td key={columnIndex}
            className={item.tone === 'positive' ? 'value-positive' : item.tone === 'negative' ? 'value-negative' : ''}>
            {columnIndex === 0 ? <strong>{item.text}</strong> : item.text}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
  )
}

export function getWaitDayClass(days: number | null) {
  return days === 0 ? 'value-positive' : days != null && days > 0 ? 'value-negative' : ''
}

export function formatDividendTiming(holding: { daysUntilNextDividend: number | null; daysSinceLastDividend: number | null }) {
  if (holding.daysUntilNextDividend != null) return `${holding.daysUntilNextDividend} days until next dividend`
  if (holding.daysSinceLastDividend != null) return `${holding.daysSinceLastDividend} days since last tracked dividend`
  return 'No tracked dividend'
}

export function buildFormattedReviewContent(report: PortfolioInsightsReport, title: ReviewSectionTitle): string {
  if (title === 'Recommended lot amount') return FORMAT_MARKER + JSON.stringify(buildRecommendedLotReview(report))
  const facts = report.facts.filter((fact) => fact.type === 'concentration')
  const holdings = report.snapshot.holdingReviewContext?.filter((holding) => holding.matchesLossReviewFilter === true) ?? []
  const isTiming = title === 'Loss-review timing'
  const content: FormattedReview = {
    version: 1, title, generatedAt: new Date(report.generatedAt).toISOString(),
    description: isTiming
      ? 'Only holdings with negative Yearly Gain/Loss and more than three display lots appear below. Wait days reflect the latest tracked buy/dividend reinvestment; the prior window clears on day 31. Zero means no remaining prior-window wait, not confirmed wash-sale eligibility. Future purchases, outside accounts, and substantially identical securities remain unknown. Dividend elapsed days reflect tracked payments, not a prediction.'
      : 'Share of priced equities (20% review threshold).',
    headers: isTiming ? ['Ticker', 'Yearly Gain/Loss', 'Days to wait (prior buy/div window)', 'Dividend timing']
      : ['Ticker', 'Share of priced equities', 'Market value'],
    rows: isTiming ? holdings.map((holding) => [
      cell(holding.ticker, holding.daysUntilPriorAcquisitionWindowClears === 0 ? 'positive'
        : (holding.daysUntilPriorAcquisitionWindowClears ?? 0) > 0 ? 'negative' : 'neutral'),
      cell(formatCurrency2(holding.yearlyGainLoss), 'negative'),
      cell(String(holding.daysUntilPriorAcquisitionWindowClears ?? 'Unknown')),
      cell(formatDividendTiming(holding)),
    ]) : facts.map((fact) => [
      cell(fact.ticker),
      cell(fact.percentOfEquities == null ? '--' : `${fact.percentOfEquities.toFixed(2)}%`),
      cell(formatCurrency2(fact.marketValue)),
    ]),
    commentary: isTiming ? [] : facts.map((fact) => ({
      ticker: fact.ticker,
      text: report.explanations.find((item) => item.factId === fact.id)?.explanation
        || 'No additional model explanation was returned for this item.',
    })),
    emptyText: isTiming ? 'No holdings match the review filter with available data.'
      : 'No holding reached the 20% concentration review threshold.',
    limitations: report.limitations,
  }
  return FORMAT_MARKER + JSON.stringify(content)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isReviewRows(rows: unknown, columnCount: number): rows is ReviewCell[][] {
  return Array.isArray(rows) && rows.every((row) => Array.isArray(row) && row.length === columnCount
    && row.every((item) => isRecord(item) && typeof item.text === 'string'
      && ['neutral', 'positive', 'negative'].includes(String(item.tone))))
}

function isReviewTable(value: unknown): value is ReviewTable {
  return isRecord(value) && typeof value.heading === 'string' && isStringArray(value.headers)
    && value.headers.length > 0 && isReviewRows(value.rows, value.headers.length)
}

function isFormattedReview(value: unknown): value is FormattedReview {
  if (!isRecord(value) || value.version !== 1
    || !REVIEW_SECTION_TITLES.includes(String(value.title))
    || typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))
    || typeof value.description !== 'string' || typeof value.emptyText !== 'string'
    || !isStringArray(value.headers) || !isStringArray(value.limitations)
    || !Array.isArray(value.rows) || !Array.isArray(value.commentary)) return false
  const columnCount = value.headers.length
  const tables = value.additionalTables
  return columnCount > 0 && isReviewRows(value.rows, columnCount)
    && (tables === undefined || (Array.isArray(tables) && tables.every(isReviewTable)))
    && value.commentary.every((item) => isRecord(item) && typeof item.ticker === 'string' && typeof item.text === 'string')
}

export function SavedReviewMessage({ body }: { body: string }) {
  const firstLine = body.split('\n')[0]
  const title = firstLine.slice('Review section: '.length)
  const prefix = `Review section: ${title}\n\n${FORMAT_MARKER}`
  if (!body.startsWith('Review section: ') || !body.startsWith(prefix)) return <p className="message-body">{body}</p>

  let parsed: unknown
  try {
    parsed = JSON.parse(body.slice(prefix.length))
  } catch (error) {
    return <div><p className="status status-error" role="alert">Unable to read saved review formatting: {error instanceof Error ? error.message : 'Invalid JSON'}.</p><p className="message-body">{body}</p></div>
  }
  if (!isFormattedReview(parsed) || parsed.title !== title) {
    return <div><p className="status status-error" role="alert">Saved review formatting is invalid or unsupported.</p><p className="message-body">{body}</p></div>
  }

  return (
    <section className="message-body message-body-formatted">
      <h3>{parsed.title === 'Loss-review timing' ? 'Loss Timing Review' : parsed.title}</h3>
      <p className="muted-text">Review generated: {new Date(parsed.generatedAt).toLocaleString()}</p>
      <p className="muted-text">{parsed.description}</p>
      {parsed.rows.length > 0 ? <ReviewTableView headers={parsed.headers} rows={parsed.rows} /> : <p>{parsed.emptyText}</p>}
      {parsed.additionalTables?.map((table, index) => <div key={index}>
        <h4>{table.heading}</h4>
        <ReviewTableView headers={table.headers} rows={table.rows} />
      </div>)}
      {parsed.commentary.map((item, index) => <p className="insight-commentary" key={index}><strong>{item.ticker}:</strong> {item.text}</p>)}
      <h4>Important limitations</h4>
      <ul>{parsed.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </section>
  )
}
