import { describe, expect, it } from 'vitest'
import { buildLatestBuyOrSellByTicker, calculateTickerTargets, checkInsufficientSharesForSmallestLot, getSmallestDisplayLotShares, getSuggestedBuyPrice } from './targetPrices'
import type { DisplayLot, StockTransaction, TickerPreference, UserTargetSettings } from './api'

const tx = (overrides: Partial<StockTransaction>): StockTransaction => ({
  id: 'id', userId: 'u', ticker: 'AAPL', type: 'buy', quantity: 1, price: 100,
  amount: 100, transactionDate: '2026-11-05T00:00:00.000Z', ...overrides,
} as StockTransaction)

describe('buildLatestBuyOrSellByTicker same-day tiebreak', () => {
  it('uses the most recently created transaction when dates tie', () => {
    const earlier = tx({ id: 'a', price: 100, createdAt: '2026-11-05T10:00:00.000Z' })
    const later = tx({ id: 'b', price: 120, createdAt: '2026-11-05T15:30:00.000Z' })
    expect(buildLatestBuyOrSellByTicker([earlier, later]).get('AAPL')?.id).toBe('b')
    expect(buildLatestBuyOrSellByTicker([later, earlier]).get('AAPL')?.id).toBe('b')
  })

  describe('buy target overrides and display lots', () => {
    const settings: UserTargetSettings = {
      basePurchaseSize: 300, saleTargetPercent: 10, buyTargetPercentAtBaseSize: 10,
      buyTargetPercentBasePlus1: 15, buyTargetPercentBasePlus2: 20,
      buyTargetPercentBasePlus3OrMore: 25, buyOnDipBuyTargetPercent: 1,
    }
    const preference: TickerPreference = {
      ticker: 'AAPL', baseSize: 3, buyOnDip: false, buyOnDipPrice: null,
      buyRestricted: false, buyRestrictedUntil: null, isBuyRestricted: false,
      restrictionSalePrice: null, note: null, targetBuyPriceOverride: 60,
    }
    const lots: DisplayLot[] = [
      { id: '1', userId: 'u', ticker: 'AAPL', lots: [10, 2, 8], lotCount: 3, totalQuantity: 20, createdAt: '', updatedAt: '' },
      { id: '2', userId: 'u', ticker: 'AAPL', lots: [5, 0], lotCount: 2, totalQuantity: 5, createdAt: '', updatedAt: '' },
    ]

    it('uses the override for the buy target without changing the sale target', () => {
      expect(calculateTickerTargets(100, 3, settings, preference)).toEqual({ buy: 60, sell: 110.00000000000001 })
      expect(calculateTickerTargets(100, 1, settings, preference)).toEqual({ buy: 60, sell: 110 })
      expect(calculateTickerTargets(100, 3, settings, { ...preference, buyOnDip: true, buyOnDipPrice: 120 })).toEqual({ buy: 60, sell: 132 })
      expect(calculateTickerTargets(null, 3, settings, preference)).toEqual({ buy: 60, sell: null })
      expect(calculateTickerTargets(100, 3, settings, { ...preference, targetBuyPriceOverride: null }).buy).toBe(90)
    })

    it('uses the smallest individual positive lot, not an average or the last row', () => {
      expect(getSmallestDisplayLotShares(lots)).toBe(2)
      expect(getSmallestDisplayLotShares([])).toBeNull()
    })

    it('calculates the price for the next whole-share quantity above the smallest lot', () => {
      const suggested = getSuggestedBuyPrice(300, 2)
      expect(suggested).toBe(100)
      expect(checkInsufficientSharesForSmallestLot(300, 150, 2)).toBe(true)
      expect(checkInsufficientSharesForSmallestLot(300, suggested, 2)).toBe(false)
      expect(getSuggestedBuyPrice(300, 2.5)).toBe(100)
      expect(getSuggestedBuyPrice(300, 0.5)).toBe(300)
      expect(getSuggestedBuyPrice(100, 2)).toBe(33.33333333)
      expect(getSuggestedBuyPrice(0.3, 2)).toBe(0.1)
      expect(3 * getSuggestedBuyPrice(100, 2)!).toBeLessThanOrEqual(100)
      expect(getSuggestedBuyPrice(300, 0)).toBeNull()
      expect(getSuggestedBuyPrice(0.00000001, 2)).toBeNull()
    })
  })

  it('still prefers the later transaction date regardless of createdAt', () => {
    const older = tx({ id: 'a', transactionDate: '2026-11-04T00:00:00.000Z', createdAt: '2026-11-06T00:00:00.000Z' })
    const newer = tx({ id: 'b', transactionDate: '2026-11-05T00:00:00.000Z', createdAt: '2026-11-05T00:00:00.000Z' })
    expect(buildLatestBuyOrSellByTicker([older, newer]).get('AAPL')?.id).toBe('b')
  })

  it('ignores dividends even if created later on the same day', () => {
    const buy = tx({ id: 'a', createdAt: '2026-11-05T10:00:00.000Z' })
    const div = tx({ id: 'c', type: 'div', quantity: null, price: null, amount: 5, createdAt: '2026-11-05T18:00:00.000Z' })
    expect(buildLatestBuyOrSellByTicker([buy, div]).get('AAPL')?.id).toBe('a')
  })
})
