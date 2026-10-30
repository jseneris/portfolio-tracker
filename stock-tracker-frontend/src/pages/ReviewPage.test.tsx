import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { describe, expect, it } from 'vitest'
import type { CashTransaction, PortfolioComparisonPoint, PortfolioInsightsReport, PortfolioReview, StockTransaction } from '../api'
import { buildFormattedReviewContent, formatDividendTiming, SavedReviewMessage } from '../reviewMessages'
import ReviewPage, { getHoldingsWithLargeLots, LossTimingTable, PerformanceSection, RecommendedLotAmountSection, ReviewSections } from './ReviewPage'

function renderWithRouter(element: ReactNode) {
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/review' }, element))
}

const holding: NonNullable<PortfolioReview['snapshot']['holdingReviewContext']>[number] = {
  ticker: 'TEST', displayLotCount: 4, largestDisplayLot: 5, yearlyGainLoss: -10, matchesLossReviewFilter: true,
  qualifyingLossLots: [{
    acquisitionDate: '2025-02-03', quantity: 2, unitCost: 100, closePrice: 70,
    marketDate: '2026-10-06', costBasis: 200, estimatedValue: 140, estimatedLoss: 60, lossPercent: 30,
  }],
  lastTrackedAcquisitionDate: null, priorAcquisitionWindowClearsOn: null, daysUntilPriorAcquisitionWindowClears: 0,
  lastTrackedDividendDate: null, nextDeclaredDividendDate: null, daysUntilNextDividend: null, daysSinceLastDividend: 11,
}
const recommendation: NonNullable<PortfolioReview['snapshot']['recommendedLotAmount']> = {
  increment: 50, targetWeight: 1, availableCash: 2000, unpricedTickers: [], lotAmount: 500, totalCost: 1000,
  totalLotsAbovePlusOne: 3,
  nextSteps: [{ lotAmount: 550, totalCost: 2200, shortfall: 200 }],
  holdings: [
    { ticker: 'MINUS', closePrice: 500, displayLotCount: 2, baseSize: 3, weight: -1, lotsNeeded: 2, lotsAbovePlusOne: 0, sharesPerLot: 1, costPerLot: 500, totalCost: 1000 },
    { ticker: 'OVER', closePrice: 10, displayLotCount: 4, baseSize: 3, weight: 1, lotsNeeded: 0, lotsAbovePlusOne: 0, sharesPerLot: 50, costPerLot: 500, totalCost: 0 },
    { ticker: 'TWO', closePrice: 10, displayLotCount: 5, baseSize: 3, weight: 2, lotsNeeded: 0, lotsAbovePlusOne: 1, sharesPerLot: 0, costPerLot: 0, totalCost: 0 },
    { ticker: 'THREE', closePrice: 10, displayLotCount: 6, baseSize: 3, weight: 3, lotsNeeded: 0, lotsAbovePlusOne: 2, sharesPerLot: 0, costPerLot: 0, totalCost: 0 },
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
    holdings: [], openLots: [
      { ticker: 'TEST', sourceType: 'buy', acquisitionDate: '2025-01-01', quantity: 10, unitCost: 100,
        costBasis: 1000, closePrice: 200, marketValue: 2000, unrealizedGainLoss: 1000, marketDate: '2026-10-06', recentAcquisitionCount: 0 },
      { ticker: 'TEST', sourceType: 'buy', acquisitionDate: '2025-02-01', quantity: 5, unitCost: 100,
        costBasis: 500, closePrice: 200, marketValue: 1000, unrealizedGainLoss: 500, marketDate: '2026-10-06', recentAcquisitionCount: 0 },
      { ticker: 'BELOW', sourceType: 'buy', acquisitionDate: '2025-01-01', quantity: 5, unitCost: 100,
        costBasis: 500, closePrice: 299.8, marketValue: 1499, unrealizedGainLoss: 999, marketDate: '2026-10-06', recentAcquisitionCount: 0 },
      { ticker: 'NOQUOTE', sourceType: 'buy', acquisitionDate: '2025-01-01', quantity: 5, unitCost: 100,
        costBasis: 500, closePrice: null, marketValue: null, unrealizedGainLoss: null, marketDate: null, recentAcquisitionCount: 0 },
    ], missingPriceTickers: ['NOQUOTE'],
    cash: { deposits: 0, withdrawals: 0, interest: 0, fees: 0, buys: 0, sells: 0, availableCash: 0, costBasis: 0, adjustments: 0 },
    totals: { holdingCount: 0, openLotCount: 0, equityCostBasis: 0, pricedEquityValue: 0, equityValue: 0, portfolioValue: null, unrealizedGainLoss: 0, cashPercentOfPortfolio: null },
    holdingReviewContext: [holding], recommendedLotAmount: recommendation,
  },
}

