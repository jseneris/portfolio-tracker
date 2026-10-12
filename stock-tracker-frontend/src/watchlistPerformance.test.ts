import { describe, expect, it } from 'vitest'
import { buildWatchlistPoints } from './watchlistPerformance'

describe('watchlist performance', () => {
  const item = { id: 'watch', ticker: 'TEST', startDate: '2025-06-01' }
  const prices = [
    { date: '2025-05-30', close: 80 },
    { date: '2025-06-02', close: 100 },
    { date: '2025-12-31', close: 120 },
    { date: '2026-01-02', close: 130 },
    { date: '2026-02-02', close: 90 },
  ]

  it('starts at the first close on or after the saved date, not a prior close', () => {
    const points = buildWatchlistPoints(item, prices, '', '2026-02-02')
    expect(points[0]).toEqual({ date: '2025-06-02', value: 0 })
    expect(points[points.length - 1]).toMatchObject({ date: '2026-02-02' })
    expect(points[points.length - 1].value).toBeCloseTo(-10)
  })

  it('clips to a selected year without resetting the saved-date baseline', () => {
    const points = buildWatchlistPoints(item, prices, '2026-01-01', '2026-01-31')
    expect(points.map((point) => point.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-31'])
    expect(points[0].value).toBeCloseTo(20)
    expect(points[2].value).toBeCloseTo(30)
  })

  it('does not display prices before watching began or before the fund had an available quote', () => {
    expect(buildWatchlistPoints(item, prices, '2024-01-01', '2024-12-31')).toEqual([])
    expect(buildWatchlistPoints(item, prices, '2025-01-01', '2025-06-01')).toEqual([])
    expect(buildWatchlistPoints(item, [], '', '2026-01-01')).toEqual([])
  })

  it('rejects invalid closes and never uses a future quote as the opening period value', () => {
    const result = buildWatchlistPoints(item, [
      { date: '2025-06-01', close: 0 },
      { date: '2025-06-02', close: Number.NaN },
      { date: '2025-06-03', close: 100 },
    ], '2025-06-01', '2025-06-02')
    expect(result).toEqual([])
  })
})
