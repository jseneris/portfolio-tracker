import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CashTransaction, DisplayLot, HistoricalPrice, StockSplitEvent, StockTransaction } from '../api'
import { calculatePortfolioSnapshot } from '../portfolioSnapshot'
import {
  calculateDashboardDailyChange,
  countDailyStockChanges,
  formatLotCountDifference,
  getLotCountDifference,
  getLotCountDifferenceStyle,
  DashboardTooltip,
  getTickerInfoBadges,
  getLargestDisplayLotValues,
  getSplitAdjustedTargetBasePrice,
  getTargetBaseMarker,
  getTargetBarPosition,
  getTargetProximityLabel,
  isUsMarketOpenNow,
  mergeDashboardHistoricalPrices,
} from './DashboardPage'

describe('dashboard daily stock counts', () => {
  it('counts positive and negative tickers, not the size of their changes', () => {
    expect(countDailyStockChanges([1, 5, -2, -0.01, 0.001])).toEqual({ positive: 3, negative: 2 })
  })

  describe('dashboard ticker info badges', () => {
    const preference = { baseSize: 3, buyOnDip: false, buyOnDipPrice: null }

    it('shows independent colored symbols, including multiple badges per ticker', () => {
      expect(getTickerInfoBadges(preference, null, 300)).toEqual([])
      expect(getTickerInfoBadges({ ...preference, baseSize: 2 }, null, 300))
        .toEqual([{ symbol: '\u2013', tone: 'red', message: 'Base size: 2 display lots (default is 3).' }])
      const badges = getTickerInfoBadges({ baseSize: 4, buyOnDip: true, buyOnDipPrice: 100 }, 1600, 300)
      expect(badges.map(({ symbol, tone }) => ({ symbol, tone }))).toEqual([
        { symbol: 'B', tone: 'green' }, { symbol: '+', tone: 'green' }, { symbol: '5', tone: 'red' },
      ])
      expect(badges[0].message).toContain('$100.0000')
      expect(badges[2].message).toContain('$1,500.00')
    })

    it('uses a strict 5x threshold and the saved purchase size', () => {
      for (const value of [null, 1499, 1500, NaN, Infinity]) {
        expect(getTickerInfoBadges(preference, value, 300)).toEqual([])
      }
      expect(getTickerInfoBadges(preference, 1500.01, 300).map((badge) => badge.symbol)).toEqual(['5'])
      expect(getTickerInfoBadges(preference, 1600, 400)).toEqual([])
      expect(getTickerInfoBadges(preference, 2000.01, 400).map((badge) => badge.symbol)).toEqual(['5'])
    })

    it('values the largest individual lot at the latest valid stored close, not the sum or a future price', () => {
      const lots: DisplayLot[] = [
        { id: '1', userId: 'u', ticker: 'test', lots: [10, 20], lotCount: 2, totalQuantity: 30, createdAt: '', updatedAt: '' },
        { id: '2', userId: 'u', ticker: 'TEST', lots: [15], lotCount: 1, totalQuantity: 15, createdAt: '', updatedAt: '' },
        { id: '3', userId: 'u', ticker: 'MISSING', lots: [100], lotCount: 1, totalQuantity: 100, createdAt: '', updatedAt: '' },
      ]
      const prices: HistoricalPrice[] = [
        { ticker: 'TEST', priceDate: '2026-10-25', marketDate: '2026-10-25', closePrice: 100, source: 'test' },
        { ticker: 'TEST', priceDate: '2026-10-24', marketDate: '2026-10-24', closePrice: 200, source: 'test' },
        { ticker: 'TEST', priceDate: '2026-10-28', marketDate: '2026-10-28', closePrice: 300, source: 'test' },
        { ticker: 'TEST', priceDate: '2026-10-26', marketDate: '2026-10-26', closePrice: NaN, source: 'test' },
      ]
      expect(getLargestDisplayLotValues(lots, prices, '2026-10-27')).toEqual({ TEST: 2000 })
      expect(getLargestDisplayLotValues(lots, [], '2026-10-27')).toEqual({})
    })

    it('renders a tooltip trigger without expandable inline content', () => {
      const html = renderToStaticMarkup(createElement(DashboardTooltip, { message: 'Buy on Dip', className: 'ticker-info-badge', children: 'B' }))
      expect(html).toContain('<button')
      expect(html).toContain('aria-label="Buy on Dip"')
      expect(html).toContain('>B</button>')
      expect(html).not.toContain('<details')
      expect(html).not.toContain('role="tooltip"')
    })
  })

  it('excludes unchanged, unavailable, and non-finite daily changes', () => {
    expect(countDailyStockChanges([0, -0, null, NaN, Infinity, -Infinity])).toEqual({
      positive: 0, negative: 0,
    })
  })

  it('shows zero counts for no holdings', () => {
    expect(countDailyStockChanges([])).toEqual({ positive: 0, negative: 0 })
  })
})

