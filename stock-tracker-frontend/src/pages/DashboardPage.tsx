import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppAuth } from '../auth'
import {
  CashTransaction,
  CreateStockInput,
  HistoricalPrice,
  SaleAllocation,
  getCashTransactions,
  getSaleAllocationsByTransactionIds,
  getHistoricalPrices,
  PORTFOLIO_UPDATED_EVENT,
  PortfolioSummary,
  PurchaseLot,
  StockTransaction,
  createStockTransaction,
  emitPortfolioUpdated,
  getCurrentPrices,
  getDisplayLots,
  getPortfolioSummary,
  getStockTransactions,
  UserTargetSettings,
  getUserTargetSettings,
  getAllStockSplits,
  StockSplitEvent,
} from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'
import { calculatePortfolioSnapshot, createSplitMultiplierResolver } from '../portfolioSnapshot'

const DEFAULT_SALE_TARGET_PERCENT = 10
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25

export function getSplitAdjustedTargetBasePrice(
  transaction: StockTransaction | undefined,
  splitEvents: StockSplitEvent[],
  snapshotDate: string
): number | null {
  const originalPrice = Number(transaction?.price)
  const transactionDate = toDateOnly(String(transaction?.transactionDate || ''))
  const ticker = String(transaction?.ticker || '').toUpperCase()
  if (!Number.isFinite(originalPrice) || originalPrice <= 0 || !transactionDate || !ticker) {
    return null
  }

  const splitMultiplier = createSplitMultiplierResolver(splitEvents, snapshotDate)(ticker, transactionDate)
  const adjustedPrice = originalPrice / splitMultiplier
  return Number.isFinite(adjustedPrice) && adjustedPrice > 0 ? adjustedPrice : null
}

type AddStockFormState = {
  ticker: string
  shares: string
  price: string
  transactionDate: string
}

const EMPTY_ADD_STOCK_FORM: AddStockFormState = {
  ticker: '',
  shares: '',
  price: '',
  transactionDate: new Date().toISOString().slice(0, 10),
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function formatShares(value: number) {
  return Number(value.toFixed(6)).toString()
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return 'Never'
  }
  return value.toLocaleString()
}

function formatPercent2(value: number | null | undefined, fallback = '--') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return `${value.toFixed(2)}%`
}

type TargetDirection = 'buy' | 'sell' | null

function calculateTargetProximity(
  currentPrice: number | null | undefined,
  sellTarget: number | null | undefined,
  buyTarget: number | null | undefined
): { percent: number | null; direction: TargetDirection } {
  const current = Number(currentPrice)
  const sell = Number(sellTarget)
  const buy = Number(buyTarget)

  const sellRatio = Number.isFinite(current) && current > 0 && Number.isFinite(sell) && sell > 0
    ? (current / sell) * 100
    : null
  const buyRatio = Number.isFinite(current) && current > 0 && Number.isFinite(buy) && buy > 0
    ? (buy / current) * 100
    : null

  if (sellRatio == null && buyRatio == null) {
    return { percent: null, direction: null }
  }

  if (sellRatio == null) {
    return { percent: buyRatio, direction: 'buy' }
  }

  if (buyRatio == null) {
    return { percent: sellRatio, direction: 'sell' }
  }

  return sellRatio >= buyRatio
    ? { percent: sellRatio, direction: 'sell' }
    : { percent: buyRatio, direction: 'buy' }
}

function toDateOnly(value: string): string {
  if (typeof value !== 'string' || value.length < 10) {
    return ''
  }
  return value.slice(0, 10)
}

function subtractDaysFromDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function addDaysToDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Approximate regular-hours check (9:30am-4:00pm America/New_York, weekdays); does not account for market holidays.
function isUsMarketOpenNow(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date())

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const isWeekday = lookup.weekday !== 'Sat' && lookup.weekday !== 'Sun'
  const minutesSinceMidnight = Number(lookup.hour) * 60 + Number(lookup.minute)

  return isWeekday && minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60
}

function calculateStockCostBasisExcludingDividends(lots: PurchaseLot[]): number {
  return lots.reduce((sum, lot) => {
    if (lot.sourceType !== 'purchase') {
      return sum
    }

    const remaining = Number(lot.remainingQuantity)
    const unitCost = Number(lot.unitCost)
    if (!Number.isFinite(remaining) || !Number.isFinite(unitCost)) {
      return sum
    }

    return sum + (remaining * unitCost)
  }, 0)
}

function calculateStockCostBasisExcludingDividendsByTicker(lots: PurchaseLot[]): Record<string, number> {
  const byTicker: Record<string, number> = {}

  for (const lot of lots) {
    if (lot.sourceType !== 'purchase') {
      continue
    }

    const ticker = String(lot.ticker || '').toUpperCase()
    const remaining = Number(lot.remainingQuantity)
    const unitCost = Number(lot.unitCost)
    if (!ticker || !Number.isFinite(remaining) || !Number.isFinite(unitCost)) {
      continue
    }

    byTicker[ticker] = Number(byTicker[ticker] || 0) + (remaining * unitCost)
  }

  return byTicker
}

function getPerformanceClassName(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return ''
  }
  if (value > 0) {
    return 'value-positive'
  }
  if (value < 0) {
    return 'value-negative'
  }
  return ''
}

type HoldingsSortColumn = 'ticker' | 'marketValue' | 'targetProximityPercent' | 'lotCount'

