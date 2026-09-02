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
})