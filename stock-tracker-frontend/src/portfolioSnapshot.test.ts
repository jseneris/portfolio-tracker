import { describe, expect, it } from 'vitest'
import { calculatePortfolioSnapshot } from './portfolioSnapshot'

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
})