import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ComparisonPage from './ComparisonPage'
import { getGroupPerformance, groupPerformanceTickers, StocksGainLossChart } from './StocksPerformanceChart'
import type { CompanyProfile } from '../api'

describe('stock chart ticker grouping', () => {
  const point = {
    date: '2026-01-02',
    gains: { AAA: 0, BBB: -1, CCC: 1, DDD: null },
    bases: { AAA: 100, BBB: 100, CCC: 100, DDD: 100 },
    priceReturns: { AAA: -10, BBB: 10, CCC: -5, DDD: null },
    initialBuysGain: null,
    initialBuysBasis: null,
  }
  const tickers = ['DDD', 'CCC', 'BBB', 'AAA']
  const profile = (ticker: string, industry: string | null, sizeClassification: string | null): CompanyProfile => ({
    ticker, industry, sizeClassification, companyName: null, sector: null, marketCap: null, source: 'test',
  })
  const profiles = {
    AAA: profile('AAA', 'Software', 'Small Cap'),
    BBB: profile('BBB', 'Hardware', 'Mega Cap'),
    CCC: profile('CCC', 'Software', 'Large Cap'),
    DDD: null,
  }

  it('lists all tickers alphabetically without grouping', () => {
    expect(groupPerformanceTickers(tickers, point, 'none', profiles)).toEqual([
      { label: '', tickers: ['AAA', 'BBB', 'CCC', 'DDD'] },
    ])
  })

  it('groups by holding performance, includes zero in the positive group and separates unavailable returns', () => {
    expect(groupPerformanceTickers(tickers, point, 'performance', profiles)).toEqual([
      { label: '0% or greater', tickers: ['AAA', 'CCC'] },
      { label: 'Less than 0%', tickers: ['BBB'] },
      { label: 'Performance unavailable', tickers: ['DDD'] },
    ])
  })

  it('groups by industry and explicitly lists unknown classifications', () => {
    expect(groupPerformanceTickers(tickers, point, 'industry', profiles)).toEqual([
      { label: 'Hardware', tickers: ['BBB'] },
      { label: 'Software', tickers: ['AAA', 'CCC'] },
      { label: 'Unknown Industry', tickers: ['DDD'] },
    ])
  })

  it('orders size groups from largest to smallest with unknown sizes last', () => {
    expect(groupPerformanceTickers(tickers, point, 'size', profiles)).toEqual([
      { label: 'Mega Cap', tickers: ['BBB'] },
      { label: 'Large Cap', tickers: ['CCC'] },
      { label: 'Small Cap', tickers: ['AAA'] },
      { label: 'Unknown Size', tickers: ['DDD'] },
    ])
  })

  it('weights cumulative group returns by combined performance basis, not by ticker count', () => {
    const weighted = { ...point, gains: { AAA: 100, BBB: -10 }, bases: { AAA: 1000, BBB: 100 } }
    expect(getGroupPerformance(weighted, ['AAA', 'BBB'])).toBeCloseTo(90 / 1100 * 100)
    expect(getGroupPerformance(weighted, ['AAA'])).toBe(10)
    expect(getGroupPerformance(weighted, ['BBB'])).toBe(-10)
  })

  it('does not report a partial group return when a member gain or basis is unavailable', () => {
    expect(getGroupPerformance(point, ['AAA', 'DDD'])).toBeNull()
    expect(getGroupPerformance({ ...point, bases: { AAA: null } }, ['AAA'])).toBeNull()
    expect(getGroupPerformance({ ...point, bases: { AAA: 0 } }, ['AAA'])).toBeNull()
  })
})

describe('performance graph selection', () => {
  it('shows the indexes view by default without a graph type selector', () => {
    const html = renderToStaticMarkup(createElement(ComparisonPage))
    expect(html).toContain('vs Indexes Performance')
    expect(html).toContain('Portfolio vs Indexes:')
    expect(html).toContain('No chart data loaded yet.')
    expect(html).not.toContain('vs Indexes</option>')
    expect(html).not.toContain('Stocks</option>')
    expect(html).not.toContain('Initial Buys')
  })

  it('shows the stocks view when selected by its route without a graph type selector', () => {
    const html = renderToStaticMarkup(createElement(ComparisonPage, { graph: 'stocks' }))
    expect(html).toContain('Stocks Performance')
    expect(html).toContain('Stocks: combined cumulative gain/loss')
    expect(html).not.toContain('Portfolio vs Indexes:')
    expect(html).not.toContain('No chart data loaded yet.')
    expect(html).not.toContain('vs Indexes</option>')
    expect(html).not.toContain('Stocks</option>')
  })

  it('renders only the combined line by default with unchecked individual stock selectors', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA', 'BBB'],
      points: [
        { date: '2025-12-31', gains: { AAA: 0, BBB: 0 }, priceReturns: { AAA: 0, BBB: 0 }, initialBuysGain: 0, bases: { AAA: 1000, BBB: 500 }, initialBuysBasis: null },
        { date: '2026-01-02', gains: { AAA: 120, BBB: -50 }, priceReturns: { AAA: 8, BBB: -5 }, initialBuysGain: 0, bases: { AAA: 1000, BBB: 500 }, initialBuysBasis: null },
      ],
    }))
    expect(html).toContain('Combined percentage gain/loss with optional individual stock lines, relative to value at the start of the period')
    expect(html).toContain('<title>Combined holdings</title>')
    expect(html).not.toContain('<title>AAA</title>')
    expect(html).not.toContain('<title>BBB</title>')
    expect(html).not.toContain('<title>AAA holding</title>')
    expect(html).not.toContain('<title>AAA price</title>')
    expect(html).toContain('same-color dashed price-performance line')
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
      points: [{ date: '2026-01-02', gains: { AAA: 120, BBB: null }, priceReturns: { AAA: 8, BBB: null }, initialBuysGain: null, bases: { AAA: 1000, BBB: 500 }, initialBuysBasis: null }],
    }))
    expect(html).toContain('Combined holdings: --')
  })

  it('shows a thin initial-buy performance line alongside the thin combined line', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA'], hasInitialBuys: true,
      points: [
        { date: '2025-12-31', gains: { AAA: 0 }, priceReturns: { AAA: 0 }, initialBuysGain: 0, bases: { AAA: 1000 }, initialBuysBasis: 1000 },
        { date: '2026-01-02', gains: { AAA: 120 }, priceReturns: { AAA: 8 }, initialBuysGain: 200, bases: { AAA: 1000 }, initialBuysBasis: 1000 },
      ],
    }))
    expect(html).toContain('<title>Initial buys (buy and hold)</title>')
    expect(html).toContain('Initial buys (buy and hold): 20.00%')
    expect(html.match(/stroke-width="1.5"/g)).toHaveLength(2)
  })

  it('hides the initial-buy line and legend in yearly views even when initial purchases exist', () => {
    const html = renderToStaticMarkup(createElement(StocksGainLossChart, {
      tickers: ['AAA'], hasInitialBuys: true, showInitialBuys: false,
      points: [{ date: '2025-12-31', gains: { AAA: 0 }, priceReturns: { AAA: 0 }, initialBuysGain: 0, bases: { AAA: 1000 }, initialBuysBasis: 1000 }],
    }))
    expect(html).toContain('<title>Combined holdings</title>')
    expect(html).not.toContain('Initial buys')
    expect(html).not.toContain('Initial Purchases')
  })
})
