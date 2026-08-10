import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CashTransaction,
  CreateStockInput,
  HistoricalPrice,
  SaleAllocation,
  getCashTransactions,
  getSaleAllocations,
  getHistoricalPrices,
  PORTFOLIO_UPDATED_EVENT,
  PortfolioSummary,
  PurchaseLot,
  StockTransaction,
  createStockTransaction,
  emitPortfolioUpdated,
  getDisplayLots,
  getPortfolioSummary,
  getPurchaseLots,
  getStockTransactions,
  UserTargetSettings,
  getUserTargetSettings,
  getAllStockSplits,
  StockSplitEvent,
} from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'

const DEFAULT_SALE_TARGET_PERCENT = 10
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25

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
  return value.toFixed(6)
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return 'Never'
  }
  return value.toLocaleString()
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

function calculateHoldingsMarketValue(
  summary: PortfolioSummary,
  latestPriceByTicker: Record<string, number>
): number | null {
  let total = 0

  for (const stock of summary.stocks) {
    const ticker = String(stock.ticker || '').toUpperCase()
    const shares = Number(stock.totalShares)
    const latestPrice = Number(latestPriceByTicker[ticker])

    if (!ticker || !Number.isFinite(shares) || !Number.isFinite(latestPrice)) {
      return null
    }

    total += shares * latestPrice
  }

  return total
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

export default function DashboardPage() {
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
  const [snapshotDate, setSnapshotDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([])
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPrice[]>([])
  const [saleAllocationsBySaleId, setSaleAllocationsBySaleId] = useState<Record<string, SaleAllocation[]>>({})
  const [historicalLoadedEndDate, setHistoricalLoadedEndDate] = useState<string | null>(null)
  const [splitEvents, setSplitEvents] = useState<StockSplitEvent[]>([])

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
    saleTargetPercent: number
  ): Record<string, number | null> {
    const targets: Record<string, number | null> = {}
    const multiplier = 1 + saleTargetPercent / 100
    for (const stock of summary.stocks) {
      const ticker = String(stock.ticker || '').toUpperCase()
      const baseTx = latestByTicker.get(ticker)
      const basePrice = Number(baseTx?.price)
      targets[ticker] = Number.isFinite(basePrice) && basePrice > 0
        ? basePrice * multiplier
        : null
    }

    return targets
  }

  function calculateBuyTargetsByTicker(
    summary: PortfolioSummary,
    latestByTicker: Map<string, StockTransaction>,
    displayLotCountsByTicker: Record<string, number>,
    settings: UserTargetSettings
  ): Record<string, number | null> {
    const targets: Record<string, number | null> = {}

    for (const stock of summary.stocks) {
      const ticker = String(stock.ticker || '').toUpperCase()
      const displayLotCount = Number(displayLotCountsByTicker[ticker] || 0)
      const buyTargetPercent = getBuyTargetPercentForDisplayLotCount(settings, displayLotCount)

      const baseTx = latestByTicker.get(ticker)
      const basePrice = Number(baseTx?.price)
      if (!Number.isFinite(basePrice) || basePrice <= 0) {
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
    const holdingsByTicker = new Map<string, number>()

    const activeSplits = splitEvents
      .filter((split) => split.isActive !== false)
      .map((split) => ({
        ticker: String(split.ticker || '').toUpperCase(),
        splitDate: toDateOnly(split.splitDate),
        multiplier: Number(split.multiplier),
      }))
      .filter((split) => split.ticker && split.splitDate && Number.isFinite(split.multiplier) && split.multiplier > 0 && split.splitDate <= snapshotDate)

    function getCumulativeSplitMultiplierForDate(ticker: string, transactionDate: string): number {
      let cumulativeMultiplier = 1

      for (const split of activeSplits) {
        if (split.ticker !== ticker) {
          continue
        }

        if (transactionDate <= split.splitDate) {
          cumulativeMultiplier *= split.multiplier
        }
      }

      return cumulativeMultiplier
    }

    for (const tx of stockTransactions) {
      const txDate = toDateOnly(tx.transactionDate)
      if (!txDate || txDate > snapshotDate) {
        continue
      }

      const ticker = String(tx.ticker || '').toUpperCase()
      if (!ticker) {
        continue
      }

      const quantity = Number(tx.quantity || 0)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        continue
      }

      const splitMultiplier = getCumulativeSplitMultiplierForDate(ticker, txDate)
      const adjustedQuantity = quantity * splitMultiplier
      if (!Number.isFinite(adjustedQuantity) || adjustedQuantity <= 0) {
        continue
      }

      const previous = Number(holdingsByTicker.get(ticker) ?? 0)
      if (tx.type === 'buy' || tx.type === 'div') {
        holdingsByTicker.set(ticker, previous + adjustedQuantity)
      } else if (tx.type === 'sell') {
        holdingsByTicker.set(ticker, previous - adjustedQuantity)
      }
    }

    const priceByTicker: Record<string, { date: string; price: number }> = {}
    for (const row of historicalPrices) {
      const ticker = String(row.ticker || '').toUpperCase()
      const priceDate = String(row.priceDate || '')
      const closePrice = Number(row.closePrice)
      if (!ticker || !priceDate || priceDate > snapshotDate || !Number.isFinite(closePrice)) {
        continue
      }

      const existing = priceByTicker[ticker]
      if (!existing || priceDate > existing.date) {
        priceByTicker[ticker] = { date: priceDate, price: closePrice }
      }
    }

    const holdings = Array.from(holdingsByTicker.entries())
      .map(([ticker, shares]) => ({
        ticker,
        totalShares: Number(shares),
      }))
      .filter((row) => Number.isFinite(row.totalShares) && row.totalShares > 1e-6)
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .map((row) => {
        const latestPrice = Number(priceByTicker[row.ticker]?.price)
        const hasPrice = Number.isFinite(latestPrice)
        return {
          ...row,
          latestPrice: hasPrice ? latestPrice : null,
          marketValue: hasPrice ? row.totalShares * latestPrice : null,
        }
      })

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

    const deposits = cashTransactions
      .filter((tx) => tx.type === 'deposit' && toDateOnly(tx.transactionDate) <= snapshotDate)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const withdrawals = cashTransactions
      .filter((tx) => tx.type === 'withdrawal' && toDateOnly(tx.transactionDate) <= snapshotDate)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const interest = cashTransactions
      .filter((tx) => tx.type === 'interest' && toDateOnly(tx.transactionDate) <= snapshotDate)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const fees = cashTransactions
      .filter((tx) => tx.type === 'fee' && toDateOnly(tx.transactionDate) <= snapshotDate)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)

    const buys = stockTransactions
      .filter((tx) => tx.type === 'buy' && toDateOnly(tx.transactionDate) <= snapshotDate)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const sells = stockTransactions
      .filter((tx) => tx.type === 'sell' && toDateOnly(tx.transactionDate) <= snapshotDate)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)

    const availableCash = deposits - withdrawals + interest - fees - buys + sells
    const cashBasis = deposits - withdrawals
    const adjustments = interest - fees

    const missingPrices = holdings.some((row) => row.latestPrice == null)
    const holdingsMarketValue = missingPrices
      ? null
      : holdings.reduce((sum, row) => sum + Number(row.marketValue || 0), 0)

    const portfolioValue = holdingsMarketValue == null ? null : availableCash + holdingsMarketValue
    const performance = portfolioValue == null ? null : portfolioValue - cashBasis

    return {
      holdings,
      availableCash,
      cashBasis,
      adjustments,
      holdingsMarketValue,
      portfolioValue,
      performance,
      stockCount: holdings.length,
      stockCostBasisExcludingDividends,
      stockCostBasisExcludingDividendsByTicker: snapshotCostBasisByTicker,
      realizedSalesPerformanceByTicker,
      lotCountByTicker: snapshotLotCountByTicker,
    }
  }, [stockTransactions, cashTransactions, historicalPrices, saleAllocationsBySaleId, snapshotDate, splitEvents])

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

      return {
        ticker: row.ticker,
        totalShares: hydrated?.totalShares ?? row.totalShares,
        latestPrice: hydrated?.latestPrice ?? null,
        marketValue: hydrated?.marketValue ?? null,
        costBasis,
        gainLoss,
        lotCount: Number(snapshot.lotCountByTicker[row.ticker] ?? row.lotCount),
      }
    })
  }, [summaryHoldings, snapshot.holdings, snapshot.stockCostBasisExcludingDividendsByTicker, snapshot.realizedSalesPerformanceByTicker, snapshot.lotCountByTicker])

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
      const [transactionsResult, cashTransactionsResult, settingsResult, displayLotsResult, purchaseLotsResult, splitEventsResult] = await Promise.all([
        getStockTransactions(),
        getCashTransactions(),
        getUserTargetSettings(),
        getDisplayLots(),
        getPurchaseLots(),
        getAllStockSplits(),
      ])

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

      const historicalPricesResult = transactionsResult.length > 0
        ? await getHistoricalPrices(historicalStartDate, historicalEndDate)
        : []

      const sellTransactions = transactionsResult.filter((tx) => tx.type === 'sell')
      const allocationEntries = await Promise.all(
        sellTransactions.map(async (tx) => {
          const rows = await getSaleAllocations(tx.id)
          return [tx.id, rows] as const
        })
      )
      setSaleAllocationsBySaleId(Object.fromEntries(allocationEntries))

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
      setSaleTargetsByTicker(calculateSaleTargetsByTicker(summary, latestByTicker, normalizedSettings.saleTargetPercent))
      setBuyTargetsByTicker(calculateBuyTargetsByTicker(summary, latestByTicker, displayLotCountsByTicker, normalizedSettings))

      setLastUpdatedAt(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load summary')
    } finally {
      setSummaryLoading(false)
      setHoldingsLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadSummary()

    const handlePortfolioUpdated = () => {
      loadSummary(true)
    }

    window.addEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)

    return () => {
      window.removeEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated)
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
        const nextRows = await getHistoricalPrices(incrementalStartDate, targetEndDate)
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
      await loadSummary(true)
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
            <label>
              Snapshot Date
              <input
                type="date"
                min="1980-01-01"
                max={new Date().toISOString().slice(0, 10)}
                value={snapshotDate}
                onChange={(event) => setSnapshotDate(event.target.value)}
                style={{ marginLeft: '0.5rem', marginRight: '0.5rem' }}
              />
            </label>
            <button className="button button-primary" type="button" onClick={openAddStockModal}>
              Add Stock
            </button>
            <button className="button" type="button" onClick={() => loadSummary(true)} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <small>Last updated: {formatDateTime(lastUpdatedAt)}</small>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}

      {summaryLoading && !data ? (
        <>
          <div className="panel skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
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
            <div className="stat"><div className="label">Available Cash</div><div className="value">{formatCurrency2(data.availableCash)}</div></div>
            <div className="stat"><div className="label">Cash Basis</div><div className="value">{formatCurrency2(data.cashBasis)}</div></div>
            <div className="stat"><div className="label">Holdings Market Value</div><div className="value">{holdingsLoading ? 'Loading...' : formatCurrency2(snapshot.holdingsMarketValue)}</div></div>
            <div className="stat"><div className="label">Performance</div><div className={performanceClassName}>{holdingsLoading ? 'Loading...' : formatCurrency2(snapshot.performance)}</div></div>
            <div className="stat"><div className="label">Adjustments</div><div className="value">{formatCurrency2(data.adjustments)}</div></div>
            <div className="stat"><div className="label">Stock Cost Basis (No Div)</div><div className="value">{formatCurrency2(data.totalStockCostBasis)}</div></div>
            <div className="stat"><div className="label">Stock Count</div><div className="value">{data.stockCount}</div></div>
          </div>

          <div className="panel">
            <h3>Holdings</h3>
            {holdingsLoading ? <p>Loading prices and market values...</p> : null}
            <table className="table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Total Shares</th>
                  <th>Price</th>
                  <th>Market Value</th>
                  <th>Cost Basis</th>
                  <th>Gain/Loss</th>
                  <th>Buy Target</th>
                  <th>Sale Target</th>
                  <th>Lots</th>
                </tr>
              </thead>
              <tbody>
                {holdingsRows.map((row) => (
                  <tr key={row.ticker}>
                    <td>
                      <Link className="link-button" to={`/stocks/${encodeURIComponent(row.ticker)}`}>
                        {row.ticker}
                      </Link>
                    </td>
                    <td>{formatShares(row.totalShares)}</td>
                    <td>
                      {holdingsLoading && row.latestPrice == null ? (
                        <span className="table-skeleton table-skeleton-sm" aria-label="Loading price" />
                      ) : (
                        formatStockPrice4(row.latestPrice)
                      )}
                    </td>
                    <td>
                      {holdingsLoading && row.marketValue == null ? (
                        <span className="table-skeleton table-skeleton-md" aria-label="Loading market value" />
                      ) : (
                        formatCurrency2(row.marketValue)
                      )}
                    </td>
                    <td>{formatCurrency2(row.costBasis)}</td>
                    <td className={getPerformanceClassName(row.gainLoss)}>{formatCurrency2(row.gainLoss)}</td>
                    <td>
                      {holdingsLoading && buyTargetsByTicker[row.ticker] == null ? (
                        <span className="table-skeleton table-skeleton-sm" aria-label="Loading buy target" />
                      ) : (
                        formatStockPrice4(buyTargetsByTicker[row.ticker] ?? null)
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
