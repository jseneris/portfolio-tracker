import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { describe, expect, it } from 'vitest'
import type { PortfolioReview } from '../api'
import LotSaleAssessmentTable from './LotSaleAssessmentTable'

const assessment: NonNullable<PortfolioReview['snapshot']['lotSaleAssessments']>[number] = {
  lotIndex: 0, ticker: 'TEST', sourceType: 'purchase', acquisitionDate: '2025-01-01',
  quantity: 100, unitCost: 100, closePrice: 90, marketDate: '2026-11-09', saleDate: '2026-11-10',
  estimatedLoss: 1000, priorWindowStartsOn: '2026-10-11', postSaleWindowEndsOn: '2026-12-10',
  status: 'prior_exposure', unavailableReason: null, potentialAffectedShares: 20.5, potentialDeferredLoss: 205,
  replacementLots: [{ lotIndex: 1, acquisitionDate: '2026-11-05', sourceType: 'dividend', quantity: 20.5 }],
}

function render(assessments?: PortfolioReview['snapshot']['lotSaleAssessments']) {
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/review' },
    createElement(LotSaleAssessmentTable, { assessments })))
}

describe('lot-specific proposed sale assessment table', () => {
  it('shows lot identity, price date, sale date, partial exposure and replacement details', () => {
    const html = render([assessment])
    for (const value of ['Lot-specific sale assessment', 'href="/stocks/TEST"', '/ lot 1', '2026-11-09',
      '2026-11-10', '$1,000.00', 'Potential prior-window wash sale', '20.5', '$205.00',
      'Lot 2: 2026-11-05 / dividend / 20.5 shares', 'Unresolved through 2026-12-10 (inclusive)']) {
      expect(html).toContain(value)
    }
  })

  it('explains independent scenarios and unknowns without promising tax clearance', () => {
    const html = render([assessment])
    for (const text of ['separate what-if scenarios, not a combined sale', 'not tax clearance',
      'upper-bound estimates', 'prior wash-sale matching is not tracked', 'spouse purchases',
      'IRA/Roth IRA', 'substantially identical', 'permanently disallow', 'Prices may be stale',
      'No transactions or tax bases are changed', 'selected lot are excluded']) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('Safe to sell')
  })

  it('shows no tracked prior exposure without a green cleared label', () => {
    const html = render([{ ...assessment, status: 'no_tracked_prior_exposure', potentialAffectedShares: 0,
      potentialDeferredLoss: 0, replacementLots: [] }])
    expect(html).toContain('No tracked prior exposure')
    expect(html).toContain('Unresolved through 2026-12-10')
    expect(html).not.toContain('value-positive')
    expect(html).not.toContain('>Clear<')
  })

  it('distinguishes missing prices and non-loss lots from assessed loss exposure', () => {
    const html = render([
      { ...assessment, status: 'unavailable', closePrice: null, marketDate: null, estimatedLoss: null,
        potentialAffectedShares: null, potentialDeferredLoss: null, unavailableReason: 'No stored price.' },
      { ...assessment, lotIndex: 2, status: 'no_loss', estimatedLoss: 0, potentialAffectedShares: 0, potentialDeferredLoss: 0 },
    ])
    expect(html).toContain('Unable to assess: No stored price.')
    expect(html).toContain('No estimated loss')
    expect(html).toContain('Not applicable at this price')
    expect(html).toContain('/ lot 3')
    expect(html).not.toContain('Potential prior-window wash sale</td>')
  })

  it('distinguishes absent assessment data from an empty portfolio', () => {
    expect(render()).toContain('assessment is unavailable')
    expect(render([])).toContain('No open lots to assess')
  })
})
