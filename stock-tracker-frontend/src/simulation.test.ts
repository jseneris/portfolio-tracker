import { describe, expect, it } from 'vitest'
import type { SimulationBar, StockSplitEvent, StockTransaction, TickerPreference } from './api'
import { getSimulationDateRange, simulatePortfolio, type SimulationInput } from './simulation'

function transaction(overrides: Partial<StockTransaction> = {}): StockTransaction {
  return { id: 'buy', userId: 'user', ticker: 'AAA', type: 'buy', quantity: 1, price: 100, amount: 100, transactionDate: '2025-12-01', ...overrides }
}
function bar(date: string, overrides: Partial<SimulationBar> = {}): SimulationBar {
  return { ticker: 'AAA', date, open: 100, high: 100, low: 100, close: 100, ...overrides }
}
function preference(baseSize = 3): TickerPreference {
  return { ticker: 'AAA', baseSize, buyOnDip: false, buyOnDipPrice: null, buyRestricted: false,
    buyRestrictedUntil: null, isBuyRestricted: false, restrictionSalePrice: null }
}
function fixture(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    startDate: '2026-01-01', endDate: '2026-01-02',
    transactions: [1, 2, 3].map((id) => transaction({ id: String(id) })),
    cashTransactions: [{ id: 'cash', userId: 'user', amount: 300, type: 'deposit', transactionDate: '2025-11-01' }],
    splits: [], preferences: [preference()],
    settings: { basePurchaseSize: 300, saleTargetPercent: 10, buyOnDipBuyTargetPercent: 1,
      buyTargetPercentAtBaseSize: 10, buyTargetPercentBasePlus1: 15,
      buyTargetPercentBasePlus2: 20, buyTargetPercentBasePlus3OrMore: 25 },
    bars: [bar('2026-01-01'), bar('2026-01-02')], ...overrides,
  }
}
function scenario(input: SimulationInput, name = 'Aggressive') {
  return simulatePortfolio(input).scenarios.find((item) => item.name === name)!
}
const split: StockSplitEvent = { id: 'split', ticker: 'AAA', splitDate: '2026-01-02',
  ratioNumerator: 2, ratioDenominator: 1, multiplier: 2, isActive: true }

