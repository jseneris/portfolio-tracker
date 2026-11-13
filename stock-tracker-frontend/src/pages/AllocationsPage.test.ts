import { describe, expect, it } from 'vitest'
import { CashTransaction, CompanyProfile, HistoricalPrice, StockTransaction } from '../api'
import { calculatePortfolioSnapshot } from '../portfolioSnapshot'
import { AllocationSlice, buildAllocationSlices, buildAllocationYearlyGainLoss, getAllocationYears, sortAllocationSlices } from './AllocationsPage'

function makeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    ticker: 'TEST',
    companyName: 'Test Co',
    sector: 'Technology',
    industry: 'Software',
    marketCap: 3_000_000_000_000,
    sizeClassification: 'Mega Cap',
    source: 'yahoo-finance',
    ...overrides,
  }
}

describe('buildAllocationSlices', () => {
  it('groups by ticker and includes available cash as a slice', () => {
    const result = buildAllocationSlices({
      groupBy: 'ticker',
      holdings: [
        { ticker: 'AAPL', marketValue: 300 },
        { ticker: 'MSFT', marketValue: 100 },
      ],
      profilesByTicker: {},
      availableCash: 100,
    })

    expect(result.slices.map((slice) => slice.label)).toEqual(['Available Cash', 'AAPL', 'MSFT'])
    expect(result.total).toBe(500)
    expect(result.slices[1].percent).toBeCloseTo(60)
    expect(result.slices[0].percent).toBeCloseTo(20)
    expect(result.slices[0].isCash).toBe(true)
    expect(result.slices.map((slice) => slice.tickers)).toEqual([[], ['AAPL'], ['MSFT']])
    expect(result.excludedTickers).toEqual([])
  })

  it('groups by industry using company profiles with an unknown fallback', () => {
    const result = buildAllocationSlices({
      groupBy: 'industry',
      holdings: [
        { ticker: 'AAPL', marketValue: 200 },
        { ticker: 'MSFT', marketValue: 100 },
        { ticker: 'XOM', marketValue: 100 },
      ],
      profilesByTicker: {
        AAPL: makeProfile({ ticker: 'AAPL', industry: 'Hardware' }),
        MSFT: makeProfile({ ticker: 'MSFT', industry: 'Software' }),
        XOM: null,
      },
      availableCash: 100,
    })

    expect(result.slices.map((slice) => slice.label)).toEqual(['Available Cash', 'Hardware', 'Software', 'Unknown Industry'])
    expect(result.slices[1].value).toBe(200)
    expect(result.slices[0].isCash).toBe(true)
  })

  it('orders size slices by market-cap classification rank', () => {
    const result = buildAllocationSlices({
      groupBy: 'size',
      holdings: [
        { ticker: 'SMALL', marketValue: 500 },
        { ticker: 'MEGA', marketValue: 100 },
      ],
      profilesByTicker: {
        SMALL: makeProfile({ ticker: 'SMALL', sizeClassification: 'Small Cap' }),
        MEGA: makeProfile({ ticker: 'MEGA', sizeClassification: 'Mega Cap' }),
      },
      availableCash: 50,
    })

    expect(result.slices.map((slice) => slice.label)).toEqual(['Available Cash', 'Mega Cap', 'Small Cap'])
    expect(result.slices.map((slice) => slice.tickers)).toEqual([[], ['MEGA'], ['SMALL']])
  })

  it.each(['industry', 'size'] as const)('lists unique, alphabetized tickers in each %s category', (groupBy) => {
    const result = buildAllocationSlices({
      groupBy,
      holdings: [
        { ticker: 'MSFT', marketValue: 100 },
        { ticker: 'AAPL', marketValue: 200 },
        { ticker: 'MSFT', marketValue: 50 },
        { ticker: 'UNKNOWN', marketValue: 50 },
        { ticker: 'NOPRICE', marketValue: null },
      ],
      profilesByTicker: {
        MSFT: makeProfile({ ticker: 'MSFT' }),
        AAPL: makeProfile({ ticker: 'AAPL' }),
        NOPRICE: makeProfile({ ticker: 'NOPRICE' }),
      },
      availableCash: 100,
    })
    const category = result.slices.find((slice) => slice.label === (groupBy === 'industry' ? 'Software' : 'Mega Cap'))
    expect(category?.tickers).toEqual(['AAPL', 'MSFT'])
    expect(category?.value).toBe(350)
    expect(category?.percent).toBe(70)
    expect(result.slices.find((slice) => slice.label.startsWith('Unknown'))?.tickers).toEqual(['UNKNOWN'])
    expect(result.slices[0].tickers).toEqual([])
    expect(result.excludedTickers).toEqual(['NOPRICE'])
    expect(sortAllocationSlices(result.slices, 'label', 'asc').find((slice) => slice.key === category?.key)?.tickers)
      .toEqual(['AAPL', 'MSFT'])
  })

  it('excludes holdings without a usable market value', () => {
    const result = buildAllocationSlices({
      groupBy: 'ticker',
      holdings: [
        { ticker: 'AAPL', marketValue: 100 },
        { ticker: 'NOPRICE', marketValue: null },
        { ticker: 'ZERO', marketValue: 0 },
      ],
      profilesByTicker: {},
      availableCash: 0,
    })

    expect(result.slices.map((slice) => slice.label)).toEqual(['AAPL'])
    expect(result.excludedTickers).toEqual(['NOPRICE', 'ZERO'])
  })

  it('omits the cash slice when cash is zero and flags negative cash', () => {
    const zeroCash = buildAllocationSlices({
      groupBy: 'ticker',
      holdings: [{ ticker: 'AAPL', marketValue: 100 }],
      profilesByTicker: {},
      availableCash: 0,
    })
    expect(zeroCash.slices.some((slice) => slice.isCash)).toBe(false)
    expect(zeroCash.isCashNegative).toBe(false)

    const negativeCash = buildAllocationSlices({
      groupBy: 'ticker',
      holdings: [{ ticker: 'AAPL', marketValue: 100 }],
      profilesByTicker: {},
      availableCash: -50,
    })
    expect(negativeCash.slices.some((slice) => slice.isCash)).toBe(false)
    expect(negativeCash.isCashNegative).toBe(true)
    expect(negativeCash.total).toBe(100)
  })

  it('supports cash-only portfolios', () => {
    const result = buildAllocationSlices({
      groupBy: 'ticker',
      holdings: [],
      profilesByTicker: {},
      availableCash: 250,
    })

    expect(result.slices).toHaveLength(1)
    expect(result.slices[0].isCash).toBe(true)
    expect(result.slices[0].percent).toBe(100)
    expect(result.total).toBe(250)
  })
})

