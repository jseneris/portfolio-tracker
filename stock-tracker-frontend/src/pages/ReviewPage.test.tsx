import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PortfolioInsightsReport, PortfolioReview } from '../api'
import { buildFormattedReviewContent, formatDividendTiming, SavedReviewMessage } from '../reviewMessages'
import ReviewPage, { LossTimingTable, RecommendedLotAmountSection, ReviewSections } from './ReviewPage'

const holding: NonNullable<PortfolioReview['snapshot']['holdingReviewContext']>[number] = {
  ticker: 'TEST', displayLotCount: 4, yearlyGainLoss: -10, matchesLossReviewFilter: true,
  qualifyingLossLots: [{
    acquisitionDate: '2025-02-03', quantity: 2, unitCost: 100, closePrice: 70,
    marketDate: '2026-10-06', costBasis: 200, estimatedValue: 140, estimatedLoss: 60, lossPercent: 30,
  }],
  lastTrackedAcquisitionDate: null, priorAcquisitionWindowClearsOn: null, daysUntilPriorAcquisitionWindowClears: 0,
  lastTrackedDividendDate: null, nextDeclaredDividendDate: null, daysUntilNextDividend: null, daysSinceLastDividend: 11,
}
const recommendation: NonNullable<PortfolioReview['snapshot']['recommendedLotAmount']> = {
  increment: 50, targetWeight: 1, availableCash: 2000, unpricedTickers: [], lotAmount: 500, totalCost: 1000,
  nextSteps: [{ lotAmount: 550, totalCost: 2200, shortfall: 200 }],
  holdings: [
    { ticker: 'MINUS', closePrice: 500, displayLotCount: 2, baseSize: 3, weight: -1, lotsNeeded: 2, sharesPerLot: 1, costPerLot: 500, totalCost: 1000 },
    { ticker: 'OVER', closePrice: 10, displayLotCount: 4, baseSize: 3, weight: 1, lotsNeeded: 0, sharesPerLot: 50, costPerLot: 500, totalCost: 0 },
  ],
}
const review: PortfolioReview = {
  generatedAt: '2026-10-06T20:00:00Z',
  facts: [
    { id: 'concentration-TEST', type: 'concentration', ticker: 'TEST', marketValue: 100, percentOfEquities: 50 },
    { id: 'loss-TEST', type: 'unrealized_loss_lot', ticker: 'TEST', acquisitionDate: '2025-02-03',
      quantity: 2, costBasis: 200, estimatedValue: 140, unrealizedLoss: 60, recentAcquisitionCount: 1 },
    { id: 'missing-NOQUOTE', type: 'missing_price', ticker: 'NOQUOTE' },
  ],
  limitations: ['Stored closes may be stale.'],
  snapshot: {
    generatedAt: '2026-10-06T20:00:00Z', valuationBasis: 'latest_stored_close', assumptions: null,
    holdings: [], openLots: [], missingPriceTickers: ['NOQUOTE'],
    cash: { deposits: 0, withdrawals: 0, interest: 0, fees: 0, buys: 0, sells: 0, availableCash: 0, costBasis: 0, adjustments: 0 },
    totals: { holdingCount: 0, openLotCount: 0, equityCostBasis: 0, pricedEquityValue: 0, equityValue: 0, portfolioValue: null, unrealizedGainLoss: 0, cashPercentOfPortfolio: null },
    holdingReviewContext: [holding], recommendedLotAmount: recommendation,
  },
}

