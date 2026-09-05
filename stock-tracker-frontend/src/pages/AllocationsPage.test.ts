import { describe, expect, it } from 'vitest'
import { CompanyProfile } from '../api'
import { AllocationSlice, buildAllocationSlices, sortAllocationSlices } from './AllocationsPage'

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
    { key: 'available-cash', label: 'Available Cash', value: 100, percent: 20, color: '#16a34a', isCash: true },
    { key: 'MSFT', label: 'MSFT', value: 300, percent: 60, color: '#1d4ed8', isCash: false },
    { key: 'AAPL', label: 'AAPL', value: 100, percent: 20, color: '#db2777', isCash: false },
  ]

  it('returns the default order unchanged when no sort column is selected', () => {
    expect(sortAllocationSlices(slices, 'default', 'asc').map((slice) => slice.label))
      .toEqual(['Available Cash', 'MSFT', 'AAPL'])
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
