import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { calculateTickerTargets, normalizeTargetSettings } from '../targetPrices'
import { getTargetDistanceRows, loadTargetDistances, TargetDistanceTable, type TargetDistanceInput } from './TargetDistanceSection'

const input: TargetDistanceInput = { ticker: 'TEST', price: 100, buy: 80, sell: 160, priceLabel: 'Stored close 2026-10-23' }
const settings: api.UserTargetSettings = {
  saleTargetPercent: 60, buyTargetPercentUnder3DisplayLots: 20, buyTargetPercentFor3DisplayLots: 25,
  buyTargetPercentFor4DisplayLots: 30, buyTargetPercentFor5DisplayLots: 35,
  buyTargetPercentFor6OrMoreDisplayLots: 40, buyOnDipBuyTargetPercent: 2,
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('target-distance tiers', () => {
  it.each([20, 25, 30])('includes exact %s%% boundaries measured from each target', (threshold) => {
    const [row] = getTargetDistanceRows([{ ...input, buy: 100, price: 100 + threshold, sell: (100 + threshold) / (1 - threshold / 100) }])
    expect(row.tier).toBe(threshold)
    expect(row.aboveBuy).toBeCloseTo(threshold)
    expect(row.belowSell).toBeCloseTo(threshold)
  })

  it('requires both distances and assigns only the highest tier using the smaller distance', () => {
    expect(getTargetDistanceRows([
      input,
      { ...input, ticker: 'HIGH', buy: 70 },
      { ...input, ticker: 'BUYNEAR', buy: 90 },
      { ...input, ticker: 'SELLNEAR', sell: 120 },
      { ...input, ticker: 'ABOVESELL', price: 200 },
      { ...input, ticker: 'BELOWBUY', price: 20 },
    ]).map((row) => [row.ticker, row.tier])).toEqual([['HIGH', 30], ['TEST', 25]])
  })

  it('does not round sub-threshold percentages into a tier', () => {
    expect(getTargetDistanceRows([{ ...input, price: 119.999999, buy: 100, sell: 200 }])).toEqual([])
    expect(getTargetDistanceRows([{ ...input, price: 124.999999, buy: 100, sell: 200 }])[0].tier).toBe(20)
  })

  it('excludes unavailable, nonpositive, nonfinite and inverted inputs', () => {
    const invalid = [null, 0, -1, NaN, Infinity]
    expect(getTargetDistanceRows([
      ...invalid.map((price) => ({ ...input, price })),
      ...invalid.map((buy) => ({ ...input, buy })),
      ...invalid.map((sell) => ({ ...input, sell })),
      { ...input, buy: 200, sell: 100 },
    ])).toEqual([])
  })

  it('sorts by tier then minimum distance then ticker', () => {
    const rows = getTargetDistanceRows([
      { ...input, ticker: 'Z' }, { ...input, ticker: 'A' },
      { ...input, ticker: 'B', buy: 79 }, { ...input, ticker: 'C', buy: 70 },
      { ...input, ticker: 'D', buy: 82 },
    ])
    expect(rows.map((row) => row.ticker)).toEqual(['C', 'B', 'A', 'Z', 'D'])
  })

  it('renders each ticker once with both targets, distances, as-of date and stock link', () => {
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/insights' }, createElement(TargetDistanceTable, { inputs: [input] })))
    expect(html.match(/href="\/stocks\/TEST"/g)).toHaveLength(1)
    expect(html).toContain('25.00%')
    expect(html).toContain('37.50%')
    expect(html).toContain('$80.0000')
    expect(html).toContain('$160.0000')
    expect(html).toContain('$20.0000 (25.00%)')
    expect(html).toContain('$60.0000 (37.50%)')
    expect(html).toContain('Stored close 2026-10-23')
    expect(html).toContain('No qualifying tickers in this tier.')
  })
})

describe('shared dashboard targets', () => {
  it.each([[2, 80], [3, 75], [4, 70], [5, 65], [6, 60], [7, 60]])('uses display lot count %s', (count, buy) => {
    expect(calculateTickerTargets(100, count, settings, undefined)).toEqual({ buy, sell: 160 })
  })

  it('uses buy-on-dip overrides even without a transaction base', () => {
    const preference: api.TickerPreference = {
      ticker: 'TEST', baseSize: 1, buyOnDip: true, buyOnDipPrice: 100,
      buyRestricted: false, buyRestrictedUntil: null, isBuyRestricted: false,
    }
    expect(calculateTickerTargets(null, 6, settings, preference)).toEqual({ buy: 98, sell: 110 })
    expect(calculateTickerTargets(null, 6, settings, undefined)).toEqual({ buy: null, sell: null })
  })

  it('preserves dashboard defaults for invalid settings', () => {
    expect(normalizeTargetSettings({ ...settings, saleTargetPercent: 0, buyOnDipBuyTargetPercent: 100 }))
      .toEqual({ ...settings, saleTargetPercent: 10, buyOnDipBuyTargetPercent: 1 })
  })
})

function mockPortfolio(time: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(time))
  vi.spyOn(api, 'getPortfolioSummary').mockResolvedValue({
    deposits: 0, withdrawals: 0, interest: 0, fees: 0, buys: 0, sells: 0,
    availableCash: 0, cashBasis: 0, adjustments: 0, totalStockCostBasis: 100, stockCount: 1,
    stocks: [{ ticker: 'TEST', totalShares: 1, costBasis: 100, lotCount: 1 }],
  })
  vi.spyOn(api, 'getStockTransactions').mockResolvedValue([{
    id: 'buy', userId: 'user', ticker: 'TEST', type: 'buy', quantity: 1,
    price: 100, amount: 100, transactionDate: '2026-10-01',
  }])
  vi.spyOn(api, 'getUserTargetSettings').mockResolvedValue(settings)
  vi.spyOn(api, 'getDisplayLots').mockResolvedValue([])
  vi.spyOn(api, 'getAllStockSplits').mockResolvedValue([])
  vi.spyOn(api, 'getTickerPreferences').mockResolvedValue([])
  vi.spyOn(api, 'getHistoricalPrices').mockResolvedValue([{
    ticker: 'TEST', closePrice: 100, priceDate: '2026-10-23', marketDate: '2026-10-23', source: 'test',
  }])
  return vi.spyOn(api, 'getCurrentPrices').mockResolvedValue({
    source: 'test', missingTickers: [], prices: [{ ticker: 'TEST', price: 104, changePercent: 4, source: 'test', asOf: time }],
  })
}

