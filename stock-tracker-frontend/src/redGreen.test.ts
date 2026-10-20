import { describe, expect, it } from 'vitest'
import { HistoricalPrice, StockSplitEvent, StockTransaction } from './api'
import { buildRedGreenPoints } from './redGreen'

function transaction(id: string, date: string, type: StockTransaction['type'], quantity: number, ticker = 'AAA'): StockTransaction {
  return { id, userId: 'user', ticker, type, quantity, amount: quantity * 10, price: 10, transactionDate: date }
}

function price(date: string, closePrice: number, ticker = 'AAA', marketDate = date): HistoricalPrice {
  return { ticker, priceDate: date, marketDate, closePrice, source: 'test' }
}

function split(date: string, multiplier: number, ticker = 'AAA'): StockSplitEvent {
  return { id: `split-${ticker}-${date}`, ticker, splitDate: date, multiplier, ratioNumerator: multiplier, ratioDenominator: 1, isActive: true }
}

const base = { splitEvents: [] as StockSplitEvent[], startDate: '2026-01-05', endDate: '2026-01-09' }

describe('red/green daily counts', () => {
  it('counts held tickers up, down, and unchanged versus each ticker\'s previous close', () => {
    const points = buildRedGreenPoints({
      ...base,
      transactions: [transaction('a', '2026-01-01', 'buy', 1), transaction('b', '2026-01-01', 'buy', 1, 'BBB'), transaction('c', '2026-01-01', 'buy', 1, 'CCC')],
      historicalPrices: [
        price('2026-01-02', 10), price('2026-01-02', 20, 'BBB'), price('2026-01-02', 30, 'CCC'),
        price('2026-01-05', 11), price('2026-01-05', 19, 'BBB'), price('2026-01-05', 30, 'CCC'),
        price('2026-01-06', 12), price('2026-01-06', 21, 'BBB'), price('2026-01-06', 29, 'CCC'),
      ],
    })
    expect(points).toEqual([
      { date: '2026-01-05', up: 1, down: 1, unchanged: 1 },
      { date: '2026-01-06', up: 2, down: 1, unchanged: 0 },
    ])
  })

  it('uses the prior close before the period for the first day and skips non-trading days', () => {
    const points = buildRedGreenPoints({
      ...base,
      startDate: '2026-01-03',
      transactions: [transaction('a', '2026-01-01', 'buy', 1)],
      historicalPrices: [price('2026-01-02', 10), price('2026-01-05', 9)],
    })
    expect(points).toEqual([{ date: '2026-01-05', up: 0, down: 1, unchanged: 0 }])
  })

  it('counts tickers held at the end of the day, including same-day buys and excluding full sales', () => {
    const points = buildRedGreenPoints({
      ...base,
      transactions: [
        transaction('a', '2026-01-01', 'buy', 1),
        transaction('b', '2026-01-05', 'buy', 1, 'BBB'),
        transaction('c', '2026-01-06', 'sell', 1),
      ],
      historicalPrices: [
        price('2026-01-02', 10), price('2026-01-02', 20, 'BBB'),
        price('2026-01-05', 11), price('2026-01-05', 21, 'BBB'),
        price('2026-01-06', 12), price('2026-01-06', 22, 'BBB'),
      ],
    })
    expect(points.map(({ up, down }) => [up, down])).toEqual([[2, 0], [1, 0]])
  })

  it('normalizes stored closes across splits, and tracks post-split sales correctly', () => {
    const points = buildRedGreenPoints({
      ...base,
      splitEvents: [split('2026-01-05', 2)],
      transactions: [transaction('a', '2026-01-01', 'buy', 10), transaction('b', '2026-01-06', 'sell', 15)],
      historicalPrices: [price('2026-01-02', 100), price('2026-01-05', 49), price('2026-01-06', 50), price('2026-01-07', 50)],
    })
    expect(points).toEqual([
      { date: '2026-01-05', up: 0, down: 1, unchanged: 0 },
      { date: '2026-01-06', up: 1, down: 0, unchanged: 0 },
      { date: '2026-01-07', up: 0, down: 0, unchanged: 1 },
    ])
  })

  it('excludes tickers without a previous close and ignores data outside the period', () => {
    const points = buildRedGreenPoints({
      ...base,
      transactions: [transaction('a', '2026-01-01', 'buy', 1), transaction('b', '2026-01-01', 'buy', 1, 'NEW')],
      historicalPrices: [price('2026-01-02', 10), price('2026-01-05', 11), price('2026-01-05', 5, 'NEW'), price('2026-01-12', 1)],
    })
    expect(points).toEqual([{ date: '2026-01-05', up: 1, down: 0, unchanged: 0 }])
  })

  it('skips weekend and holiday rows that repeat the prior session close', () => {
    const points = buildRedGreenPoints({
      ...base,
      startDate: '2026-01-08',
      endDate: '2026-01-20',
      transactions: [transaction('a', '2026-01-01', 'buy', 1), transaction('b', '2026-01-01', 'buy', 1, 'BBB')],
      historicalPrices: [
        price('2026-01-08', 10), price('2026-01-08', 20, 'BBB'),
        price('2026-01-09', 11), price('2026-01-09', 19, 'BBB'),
        price('2026-01-10', 11, 'AAA', '2026-01-09'), price('2026-01-10', 19, 'BBB', '2026-01-09'),
        price('2026-01-11', 11, 'AAA', '2026-01-09'), price('2026-01-11', 19, 'BBB', '2026-01-09'),
        price('2026-01-12', 12), price('2026-01-12', 18, 'BBB'),
        price('2026-01-19', 12, 'AAA', '2026-01-16'), price('2026-01-19', 18, 'BBB', '2026-01-16'),
        price('2026-01-16', 12), price('2026-01-16', 18, 'BBB'),
        price('2026-01-20', 13), price('2026-01-20', 19, 'BBB'),
      ],
    })
    expect(points.map((point) => point.date)).toEqual(['2026-01-08', '2026-01-09', '2026-01-12', '2026-01-16', '2026-01-20'])
    expect(points.map(({ up, down }) => [up, down])).toEqual([[0, 0], [1, 1], [1, 1], [0, 0], [2, 0]])
  })

  it('uses a pre-period holiday row as the baseline under its trading date', () => {
    const points = buildRedGreenPoints({
      ...base,
      startDate: '2026-01-01',
      transactions: [transaction('a', '2025-12-01', 'buy', 1)],
      historicalPrices: [price('2026-01-01', 10, 'AAA', '2025-12-31'), price('2026-01-02', 11)],
    })
    expect(points).toEqual([{ date: '2026-01-02', up: 1, down: 0, unchanged: 0 }])
  })

  it('applies exchanges as removals from the source ticker', () => {
    const points = buildRedGreenPoints({
      ...base,
      transactions: [
        transaction('a', '2026-01-01', 'buy', 5),
        { ...transaction('x', '2026-01-05', 'exchange', 0), exchangeSourceQuantity: 5 },
      ],
      historicalPrices: [price('2026-01-02', 10), price('2026-01-05', 11)],
    })
    expect(points).toEqual([{ date: '2026-01-05', up: 0, down: 0, unchanged: 0 }])
  })
})
