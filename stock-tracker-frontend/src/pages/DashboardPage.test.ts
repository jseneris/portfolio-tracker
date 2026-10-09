import { describe, expect, it } from 'vitest'
import { StockSplitEvent, StockTransaction } from '../api'
import {
  formatLotCountDifference,
  getLotCountDifference,
  getLotCountDifferenceStyle,
  getSplitAdjustedTargetBasePrice,
} from './DashboardPage'

describe('dashboard display lot count comparison', () => {
  it('shows the difference from the configured base size with a plus sign for positive values', () => {
    expect(getLotCountDifference(3, 3)).toBe(0)
    expect(formatLotCountDifference(getLotCountDifference(3, 3))).toBe('--')
    expect(formatLotCountDifference(getLotCountDifference(4, 3))).toBe('+1')
    expect(formatLotCountDifference(getLotCountDifference(5, 3))).toBe('+2')
    expect(formatLotCountDifference(getLotCountDifference(2, 3))).toBe('-1')
  })

  it('uses progressively darker green for higher counts and yellow below the base', () => {
    const zero = String(getLotCountDifferenceStyle(0).backgroundColor)
    const oneAbove = String(getLotCountDifferenceStyle(1).backgroundColor)
    const twoAbove = String(getLotCountDifferenceStyle(2).backgroundColor)

    expect(zero).toBe('hsl(142, 70%, 86%)')
    expect(Number(oneAbove.match(/, (\d+)%\)$/)?.[1])).toBeGreaterThan(Number(twoAbove.match(/, (\d+)%\)$/)?.[1]))
    expect(getLotCountDifferenceStyle(-1).backgroundColor).toBe('#fef08a')
  })
})

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