describe('calculated Review page', () => {
  it('loads automatically and includes target distances without an AI or Messages action', () => {
    const html = renderToStaticMarkup(createElement(ReviewPage))
    expect(html).toContain('Loading portfolio review...')
    expect(html).toContain('Distance from buy and sell targets')
    expect(html).toContain('No AI required.')
    expect(html).not.toContain('Generate review')
    expect(html).not.toContain('Send to Messages')
    expect(html).not.toContain('<button')
    expect(html).toContain('As of page load; reload the page to update.')
  })

  it('shows all standard sections even when saved AI assumptions are disabled', () => {
    const html = renderToStaticMarkup(createElement(ReviewSections, { review }))
    for (const text of ['Portfolio snapshot', 'Recommended lot amount', 'Largest concentrations',
      'Unrealized loss items to review', 'Loss Timing Review', 'Holdings without a stored close', 'Important limitations']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('50.00%')
    expect(html).toContain('TEST qualifying buy lots')
    expect(html).toContain('NOQUOTE')
    expect(html).toContain('Unavailable (missing prices)')
    expect(html).not.toContain('No additional model explanation')
    expect(html).not.toContain('Send to Messages')
  })

  it('retains explicit empty-section messages', () => {
    const html = renderToStaticMarkup(createElement(ReviewSections, {
      review: { ...review, facts: [], snapshot: { ...review.snapshot, holdingReviewContext: [] } },
    }))
    expect(html).toContain('No holding reached')
    expect(html).toContain('No open lots')
    expect(html).toContain('No holdings match')
  })
})

describe('loss timing display', () => {
  it('preserves yearly losses, lot details and wait-day colors while excluding nonmatches', () => {
    const html = renderToStaticMarkup(createElement(LossTimingTable, { holdings: [
      holding, { ...holding, ticker: 'WAIT', daysUntilPriorAcquisitionWindowClears: 12, yearlyGainLoss: -250 },
      { ...holding, ticker: 'UNKNOWN', daysUntilPriorAcquisitionWindowClears: null },
      { ...holding, ticker: 'EXCLUDED', matchesLossReviewFilter: false },
    ] }))
    expect(html).toContain('class="value-positive"><strong>TEST</strong>')
    expect(html).toContain('class="value-negative"><strong>WAIT</strong>')
    expect(html).toContain('class=""><strong>UNKNOWN</strong>')
    expect(html).toContain('-$250.00')
    expect(html).toContain('30.00%')
    expect(html).toContain('11 days since last tracked dividend')
    expect(html).not.toContain('EXCLUDED')
  })

  it('uses verified future dividend timing or elapsed days without treating unknown as zero', () => {
    expect(formatDividendTiming({ daysUntilNextDividend: 5, daysSinceLastDividend: 85 })).toBe('5 days until next dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: 0 })).toBe('0 days since last tracked dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: null })).toBe('No tracked dividend')
  })
})

describe('recommended lot amount', () => {
  it('shows only holdings needing cash and retains next-step amounts', () => {
    const html = renderToStaticMarkup(createElement(RecommendedLotAmountSection, { recommendation }))
    expect(html).toContain('$500.00')
    expect(html).toContain('<strong>MINUS</strong>')
    expect(html).not.toContain('<strong>OVER</strong>')
    expect(html).toContain('Next steps')
    expect(html).toContain('$550.00')
    expect(html).not.toContain('Send to Messages')
  })

  it('explains insufficient cash and missing prices', () => {
    const html = renderToStaticMarkup(createElement(RecommendedLotAmountSection, {
      recommendation: { ...recommendation, availableCash: 20, lotAmount: null, unpricedTickers: ['NOPRICE'] },
    }))
    expect(html).toContain('cannot cover')
    expect(html).toContain('NOPRICE')
  })
})

describe('previously saved review Messages', () => {
  const report: PortfolioInsightsReport = { ...review, reportId: 'legacy', explanations: [{ factId: 'concentration-TEST', explanation: 'Saved commentary.' }] }
  it.each(['Largest concentrations', 'Loss-review timing', 'Recommended lot amount'] as const)('keeps existing %s messages readable', (section) => {
    const html = renderToStaticMarkup(createElement(SavedReviewMessage, {
      body: `Review section: ${section}\n\n${buildFormattedReviewContent(report, section)}`,
    }))
    expect(html).toContain('<table')
    expect(html).toContain('Stored closes may be stale.')
    expect(html).not.toContain('Formatted review v1')
  })

  it('retains legacy text and reports malformed saved formatting explicitly', () => {
    const body = 'Review section: Loss-review timing\n\nTEST: 0 days to wait'
    expect(renderToStaticMarkup(createElement(SavedReviewMessage, { body }))).toContain(body)
    expect(renderToStaticMarkup(createElement(SavedReviewMessage, {
      body: 'Review section: Loss-review timing\n\nFormatted review v1:\n{broken',
    }))).toContain('role="alert"')
  })
})
