import { describe, expect, it } from 'vitest'
import { HistoricalPrice, StockTransaction } from './api'
import { buildStockPerformance, getCombinedStockGain, toGainPercent } from './stockPerformance'

function transaction(id: string, date: string, type: StockTransaction['type'], quantity: number, amount: number, ticker = 'TEST'): StockTransaction {
  return { id, userId: 'user', ticker, type, quantity, amount, price: amount / quantity, transactionDate: date }
}

function price(date: string, closePrice: number, ticker = 'TEST'): HistoricalPrice {
  return { ticker, priceDate: date, marketDate: date, closePrice, source: 'test' }
}

describe('stock performance', () => {
  it('tracks marked initial buys as buy-and-hold, ignoring later sales, unmarked buys and dividends', () => {
    const result = buildStockPerformance({
      transactions: [
        { ...transaction('initial', '2026-01-01', 'buy', 10, 1000), isInitialPurchase: true },
        transaction('div', '2026-01-02', 'div', 1, 110),
        transaction('later-buy', '2026-01-02', 'buy', 2, 220),
        transaction('sell', '2026-01-03', 'sell', 13, 1560),
      ],
      historicalPrices: [price('2026-01-01', 100), price('2026-01-02', 110), price('2026-01-03', 120), price('2026-01-04', 130)],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-04',
    })
    expect(result.hasInitialBuys).toBe(true)
    expect(result.points.map((point) => point.initialBuysGain)).toEqual([0, 0, 100, 200, 300])
    expect(result.points[4].gains.TEST).toBe(340)
  })

  it('rebases initial-buy performance for selected years and adjusts active splits', () => {
    const result = buildStockPerformance({
      transactions: [{ ...transaction('initial', '2025-01-01', 'buy', 10, 1000), isInitialPurchase: true }],
      historicalPrices: [price('2025-12-31', 110), price('2026-01-02', 60)],
      splitEvents: [{ id: 'split', ticker: 'TEST', ratioNumerator: 2, ratioDenominator: 1, multiplier: 2, splitDate: '2026-01-02', isActive: true }],
      startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points.map((point) => point.initialBuysGain)).toEqual([0, 100])
  })

  it('reports unavailable initial-buy valuations even after the actual position has been sold', () => {
    const result = buildStockPerformance({
      transactions: [
        { ...transaction('initial', '2025-01-01', 'buy', 10, 1000), isInitialPurchase: true },
        transaction('sold', '2025-06-01', 'sell', 10, 1200),
      ],
      historicalPrices: [], splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points.map((point) => point.initialBuysGain)).toEqual([null, null])
    expect(result.points.map((point) => point.gains.TEST)).toEqual([0, 0])
    expect(result.missingTickers).toEqual(['TEST'])
  })

  it('does not treat exchange-generated or unmarked purchases as initial buys', () => {
    const result = buildStockPerformance({
      transactions: [
        { ...transaction('exchange', '2026-01-01', 'buy', 10, 1000), isInitialPurchase: true, isExchangeGenerated: true },
        transaction('unmarked', '2026-01-01', 'buy', 10, 1000),
      ],
      historicalPrices: [price('2026-01-01', 100)], splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.hasInitialBuys).toBe(false)
  })

  it('skips hypothetical initial holdings in yearly views without warning about their missing prices', () => {
    const result = buildStockPerformance({
      transactions: [
        { ...transaction('initial', '2025-01-01', 'buy', 10, 1000), isInitialPurchase: true },
        transaction('sold', '2025-06-01', 'sell', 10, 1200),
      ],
      historicalPrices: [], splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-02', includeInitialBuys: false,
    })
    expect(result.hasInitialBuys).toBe(false)
    expect(result.missingTickers).toEqual([])
    expect(result.points.map((point) => point.gains.TEST)).toEqual([0, 0])
  })

  it('combines every stock independently of which individual lines are selected', () => {
    const point = { date: '2026-01-02', gains: { AAA: 120, BBB: -50 }, initialBuysGain: 0, bases: {}, initialBuysBasis: null }
    expect(getCombinedStockGain(point, ['AAA', 'BBB'])).toBe(70)
    expect(getCombinedStockGain({ ...point, gains: { AAA: 120, BBB: null } }, ['AAA', 'BBB'])).toBeNull()
    expect(getCombinedStockGain(point, ['AAA', 'MISSING'])).toBeNull()
  })

  it('resets the opening combined and initial-buy gains to zero independently each year', () => {
    const transactions = [{ ...transaction('buy', '2024-01-01', 'buy', 10, 1000), isInitialPurchase: true }]
    const historicalPrices = [price('2024-12-31', 120), price('2025-12-31', 150), price('2026-12-31', 140)]
    const year2025 = buildStockPerformance({ transactions, historicalPrices, splitEvents: [], startDate: '2025-01-01', endDate: '2025-12-31' })
    const year2026 = buildStockPerformance({ transactions, historicalPrices, splitEvents: [], startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(year2025.points[0].gains.TEST).toBe(0)
    expect(year2025.points[0].initialBuysGain).toBe(0)
    expect(year2025.points[year2025.points.length - 1].gains.TEST).toBe(300)
    expect(year2026.points[0].gains.TEST).toBe(0)
    expect(year2026.points[0].initialBuysGain).toBe(0)
    expect(year2026.points[year2026.points.length - 1].gains.TEST).toBe(-100)
    expect(year2026.points[year2026.points.length - 1].initialBuysGain).toBe(-100)
  })

  it('uses start-of-year value plus in-year buys as the percentage basis', () => {
    const result = buildStockPerformance({
      transactions: [
        transaction('old', '2025-01-01', 'buy', 10, 1000),
        transaction('new', '2026-03-01', 'buy', 5, 600),
      ],
      historicalPrices: [price('2025-12-31', 120), price('2026-03-01', 120), price('2026-06-01', 132)],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-06-01',
    })
    const first = result.points[0]
    const last = result.points[result.points.length - 1]
    expect(first.bases.TEST).toBe(1200)
    expect(last.bases.TEST).toBe(1800)
    expect(last.gains.TEST).toBe(180)
    expect(toGainPercent(last.gains.TEST, last.bases.TEST)).toBeCloseTo(10)
    expect(toGainPercent(10, 0)).toBeNull()
  })

  it('starts at zero and includes realized, unrealized and reinvested dividend gains, retaining closed stocks', () => {
    const result = buildStockPerformance({
      transactions: [
        transaction('buy', '2026-01-01', 'buy', 10, 1000),
        transaction('div', '2026-01-02', 'div', 1, 110),
        transaction('sell', '2026-01-03', 'sell', 5, 600),
        transaction('closed', '2026-01-04', 'sell', 6, 780),
      ],
      historicalPrices: [price('2026-01-01', 100), price('2026-01-02', 110), price('2026-01-03', 120)],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-04',
    })
    expect(result.points.map((point) => point.gains.TEST)).toEqual([0, 0, 210, 320, 380])
    expect(result.missingTickers).toEqual([])
  })

  it('rebases existing positions at the prior year end without counting new invested capital as profit', () => {
    const result = buildStockPerformance({
      transactions: [
        transaction('old', '2025-02-01', 'buy', 10, 1000),
        transaction('new', '2026-01-02', 'buy', 5, 600),
      ],
      historicalPrices: [price('2025-12-31', 110), price('2026-01-02', 120)],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points.map((point) => point.gains.TEST)).toEqual([0, 100])
  })

  it('adjusts quantities for active splits without creating artificial gains', () => {
    const result = buildStockPerformance({
      transactions: [transaction('buy', '2026-01-01', 'buy', 10, 1000)],
      historicalPrices: [price('2026-01-01', 100), price('2026-01-02', 50)],
      splitEvents: [{ id: 'split', ticker: 'TEST', ratioNumerator: 2, ratioDenominator: 1, multiplier: 2, splitDate: '2026-01-02', isActive: true }],
      startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points.map((point) => point.gains.TEST)).toEqual([0, 0, 0])
  })

  it('marks missing valuations as gaps instead of treating missing prices as zero or using future prices', () => {
    const result = buildStockPerformance({
      transactions: [transaction('buy', '2026-01-01', 'buy', 10, 1000)],
      historicalPrices: [price('2026-01-03', 120)],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-03',
    })
    expect(result.points.map((point) => point.gains.TEST)).toEqual([0, null, 200])
    expect(result.missingTickers).toEqual(['TEST'])
  })

  it('keeps period returns unavailable when the opening valuation is missing', () => {
    const result = buildStockPerformance({
      transactions: [transaction('buy', '2025-01-01', 'buy', 10, 1000)],
      historicalPrices: [price('2026-01-02', 120)],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points.map((point) => point.gains.TEST)).toEqual([null, null])
    expect(result.missingTickers).toEqual(['TEST'])
  })

  it('does not multiply a stale pre-split quote by post-split shares', () => {
    const result = buildStockPerformance({
      transactions: [transaction('buy', '2026-01-01', 'buy', 10, 1000)],
      historicalPrices: [price('2026-01-01', 100)],
      splitEvents: [{ id: 'split', ticker: 'TEST', ratioNumerator: 2, ratioDenominator: 1, multiplier: 2, splitDate: '2026-01-02', isActive: true }],
      startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points[2].gains.TEST).toBeNull()
    expect(result.missingTickers).toEqual(['TEST'])
  })

  it('accounts for stock exchanges as transferred capital, independently per ticker', () => {
    const result = buildStockPerformance({
      transactions: [
        transaction('buy', '2026-01-01', 'buy', 10, 1000),
        { ...transaction('exchange', '2026-01-02', 'exchange', 10, 1200), exchangeSourceQuantity: 10 },
        { ...transaction('target', '2026-01-02', 'buy', 20, 1200, 'NEW'), isExchangeGenerated: true },
      ],
      historicalPrices: [price('2026-01-01', 100), price('2026-01-02', 60, 'NEW')],
      splitEvents: [], startDate: '2026-01-01', endDate: '2026-01-02',
    })
    expect(result.points[2].gains).toEqual({ NEW: 0, TEST: 200 })
  })
})
