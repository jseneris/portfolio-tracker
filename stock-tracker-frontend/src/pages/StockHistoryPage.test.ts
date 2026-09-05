import { describe, expect, it } from 'vitest'
import { StockSplitEvent, StockTransaction } from '../api'
import {
  calculateYearlyPerformance,
  findPriceOnOrBefore,
  getSharesAtDate,
} from './StockHistoryPage'

function makeTransaction(overrides: Partial<StockTransaction> = {}): StockTransaction {
  return {
    id: 'tx-1',
    userId: 'user-1',
    ticker: 'TEST',
    type: 'buy',
    quantity: 10,
    price: 100,
    amount: 1000,
    transactionDate: '2024-01-15T00:00:00Z',
    ...overrides,
  }
}

function makeSplit(overrides: Partial<StockSplitEvent> = {}): StockSplitEvent {
  return {
    id: 'split-1',
    ticker: 'TEST',
    ratioNumerator: 2,
    ratioDenominator: 1,
    multiplier: 2,
    splitDate: '2024-06-01T00:00:00Z',
    isActive: true,
    ...overrides,
  }
}

const PRICES = [
  { priceDate: '2024-12-31', closePrice: 150 },
  { priceDate: '2025-12-31', closePrice: 200 },
  { priceDate: '2026-09-04', closePrice: 250 },
]

describe('findPriceOnOrBefore', () => {
  it('returns the latest price on or before the date', () => {
    expect(findPriceOnOrBefore(PRICES, '2025-06-15')).toBe(150)
    expect(findPriceOnOrBefore(PRICES, '2025-12-31')).toBe(200)
  })

  it('returns null when no price exists on or before the date', () => {
    expect(findPriceOnOrBefore(PRICES, '2023-12-31')).toBeNull()
  })
})

describe('getSharesAtDate', () => {
  it('sums buys and sells as of a date', () => {
    const transactions = [
      makeTransaction({ id: 'buy-1', type: 'buy', quantity: 10 }),
      makeTransaction({ id: 'buy-2', type: 'buy', quantity: 5, transactionDate: '2025-03-01T00:00:00Z' }),
      makeTransaction({ id: 'sell-1', type: 'sell', quantity: 4, transactionDate: '2025-06-01T00:00:00Z' }),
    ]

    expect(getSharesAtDate(transactions, '2024-12-31', [])).toBe(10)
    expect(getSharesAtDate(transactions, '2025-12-31', [])).toBe(11)
  })

  it('applies split multipliers to transactions before the split', () => {
    const transactions = [
      makeTransaction({ id: 'buy-1', type: 'buy', quantity: 10, transactionDate: '2024-01-15T00:00:00Z' }),
    ]
    const splits = [{ day: Date.UTC(2024, 5, 1), multiplier: 2 }]

    expect(getSharesAtDate(transactions, '2024-05-31', splits)).toBe(10)
    expect(getSharesAtDate(transactions, '2024-12-31', splits)).toBe(20)
  })
})

describe('calculateYearlyPerformance', () => {
  it('matches summary performance when held for a single year', () => {
    const transactions = [
      makeTransaction({ id: 'buy-1', type: 'buy', quantity: 10, price: 100, amount: 1000, transactionDate: '2026-01-10T00:00:00Z' }),
    ]

    const result = calculateYearlyPerformance({
      transactions,
      historicalPrices: PRICES,
      splitEvents: [],
      finalValue: 2500,
      asOfDate: '2026-09-04',
    })

    expect(result.years).toHaveLength(1)
    expect(result.years[0].performance).toBe(1500)
    expect(result.overall).toBe(1500)
  })

  it('splits performance across years so the sum equals all-time performance', () => {
    const transactions = [
      makeTransaction({ id: 'buy-1', type: 'buy', quantity: 10, price: 100, amount: 1000, transactionDate: '2024-01-15T00:00:00Z' }),
    ]

    const result = calculateYearlyPerformance({
      transactions,
      historicalPrices: PRICES,
      splitEvents: [],
      finalValue: 2500,
      asOfDate: '2026-09-04',
    })

    expect(result.years).toHaveLength(3)
    expect(result.years[0].year).toBe(2024)
    expect(result.years[0].performance).toBe(500)
    expect(result.years[1].year).toBe(2025)
    expect(result.years[1].performance).toBe(500)
    expect(result.years[2].year).toBe(2026)
    expect(result.years[2].performance).toBe(500)

    const yearSum = result.years.reduce((sum, row) => sum + (row.performance ?? 0), 0)
    expect(yearSum).toBe(result.overall)
  })

  it('handles mid-year buys and sells using net invested', () => {
    const transactions = [
      makeTransaction({ id: 'buy-1', type: 'buy', quantity: 10, price: 100, amount: 1000, transactionDate: '2024-01-15T00:00:00Z' }),
      makeTransaction({ id: 'sell-1', type: 'sell', quantity: 5, price: 200, amount: 1000, transactionDate: '2025-06-01T00:00:00Z' }),
    ]

    const result = calculateYearlyPerformance({
      transactions,
      historicalPrices: PRICES,
      splitEvents: [],
      finalValue: 1250,
      asOfDate: '2026-09-04',
    })

    expect(result.years[0].performance).toBe(500)
    expect(result.years[1].performance).toBe(500)
    expect(result.years[2].performance).toBe(250)
    expect(result.overall).toBe(1250)
  })

  it('applies split-adjusted shares for year-end values', () => {
    const transactions = [
      makeTransaction({ id: 'buy-1', type: 'buy', quantity: 10, price: 100, amount: 1000, transactionDate: '2024-01-15T00:00:00Z' }),
    ]
    const splits = [makeSplit({ multiplier: 2, splitDate: '2024-06-01T00:00:00Z' })]

    const result = calculateYearlyPerformance({
      transactions,
      historicalPrices: PRICES,
      splitEvents: splits,
      finalValue: 5000,
      asOfDate: '2026-09-04',
    })

    expect(result.years[0].performance).toBe(2000)
    expect(result.years[1].performance).toBe(1000)
    expect(result.years[2].performance).toBe(1000)
    expect(result.overall).toBe(4000)
  })
})