describe('calculated Review page', () => {
  it('loads automatically without an AI or Messages action', () => {
    const html = renderToStaticMarkup(createElement(ReviewPage))
    expect(html).toContain('Loading portfolio review...')
    expect(html).toContain('No AI required.')
    expect(html).not.toContain('Generate review')
    expect(html).not.toContain('Send to Messages')
    expect(html).not.toContain('<button')
    expect(html).toContain('As of page load; reload the page to update.')
    expect(html).not.toContain('Refresh')
  })

  it('shows all standard sections even when saved AI assumptions are disabled', () => {
    const html = renderWithRouter(createElement(ReviewSections, {
      review,
      performanceData: { stockTransactions: [], cashTransactions: [], comparisonPoints: [] },
    }))
    for (const text of ['Recommended lot amount', 'Largest concentrations',
      'Potential Sales', 'Distance from buy and sell targets', 'Large Losses', 'Holdings without a stored close', 'Largest display-lot value at least 5× a $300 lot size ($1,500)']) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('Portfolio snapshot')
    expect(html).not.toContain('Unrealized loss items to review')
    expect(html).not.toContain('Loss Timing Review')
    expect(html).not.toContain('Important limitations')
    expect(html).not.toContain('Stored closes may be stale.')
    expect(html).not.toContain('Cash deployment')
    expect(html).toContain('No largest individual display lot is valued at $1,500 or more.')
    expect(html).not.toContain('href="/stocks/BELOW"')
    expect(html.indexOf('<h3>Recommended lot amount</h3>'))
      .toBeLessThan(html.indexOf('<h3>Largest concentrations</h3>'))
    expect(html.indexOf('<h3>Performance</h3>'))
      .toBeLessThan(html.indexOf('<h3>Recommended lot amount</h3>'))
    expect(html.indexOf('<h3>Largest concentrations</h3>'))
      .toBeLessThan(html.indexOf('<h3>Potential Sales</h3>'))
    expect(html.indexOf('<h4>Distance from buy and sell targets</h4>'))
      .toBeLessThan(html.indexOf('<h4>Large Losses</h4>'))
    expect(html).not.toContain('<h3>Loss Timing</h3>')
    expect(html).not.toContain('open="">')
    expect(html).toContain('50.00%')
    expect(html).not.toContain('>TEST</a> qualifying buy lots')
    expect(html).not.toContain('class="loss-timing-lots"')
    expect(html).toContain('NOQUOTE')
    expect(html).not.toContain('No additional model explanation')
    expect(html).not.toContain('Send to Messages')
    for (const ticker of ['TEST', 'MINUS', 'TWO', 'THREE', 'NOQUOTE']) {
      expect(html).toContain(`href="/stocks/${ticker}"`)
    }
  })

  it('retains explicit empty-section messages', () => {
    const html = renderWithRouter(createElement(ReviewSections, {
      review: { ...review, facts: [], snapshot: { ...review.snapshot, holdingReviewContext: [] } },
    }))
    expect(html).toContain('No holding reached')
    expect(html).toContain('Potential Sales')
    expect(html).not.toContain('Loss Timing')
  })
})

