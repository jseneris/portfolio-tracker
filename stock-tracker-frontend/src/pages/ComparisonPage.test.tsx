import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ComparisonPage from './ComparisonPage'
import { StocksGainLossChart } from './StocksPerformanceChart'

describe('performance graph selection', () => {
  it('offers vs Indexes and Stocks views', () => {
    const html = renderToStaticMarkup(createElement(ComparisonPage))
    expect(html).toContain('Performance')
    expect(html).toContain('vs Indexes</option>')
    expect(html).toContain('Stocks</option>')
    expect(html).not.toContain('Initial Buys')
  })

  it('renders only the combined line by default with unchecked individual stock selectors', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA', 'BBB'],
      points: [
        { date: '2025-12-31', gains: { AAA: 0, BBB: 0 }, initialBuysGain: 0, bases: { AAA: 1000, BBB: 500 }, initialBuysBasis: null },
        { date: '2026-01-02', gains: { AAA: 120, BBB: -50 }, initialBuysGain: 0, bases: { AAA: 1000, BBB: 500 }, initialBuysBasis: null },
      ],
    }))
    expect(html).toContain('Combined percentage gain/loss with optional individual stock lines, relative to value at the start of the period')
    expect(html).toContain('<title>Combined holdings</title>')
    expect(html).not.toContain('<title>AAA</title>')
    expect(html).not.toContain('<title>BBB</title>')
    expect(html).toContain('Combined holdings: 4.67%')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('AAA: 12.00%')
    expect(html).toContain('BBB: -10.00%')
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('stroke-dasharray="4 3"')
  })

  it('does not display a partial total when a stock valuation is unavailable', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA', 'BBB'],
      points: [{ date: '2026-01-02', gains: { AAA: 120, BBB: null }, initialBuysGain: null, bases: { AAA: 1000, BBB: 500 }, initialBuysBasis: null }],
    }))
    expect(html).toContain('Combined holdings: --')
  })

  it('shows a thin initial-buy performance line alongside the thin combined line', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA'], hasInitialBuys: true,
      points: [
        { date: '2025-12-31', gains: { AAA: 0 }, initialBuysGain: 0, bases: { AAA: 1000 }, initialBuysBasis: 1000 },
        { date: '2026-01-02', gains: { AAA: 120 }, initialBuysGain: 200, bases: { AAA: 1000 }, initialBuysBasis: 1000 },
      ],
    }))
    expect(html).toContain('<title>Initial buys (buy and hold)</title>')
    expect(html).toContain('Initial buys (buy and hold): 20.00%')
    expect(html.match(/stroke-width="1.5"/g)).toHaveLength(2)
  })

  it('hides the initial-buy line and legend in yearly views even when initial purchases exist', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA'], hasInitialBuys: true, showInitialBuys: false,
      points: [{ date: '2025-12-31', gains: { AAA: 0 }, initialBuysGain: 0, bases: { AAA: 1000 }, initialBuysBasis: 1000 }],
    }))
    expect(html).toContain('<title>Combined holdings</title>')
    expect(html).not.toContain('Initial buys')
    expect(html).not.toContain('Initial Purchases')
  })
})
