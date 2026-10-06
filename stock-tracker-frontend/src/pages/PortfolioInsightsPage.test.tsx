import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PortfolioInsightsPage, { ChatResponseActions, formatDividendTiming, buildReviewSectionContent } from './PortfolioInsightsPage'
import { PortfolioInsightsReport } from '../api'

function render(overrides: Partial<Parameters<typeof ChatResponseActions>[0]> = {}) {
  return renderToStaticMarkup(createElement(ChatResponseActions, {
    saved: false, saving: false, disabled: false, onSend: () => undefined, ...overrides,
  }))
}

describe('AI response save action', () => {
  const report: PortfolioInsightsReport = {
    reportId: 'review', generatedAt: '2026-10-06T20:00:00Z',
    facts: [{ id: 'concentration-TEST', type: 'concentration', ticker: 'TEST', marketValue: 100, percentOfEquities: 50 }],
    explanations: [{ factId: 'concentration-TEST', explanation: 'Concentration commentary.' }],
    limitations: ['Stored closes may be stale.'],
    snapshot: {
      generatedAt: '2026-10-06T20:00:00Z', valuationBasis: 'latest_stored_close',
      holdings: [], openLots: [], missingPriceTickers: [],
      cash: { deposits: 0, withdrawals: 0, interest: 0, fees: 0, buys: 0, sells: 0, availableCash: 0, costBasis: 0, adjustments: 0 },
      totals: { holdingCount: 0, openLotCount: 0, equityCostBasis: 0, pricedEquityValue: 0, equityValue: 0, portfolioValue: 0, unrealizedGainLoss: 0, cashPercentOfPortfolio: null },
      holdingReviewContext: [
        { ticker: 'TEST', displayLotCount: 4, yearlyGainLoss: -10, matchesLossReviewFilter: true,
          lastTrackedAcquisitionDate: null, priorAcquisitionWindowClearsOn: null, daysUntilPriorAcquisitionWindowClears: 0,
          lastTrackedDividendDate: null, nextDeclaredDividendDate: null, daysUntilNextDividend: null, daysSinceLastDividend: 11 },
        { ticker: 'EXCLUDED', displayLotCount: 3, yearlyGainLoss: -10, matchesLossReviewFilter: false,
          lastTrackedAcquisitionDate: null, priorAcquisitionWindowClearsOn: null, daysUntilPriorAcquisitionWindowClears: 10,
          lastTrackedDividendDate: null, nextDeclaredDividendDate: null, daysUntilNextDividend: null, daysSinceLastDividend: null },
      ],
    },
  }

  it('saves concentration results with commentary, timestamp and limitations', () => {
    const text = buildReviewSectionContent(report, 'Largest concentrations')
    expect(text).toContain('TEST: 50.00%')
    expect(text).toContain('Concentration commentary.')
    expect(text).toContain(new Date(report.generatedAt).toISOString())
    expect(text).toContain(report.limitations[0])
  })

  it('saves ticker-level timing with dividend fallback and excludes filtered holdings', () => {
    const text = buildReviewSectionContent(report, 'Loss-review timing')
    expect(text).toContain('TEST: 0 days to wait; 11 days since last tracked dividend')
    expect(text).not.toContain('EXCLUDED')
    expect(text).toContain('not confirmed wash-sale eligibility')
  })

  it('saves empty sections explicitly and allows a section-specific success confirmation', () => {
    expect(buildReviewSectionContent({ ...report, facts: [] }, 'Largest concentrations')).toContain('No holding reached')
    expect(buildReviewSectionContent({ ...report, snapshot: { ...report.snapshot, holdingReviewContext: [] } }, 'Loss-review timing'))
      .toContain('No holdings match')
    expect(render({ saved: true, successText: 'Review section saved.' })).toContain('Review section saved.')
  })

  it('shows the seed and its limits with an explicit per-account enable control', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('Investment horizon: 10 years.')
    expect(html).toContain('more than three display lots')
    expect(html).toContain('not confirmed wash-sale eligibility')
    expect(html).toContain('days since the last tracked dividend')
    expect(html).toContain('Save and enable these assumptions')
  })

  it('uses verified future dividend timing or falls back to elapsed days without treating unknown as zero', () => {
    expect(formatDividendTiming({ daysUntilNextDividend: 5, daysSinceLastDividend: 85 })).toBe('5 days until next dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: 0 })).toBe('0 days since last tracked dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: 11 })).toBe('11 days since last tracked dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: null })).toBe('No tracked dividend')
  })

  it('renders an enabled Send to Messages button for an unsaved answer', () => {
    const html = render()
    expect(html).toContain('Send to Messages')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  it('disables the action during saving or refreshing', () => {
    expect(render({ saving: true })).toContain('Sending...')
    expect(render({ saving: true })).toContain('disabled')
    expect(render({ disabled: true })).toContain('disabled')
  })

  it('confirms success and prevents resending the same answer', () => {
    const html = render({ saved: true })
    expect(html).toContain('Sent to Messages')
    expect(html).toContain('disabled')
    expect(html).toContain('role="status"')
    expect(html).toContain('Question and response saved.')
  })

  it('shows an explicit error while allowing a retry', () => {
    const html = render({ error: 'Unable to save' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Unable to save')
    expect(html).not.toContain('disabled')
  })
})