describe('Review performance summaries', () => {
  it('shows All Time first and yearly summaries from the current year back to the earliest transaction year', () => {
    const currentYear = new Date().getUTCFullYear()
    const stockTransactions: StockTransaction[] = [
      { id: 'buy-now', userId: 'user', ticker: 'TEST', type: 'buy', quantity: 1, price: 100, amount: 100, transactionDate: `${currentYear}-02-01` },
      { id: 'buy-old', userId: 'user', ticker: 'TEST', type: 'buy', quantity: 3, price: 100, amount: 300, transactionDate: `${currentYear - 2}-02-01` },
    ]
    const cashTransactions: CashTransaction[] = [
      { id: 'deposit-now', userId: 'user', type: 'deposit', amount: 1000, transactionDate: `${currentYear}-01-01` },
      { id: 'fee-old', userId: 'user', type: 'fee', amount: 10, transactionDate: `${currentYear - 2}-03-01` },
    ]
    const comparisonPoints: PortfolioComparisonPoint[] = [
      {
        date: `${currentYear - 2}-12-31`, hasCashFlowEvent: false, availableCash: 100, cashCostBasis: 100,
        stockValue: 200, portfolioValue: 0, initialBuysValue: 0, dowBenchmarkValue: 300, dowBenchmarkShares: 1,
        nasdaqBenchmarkValue: 400, nasdaqBenchmarkShares: 1, sp500BenchmarkValue: 500, sp500BenchmarkShares: 1,
        missingTickers: [],
      },
      {
        date: `${currentYear}-12-31`, hasCashFlowEvent: false, availableCash: 200, cashCostBasis: 200,
        stockValue: 400, portfolioValue: 0, initialBuysValue: 0, dowBenchmarkValue: 500, dowBenchmarkShares: 1,
        nasdaqBenchmarkValue: 600, nasdaqBenchmarkShares: 1, sp500BenchmarkValue: 700, sp500BenchmarkShares: 1,
        missingTickers: [],
      },
    ]
    const html = renderToStaticMarkup(createElement(PerformanceSection, {
      stockTransactions, cashTransactions, comparisonPoints,
    }))

    const allTimeIndex = html.indexOf('<summary><h4>All Time</h4></summary>')
    const currentYearIndex = html.indexOf(`<summary><h4>${currentYear}</h4></summary>`)
    const previousYearIndex = html.indexOf(`<summary><h4>${currentYear - 1}</h4></summary>`)
    const firstTransactionYearIndex = html.indexOf(`<summary><h4>${currentYear - 2}</h4></summary>`)
    expect(html).toContain('<h3>Performance</h3>')
    expect(allTimeIndex).toBeGreaterThan(-1)
    expect(allTimeIndex).toBeLessThan(currentYearIndex)
    expect(currentYearIndex).toBeLessThan(previousYearIndex)
    expect(previousYearIndex).toBeLessThan(firstTransactionYearIndex)
    expect(html.match(/<details class="review-collapsible review-performance-period">/g)).toHaveLength(4)
    expect(html).not.toContain('open=""')
    expect(html).toContain('Portfolio Starting Value')
    expect(html).toContain('Cash Basis in S&amp;P 500 Benchmark')
  })
})