describe('sortAllocationSlices', () => {
  const slices: AllocationSlice[] = [
    { key: 'available-cash', label: 'Available Cash', value: 100, percent: 20, color: '#16a34a', isCash: true, tickers: [] },
    { key: 'MSFT', label: 'MSFT', value: 300, percent: 60, color: '#1d4ed8', isCash: false, tickers: ['MSFT'] },
    { key: 'AAPL', label: 'AAPL', value: 100, percent: 20, color: '#db2777', isCash: false, tickers: ['AAPL'] },
  ]

  it('returns the default order unchanged when no sort column is selected', () => {
    expect(sortAllocationSlices(slices, 'default', 'asc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'MSFT', 'AAPL'])
  })

  describe('allocation historical snapshots and yearly gain/loss', () => {
    const stockTransactions: StockTransaction[] = [
      { id: '1', userId: 'u', ticker: 'AAPL', type: 'buy', quantity: 2, price: 100, amount: 200, transactionDate: '2023-06-01' },
      { id: '2', userId: 'u', ticker: 'AAPL', type: 'buy', quantity: 1, price: 120, amount: 120, transactionDate: '2024-06-01' },
      { id: '3', userId: 'u', ticker: 'MSFT', type: 'buy', quantity: 1, price: 100, amount: 100, transactionDate: '2024-03-01' },
      { id: '4', userId: 'u', ticker: 'AAPL', type: 'sell', quantity: 1, price: 200, amount: 200, transactionDate: '2025-01-01' },
    ]
    const cashTransactions: CashTransaction[] = [
      { id: 'c1', userId: 'u', type: 'deposit', amount: 1000, transactionDate: '2022-01-01' },
      { id: 'c2', userId: 'u', type: 'interest', amount: 10, transactionDate: '2024-05-01' },
      { id: 'c3', userId: 'u', type: 'fee', amount: 3, transactionDate: '2024-05-02' },
    ]
    const historicalPrices: HistoricalPrice[] = [
      { ticker: 'AAPL', priceDate: '2023-12-29', marketDate: '2023-12-29', closePrice: 110, source: 'test' },
      { ticker: 'AAPL', priceDate: '2024-12-30', marketDate: '2024-12-30', closePrice: 150, source: 'test' },
      { ticker: 'MSFT', priceDate: '2024-12-30', marketDate: '2024-12-30', closePrice: 130, source: 'test' },
      { ticker: 'AAPL', priceDate: '2025-01-01', marketDate: '2025-01-01', closePrice: 200, source: 'test' },
    ]
    const snapshot = (snapshotDate: string, currentPricesByTicker = {}) => calculatePortfolioSnapshot({
      stockTransactions, cashTransactions, historicalPrices, splitEvents: [], snapshotDate, currentPricesByTicker,
    })

    it('lists every year from the earliest transaction through the current year', () => {
      expect(getAllocationYears(stockTransactions, cashTransactions, 2025)).toEqual([2025, 2024, 2023, 2022])
      expect(getAllocationYears([], [], 2025)).toEqual([2025])
    })

    it('uses historical holdings and stored closes at year end, and live prices only when provided', () => {
      const yearEnd = snapshot('2024-12-31')
      expect(yearEnd.holdings.map((holding) => [holding.ticker, holding.totalShares, holding.marketValue]))
        .toEqual([['AAPL', 3, 450], ['MSFT', 1, 130]])
      expect(yearEnd.availableCash).toBe(587)
      expect(snapshot('2025-01-02', { AAPL: 210 }).holdings[0].marketValue).toBe(420)
    })

    it('calculates ticker, grouped, and cash gain/loss from the selected year', () => {
      const yearEnd = snapshot('2024-12-31')
      const previous = snapshot('2023-12-31')
      const allocation = buildAllocationSlices({
        groupBy: 'industry', holdings: yearEnd.holdings, availableCash: yearEnd.availableCash,
        profilesByTicker: { AAPL: makeProfile({ ticker: 'AAPL' }), MSFT: makeProfile({ ticker: 'MSFT' }) },
      })
      expect(buildAllocationYearlyGainLoss({
        slices: allocation.slices, stockTransactions, cashTransactions, holdings: yearEnd.holdings,
        previousHoldings: previous.holdings, snapshotDate: '2024-12-31',
      })).toEqual({ 'available-cash': 7, Software: 140 })
    })

    it('does not present a partial group gain when a prior holding lacks a price', () => {
      const yearEnd = snapshot('2024-12-31')
      const previous = snapshot('2023-12-31')
      previous.holdings[0].marketValue = null
      const allocation = buildAllocationSlices({
        groupBy: 'industry', holdings: yearEnd.holdings, availableCash: 0,
        profilesByTicker: { AAPL: makeProfile(), MSFT: makeProfile() },
      })
      expect(buildAllocationYearlyGainLoss({
        slices: allocation.slices, stockTransactions, cashTransactions, holdings: yearEnd.holdings,
        previousHoldings: previous.holdings, snapshotDate: '2024-12-31',
      }).Software).toBeNull()
    })
  })

  it('sorts non-cash slices by label while keeping cash pinned first', () => {
    expect(sortAllocationSlices(slices, 'label', 'asc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'AAPL', 'MSFT'])
    expect(sortAllocationSlices(slices, 'label', 'desc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'MSFT', 'AAPL'])
  })

  it('sorts non-cash slices by value and percent while keeping cash pinned first', () => {
    expect(sortAllocationSlices(slices, 'value', 'asc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'AAPL', 'MSFT'])
    expect(sortAllocationSlices(slices, 'value', 'desc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'MSFT', 'AAPL'])
    expect(sortAllocationSlices(slices, 'percent', 'desc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'MSFT', 'AAPL'])
  })
})
