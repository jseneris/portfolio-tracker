import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InsufficientSharesBanner } from './InsufficientSharesBanner'
import { BuyTargetBadges } from './DashboardPage'

describe('insufficient shares display', () => {
  it('renders a collapsed disclosure and describes the effective override price', () => {
    const html = renderToStaticMarkup(createElement(InsufficientSharesBanner, {
      ticker: 'TEST', buyPrice: 150, basePurchaseSize: 300, smallestDisplayLotShares: 2, isOverride: true,
    }))
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('<summary><strong>Insufficient shares for next display lot</strong></summary>')
    expect(html).toContain('override')
    expect(html).not.toContain('Consider increasing')
    expect(renderToStaticMarkup(createElement(InsufficientSharesBanner, {
      ticker: 'TEST', buyPrice: 100, basePurchaseSize: 300, smallestDisplayLotShares: 2, isOverride: true,
    }))).toBe('')
  })

  it('shows independent override and insufficient badges at the buy target', () => {
    const html = renderToStaticMarkup(createElement(BuyTargetBadges, {
      override: 150, buyTarget: 150, basePurchaseSize: 300, smallestLot: 2,
    }))
    expect(html).toContain('Target Buy Price Override')
    expect(html).toContain('Buy target would not buy more shares')
    expect(renderToStaticMarkup(createElement(BuyTargetBadges, {
      override: null, buyTarget: 100, basePurchaseSize: 300, smallestLot: 2,
    }))).toBe('')
  })
})
