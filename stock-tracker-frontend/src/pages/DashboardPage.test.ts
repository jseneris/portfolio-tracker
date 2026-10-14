import { describe, expect, it } from 'vitest'
import { StockSplitEvent, StockTransaction } from '../api'
import {
  formatLotCountDifference,
  getLotCountDifference,
  getLotCountDifferenceStyle,
  getSplitAdjustedTargetBasePrice,
  getTargetBaseMarker,
  getTargetBarPosition,
  getTargetProximityLabel,
} from './DashboardPage'

describe('target proximity labels', () => {
  it('shows the effective signed percentage used for the relevant target', () => {
    expect(getTargetProximityLabel('sell', 100, 95, 110)).toBe('Approaching sale target (+10.00%)')
    expect(getTargetProximityLabel('buy', 100, 95, 110)).toBe('Approaching buy target (-5.00%)')
  })

  it('reflects target overrides and omits invalid target data', () => {
    expect(getTargetProximityLabel('buy', 100, 99, 110)).toBe('Approaching buy target (-1.00%)')
    expect(getTargetProximityLabel('sell', 100, null, 110)).toBe('Approaching sale target (+10.00%)')
    expect(getTargetProximityLabel('buy', null, 95, 110)).toBeUndefined()
    expect(getTargetProximityLabel(null, 100, 95, 110)).toBeUndefined()
  })
})

describe('target bar base-price marker', () => {
  const transaction: StockTransaction = {
    id: 'target-transaction',
    userId: 'user-1',
    ticker: 'TEST',
    type: 'buy',
    quantity: 10,
    price: 112.354,
    amount: 1123.54,
    transactionDate: '2026-10-14T00:00:00Z',
  }

  it('labels the last buy and selects the green marker class', () => {
    const marker = getTargetBaseMarker(112.354, transaction)
    expect(marker.className).toBe('target-proximity-base target-proximity-base-buy')
    expect(marker.label).toBe('Base price: $112.3540 (Buy)')
  })

  it('labels the last sale and selects the red marker class', () => {
    const marker = getTargetBaseMarker(112.354, { ...transaction, type: 'sell' })
    expect(marker.className).toBe('target-proximity-base target-proximity-base-sell')
    expect(marker.label).toContain('(Sale)')
  })

  it('keeps the last transaction label when Buy on Dip supplies a different base price', () => {
    const marker = getTargetBaseMarker(100, { ...transaction, type: 'sell' })
    expect(marker.label).toContain('100.0000')
    expect(marker.label).toContain('(Sale)')
    expect(marker.className).toContain('target-proximity-base-sell')
  })

  it('retains a neutral marker when there is no buy or sale transaction', () => {
    for (const latestTransaction of [undefined, { ...transaction, type: 'div' as const }]) {
      const marker = getTargetBaseMarker(100, latestTransaction)
      expect(marker.className).toBe('target-proximity-base')
      expect(marker.label).not.toMatch(/\((Buy|Sale)\)/)
    }
  })

  it('maps prices across the full buy-to-sell target range', () => {
    expect(getTargetBarPosition(100, 90, 110)).toBe(50)
    expect(getTargetBarPosition(112.354, 89.712, 123.354)).toBeCloseTo(67.3, 1)
  })

  it('clips positions to the bar and omits invalid bases or targets', () => {
    expect(getTargetBarPosition(120, 90, 110)).toBe(100)
    expect(getTargetBarPosition(80, 90, 110)).toBe(0)
    expect(getTargetBarPosition(null, 90, 110)).toBeNull()
    expect(getTargetBarPosition(100, NaN, 110)).toBeNull()
    expect(getTargetBarPosition(0, 90, 110)).toBeNull()
    expect(getTargetBarPosition(100, 110, 110)).toBeNull()
  })
})

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