export default function DashboardPage() {
  const auth = useAppAuth()
  const [data, setData] = useState<PortfolioSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addStockError, setAddStockError] = useState<string | null>(null)
  const [addStockSaving, setAddStockSaving] = useState(false)
  const [showAddStockModal, setShowAddStockModal] = useState(false)
  const [addStockForm, setAddStockForm] = useState<AddStockFormState>(EMPTY_ADD_STOCK_FORM)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [holdingsLoading, setHoldingsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [saleTargetsByTicker, setSaleTargetsByTicker] = useState<Record<string, number | null>>({})
  const [buyTargetsByTicker, setBuyTargetsByTicker] = useState<Record<string, number | null>>({})
  const [displayLotCountsByTicker, setDisplayLotCountsByTicker] = useState<Record<string, number>>({})
  const snapshotDate = new Date().toISOString().slice(0, 10)
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([])
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPrice[]>([])
  const [saleAllocationsBySaleId, setSaleAllocationsBySaleId] = useState<Record<string, SaleAllocation[]>>({})
  const [historicalLoadedEndDate, setHistoricalLoadedEndDate] = useState<string | null>(null)
  const [splitEvents, setSplitEvents] = useState<StockSplitEvent[]>([])
  const updateCurrentPricesRef = useRef<() => Promise<void>>(async () => {})
  const [updatingPrices, setUpdatingPrices] = useState(false)
  const [isLivePollingActive, setIsLivePollingActive] = useState(false)
  const [currentPricesByTicker, setCurrentPricesByTicker] = useState<Record<string, number>>({})
  const [changePercentByTicker, setChangePercentByTicker] = useState<Record<string, number | null>>({})
  const [holdingsSortColumn, setHoldingsSortColumn] = useState<HoldingsSortColumn>('targetProximityPercent')
  const [holdingsSortDirection, setHoldingsSortDirection] = useState<'asc' | 'desc'>('desc')

  function normalizePositivePercent(value: unknown, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  function normalizeSettings(settings: UserTargetSettings): UserTargetSettings {
    return {
      saleTargetPercent: normalizePositivePercent(settings.saleTargetPercent, DEFAULT_SALE_TARGET_PERCENT),
      buyTargetPercentUnder3DisplayLots: normalizePositivePercent(settings.buyTargetPercentUnder3DisplayLots, DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS),
      buyTargetPercentFor3DisplayLots: normalizePositivePercent(settings.buyTargetPercentFor3DisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS),
      buyTargetPercentFor4DisplayLots: normalizePositivePercent(settings.buyTargetPercentFor4DisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS),
      buyTargetPercentFor5DisplayLots: normalizePositivePercent(settings.buyTargetPercentFor5DisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS),
      buyTargetPercentFor6OrMoreDisplayLots: normalizePositivePercent(settings.buyTargetPercentFor6OrMoreDisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS),
    }
  }

  function buildLatestBuyOrSellByTicker(transactions: StockTransaction[]): Map<string, StockTransaction> {
    const latestByTicker = new Map<string, StockTransaction>()

    for (const tx of transactions) {
      const type = String(tx.type || '').toLowerCase()
      if (type !== 'buy' && type !== 'sell') {
        continue
      }

      const price = Number(tx.price)
      if (!Number.isFinite(price) || price <= 0) {
        continue
      }

      const ticker = String(tx.ticker || '').toUpperCase()
      if (!ticker) {
        continue
      }

      const existing = latestByTicker.get(ticker)
      if (!existing) {
        latestByTicker.set(ticker, tx)
        continue
      }

      const existingTs = new Date(existing.transactionDate).getTime()
      const currentTs = new Date(tx.transactionDate).getTime()
      if (currentTs > existingTs) {
        latestByTicker.set(ticker, tx)
      }
    }

    return latestByTicker
  }

  function getTickersFromTransactions(transactions: StockTransaction[]): string[] {
    return Array.from(new Set(
      transactions
        .map((tx) => String(tx.ticker || '').toUpperCase())
        .filter((ticker) => ticker.length > 0)
    ))
  }

  function getBuyTargetPercentForDisplayLotCount(settings: UserTargetSettings, displayLotCount: number): number {
    if (displayLotCount < 3) {
      return settings.buyTargetPercentUnder3DisplayLots
    }
    if (displayLotCount === 3) {
      return settings.buyTargetPercentFor3DisplayLots
    }
    if (displayLotCount === 4) {
      return settings.buyTargetPercentFor4DisplayLots
    }
    if (displayLotCount === 5) {
      return settings.buyTargetPercentFor5DisplayLots
    }
    return settings.buyTargetPercentFor6OrMoreDisplayLots
  }

  function calculateSaleTargetsByTicker(
    summary: PortfolioSummary,
    latestByTicker: Map<string, StockTransaction>,
    saleTargetPercent: number,
    splitEvents: StockSplitEvent[],
    snapshotDate: string
  ): Record<string, number | null> {
    const targets: Record<string, number | null> = {}
    const multiplier = 1 + saleTargetPercent / 100
    for (const stock of summary.stocks) {
      const ticker = String(stock.ticker || '').toUpperCase()
      const baseTx = latestByTicker.get(ticker)
      const basePrice = getSplitAdjustedTargetBasePrice(baseTx, splitEvents, snapshotDate)
      targets[ticker] = basePrice != null
        ? basePrice * multiplier
        : null
    }

    return targets
  }

  function calculateBuyTargetsByTicker(
    summary: PortfolioSummary,
    latestByTicker: Map<string, StockTransaction>,
    displayLotCountsByTicker: Record<string, number>,
    settings: UserTargetSettings,
    splitEvents: StockSplitEvent[],
    snapshotDate: string
  ): Record<string, number | null> {
    const targets: Record<string, number | null> = {}

    for (const stock of summary.stocks) {
      const ticker = String(stock.ticker || '').toUpperCase()
      const displayLotCount = Number(displayLotCountsByTicker[ticker] || 0)
      const buyTargetPercent = getBuyTargetPercentForDisplayLotCount(settings, displayLotCount)

      const baseTx = latestByTicker.get(ticker)
      const basePrice = getSplitAdjustedTargetBasePrice(baseTx, splitEvents, snapshotDate)
      if (basePrice == null) {
        targets[ticker] = null
        continue
      }

      targets[ticker] = basePrice * (1 - buyTargetPercent / 100)
    }

    return targets
  }

  const buyShares = Number(addStockForm.shares)
  const buyPrice = Number(addStockForm.price)
  const buyTotalCost = Number.isFinite(buyShares) && Number.isFinite(buyPrice)
    ? buyShares * buyPrice
    : NaN

  const snapshot = useMemo(() => {
    const LOT_TOLERANCE = 1e-6
    const coreSnapshot = calculatePortfolioSnapshot({
      stockTransactions,
      cashTransactions,
      historicalPrices,
      splitEvents,
      snapshotDate,
      currentPricesByTicker,
    })
    const getCumulativeSplitMultiplierForDate = createSplitMultiplierResolver(splitEvents, snapshotDate)

    type SnapshotPurchaseLot = {
      ticker: string
      purchaseDate: string
      unitCost: number
      remainingQuantity: number
    }

    const snapshotPurchaseLots: SnapshotPurchaseLot[] = stockTransactions
      .filter((tx) => {
        const txDate = toDateOnly(tx.transactionDate)
        return tx.type === 'buy' && !!txDate && txDate <= snapshotDate
      })
      .map((tx) => {
        const ticker = String(tx.ticker || '').toUpperCase()
        const purchaseDate = toDateOnly(tx.transactionDate)
        const quantity = Number(tx.quantity || 0)
        const unitCost = Number(tx.price || 0)
        const splitMultiplier = ticker && purchaseDate ? getCumulativeSplitMultiplierForDate(ticker, purchaseDate) : 1

        return {
          ticker,
          purchaseDate,
          unitCost: splitMultiplier > 0 ? (unitCost / splitMultiplier) : unitCost,
          remainingQuantity: quantity * splitMultiplier,
        }
      })
      .filter((lot) => lot.ticker && Number.isFinite(lot.unitCost) && Number.isFinite(lot.remainingQuantity) && lot.remainingQuantity > LOT_TOLERANCE)

    const sellTransactionsUpToSnapshot = stockTransactions
      .filter((tx) => {
        const txDate = toDateOnly(tx.transactionDate)
        return tx.type === 'sell' && !!txDate && txDate <= snapshotDate
      })
      .sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime())

    const realizedSalesProceedsByTicker: Record<string, number> = {}
    const realizedSalesCostBasisByTicker: Record<string, number> = {}

    for (const sellTx of sellTransactionsUpToSnapshot) {
      const sellTicker = String(sellTx.ticker || '').toUpperCase()
      const sellAmount = Number(sellTx.amount || 0)
      if (sellTicker && Number.isFinite(sellAmount)) {
        realizedSalesProceedsByTicker[sellTicker] = Number(realizedSalesProceedsByTicker[sellTicker] || 0) + sellAmount
      }

      const allocations = saleAllocationsBySaleId[sellTx.id] ?? []
      const purchaseAllocations = allocations
        .filter((allocation) => String(allocation.sourceType || '').toLowerCase() === 'purchase')

      for (const allocation of purchaseAllocations) {
        const allocationTicker = String(allocation.ticker || '').toUpperCase()
        const allocationDate = toDateOnly(allocation.purchaseDate)
        const rawAllocationUnitCost = Number(allocation.unitCost)
        const rawAllocationQuantity = Number(allocation.quantity || 0)
        const splitMultiplier = allocationTicker && allocationDate
          ? getCumulativeSplitMultiplierForDate(allocationTicker, allocationDate)
          : 1

        const allocationUnitCost = splitMultiplier > 0
          ? (rawAllocationUnitCost / splitMultiplier)
          : rawAllocationUnitCost
        let quantityToConsume = rawAllocationQuantity * splitMultiplier

        if (!allocationTicker || !allocationDate || !Number.isFinite(allocationUnitCost) || !Number.isFinite(quantityToConsume) || quantityToConsume <= LOT_TOLERANCE) {
          continue
        }

        realizedSalesCostBasisByTicker[allocationTicker] = Number(realizedSalesCostBasisByTicker[allocationTicker] || 0)
          + (allocationUnitCost * quantityToConsume)

        for (const lot of snapshotPurchaseLots) {
          if (quantityToConsume <= LOT_TOLERANCE) {
            break
          }

          if (lot.ticker !== allocationTicker) {
            continue
          }

          if (lot.purchaseDate !== allocationDate) {
            continue
          }

          if (Math.abs(lot.unitCost - allocationUnitCost) > LOT_TOLERANCE) {
            continue
          }

          if (lot.remainingQuantity <= LOT_TOLERANCE) {
            continue
          }

          const consumed = Math.min(lot.remainingQuantity, quantityToConsume)
          lot.remainingQuantity -= consumed
          quantityToConsume -= consumed
        }
      }
    }

    const snapshotCostBasisByTicker: Record<string, number> = {}
    const snapshotLotCountByTicker: Record<string, number> = {}
    for (const lot of snapshotPurchaseLots) {
      if (lot.remainingQuantity <= LOT_TOLERANCE) {
        continue
      }

      snapshotCostBasisByTicker[lot.ticker] = Number(snapshotCostBasisByTicker[lot.ticker] || 0) + (lot.remainingQuantity * lot.unitCost)
      snapshotLotCountByTicker[lot.ticker] = Number(snapshotLotCountByTicker[lot.ticker] || 0) + 1
    }

    const realizedSalesPerformanceByTicker: Record<string, number> = {}
    for (const ticker of new Set([
      ...Object.keys(realizedSalesProceedsByTicker),
      ...Object.keys(realizedSalesCostBasisByTicker),
    ])) {
      realizedSalesPerformanceByTicker[ticker] = Number(realizedSalesProceedsByTicker[ticker] || 0)
        - Number(realizedSalesCostBasisByTicker[ticker] || 0)
    }

    const stockCostBasisExcludingDividends = Object.values(snapshotCostBasisByTicker).reduce((sum, value) => sum + Number(value || 0), 0)

    const performance = coreSnapshot.portfolioValue == null ? null : coreSnapshot.portfolioValue - coreSnapshot.cashBasis

    return {
      holdings: coreSnapshot.holdings,
      availableCash: coreSnapshot.availableCash,
      cashBasis: coreSnapshot.cashBasis,
      adjustments: coreSnapshot.adjustments,
      holdingsMarketValue: coreSnapshot.holdingsMarketValue,
      portfolioValue: coreSnapshot.portfolioValue,
      performance,
      stockCount: coreSnapshot.stockCount,
      stockCostBasisExcludingDividends,
      stockCostBasisExcludingDividendsByTicker: snapshotCostBasisByTicker,
      realizedSalesPerformanceByTicker,
      lotCountByTicker: snapshotLotCountByTicker,
    }
  }, [stockTransactions, cashTransactions, historicalPrices, currentPricesByTicker, saleAllocationsBySaleId, snapshotDate, splitEvents])

  const hasInsufficientCashForBuy = Boolean(
    data && Number.isFinite(buyTotalCost) && buyTotalCost > Number(data.availableCash)
  )

  const summaryHoldings = useMemo(() => {
    return (data?.stocks ?? [])
      .map((stock) => ({
        ticker: String(stock.ticker || '').toUpperCase(),
        totalShares: Number(stock.totalShares || 0),
        costBasis: Number(stock.costBasis || 0),
        lotCount: Number(stock.lotCount || 0),
      }))
      .filter((row) => row.ticker && Number.isFinite(row.totalShares) && row.totalShares > 1e-6)
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [data])

  const holdingsRows = useMemo(() => {
    const snapshotByTicker = new Map(
      snapshot.holdings.map((row) => [row.ticker, row] as const)
    )

    return summaryHoldings.map((row) => {
      const hydrated = snapshotByTicker.get(row.ticker)
      const hasSnapshotCostBasis = Object.prototype.hasOwnProperty.call(
        snapshot.stockCostBasisExcludingDividendsByTicker,
        row.ticker
      )

      const costBasis = hasSnapshotCostBasis
        ? Number(snapshot.stockCostBasisExcludingDividendsByTicker[row.ticker] ?? 0)
        : row.costBasis
      const performance = hydrated?.marketValue == null
        ? null
        : Number(hydrated.marketValue) - costBasis
      const gainLoss = performance == null
        ? null
        : performance + Number(snapshot.realizedSalesPerformanceByTicker[row.ticker] ?? 0)

      const targetProximity = calculateTargetProximity(
        hydrated?.latestPrice ?? null,
        saleTargetsByTicker[row.ticker] ?? null,
        buyTargetsByTicker[row.ticker] ?? null
      )

      return {
        ticker: row.ticker,
        totalShares: hydrated?.totalShares ?? row.totalShares,
        latestPrice: hydrated?.latestPrice ?? null,
        marketValue: hydrated?.marketValue ?? null,
        costBasis,
        gainLoss,
        targetProximityPercent: targetProximity.percent,
        targetDirection: targetProximity.direction,
        lotCount: Number(displayLotCountsByTicker[row.ticker] ?? snapshot.lotCountByTicker[row.ticker] ?? row.lotCount),
      }
    })
  }, [summaryHoldings, snapshot.holdings, snapshot.stockCostBasisExcludingDividendsByTicker, snapshot.realizedSalesPerformanceByTicker, snapshot.lotCountByTicker, displayLotCountsByTicker, saleTargetsByTicker, buyTargetsByTicker])

  const displayedHoldingsMarketValue = useMemo(() => {
    if (holdingsRows.some((row) => row.marketValue == null || !Number.isFinite(row.marketValue))) {
      return null
    }

    return holdingsRows.reduce((total, row) => total + Number(row.marketValue), 0)
  }, [holdingsRows])

  const displayedPortfolioValue = displayedHoldingsMarketValue == null
    ? null
    : snapshot.availableCash + displayedHoldingsMarketValue

  const previousDayPortfolioValue = useMemo(() => {
    const previousDaySnapshot = calculatePortfolioSnapshot({
      stockTransactions,
      cashTransactions,
      historicalPrices,
      splitEvents,
      snapshotDate: subtractDaysFromDateOnly(snapshotDate, 1),
    })

    return previousDaySnapshot.portfolioValue
  }, [stockTransactions, cashTransactions, historicalPrices, splitEvents, snapshotDate])

  const portfolioValueChangeSinceYesterday = displayedPortfolioValue == null || previousDayPortfolioValue == null
    ? null
    : displayedPortfolioValue - previousDayPortfolioValue

  const sortedHoldingsRows = useMemo(() => {
    const directionMultiplier = holdingsSortDirection === 'asc' ? 1 : -1

    return [...holdingsRows].sort((a, b) => {
      if (holdingsSortColumn === 'ticker') {
        return a.ticker.localeCompare(b.ticker) * directionMultiplier
      }

      const aValue = a[holdingsSortColumn]
      const bValue = b[holdingsSortColumn]
      const aIsNil = aValue == null || !Number.isFinite(aValue)
      const bIsNil = bValue == null || !Number.isFinite(bValue)

      if (aIsNil && bIsNil) {
        return 0
      }
      if (aIsNil) {
        return 1
      }
      if (bIsNil) {
        return -1
      }

      return (Number(aValue) - Number(bValue)) * directionMultiplier
    })
  }, [holdingsRows, holdingsSortColumn, holdingsSortDirection])

  function handleHoldingsSort(column: HoldingsSortColumn) {
    if (column === holdingsSortColumn) {
      setHoldingsSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setHoldingsSortColumn(column)
    setHoldingsSortDirection('asc')
  }

  function getHoldingsSortIndicator(column: HoldingsSortColumn) {
    if (column !== holdingsSortColumn) {
      return ''
    }
    return holdingsSortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  const performanceClassName =
    snapshot.performance == null || !Number.isFinite(snapshot.performance)
      ? 'value'
      : snapshot.performance > 0
        ? 'value value-positive'
        : snapshot.performance < 0
          ? 'value value-negative'
          : 'value'

  async function loadSummary(backgroundRefresh = false) {
    if (backgroundRefresh) {
      setRefreshing(true)
    } else {
      setSummaryLoading(true)
    }
    setHoldingsLoading(true)
    setError(null)

    try {
      const summary = await getPortfolioSummary()
      setData(summary)

      const today = new Date().toISOString().slice(0, 10)
      const historicalEndDate = snapshotDate < today ? snapshotDate : today
      const [transactionsResult, cashTransactionsResult, settingsResult, displayLotsResult, splitEventsResult] = await Promise.all([
        getStockTransactions(),
        getCashTransactions(),
        getUserTargetSettings(),
        getDisplayLots(),
        getAllStockSplits(),
      ])
      const tickers = getTickersFromTransactions(transactionsResult)

      const earliestTransactionDate = transactionsResult.reduce((earliest, tx) => {
        const txDate = toDateOnly(tx.transactionDate)
        if (!txDate) {
          return earliest
        }
        if (!earliest || txDate < earliest) {
          return txDate
        }
        return earliest
      }, '')

      // Include a short pre-transaction buffer so weekend/holiday snapshots can
      // still resolve to the nearest prior market close.
      const historicalStartDate = earliestTransactionDate
        ? subtractDaysFromDateOnly(earliestTransactionDate, 14)
        : historicalEndDate

      const historicalPricesResult = tickers.length > 0
        ? await getHistoricalPrices(historicalStartDate, historicalEndDate, tickers)
        : []

      const sellTransactions = transactionsResult.filter((tx) => tx.type === 'sell')
      setSaleAllocationsBySaleId(await getSaleAllocationsByTransactionIds(sellTransactions.map((tx) => tx.id)))

      const normalizedSettings = normalizeSettings(settingsResult)
      const latestByTicker = buildLatestBuyOrSellByTicker(transactionsResult)
      const displayLotCountsByTicker: Record<string, number> = {}
      for (const lot of displayLotsResult) {
        const ticker = String(lot.ticker || '').toUpperCase()
        if (!ticker) {
          continue
        }
        const countFromRow = Number(
          lot.lotCount ?? (Array.isArray((lot as any).lots) ? (lot as any).lots.length : 0)
        )
        displayLotCountsByTicker[ticker] = Number(displayLotCountsByTicker[ticker] || 0) + countFromRow
      }

      setData(summary)
      setStockTransactions(transactionsResult)
      setCashTransactions(cashTransactionsResult)
      setHistoricalPrices(historicalPricesResult)
      setSplitEvents(splitEventsResult)
      setHistoricalLoadedEndDate(historicalEndDate)
      setDisplayLotCountsByTicker(displayLotCountsByTicker)
      setSaleTargetsByTicker(calculateSaleTargetsByTicker(
        summary,
        latestByTicker,
        normalizedSettings.saleTargetPercent,
        splitEventsResult,
        snapshotDate
      ))
      setBuyTargetsByTicker(calculateBuyTargetsByTicker(
        summary,
        latestByTicker,
        displayLotCountsByTicker,
        normalizedSettings,
        splitEventsResult,
        snapshotDate
      ))

      setLastUpdatedAt(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load summary')
    } finally {
      setSummaryLoading(false)
      setHoldingsLoading(false)
      setRefreshing(false)
    }
  }

  async function updateCurrentPrices() {
    const tickers = summaryHoldings.map((row) => row.ticker)
    if (tickers.length === 0) {
      return
    }

    setUpdatingPrices(true)
    setError(null)

    try {
      const result = await getCurrentPrices(tickers)
      const nextPrices: Record<string, number> = {}
      const nextChangePercents: Record<string, number | null> = {}
      for (const row of result.prices) {
        const ticker = String(row.ticker || '').toUpperCase()
        const price = Number(row.price)
        if (ticker && Number.isFinite(price) && price > 0) {
          nextPrices[ticker] = price
          const changePercent = Number(row.changePercent)
          nextChangePercents[ticker] = Number.isFinite(changePercent) ? changePercent : null
        }
      }

      setCurrentPricesByTicker((previous) => ({
        ...previous,
        ...nextPrices,
      }))
      setChangePercentByTicker((previous) => ({
        ...previous,
        ...nextChangePercents,
      }))
      setLastUpdatedAt(new Date())

      if (Object.keys(nextPrices).length === 0) {
        setError('Unable to load current prices for the dashboard tickers.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update current prices')
    } finally {
      setUpdatingPrices(false)
    }
  }

  updateCurrentPricesRef.current = updateCurrentPrices

  useEffect(() => {
    if (auth.isConfigured && !auth.isAuthenticated) {
      return
    }

    let cancelled = false

    async function loadWithAuthRetry() {
      try {
        await loadSummary()
      } catch (err: unknown) {
        if (cancelled) {
          return
        }
        const message = err instanceof Error ? err.message : ''
        if (message.includes('401')) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
          if (!cancelled) {
            await loadSummary()
          }
        }
      }
    }

    void loadWithAuthRetry()

    const handlePortfolioUpdated = () => {
      loadSummary(true)
    }

    window.addEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)

    return () => {
      cancelled = true
      window.removeEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
    }
  }, [auth.isConfigured, auth.isAuthenticated])

  // Live-price polling: only while this tab is visible and the US market is open.
  useEffect(() => {
    const POLL_INTERVAL_MS = 5 * 60 * 1000
    const POLLING_STATUS_CHECK_MS = 30 * 1000
    const wasMarketOpenRef = { current: isUsMarketOpenNow() }

    function refreshPollingActiveStatus() {
      setIsLivePollingActive(document.visibilityState === 'visible' && isUsMarketOpenNow())
    }

    function maybeRefreshCurrentPrices() {
      refreshPollingActiveStatus()
      const marketOpenNow = isUsMarketOpenNow()

      if (document.visibilityState === 'visible' && marketOpenNow) {
        void updateCurrentPricesRef.current()
      } else if (wasMarketOpenRef.current && !marketOpenNow) {
        // Market just closed: drop live overrides so the snapshot falls back to the latest stored close.
        setCurrentPricesByTicker({})
        setChangePercentByTicker({})
      }

      wasMarketOpenRef.current = marketOpenNow
    }

    refreshPollingActiveStatus()
    const priceIntervalId = window.setInterval(maybeRefreshCurrentPrices, POLL_INTERVAL_MS)
    const statusIntervalId = window.setInterval(refreshPollingActiveStatus, POLLING_STATUS_CHECK_MS)
    document.addEventListener('visibilitychange', maybeRefreshCurrentPrices)

    return () => {
      window.clearInterval(priceIntervalId)
      window.clearInterval(statusIntervalId)
      document.removeEventListener('visibilitychange', maybeRefreshCurrentPrices)
    }
  }, [])

  useEffect(() => {
    if (stockTransactions.length === 0 || !historicalLoadedEndDate) {
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    const targetEndDate = snapshotDate < today ? snapshotDate : today
    if (targetEndDate <= historicalLoadedEndDate) {
      return
    }

    const incrementalStartDate = addDaysToDateOnly(historicalLoadedEndDate, 1)
    if (incrementalStartDate > targetEndDate) {
      return
    }

    let cancelled = false

    async function loadForwardHistoricalRange() {
      setHoldingsLoading(true)
      try {
        const tickers = getTickersFromTransactions(stockTransactions)
        const nextRows = await getHistoricalPrices(incrementalStartDate, targetEndDate, tickers)
        if (cancelled) {
          return
        }

        if (nextRows.length > 0) {
          setHistoricalPrices((previous) => {
            const merged = [...previous, ...nextRows]
            const deduped = new Map<string, HistoricalPrice>()
            for (const row of merged) {
              const key = `${String(row.ticker || '').toUpperCase()}|${String(row.priceDate || '')}|${String(row.source || '')}`
              deduped.set(key, row)
            }
            return Array.from(deduped.values())
          })
        }

        setHistoricalLoadedEndDate(targetEndDate)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load historical prices for selected snapshot date')
        }
      } finally {
        if (!cancelled) {
          setHoldingsLoading(false)
        }
      }
    }

    void loadForwardHistoricalRange()

    return () => {
      cancelled = true
    }
  }, [snapshotDate, stockTransactions.length, historicalLoadedEndDate])

  function openAddStockModal() {
    setAddStockError(null)
    setAddStockForm(EMPTY_ADD_STOCK_FORM)
    setShowAddStockModal(true)
  }

  function closeAddStockModal() {
    setShowAddStockModal(false)
    setAddStockSaving(false)
    setAddStockError(null)
    setAddStockForm(EMPTY_ADD_STOCK_FORM)
  }

  function validateAddStockForm(form: AddStockFormState): string | null {
    const ticker = normalizeTicker(form.ticker)
    if (!ticker) {
      return 'Ticker is required.'
    }

    const shares = Number(form.shares)
    if (!Number.isFinite(shares) || shares <= 0) {
      return 'Shares must be greater than 0.'
    }

    const price = Number(form.price)
    if (!Number.isFinite(price) || price <= 0) {
      return 'Price must be greater than 0.'
    }

    if (!form.transactionDate) {
      return 'Date is required.'
    }

    const selectedDate = new Date(form.transactionDate)
    if (Number.isNaN(selectedDate.getTime())) {
      return 'Date is invalid.'
    }

    const now = new Date()
    const selectedUtc = Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate())
    const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    if (selectedUtc > nowUtc) {
      return 'Date cannot be in the future.'
    }

    return null
  }

  async function onAddStockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAddStockError(null)

    const validationError = validateAddStockForm(addStockForm)
    if (validationError) {
      setAddStockError(validationError)
      return
    }

    const payload: CreateStockInput = {
      ticker: normalizeTicker(addStockForm.ticker),
      type: 'buy',
      quantity: Number(addStockForm.shares),
      price: Number(addStockForm.price),
      transactionDate: new Date(addStockForm.transactionDate).toISOString(),
    }

    const availableCash = Number(data?.availableCash)
    const buyCost = Number(payload.quantity || 0) * Number(payload.price || 0)
    if (Number.isFinite(availableCash) && Number.isFinite(buyCost) && buyCost > availableCash) {
      setAddStockError(
        `Insufficient available cash. Buy requires ${formatCurrency2(buyCost)} but only ${formatCurrency2(availableCash)} is available.`
      )
      return
    }

    setAddStockSaving(true)
    try {
      await createStockTransaction(payload)
      emitPortfolioUpdated()
      closeAddStockModal()
    } catch (err: unknown) {
      setAddStockError(err instanceof Error ? err.message : 'Unable to add stock.')
      setAddStockSaving(false)
    }
  }

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>Dashboard (MVP)</h2>
          <p>Portfolio snapshot by date using transaction history and stored historical prices.</p>
        </div>
        <div className="stack-right">
          <div className="inline-actions">
            <button className="button button-primary" type="button" onClick={openAddStockModal}>
              Add Stock
            </button>
            <button className="button" type="button" onClick={() => loadSummary(true)} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className="button" type="button" onClick={updateCurrentPrices} disabled={updatingPrices || summaryHoldings.length === 0}>
              {updatingPrices ? 'Updating...' : 'Update'}
            </button>
          </div>
          <small>Last updated: {formatDateTime(lastUpdatedAt)}</small>
          <small className={isLivePollingActive ? 'live-polling-badge live-polling-badge-active' : 'live-polling-badge'}>
            <span className={isLivePollingActive ? 'live-polling-dot live-polling-dot-active' : 'live-polling-dot'} />
            {isLivePollingActive ? 'Live price polling active' : 'Live price polling paused (market closed or tab hidden)'}
          </small>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}

      {summaryLoading && !data ? (
        <>
          <div className="panel skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="panel">Loading summary...</div>
        </>
      ) : null}

      {data ? (
        <>
          <div className="panel stat-grid">
            <div className="stat"><div className="label">Portfolio Value</div><div className="value">{holdingsLoading ? 'Loading...' : formatCurrency2(displayedPortfolioValue)}</div></div>
            <div className="stat">
              <div className="label">Change vs Prev. Day</div>
              <div className={`value ${getPerformanceClassName(portfolioValueChangeSinceYesterday)}`}>
                {holdingsLoading
                  ? 'Loading...'
                  : portfolioValueChangeSinceYesterday == null
                    ? '--'
                    : `${portfolioValueChangeSinceYesterday >= 0 ? '+' : ''}${formatCurrency2(portfolioValueChangeSinceYesterday)}`}
              </div>
            </div>
            <div className="stat"><div className="label">Holdings Market Value</div><div className="value">{holdingsLoading ? 'Loading...' : formatCurrency2(displayedHoldingsMarketValue)}</div></div>
            <div className="stat"><div className="label">Available Cash</div><div className="value">{formatCurrency2(snapshot.availableCash)}</div></div>
          </div>

          <div className="panel">
            <h3>Holdings</h3>
            {holdingsLoading ? <p>Loading prices and market values...</p> : null}
            <table className="table">
              <thead>
                <tr>
                  <th className="sortable-header" onClick={() => handleHoldingsSort('ticker')}>Ticker{getHoldingsSortIndicator('ticker')}</th>
                  <th>Price</th>
                  <th>Change %</th>
                  <th>Total Shares</th>
                  <th className="sortable-header" onClick={() => handleHoldingsSort('marketValue')}>Market Value{getHoldingsSortIndicator('marketValue')}</th>
                  <th>Gain/Loss</th>
                  <th>Buy Target</th>
                  <th className="sortable-header" onClick={() => handleHoldingsSort('targetProximityPercent')}>Target %{getHoldingsSortIndicator('targetProximityPercent')}</th>
                  <th>Sale Target</th>
                  <th className="sortable-header" onClick={() => handleHoldingsSort('lotCount')}>Lots{getHoldingsSortIndicator('lotCount')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedHoldingsRows.map((row) => (
                  <tr key={row.ticker}>
                    <td>
                      <Link className="link-button" to={`/stocks/${encodeURIComponent(row.ticker)}`}>
                        {row.ticker}
                      </Link>
                    </td>
                    <td>
                      {holdingsLoading && row.latestPrice == null ? (
                        <span className="table-skeleton table-skeleton-sm" aria-label="Loading price" />
                      ) : (
                        formatStockPrice4(row.latestPrice)
                      )}
                    </td>
                    <td>
                      {changePercentByTicker[row.ticker] == null ? (
                        '--'
                      ) : (
                        <span className={`change-percent change-percent-${changePercentByTicker[row.ticker]! > 0 ? 'up' : changePercentByTicker[row.ticker]! < 0 ? 'down' : 'flat'}`}>
                          <span className="change-percent-arrow" aria-hidden="true">
                            {changePercentByTicker[row.ticker]! > 0 ? '\u25B2' : changePercentByTicker[row.ticker]! < 0 ? '\u25BC' : ''}
                          </span>
                          {formatPercent2(changePercentByTicker[row.ticker])}
                        </span>
                      )}
                    </td>
                    <td>{formatShares(row.totalShares)}</td>
                    <td>
                      {holdingsLoading && row.marketValue == null ? (
                        <span className="table-skeleton table-skeleton-md" aria-label="Loading market value" />
                      ) : (
                        formatCurrency2(row.marketValue)
                      )}
                    </td>
                    <td className={getPerformanceClassName(row.gainLoss)}>{formatCurrency2(row.gainLoss)}</td>
                    <td>
                      {holdingsLoading && buyTargetsByTicker[row.ticker] == null ? (
                        <span className="table-skeleton table-skeleton-sm" aria-label="Loading buy target" />
                      ) : (
                        formatStockPrice4(buyTargetsByTicker[row.ticker] ?? null)
                      )}
                    </td>
                    <td>
                      {holdingsLoading && row.targetProximityPercent == null ? (
                        <span className="table-skeleton table-skeleton-sm" aria-label="Loading target percent" />
                      ) : row.targetProximityPercent == null ? (
                        formatPercent2(null)
                      ) : (
                        <div
                          className={`target-proximity target-proximity-${row.targetDirection ?? 'neutral'}${row.targetProximityPercent >= 100 ? ' target-proximity-hit' : ''}`}
                          title={row.targetDirection === 'sell' ? 'Approaching sale target' : row.targetDirection === 'buy' ? 'Approaching buy target' : undefined}
                        >
                          <span className="target-proximity-track">
                            <span
                              className="target-proximity-fill"
                              style={{
                                width: `${
                                  row.targetDirection === 'buy'
                                    ? Math.min(100, Math.max(0, 100 - row.targetProximityPercent))
                                    : Math.min(100, Math.max(0, row.targetProximityPercent))
                                }%`,
                              }}
                            />
                          </span>
                          <span className="target-proximity-value">{formatPercent2(row.targetProximityPercent)}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      {holdingsLoading && saleTargetsByTicker[row.ticker] == null ? (
                        <span className="table-skeleton table-skeleton-sm" aria-label="Loading sale target" />
                      ) : (
                        formatStockPrice4(saleTargetsByTicker[row.ticker] ?? null)
                      )}
                    </td>
                    <td>{row.lotCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {showAddStockModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-stock-title">
          <div className="modal-card">
            <h3 id="add-stock-title">Add Stock</h3>
            <p>Create a buy transaction with ticker, shares, and price.</p>

            <form className="form-grid" onSubmit={onAddStockSubmit}>
              <label>
                Date
                <input
                  type="date"
                  min="1980-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={addStockForm.transactionDate}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, transactionDate: event.target.value }))}
                  disabled={addStockSaving}
                />
              </label>

              <label>
                Stock Ticker
                <input
                  type="text"
                  placeholder="AAPL"
                  value={addStockForm.ticker}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, ticker: event.target.value.toUpperCase() }))}
                  disabled={addStockSaving}
                />
              </label>

              <label>
                Shares
                <input
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={addStockForm.shares}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, shares: event.target.value }))}
                  disabled={addStockSaving}
                />
              </label>

              <label>
                Price
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={addStockForm.price}
                  onChange={(event) => setAddStockForm((prev) => ({ ...prev, price: event.target.value }))}
                  disabled={addStockSaving}
                />
              </label>

              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={addStockSaving || hasInsufficientCashForBuy}>
                  {addStockSaving ? 'Saving...' : 'Add Stock'}
                </button>
                <button className="button" type="button" onClick={closeAddStockModal} disabled={addStockSaving}>
                  Cancel
                </button>
              </div>
            </form>

            {hasInsufficientCashForBuy ? (
              <div className="status status-error">
                Insufficient available cash. Buy requires {formatCurrency2(buyTotalCost)} and available cash is {formatCurrency2(Number(data?.availableCash || 0))}.
              </div>
            ) : null}
            {addStockError ? <div className="status status-error">{addStockError}</div> : null}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Dashboard Page</div>
    </section>
  )
}