describe('loss timing display', () => {
  it('preserves yearly losses, lot details and wait-day colors while excluding nonmatches', () => {
    const html = renderWithRouter(createElement(LossTimingTable, { holdings: [
      holding, { ...holding, ticker: 'WAIT', daysUntilPriorAcquisitionWindowClears: 12, yearlyGainLoss: -250 },
      { ...holding, ticker: 'UNKNOWN', daysUntilPriorAcquisitionWindowClears: null },
      { ...holding, ticker: 'EXCLUDED', matchesLossReviewFilter: false },
    ] }))
    expect(html).toContain('class="value-positive"><strong><a class="link-button" href="/stocks/TEST">TEST</a></strong>')
    expect(html).toContain('class="value-negative"><strong><a class="link-button" href="/stocks/WAIT">WAIT</a></strong>')
    expect(html).toContain('class=""><strong><a class="link-button" href="/stocks/UNKNOWN">UNKNOWN</a></strong>')
    expect(html).toContain('-$250.00')
    expect(html).toContain('30.00%')
    expect(html).toContain('11 days since last tracked dividend')
    expect(html).not.toContain('EXCLUDED')
    expect(html).not.toContain('table-scroll')
  })

  it('uses verified future dividend timing or elapsed days without treating unknown as zero', () => {
    expect(formatDividendTiming({ daysUntilNextDividend: 5, daysSinceLastDividend: 85 })).toBe('5 days until next dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: 0 })).toBe('0 days since last tracked dividend')
    expect(formatDividendTiming({ daysUntilNextDividend: null, daysSinceLastDividend: null })).toBe('No tracked dividend')
  })
})

describe('recommended lot amount', () => {
  it('shows only holdings needing cash and retains next-step amounts', () => {
    const html = renderWithRouter(createElement(RecommendedLotAmountSection, { recommendation }))
    expect(html).toContain('$500.00')
    expect(html).toContain('<strong><a class="link-button" href="/stocks/MINUS">MINUS</a></strong>')
    expect(html).not.toContain('<strong>OVER</strong>')
    expect(html).toContain('3 lots above +1 base across 2 tickers')
    expect(html).toContain('<strong><a class="link-button" href="/stocks/TWO">TWO</a></strong>')
    expect(html).toContain('<strong><a class="link-button" href="/stocks/THREE">THREE</a></strong>')
    expect(html).toContain('href="/stocks/MINUS"')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<td>2</td>')
    expect(html).toContain('Recommended amounts start at $250')
    expect(html).toContain('Next steps')
    expect(html).toContain('$550.00')
    expect(html).not.toContain('Send to Messages')
  })

  it('explains insufficient cash and missing prices', () => {
    const html = renderWithRouter(createElement(RecommendedLotAmountSection, {
      recommendation: { ...recommendation, availableCash: 20, lotAmount: null, unpricedTickers: ['NOPRICE'] },
    }))
    expect(html).toContain('cannot cover')
    expect(html).toContain('NOPRICE')
  })
})

describe('largest lots in concentrations review', () => {
  it('uses the largest individual display lot times the stored close for the $1,500 threshold', () => {
    const snapshot = {
      ...review.snapshot,
      holdings: [{
        ticker: 'SNOW', quantity: 5, costBasis: 1500, closePrice: 334, marketDate: '2026-10-26',
        marketValue: 1670, unrealizedGainLoss: 170, companyName: 'Snowflake Inc.', sector: null,
        industry: null, sizeClassification: null, profileUpdatedAt: null,
        percentOfPricedEquities: null, percentOfPortfolio: null,
      }, {
        ticker: 'BELOW', quantity: 4, costBasis: 1000, closePrice: 334, marketDate: '2026-10-26',
        marketValue: 1336, unrealizedGainLoss: 336, companyName: null, sector: null,
        industry: null, sizeClassification: null, profileUpdatedAt: null,
        percentOfPricedEquities: null, percentOfPortfolio: null,
      }],
      holdingReviewContext: [
        { ...holding, ticker: 'SNOW', displayLotCount: 3, largestDisplayLot: 5 },
        { ...holding, ticker: 'BELOW', displayLotCount: 3, largestDisplayLot: 4 },
      ],
    }

    expect(getHoldingsWithLargeLots(snapshot)).toEqual([
      { ticker: 'SNOW', largestDisplayLot: 5, closePrice: 334, marketDate: '2026-10-26', marketValue: 1670 },
    ])
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