describe('dashboard daily portfolio change', () => {
  const transaction: StockTransaction = {
    id: 'buy-1', userId: 'user-1', ticker: 'TEST', type: 'buy',
    quantity: 10, price: 90, amount: 900, transactionDate: '2026-10-01',
  }
  const deposit: CashTransaction = {
    id: 'deposit-1', userId: 'user-1', type: 'deposit',
    amount: 900, transactionDate: '2026-10-01',
  }
  const thursday: HistoricalPrice = {
    ticker: 'TEST', priceDate: '2026-10-15', marketDate: '2026-10-15',
    closePrice: 100, source: 'test',
  }
  const friday: HistoricalPrice = {
    ...thursday, priceDate: '2026-10-16', marketDate: '2026-10-16', closePrice: 110,
  }
  const args = {
    stockTransactions: [transaction],
    cashTransactions: [deposit],
    historicalPrices: [friday, thursday],
    splitEvents: [],
    snapshotDate: '2026-10-19',
    currentPortfolioValue: 1100,
    marketOpen: false,
  }

  it.each([
    '2026-10-16T20:00:00Z',
    '2026-10-17T15:00:00Z',
    '2026-10-18T15:00:00Z',
    '2026-10-19T12:59:00Z',
  ])('compares Friday with Thursday outside trading at %s', (time) => {
    expect(calculateDashboardDailyChange({
      ...args,
      snapshotDate: time.slice(0, 10),
      marketOpen: isUsMarketOpenNow(new Date(time)),
    })).toBe(100)
  })

  it('compares live Monday value with Friday at the opening boundary', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      marketOpen: isUsMarketOpenNow(new Date('2026-10-19T13:30:00Z')),
      currentPortfolioValue: 1150,
    })).toBe(50)
  })

  it('uses available closing dates across a holiday, not calendar-day prices', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      snapshotDate: '2026-12-28',
      historicalPrices: [
        { ...thursday, priceDate: '2026-12-23', closePrice: 100 },
        { ...friday, priceDate: '2026-12-24', closePrice: 110 },
      ],
      marketOpen: isUsMarketOpenNow(new Date('2026-12-28T14:00:00Z')),
    })).toBe(100)
  })

  it('keeps the last completed change until a delayed close arrives', () => {
    expect(calculateDashboardDailyChange(args)).toBe(100)
    expect(calculateDashboardDailyChange({
      ...args,
      historicalPrices: [...args.historicalPrices, {
        ...friday, priceDate: '2026-10-19', marketDate: '2026-10-19', closePrice: 115,
      }],
      currentPortfolioValue: 1150,
    })).toBe(50)
  })

  it('excludes cash and stock transactions after the last saved close', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      stockTransactions: [...args.stockTransactions, {
        ...transaction, id: 'buy-2', transactionDate: '2026-10-19',
      }],
      cashTransactions: [...args.cashTransactions, {
        ...deposit, id: 'deposit-2', amount: 2000, transactionDate: '2026-10-18',
      }],
      currentPortfolioValue: 3100,
    })).toBe(100)
  })

  it('includes sales on the last closing date in its portfolio snapshot', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      stockTransactions: [...args.stockTransactions, {
        ...transaction, id: 'sell-1', type: 'sell', quantity: 2, price: 110,
        amount: 220, transactionDate: '2026-10-16',
      }],
    })).toBe(100)
  })

  it('applies splits independently to the two closing snapshots', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      historicalPrices: [thursday, { ...friday, closePrice: 55 }],
      splitEvents: [{
        id: 'split-1', ticker: 'TEST', splitDate: '2026-10-16', multiplier: 2, isActive: true,
        ratioNumerator: 2, ratioDenominator: 1,
      }],
    })).toBe(100)
  })

  it('ignores prices for unrelated tickers and future closing dates', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      historicalPrices: [...args.historicalPrices,
        { ...friday, ticker: 'OTHER', priceDate: '2026-10-19' },
        { ...friday, priceDate: '2026-10-20', closePrice: 200 },
      ],
    })).toBe(100)
  })

  it('returns unavailable rather than zero when either close cannot be valued', () => {
    expect(calculateDashboardDailyChange({ ...args, historicalPrices: [] })).toBeNull()
    expect(calculateDashboardDailyChange({ ...args, historicalPrices: [friday] })).toBeNull()
    expect(calculateDashboardDailyChange({
      ...args, marketOpen: true, currentPortfolioValue: null,
    })).toBeNull()
  })

  it('preserves calendar-day cash changes for portfolios without stock transactions', () => {
    expect(calculateDashboardDailyChange({
      ...args,
      stockTransactions: [],
      historicalPrices: [],
      cashTransactions: [deposit, {
        ...deposit, id: 'deposit-2', amount: 500, transactionDate: '2026-10-19',
      }],
      currentPortfolioValue: 1400,
    })).toBe(500)
  })

  it.each([[90, -100], [100, 0]])('preserves negative and zero changes for a close of %s', (price, change) => {
    expect(calculateDashboardDailyChange({
      ...args, historicalPrices: [thursday, { ...friday, closePrice: price }],
    })).toBe(change)
  })
})

