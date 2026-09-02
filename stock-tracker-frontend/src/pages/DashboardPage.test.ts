import { describe, expect, it } from 'vitest'
import { StockSplitEvent, StockTransaction } from '../api'
import { getSplitAdjustedTargetBasePrice } from './DashboardPage'

describe('getSplitAdjustedTargetBasePrice', () => {
  const transaction: StockTransaction = {
    id: 'buy-1',
    userId: 'user-1',
    ticker: 'TEST',
    type: 'buy',
    quantity: 10,
    price: 120,
    amount: 1200,
    transactionDate: '2026-08-01T00:00:00Z',
  }

  it('uses active splits after the transaction date to adjust the target base price', () => {
    const splits: StockSplitEvent[] = [
      {
        id: 'split-1',
        ticker: 'TEST',
        ratioNumerator: 2,
        ratioDenominator: 1,
        multiplier: 2,
        splitDate: '2026-08-11T00:00:00Z',
        isActive: true,
      },
      {
        id: 'split-2',
        ticker: 'TEST',
        ratioNumerator: 3,
        ratioDenominator: 2,
        multiplier: 1.5,
        splitDate: '2026-08-20T00:00:00Z',
        isActive: true,
      },
    ]

    expect(getSplitAdjustedTargetBasePrice(transaction, splits, '2026-08-31')).toBeCloseTo(40)
  })

  it('excludes inactive splits, future splits, and splits before the transaction', () => {
    const splits: StockSplitEvent[] = [
      {
        id: 'inactive', ticker: 'TEST', ratioNumerator: 2, ratioDenominator: 1,
        multiplier: 2, splitDate: '2026-08-11T00:00:00Z', isActive: false,
      },
      {
        id: 'future', ticker: 'TEST', ratioNumerator: 2, ratioDenominator: 1,
        multiplier: 2, splitDate: '2026-09-01T00:00:00Z', isActive: true,
      },
      {
        id: 'before', ticker: 'TEST', ratioNumerator: 2, ratioDenominator: 1,
        multiplier: 2, splitDate: '2026-07-31T00:00:00Z', isActive: true,
      },
    ]

    expect(getSplitAdjustedTargetBasePrice(transaction, splits, '2026-08-31')).toBe(120)
  })
})