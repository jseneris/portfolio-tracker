import { describe, expect, it } from 'vitest'
import { HoldingRow, sortHoldingsByResult, totalHoldingsResults } from './HoldingsPage'

function row(ticker: string, result: number | null): HoldingRow {
  return { ticker, shares: 0, price: null, value: 0, performance: result, initial: 0, result, closed: true }
}

describe('holdings result sorting', () => {
  const holdings = [row('UNKNOWN', null), row('LOSS', -100), row('GAIN', 200), row('ZERO', 0)]

  it('sorts numeric dollar results descending with unavailable results last', () => {
    expect(sortHoldingsByResult(holdings, 'desc').map((holding) => holding.ticker))
      .toEqual(['GAIN', 'ZERO', 'LOSS', 'UNKNOWN'])
    expect(holdings[0].ticker).toBe('UNKNOWN')
  })

  describe('holdings result totals', () => {
    it('adds gains and losses for the displayed holdings', () => {
      expect(totalHoldingsResults([row('GAIN', 200), row('LOSS', -100), row('ZERO', 0)]))
        .toEqual({ total: 100, unavailableCount: 0 })
    })

    it('reports unavailable values excluded from a partial total', () => {
      expect(totalHoldingsResults([row('GAIN', 200), row('UNKNOWN', null), row('INVALID', NaN)]))
        .toEqual({ total: 200, unavailableCount: 2 })
    })

    it('does not show an unavailable total as zero', () => {
      expect(totalHoldingsResults([row('UNKNOWN', null)])).toEqual({ total: null, unavailableCount: 1 })
      expect(totalHoldingsResults([])).toEqual({ total: null, unavailableCount: 0 })
      expect(totalHoldingsResults([row('ZERO', 0)])).toEqual({ total: 0, unavailableCount: 0 })
    })

    it('includes closed results only when those rows are displayed', () => {
      const holdings = [{ ...row('OPEN', 100), closed: false }, row('CLOSED', -40)]
      expect(totalHoldingsResults(holdings.filter((holding) => !holding.closed)).total).toBe(100)
      expect(totalHoldingsResults(holdings).total).toBe(60)
    })
  })

  it('sorts numeric dollar results ascending with unavailable results last', () => {
    expect(sortHoldingsByResult(holdings, 'asc').map((holding) => holding.ticker))
      .toEqual(['LOSS', 'ZERO', 'GAIN', 'UNKNOWN'])
  })

  it('uses ticker order for tied or unavailable results', () => {
    expect(sortHoldingsByResult([row('BBB', 10), row('AAA', 10), row('ZZZ', null), row('YYY', null)], 'desc')
      .map((holding) => holding.ticker)).toEqual(['AAA', 'BBB', 'YYY', 'ZZZ'])
  })
})