describe('target-distance price loading', () => {
  it('uses the latest stored close on weekends without requesting live quotes', async () => {
    const live = mockPortfolio('2026-10-24T16:00:00Z')
    const result = await loadTargetDistances()
    expect(live).not.toHaveBeenCalled()
    expect(api.getHistoricalPrices).toHaveBeenCalledWith('2026-10-24', '2026-10-24', ['TEST'], true)
    expect(result.inputs[0]).toEqual({ ...input, buy: 80, sell: 160 })
    expect(result.warning).toBeNull()
  })

  it('prefers live regular-session quotes and uses the same configured targets', async () => {
    mockPortfolio('2026-10-26T16:00:00Z')
    const result = await loadTargetDistances()
    expect(result.inputs[0]).toMatchObject({ price: 104, buy: 80, sell: 160, priceLabel: 'Live 2026-10-26T16:00:00Z' })
    expect(getTargetDistanceRows(result.inputs)[0].tier).toBe(30)
  })

  it('selects the latest available saved price regardless of response order', async () => {
    mockPortfolio('2026-10-24T16:00:00Z')
    const historical = {
      ticker: 'TEST', closePrice: 100, priceDate: '2026-10-23', marketDate: '2026-10-23', source: 'test',
    }
    vi.mocked(api.getHistoricalPrices).mockResolvedValue([
      historical, { ...historical, closePrice: 95, priceDate: '2026-10-22', marketDate: '2026-10-22' },
    ])
    expect((await loadTargetDistances()).inputs[0].price).toBe(100)
  })

  it('uses the latest buy or sale rather than dividends and adjusts target bases for splits', async () => {
    mockPortfolio('2026-10-24T16:00:00Z')
    const transaction = (await api.getStockTransactions())[0]
    vi.mocked(api.getStockTransactions).mockResolvedValue([
      transaction,
      { ...transaction, id: 'sell', type: 'sell', price: 200, transactionDate: '2026-10-02' },
      { ...transaction, id: 'dividend', type: 'div', price: 250, transactionDate: '2026-10-04' },
    ])
    vi.mocked(api.getAllStockSplits).mockResolvedValue([{
      id: 'split', ticker: 'TEST', splitDate: '2026-10-05', ratioNumerator: 2, ratioDenominator: 1, multiplier: 2,
    }])
    expect((await loadTargetDistances()).inputs[0]).toMatchObject({ buy: 80, sell: 160 })
  })

  it('falls back to stored prices with an explicit warning when live pricing fails', async () => {
    mockPortfolio('2026-10-26T16:00:00Z').mockRejectedValue(new Error('Quote service unavailable'))
    const result = await loadTargetDistances()
    expect(result.inputs[0].price).toBe(100)
    expect(result.warning).toContain('Quote service unavailable')
  })

  it('reports missing live quotes and excluded tickers without treating them as matches', async () => {
    mockPortfolio('2026-10-26T16:00:00Z').mockResolvedValue({ source: 'test', prices: [], missingTickers: ['TEST'] })
    vi.mocked(api.getHistoricalPrices).mockResolvedValue([])
    const result = await loadTargetDistances()
    expect(result.warning).toContain('TEST')
    expect(result.excluded).toEqual(['TEST'])
    expect(getTargetDistanceRows(result.inputs)).toEqual([])
  })

  it('propagates failures in required portfolio data instead of showing an empty success', async () => {
    mockPortfolio('2026-10-24T16:00:00Z')
    vi.mocked(api.getUserTargetSettings).mockRejectedValue(new Error('Settings unavailable'))
    await expect(loadTargetDistances()).rejects.toThrow('Settings unavailable')
  })
})
