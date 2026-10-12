import { describe, expect, it } from 'vitest'
import { HoldingRow, sortHoldingsByResult } from './HoldingsPage'

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

  it('sorts numeric dollar results ascending with unavailable results last', () => {
    expect(sortHoldingsByResult(holdings, 'asc').map((holding) => holding.ticker))
      .toEqual(['LOSS', 'ZERO', 'GAIN', 'UNKNOWN'])
  })

  it('uses ticker order for tied or unavailable results', () => {
    expect(sortHoldingsByResult([row('BBB', 10), row('AAA', 10), row('ZZZ', null), row('YYY', null)], 'desc')
      .map((holding) => holding.ticker)).toEqual(['AAA', 'BBB', 'YYY', 'ZZZ'])
  })
})
