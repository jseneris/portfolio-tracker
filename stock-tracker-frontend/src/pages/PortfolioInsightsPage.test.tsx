import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PortfolioInsightsPage, { ChatResponseActions, formatDividendTiming, buildReviewSectionContent, LossTimingTable, RecommendedLotAmountSection } from './PortfolioInsightsPage'
import { PortfolioInsightsReport } from '../api'
import { buildFormattedReviewContent, SavedReviewMessage } from '../reviewMessages'

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

  it('preserves concentration tables and commentary through saved message serialization', () => {
    const content = buildFormattedReviewContent(report, 'Largest concentrations')
    const html = renderToStaticMarkup(createElement(SavedReviewMessage, {
      body: `Review section: Largest concentrations\n\n${content}`,
    }))
    expect(html).toContain('<h3>Largest concentrations</h3>')
    expect(html).toContain('<table')
    expect(html).toContain('50.00%')
    expect(html).toContain('$100.00')
    expect(html).toContain('Concentration commentary.')
    expect(html).toContain('Stored closes may be stale.')
    expect(html).not.toContain('Formatted review v1')
    expect(content).not.toContain('userId')
  })

  it('preserves timing tables, yearly losses, colors, and limitations in Messages', () => {
    const holding = report.snapshot.holdingReviewContext![0]
    const savedReport = { ...report, snapshot: { ...report.snapshot, holdingReviewContext: [
      holding,
      { ...holding, ticker: 'WAIT', daysUntilPriorAcquisitionWindowClears: 12 },
      { ...holding, ticker: 'UNKNOWN', daysUntilPriorAcquisitionWindowClears: null },
      report.snapshot.holdingReviewContext![1],
    ] } }
    const html = renderToStaticMarkup(createElement(SavedReviewMessage, {
      body: `Review section: Loss-review timing\n\n${buildFormattedReviewContent(savedReport, 'Loss-review timing')}`,
    }))
    expect(html).toContain('<h3>Loss Timing Review</h3>')
    expect(html).toContain('class="value-positive"><strong>TEST</strong>')
    expect(html).toContain('class="value-negative"><strong>WAIT</strong>')
    expect(html).toContain('class=""><strong>UNKNOWN</strong>')
    expect(html).toContain('-$10.00')
    expect(html).toContain('11 days since last tracked dividend')
    expect(html).toContain('not confirmed wash-sale eligibility')
    expect(html).not.toContain('EXCLUDED')
  })

  it('retains empty review sections and escapes saved text instead of executing HTML', () => {
    const html = renderToStaticMarkup(createElement(SavedReviewMessage, {
      body: `Review section: Largest concentrations\n\n${buildFormattedReviewContent({
        ...report, facts: [], limitations: ['<img src=x onerror=alert(1)>'],
      }, 'Largest concentrations')}`,
    }))
    expect(html).toContain('No holding reached')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('keeps legacy reviews and AI answers readable and explicitly reports malformed formatting', () => {
    const legacy = 'Review section: Loss-review timing\n\nTEST: 0 days to wait'
    expect(renderToStaticMarkup(createElement(SavedReviewMessage, { body: legacy }))).toContain(legacy)
    const answer = 'Question:\nWhat next?\n\nAI response:\nKeep reviewing.'
    expect(renderToStaticMarkup(createElement(SavedReviewMessage, { body: answer }))).toContain(answer)
    const prefix = 'Review section: Loss-review timing\n\nFormatted review v1:\n'
    expect(renderToStaticMarkup(createElement(SavedReviewMessage, { body: prefix + '{broken' }))).toContain('role="alert"')
    expect(renderToStaticMarkup(createElement(SavedReviewMessage, { body: prefix + '{"version":1}' }))).toContain('invalid or unsupported')
  })

  it('saves ticker-level timing with dividend fallback and excludes filtered holdings', () => {
    const text = buildReviewSectionContent(report, 'Loss-review timing')
    expect(text).toContain('TEST: 0 days to wait; 11 days since last tracked dividend')
    expect(text).toContain('Yearly Gain/Loss: -$10.00')
    expect(text).not.toContain('EXCLUDED')
    expect(text).toContain('not confirmed wash-sale eligibility')
  })

  it('colors zero-wait tickers green, waiting tickers red, and leaves unknown waits neutral while showing yearly losses', () => {
    const holding = report.snapshot.holdingReviewContext![0]
    const html = renderToStaticMarkup(createElement(LossTimingTable, { holdings: [
      holding,
      { ...holding, ticker: 'WAIT', daysUntilPriorAcquisitionWindowClears: 12, yearlyGainLoss: -250 },
      { ...holding, ticker: 'UNKNOWN', daysUntilPriorAcquisitionWindowClears: null },
      report.snapshot.holdingReviewContext![1],
    ] }))
    expect(html).toContain('class="value-positive"><strong>TEST</strong>')
    expect(html).toContain('class="value-negative"><strong>WAIT</strong>')
    expect(html).toContain('class=""><strong>UNKNOWN</strong>')
    expect(html).toContain('-$250.00')
    expect(html).toContain('Yearly Gain/Loss')
    expect(html).not.toContain('EXCLUDED')
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

describe('recommended lot amount section', () => {
  const base = {
    increment: 50, targetWeight: 1, availableCash: 2000, unpricedTickers: [],
    holdings: [
      { ticker: 'MINUS', closePrice: 500, displayLotCount: 2, baseSize: 3, weight: -1, lotsNeeded: 2, sharesPerLot: 1, costPerLot: 500, totalCost: 1000 },
      { ticker: 'OVER', closePrice: 10, displayLotCount: 4, baseSize: 3, weight: 1, lotsNeeded: 0, sharesPerLot: 50, costPerLot: 500, totalCost: 0 },
    ],
  }
  it('shows the lot amount and only holdings needing lots', () => {
    const html = renderToStaticMarkup(createElement(RecommendedLotAmountSection, { recommendation: {
      ...base, lotAmount: 500, totalCost: 1000, nextSteps: [
        { lotAmount: 550, totalCost: 2200, shortfall: 200 },
        { lotAmount: 600, totalCost: 2400, shortfall: 400 },
        { lotAmount: 650, totalCost: 2600, shortfall: 600 },
        { lotAmount: 700, totalCost: 2800, shortfall: 800 },
        { lotAmount: 750, totalCost: 3000, shortfall: 1000 },
      ],
    } }))
    expect(html).toContain('Recommended lot amount')
    expect(html).toContain('$500.00')
    expect(html).toContain('<strong>MINUS</strong>')
    expect(html).not.toContain('<strong>OVER</strong>')
    expect(html).toContain('Next steps')
    expect(html).toContain('<strong>$750.00</strong>')
  })
  it('explains when cash cannot cover the first increment', () => {
    const html = renderToStaticMarkup(createElement(RecommendedLotAmountSection, { recommendation: {
      ...base, availableCash: 20, lotAmount: null, totalCost: 0,
      nextSteps: [50, 100, 150, 200, 250].map((lotAmount) => ({ lotAmount, totalCost: lotAmount * 2, shortfall: lotAmount * 2 - 20 })),
    } }))
    expect(html).toContain('cannot cover')
    expect(html).toContain('<strong>$250.00</strong>')
  })
  it('renders a supplied Send to Messages action', () => {
    const html = renderToStaticMarkup(createElement(RecommendedLotAmountSection, {
      recommendation: { ...base, lotAmount: 500, totalCost: 1000, nextSteps: [] },
      action: createElement(ChatResponseActions, { saved: false, saving: false, disabled: false, onSend: () => undefined }),
    }))
    expect(html).toContain('Send to Messages')
  })
  it('preserves the lot table and next steps through saved message serialization', () => {
    const report = {
      reportId: 'lots', generatedAt: '2026-10-06T20:00:00Z', facts: [], explanations: [], limitations: ['Stored closes may be stale.'],
      snapshot: { recommendedLotAmount: { ...base, lotAmount: 500, totalCost: 1000, unpricedTickers: ['NOPRICE'],
        nextSteps: [{ lotAmount: 550, totalCost: 2200, shortfall: 200 }, { lotAmount: 600, totalCost: 1900, shortfall: 0 }] } },
    } as unknown as PortfolioInsightsReport
    const html = renderToStaticMarkup(createElement(SavedReviewMessage, {
      body: `Review section: Recommended lot amount\n\n${buildFormattedReviewContent(report, 'Recommended lot amount')}`,
    }))
    expect(html).toContain('<h3>Recommended lot amount</h3>')
    expect(html).toContain('Recommended lot amount: $500.00. Cash needed: $1,000.00 of $2,000.00.')
    expect(html).toContain('Excluded (no stored price): NOPRICE.')
    expect(html).toContain('<strong>MINUS</strong>')
    expect(html).not.toContain('<strong>OVER</strong>')
    expect(html).toContain('<h4>Next steps</h4>')
    expect(html).toContain('<td class="value-negative">$200.00</td>')
    expect(html).toContain('<strong>$600.00</strong>')
    expect(html).toContain('Stored closes may be stale.')
    expect(html).not.toContain('invalid or unsupported')
  })
})