describe('portfolio simulation', () => {
  it('starts all five lines at the same actual total including cash, without modifying input', () => {
    const input = fixture()
    const before = JSON.stringify(input)
    const result = simulatePortfolio(input)
    expect(result.points[0].values).toEqual({ Actual: 300, Aggressive: 300, Base: 300, Scared: 300, Fearful: 300 })
    expect(result.scenarios).toHaveLength(5)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('uses exact daily low and minimum whole shares, allowing negative cash', () => {
    const input = fixture({ bars: [bar('2026-01-01'), bar('2026-01-02', { low: 90, close: 95 })] })
    const aggressive = scenario(input)
    expect(aggressive.trades).toEqual([{ date: '2026-01-02', ticker: 'AAA', action: 'buy', price: 90, quantity: 4 }])
    expect(aggressive.trades[0].quantity * 90).toBeGreaterThanOrEqual(300)
    expect((aggressive.trades[0].quantity - 1) * 90).toBeLessThan(300)
    expect(aggressive.cash).toBe(-360)
    expect(simulatePortfolio(input).points[1].values.Aggressive).toBe(305)
  })

  it('runs each confirmed preset independently', () => {
    const result = simulatePortfolio(fixture({ bars: [bar('2026-01-01'), bar('2026-01-02', { low: 86, close: 95 })] }))
    expect(result.scenarios.slice(1).map((item) => item.trades.filter((trade) => trade.action === 'buy').length)).toEqual([1, 1, 0, 0])
    expect(result.scenarios[2].trades[0].price).toBe(87)
  })

  it('fills gap-down buys at the opening price and does not re-enter on the same day', () => {
    const actual = scenario(fixture({ bars: [bar('2026-01-01'), bar('2026-01-02', { open: 80, low: 60, high: 100, close: 85 })] }))
    expect(actual.trades).toEqual([{ date: '2026-01-02', ticker: 'AAA', action: 'buy', quantity: 4, price: 80 }])
  })

  it('skips both-target days, including flag changes, but still values at close', () => {
    const input = fixture({ bars: [bar('2026-01-01'), bar('2026-01-02', { low: 80, high: 120, close: 105 })] })
    const result = simulatePortfolio(input)
    expect(scenario(input).trades).toEqual([{ date: '2026-01-02', ticker: 'AAA', action: 'skip-both', price: 105, quantity: 0 }])
    expect(result.points[result.points.length - 1].values.Aggressive).toBe(315)
    expect(scenario(input).cash).toBe(0)
  })

  it('sells the smallest display lot above base, at the exact high target', () => {
    const input = fixture({
      transactions: [5, 2, 4, 3].map((quantity, id) => transaction({ id: String(id), quantity, amount: quantity * 100 })),
      bars: [bar('2026-01-01'), bar('2026-01-02', { high: 110, close: 105 })],
    })
    expect(scenario(input).trades).toEqual([{ date: '2026-01-02', ticker: 'AAA', action: 'sell', quantity: 2, price: 110 }])
  })

  it('fills gap-up sells at the opening price', () => {
    const input = fixture({ preferences: [preference(2)],
      bars: [bar('2026-01-01'), bar('2026-01-02', { open: 120, high: 125, low: 115, close: 120 })] })
    expect(scenario(input).trades[0]).toMatchObject({ action: 'sell', quantity: 1, price: 120 })
  })

  it('captures Buy on Dip instead of selling at even weight, then buys at the captured dip target', () => {
    const input = fixture({ endDate: '2026-01-03', bars: [
      bar('2026-01-01'), bar('2026-01-02', { high: 110, close: 110 }),
      bar('2026-01-03', { open: 110, low: 108, high: 112, close: 110 }),
    ] })
    expect(scenario(input).trades).toEqual([
      { date: '2026-01-02', ticker: 'AAA', action: 'buy-on-dip', quantity: 0, price: 110 },
      { date: '2026-01-03', ticker: 'AAA', action: 'buy', quantity: 3, price: 108.9 },
    ])
  })

  it('automatically uses Buy on Dip below base, identically across presets', () => {
    const input = fixture({ preferences: [preference(4)],
      bars: [bar('2026-01-01'), bar('2026-01-02', { low: 99, close: 100 })] })
    for (const result of simulatePortfolio(input).scenarios.slice(1)) {
      expect(result.trades[0]).toMatchObject({ action: 'buy', price: 99, quantity: 4 })
    }
  })

  it('does not recapture an already enabled dip anchor on further rallies', () => {
    const input = fixture({ preferences: [preference(4)], endDate: '2026-01-03', bars: [
      bar('2026-01-01'), bar('2026-01-02', { high: 115, low: 100, close: 110 }),
      bar('2026-01-03', { high: 110, low: 99, close: 100 }),
    ] })
    expect(scenario(input).trades).toHaveLength(1)
    expect(scenario(input).trades[0]).toMatchObject({ action: 'skip-both' })
  })

  it('uses base-relative +1, +2, and +3+ buy percentages', () => {
    for (const [baseSize, low, price] of [[2, 84, 85], [1, 79, 80], [0, 74, 75]]) {
      const input = fixture({ preferences: [preference(baseSize)], bars: [bar('2026-01-01'), bar('2026-01-02', { low, close: 90 })] })
      expect(scenario(input).trades[0]).toMatchObject({ action: 'buy', price })
    }
  })

  it('includes external cashflows in every line but replaces actual buys and sells', () => {
    const input = fixture()
    input.cashTransactions.push({ id: 'newcash', userId: 'user', amount: 100, type: 'deposit', transactionDate: '2026-01-02' })
    input.transactions.push(transaction({ id: 'actual-sale', type: 'sell', quantity: 1, price: 100, amount: 100, transactionDate: '2026-01-02' }))
    const result = simulatePortfolio(input)
    expect(result.points[result.points.length - 1].values).toEqual({ Actual: 400, Aggressive: 400, Base: 400, Scared: 400, Fearful: 400 })
    expect(result.scenarios[0].cash).toBe(200)
    expect(result.scenarios[1].cash).toBe(100)
  })

  it('applies reinvestment rate to hypothetical shares instead of copying actual dividend shares', () => {
    const input = fixture({ endDate: '2026-01-03', bars: [bar('2026-01-01'),
      bar('2026-01-02', { low: 90, close: 95 }), bar('2026-01-03', { open: 95, high: 95, low: 95, close: 95 })] })
    input.transactions.push(transaction({ id: 'dividend', type: 'div', quantity: 0.3, amount: 28.5, price: 95, transactionDate: '2026-01-03' }))
    const result = simulatePortfolio(input)
    expect(result.points[result.points.length - 1].values.Actual).toBeCloseTo(313.5)
    expect(result.points[result.points.length - 1].values.Aggressive).toBeCloseTo(371.5)
  })

  it('splits shares and price anchors without creating phantom gains or trades', () => {
    const input = fixture({ splits: [split], bars: [bar('2026-01-01'), bar('2026-01-02', { open: 50, low: 50, high: 50, close: 50 })] })
    expect(simulatePortfolio(input).points[1].values).toEqual({ Actual: 300, Aggressive: 300, Base: 300, Scared: 300, Fearful: 300 })
    expect(scenario(input).trades).toHaveLength(0)
  })

  it('reconstructs pre-start splits and ignores inactive splits', () => {
    const input = fixture({ splits: [{ ...split, splitDate: '2025-12-15' }, { ...split, id: 'inactive', isActive: false }],
      bars: [bar('2026-01-01', { open: 50, low: 50, high: 50, close: 50 }), bar('2026-01-02', { open: 50, low: 50, high: 50, close: 50 })] })
    expect(simulatePortfolio(input).points[0].values.Actual).toBe(300)
    expect(scenario(input).trades).toHaveLength(0)
  })

  it('requires active recorded splits to match provider history', () => {
    expect(() => simulatePortfolio(fixture({ marketSplits: [{ ticker: 'AAA', date: split.splitDate, multiplier: 2 }] }))).toThrow('split history')
    expect(() => simulatePortfolio(fixture({ splits: [split], marketSplits: [] }))).toThrow('split history')
  })

  it('rejects missing split-day prices rather than creating phantom split gains from a stale close', () => {
    expect(() => simulatePortfolio(fixture({ splits: [split], bars: [bar('2026-01-01')] }))).toThrow('missing OHLC on split date')
    expect(() => simulatePortfolio(fixture({ splits: [{ ...split, splitDate: '2026-01-01' }],
      bars: [bar('2025-12-31'), bar('2026-01-02')] }))).toThrow('starting price precedes a split')
  })

  it('buys exactly the minimum share count when purchase size is an exact multiple', () => {
    const input = fixture({ bars: [bar('2026-01-01'), bar('2026-01-02', { low: 90, close: 95 })] })
    input.settings.basePurchaseSize = 270
    expect(scenario(input).trades[0]).toMatchObject({ action: 'buy', quantity: 3, price: 90 })
  })

  it('carries closes over non-trading days without executing stale bars', () => {
    const input = fixture({ endDate: '2026-01-04', bars: [bar('2026-01-01')] })
    expect(scenario(input).trades).toHaveLength(0)
    expect(simulatePortfolio(input).points).toHaveLength(4)
    expect(simulatePortfolio(input).points[3].values.Aggressive).toBe(300)
  })

  it('reports individual missing bars and never trades from a carried close', () => {
    const input = fixture({ bars: [bar('2026-01-01'), bar('2026-01-02', { ticker: 'BBB' })] })
    expect(simulatePortfolio(input).warnings.join(' ')).toContain('AAA: some sessions have no OHLC bar')
    expect(scenario(input).trades).toHaveLength(0)
  })

  it('fails explicitly instead of summing a partially valued actual portfolio', () => {
    const input = fixture()
    input.transactions.push(transaction({ ticker: 'BBB', id: 'missing' }))
    expect(() => simulatePortfolio(input)).toThrow('starting holding has no historical price')
  })

  it('does not trade newly acquired actual-only tickers', () => {
    const input = fixture()
    input.transactions.push(transaction({ ticker: 'NEW', id: 'ipo', transactionDate: '2026-01-02' }))
    input.bars.push(bar('2026-01-02', { ticker: 'NEW' }))
    const result = simulatePortfolio(input)
    expect(result.warnings.join(' ')).toContain('new tickers')
    expect(result.scenarios[1].trades).toHaveLength(0)
    expect(result.points[result.points.length - 1].values.Actual).toBe(300)
  })

  it('refuses intraperiod exchanges rather than silently dropping corporate conversions', () => {
    const input = fixture()
    input.transactions.push(transaction({ type: 'exchange', id: 'exchange', exchangeSourceQuantity: 1, transactionDate: '2026-01-02' }))
    expect(() => simulatePortfolio(input)).toThrow('includes a stock exchange')
  })

  it('blocks buys through a simulated loss-sale date plus 31 days, then allows buys', () => {
    const input = fixture({ startDate: '2026-01-01', endDate: '2026-02-04', preferences: [preference(1)],
      transactions: [
        transaction({ id: 'a', price: 200, amount: 200 }), transaction({ id: 'b', price: 200, amount: 200 }),
        transaction({ id: 'c', price: 200, amount: 200 }),
        transaction({ id: 'anchor', type: 'sell', transactionDate: '2025-12-31', price: 100, amount: 100 }),
      ], bars: [bar('2026-01-01'), bar('2026-01-02', { high: 110, close: 105 }),
        bar('2026-01-03', { open: 100, low: 90, high: 100, close: 100 }),
        bar('2026-02-02', { open: 100, low: 90, high: 100, close: 100 }),
        bar('2026-02-03', { open: 100, low: 90, high: 100, close: 100 })],
    })
    expect(scenario(input).trades.map((trade) => [trade.date, trade.action])).toEqual([['2026-01-02', 'sell'], ['2026-02-03', 'buy']])
  })

  it.each(['2026-02-30', 'nonsense'])('rejects invalid date %s', (endDate) => {
    expect(() => simulatePortfolio(fixture({ endDate }))).toThrow('Invalid simulation date range')
  })

  it('clamps a three-calendar-month window at month-end and excludes today', () => {
    expect(getSimulationDateRange(new Date('2026-06-01T10:00:00Z'))).toEqual({ startDate: '2026-02-28', endDate: '2026-05-31' })
  })
})