describe('dashboard live-price market window', () => {
  it('is closed at 5:10 PM Eastern when loading the dashboard', () => {
    expect(isUsMarketOpenNow(new Date('2026-10-14T21:10:00Z'))).toBe(false)
  })

  it('allows live quotes only during the regular session, without a closing buffer', () => {
    expect(isUsMarketOpenNow(new Date('2026-10-14T13:29:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-10-14T13:30:00Z'))).toBe(true)
    expect(isUsMarketOpenNow(new Date('2026-10-14T19:59:59Z'))).toBe(true)
    expect(isUsMarketOpenNow(new Date('2026-10-14T20:00:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-10-14T20:09:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-10-14T20:10:00Z'))).toBe(false)
  })

  it('uses Eastern time through standard time, weekends, holidays and early closes', () => {
    expect(isUsMarketOpenNow(new Date('2026-11-02T14:30:00Z'))).toBe(true)
    expect(isUsMarketOpenNow(new Date('2026-10-17T15:00:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-12-25T15:00:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-11-27T17:59:59Z'))).toBe(true)
    expect(isUsMarketOpenNow(new Date('2026-11-27T18:00:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-11-27T18:10:00Z'))).toBe(false)
    expect(isUsMarketOpenNow(new Date('2026-11-02T21:00:00Z'))).toBe(false)
  })
})

describe('dashboard saved closing prices', () => {
  const previousClose: HistoricalPrice = {
    ticker: 'TEST', priceDate: '2026-10-13', marketDate: '2026-10-13',
    closePrice: 100, source: 'test',
  }
  const closingPrice: HistoricalPrice = {
    ...previousClose, priceDate: '2026-10-14', marketDate: '2026-10-14', closePrice: 110,
  }
  const transaction: StockTransaction = {
    id: 'buy-1', userId: 'user-1', ticker: 'TEST', type: 'buy',
    quantity: 10, price: 90, amount: 900, transactionDate: '2026-10-01',
  }

  function holdingAt(time: string, history: HistoricalPrice[]) {
    return calculatePortfolioSnapshot({
      stockTransactions: [transaction],
      cashTransactions: [],
      historicalPrices: history,
      splitEvents: [],
      snapshotDate: '2026-10-14',
      currentPricesByTicker: isUsMarketOpenNow(new Date(time)) ? { TEST: 105 } : {},
    }).holdings[0]
  }

  it('uses the latest saved price and its date before opening and live prices during trading', () => {
    expect(holdingAt('2026-10-14T13:29:00Z', [previousClose])).toMatchObject({
      latestPrice: 100, priceDate: '2026-10-13', isLivePrice: false,
    })
    expect(holdingAt('2026-10-14T13:30:00Z', [previousClose])).toMatchObject({
      latestPrice: 105, isLivePrice: true,
    })
  })

  it('switches to the saved close and its date at the exact closing boundary', () => {
    expect(holdingAt('2026-10-14T20:00:00Z', [closingPrice, previousClose])).toMatchObject({
      latestPrice: 110, priceDate: '2026-10-14', isLivePrice: false, marketValue: 1100,
      historicalChangePercent: 10,
    })
  })

  it('keeps the actual saved date until a delayed close arrives, then replaces same-day corrections', () => {
    expect(holdingAt('2026-10-14T20:01:00Z', [previousClose])).toMatchObject({
      latestPrice: 100, priceDate: '2026-10-13', isLivePrice: false,
    })
    const refreshed = mergeDashboardHistoricalPrices([previousClose], [closingPrice])
    expect(holdingAt('2026-10-14T20:05:00Z', refreshed)).toMatchObject({
      latestPrice: 110, priceDate: '2026-10-14', isLivePrice: false,
    })
    const corrected = mergeDashboardHistoricalPrices(refreshed, [{ ...closingPrice, closePrice: 111 }])
    expect(corrected).toHaveLength(2)
    expect(holdingAt('2026-10-14T20:10:00Z', corrected)).toMatchObject({
      latestPrice: 111, priceDate: '2026-10-14', isLivePrice: false,
    })
  })
})

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