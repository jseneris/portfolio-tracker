import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  DisplayLot,
  getDisplayLots,
  getHistoricalPrices,
  getStockTransactions,
  getTickerPreferences,
  getUserTargetSettings,
  HistoricalPrice,
  PORTFOLIO_UPDATED_EVENT,
  TickerPreference,
  TICKER_BADGES_UPDATED_EVENT,
} from './api'
import { formatCurrency2, formatStockPrice4 } from './formatters'
import { normalizeTargetSettings } from './targetPrices'

export type TickerInfoBadge = { symbol: string; tone: 'green' | 'red'; message: string }

export function getTickerInfoBadges(
  preference: Pick<TickerPreference, 'baseSize' | 'buyOnDip' | 'buyOnDipPrice'>
    & Partial<Pick<TickerPreference, 'isBuyRestricted' | 'buyRestrictedUntil' | 'restrictionSalePrice'>>,
  largestDisplayLotValue: number | null,
  basePurchaseSize: number
): TickerInfoBadge[] {
  const badges: TickerInfoBadge[] = []
  if (preference.isBuyRestricted) {
    const salePriceMessage = preference.restrictionSalePrice == null
      ? 'The triggering loss-sale price is unavailable.'
      : `The triggering loss-sale price was ${formatStockPrice4(preference.restrictionSalePrice)}.`
    badges.push({
      symbol: 'R',
      tone: 'red',
      message: `Buying is restricted${preference.buyRestrictedUntil ? ` through ${preference.buyRestrictedUntil}` : ''}. ${salePriceMessage}`,
    })
  }
  if (preference.buyOnDip) badges.push({ symbol: 'B', tone: 'green', message: `Buy on Dip is enabled${preference.buyOnDipPrice != null ? ` with a base price of ${formatStockPrice4(preference.buyOnDipPrice)}` : ''}.` })
  if (preference.baseSize !== 3) badges.push({
    symbol: preference.baseSize < 3 ? '\u2013' : '+',
    tone: preference.baseSize < 3 ? 'red' : 'green',
    message: `Base size: ${preference.baseSize} display lots (default is 3).`,
  })
  if (largestDisplayLotValue != null && Number.isFinite(largestDisplayLotValue) && basePurchaseSize > 0
    && largestDisplayLotValue > basePurchaseSize * 5) {
    badges.push({ symbol: '5', tone: 'red', message: `Largest display lot: ${formatCurrency2(largestDisplayLotValue)} at the latest stored close, greater than 5 times Base Purchase Size (${formatCurrency2(basePurchaseSize * 5)}).` })
  }
  return badges
}

export function getLargestDisplayLotValues(displayLots: DisplayLot[], historicalPrices: HistoricalPrice[], asOfDate: string): Record<string, number> {
  const closes = new Map<string, HistoricalPrice>()
  for (const price of historicalPrices) {
    const ticker = String(price.ticker || '').trim().toUpperCase()
    if (!price.priceDate || price.priceDate.slice(0, 10) > asOfDate || !Number.isFinite(price.closePrice) || price.closePrice <= 0) continue
    const previous = closes.get(ticker)
    if (!previous || price.priceDate > previous.priceDate) closes.set(ticker, price)
  }
  const values: Record<string, number> = {}
  for (const row of displayLots) {
    const ticker = String(row.ticker || '').trim().toUpperCase()
    const close = closes.get(ticker)
    if (!close) continue
    for (const quantity of row.lots) {
      if (Number.isFinite(quantity) && quantity > 0) values[ticker] = Math.max(values[ticker] ?? 0, quantity * close.closePrice)
    }
  }
  return values
}

type TickerBadgeContextValue = {
  preferences: Record<string, TickerPreference>
  largestDisplayLotValues: Record<string, number>
  basePurchaseSize: number
}

const TickerBadgeContext = createContext<TickerBadgeContextValue>({
  preferences: {},
  largestDisplayLotValues: {},
  basePurchaseSize: 300,
})

export function TickerBadgeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [value, setValue] = useState<TickerBadgeContextValue>({
    preferences: {},
    largestDisplayLotValues: {},
    basePurchaseSize: 300,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (pathname === '/') return
    let cancelled = false
    let requestVersion = 0
    async function load() {
      const version = ++requestVersion
      setError(null)
      try {
        const [preferences, displayLots, settings, transactions] = await Promise.all([
          getTickerPreferences(),
          getDisplayLots(),
          getUserTargetSettings(),
          getStockTransactions(),
        ])
        const tickers = Array.from(new Set(transactions.map((transaction) => transaction.ticker.trim().toUpperCase()).filter(Boolean)))
        const earliestTransactionDate = transactions.reduce((earliest, transaction) => {
          const date = transaction.transactionDate.slice(0, 10)
          return date && (!earliest || date < earliest) ? date : earliest
        }, '')
        const asOfDate = new Date().toISOString().slice(0, 10)
        const prices = tickers.length > 0
          ? await getHistoricalPrices(earliestTransactionDate || asOfDate, asOfDate, tickers)
          : []
        if (cancelled || version !== requestVersion) return
        setValue({
          preferences: Object.fromEntries(preferences.map((preference) => [preference.ticker.trim().toUpperCase(), preference])),
          largestDisplayLotValues: getLargestDisplayLotValues(displayLots, prices, asOfDate),
          basePurchaseSize: normalizeTargetSettings(settings).basePurchaseSize,
        })
      } catch (requestError: unknown) {
        if (cancelled || version !== requestVersion) return
        const message = requestError instanceof Error ? requestError.message : 'Unable to load ticker badges.'
        setError(message)
        console.error('[ticker-badges] Unable to load ticker badge data:', requestError)
      }
    }
    const refresh = () => { void load() }
    refresh()
    window.addEventListener(PORTFOLIO_UPDATED_EVENT, refresh)
    window.addEventListener(TICKER_BADGES_UPDATED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(PORTFOLIO_UPDATED_EVENT, refresh)
      window.removeEventListener(TICKER_BADGES_UPDATED_EVENT, refresh)
    }
  }, [pathname])

  return <TickerBadgeContext.Provider value={value}>
    {error ? <div className="status status-error" role="alert">Ticker badges could not be refreshed: {error}</div> : null}
    {children}
  </TickerBadgeContext.Provider>
}

export function TickerInfoBadges({ ticker }: { ticker: string }) {
  const { preferences, largestDisplayLotValues, basePurchaseSize } = useContext(TickerBadgeContext)
  const normalizedTicker = ticker.trim().toUpperCase()
  const badges = useMemo(() => {
    const preference = preferences[normalizedTicker]
    return preference
      ? getTickerInfoBadges(preference, largestDisplayLotValues[normalizedTicker] ?? null, basePurchaseSize)
      : []
  }, [basePurchaseSize, largestDisplayLotValues, normalizedTicker, preferences])

  if (badges.length === 0) return null
  return <sup className="ticker-info-badges">{badges.map((badge) => (
    <span key={badge.symbol} className={`ticker-info-badge ticker-info-badge-${badge.tone}`}
      title={badge.message} aria-label={badge.message}>
      <span className={badge.symbol === '\u2013' ? 'ticker-info-badge-dash' : undefined}>{badge.symbol}</span>
    </span>
  ))}</sup>
}
