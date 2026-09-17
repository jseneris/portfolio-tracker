import { describe, expect, it } from 'vitest'
import { calculatePortfolioSnapshot, calculateTickerYearlyGainLoss, calculateYearlyGainLoss } from './portfolioSnapshot'

describe('calculatePortfolioSnapshot', () => {
  it('uses active split-adjusted shares for stock and portfolio value', () => {
    const snapshot = calculatePortfolioSnapshot({
      snapshotDate: '2022-01-10',
      stockTransactions: [
        {
          id: 'buy-1',
          userId: 'user-1',
          ticker: 'TEST',
          type: 'buy',
          quantity: 10,
          price: 10,
          amount: 100,
          transactionDate: '2022-01-03T00:00:00Z',
        },
      ],
      cashTransactions: [
        {
          id: 'cash-1',
          userId: 'user-1',
          type: 'deposit',
          amount: 1000,
          transactionDate: '2022-01-03T00:00:00Z',
        },
      ],
      historicalPrices: [
        {
          ticker: 'TEST',
          priceDate: '2022-01-10',
          marketDate: '2022-01-10',
          closePrice: 5,
          source: 'test',
        },
      ],
      splitEvents: [
        {
          id: 'split-1',
          ticker: 'TEST',
          ratioNumerator: 2,
          ratioDenominator: 1,
          multiplier: 2,
          splitDate: '2022-01-05T00:00:00Z',
          isActive: true,
        },
      ],
    })

    expect(snapshot.holdings[0]?.totalShares).toBe(20)
    expect(snapshot.stockValue).toBe(100)
    expect(snapshot.availableCash).toBe(900)
    expect(snapshot.portfolioValue).toBe(1000)
  })

  it('removes source shares for an exchange transaction', () => {
    const snapshot = calculatePortfolioSnapshot({
      snapshotDate: '2022-01-10',
      stockTransactions: [
        {
          id: 'buy-source', userId: 'user-1', ticker: 'OLD', type: 'buy',
          quantity: 10, price: 10, amount: 100, transactionDate: '2022-01-03T00:00:00Z',
        },
        {
          id: 'exchange', userId: 'user-1', ticker: 'OLD', type: 'exchange',
          quantity: null, price: null, amount: null, exchangeSourceQuantity: 10,
          transactionDate: '2022-01-05T00:00:00Z',
        },
        {
          id: 'buy-target', userId: 'user-1', ticker: 'NEW', type: 'buy',
          quantity: 20, price: 5, amount: 100, transactionDate: '2022-01-05T00:00:00Z',
        },
      ],
      cashTransactions: [],
      historicalPrices: [
        { ticker: 'OLD', priceDate: '2022-01-10', marketDate: '2022-01-10', closePrice: 12, source: 'test' },
        { ticker: 'NEW', priceDate: '2022-01-10', marketDate: '2022-01-10', closePrice: 6, source: 'test' },
      ],
      splitEvents: [],
    })

    expect(snapshot.holdings.map((holding) => holding.ticker)).toEqual(['NEW'])
    expect(snapshot.holdings[0]?.totalShares).toBe(20)
    expect(snapshot.holdingsMarketValue).toBe(120)
  })

  it('does not reduce available cash for exchange-generated buys', () => {
    const snapshot = calculatePortfolioSnapshot({
      snapshotDate: '2022-01-10',
      stockTransactions: [
        {
          id: 'exchange-buy', userId: 'user-1', ticker: 'NEW', type: 'buy',
          quantity: 20, price: 5, amount: 100, isExchangeGenerated: true,
          transactionDate: '2022-01-05T00:00:00Z',
        },
      ],
      cashTransactions: [],
      historicalPrices: [
        { ticker: 'NEW', priceDate: '2022-01-10', marketDate: '2022-01-10', closePrice: 6, source: 'test' },
      ],
      splitEvents: [],
    })

    expect(snapshot.availableCash).toBe(0)
    expect(snapshot.portfolioValue).toBe(120)
  })

  it('calculates yearly gain/loss from portfolio value change after current-year deposits and withdrawals', () => {
    const yearlyGainLoss = calculateYearlyGainLoss({
      snapshotDate: '2024-09-17',
      previousYearEndPortfolioValue: 1000,
      currentPortfolioValue: 1350,
      cashTransactions: [
        {
          id: 'deposit-current-year',
          userId: 'user-1',
          type: 'deposit',
          amount: 500,
          transactionDate: '2024-01-15T00:00:00Z',
        },
        {
          id: 'withdrawal-current-year',
          userId: 'user-1',
          type: 'withdrawal',
          amount: 200,
          transactionDate: '2024-03-01T00:00:00Z',
        },
        {
          id: 'deposit-prior-year',
          userId: 'user-1',
          type: 'deposit',
          amount: 900,
          transactionDate: '2023-11-01T00:00:00Z',
        },
        {
          id: 'interest-current-year',
          userId: 'user-1',
          type: 'interest',
          amount: 25,
          transactionDate: '2024-04-01T00:00:00Z',
        },
      ],
    })

    expect(yearlyGainLoss).toBe(50)
  })

  it('returns null yearly gain/loss when a required portfolio value is unavailable', () => {
    expect(calculateYearlyGainLoss({
      snapshotDate: '2024-09-17',
      previousYearEndPortfolioValue: null,
      currentPortfolioValue: 1350,
      cashTransactions: [],
    })).toBeNull()
  })

  it('calculates ticker yearly gain/loss from market value change after ticker buys and sells', () => {
    const yearlyGainLoss = calculateTickerYearlyGainLoss({
      ticker: 'TEST',
      snapshotDate: '2024-09-17',
      previousYearEndMarketValue: 1000,
      currentMarketValue: 1450,
      stockTransactions: [
        {
          id: 'buy-current-year',
          userId: 'user-1',
          ticker: 'TEST',
          type: 'buy',
          quantity: 10,
          price: 50,
          amount: 500,
          transactionDate: '2024-02-01T00:00:00Z',
        },
        {
          id: 'sell-current-year',
          userId: 'user-1',
          ticker: 'TEST',
          type: 'sell',
          quantity: 2,
          price: 100,
          amount: 200,
          transactionDate: '2024-08-01T00:00:00Z',
        },
        {
          id: 'buy-other-ticker',
          userId: 'user-1',
          ticker: 'OTHER',
          type: 'buy',
          quantity: 1,
          price: 1000,
          amount: 1000,
          transactionDate: '2024-03-01T00:00:00Z',
        },
        {
          id: 'buy-prior-year',
          userId: 'user-1',
          ticker: 'TEST',
          type: 'buy',
          quantity: 10,
          price: 100,
          amount: 1000,
          transactionDate: '2023-11-01T00:00:00Z',
        },
      ],
    })

    expect(yearlyGainLoss).toBe(150)
  })

  it('returns null ticker yearly gain/loss when a required market value is unavailable', () => {
    expect(calculateTickerYearlyGainLoss({
      ticker: 'TEST',
      snapshotDate: '2024-09-17',
      previousYearEndMarketValue: 1000,
      currentMarketValue: null,
      stockTransactions: [],
    })).toBeNull()
  })
})