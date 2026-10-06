import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WashSaleWindowNotice } from './StockHistoryPage'

describe('sell-lot picker transaction warning', () => {
  it('shows buy and dividend dates and offsets with a warning and scope limitations', () => {
    const html = renderToStaticMarkup(createElement(WashSaleWindowNotice, {
      saleDate: '2026-10-06',
      transactions: [
        { id: 'buy', type: 'buy', date: '2026-09-06', daysFromSale: -30 },
        { id: 'div', type: 'div', date: '2026-10-06', daysFromSale: 0 },
        { id: 'later', type: 'buy', date: '2026-11-05', daysFromSale: 30 },
      ],
    }))
    expect(html).toContain('status-warning')
    expect(html).toContain('3 tracked buy/dividend transactions')
    expect(html).toContain('Dividend reinvestment')
    expect(html).toContain('30 days before')
    expect(html).toContain('30 days after')
    expect(html).toContain('sale date')
    expect(html).toContain('Outside accounts')
    expect(html).toContain('not a determination of wash-sale status')
  })

  it('explicitly indicates no matches without claiming eligibility', () => {
    const html = renderToStaticMarkup(createElement(WashSaleWindowNotice, { saleDate: '2026-10-06', transactions: [] }))
    expect(html).toContain('No tracked buys or dividend reinvestments')
    expect(html).toContain('future unrecorded purchases')
    expect(html).not.toContain('status-warning')
  })

  it('requests a valid sale date instead of showing a misleading no-match result', () => {
    const html = renderToStaticMarkup(createElement(WashSaleWindowNotice, { saleDate: '', transactions: [] }))
    expect(html).toContain('Choose a valid sale date')
    expect(html).not.toContain('No tracked buys')
  })
})
