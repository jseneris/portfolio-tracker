import { describe, expect, it } from 'vitest'
import { buildLatestBuyOrSellByTicker } from './targetPrices'
import type { StockTransaction } from './api'

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
