import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CompanyProfile,
  CreateStockInput,
  DisplayLot,
  PurchaseLot,
  SaleAllocation,
  StockSplitEvent,
  StockTransaction,
  StockTransactionType,
  TickerSummary,
  createDisplayLot,
  createStockTransaction,
  deleteStockTransaction,
  emitPortfolioUpdated,
  getCashSummary,
  getCurrentPrices,
  getDisplayLotsByTicker,
  getHistoricalPrices,
  getOpenPurchaseLots,
  getPurchaseLotsByTicker,
  getSaleAllocations,
  getSaleAllocationsByTransactionIds,
  getStockProfileByTicker,
  getStockSplitsByTicker,
  getStockSummaryByTicker,
  getStockTransactionsByTicker,
  setInitialPurchaseFlag,
  HistoricalPrice,
} from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'
import { createSplitMultiplierResolver } from '../portfolioSnapshot'

const ALLOCATION_TOLERANCE = 1e-6
const LOT_STATE_TOLERANCE = 1e-6

type PositiveTransactionState = 'full' | 'partial' | 'empty'

type StockFormState = {
  type: StockTransactionType
  quantity: string
  price: string
  totalAmount: string
  newTicker: string
  exchangeRate: string
  transactionDate: string
}

const EMPTY_STOCK_FORM: StockFormState = {
  type: 'buy',
  quantity: '',
  price: '',
  totalAmount: '',
  newTicker: '',
  exchangeRate: '',
  transactionDate: new Date().toISOString().slice(0, 10),
}

function formatNumber(value: number | null, digits = 6) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return Number(value).toFixed(digits)
}

function formatPercent2(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return `${Number(value).toFixed(2)}%`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

function toUtcDayTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return Number.NaN
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function toDateOnly(value: string): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : ''
}

function getPositiveTransactionState(lot: PurchaseLot): PositiveTransactionState {
  const original = Number(lot.originalQuantity)
  const remaining = Number(lot.remainingQuantity)
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(remaining)) {
    return 'empty'
  }
  if (remaining <= LOT_STATE_TOLERANCE) {
    return 'empty'
  }
  if (remaining >= original - LOT_STATE_TOLERANCE) {
    return 'full'
  }
  return 'partial'
}

function getStatePillClassName(state: PositiveTransactionState) {
  if (state === 'full') {
    return 'pill pill-full'
  }
  if (state === 'partial') {
    return 'pill pill-partial'
  }
  return 'pill pill-empty'
}

function getSalePriceComparisonClassName(unitCost: number, salePrice: number | null) {
  if (salePrice == null || !Number.isFinite(salePrice) || !Number.isFinite(unitCost)) {
    return 'pill pill-muted'
  }

  if (unitCost < salePrice - ALLOCATION_TOLERANCE) {
    return 'pill pill-profit'
  }

  if (unitCost > salePrice + ALLOCATION_TOLERANCE) {
    return 'pill pill-loss'
  }

  return 'pill pill-muted'
}

function getSalePriceComparisonLabel(unitCost: number, salePrice: number | null) {
  if (salePrice == null || !Number.isFinite(salePrice) || !Number.isFinite(unitCost)) {
    return 'No comparison'
  }

  if (unitCost < salePrice - ALLOCATION_TOLERANCE) {
    return 'Profit'
  }

  if (unitCost > salePrice + ALLOCATION_TOLERANCE) {
    return 'Loss'
  }

  return 'Even'
}

function getPerformanceClassName(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 'value'
  }

  if (value > ALLOCATION_TOLERANCE) {
    return 'value value-positive'
  }

  if (value < -ALLOCATION_TOLERANCE) {
    return 'value value-negative'
  }

  return 'value'
}

function getSplitStatusClassName(split: StockSplitEvent) {
  const isActive = split.isActive !== false
  return isActive ? 'pill pill-full' : 'pill pill-warn'
}

function getSplitStatusLabel(split: StockSplitEvent) {
  const isActive = split.isActive !== false
  return isActive ? 'active' : 'not active'
}

type DisplayLotEntry = {
  id: string
  rowId: string
  index: number
  totalQuantity: number
  createdAt: string
}

type TransactionBreakdown = {
  buyCount: number
  buyAmount: number
  sellCount: number
  sellAmount: number
  divCount: number
  divAmount: number
}

export function buildEmptyBreakdown(): TransactionBreakdown {
  return { buyCount: 0, buyAmount: 0, sellCount: 0, sellAmount: 0, divCount: 0, divAmount: 0 }
}

export function accumulateBreakdown(breakdown: TransactionBreakdown, transaction: StockTransaction) {
  const type = String(transaction.type || '').toLowerCase()
  const amount = Number(transaction.amount)
  const safeAmount = Number.isFinite(amount) ? amount : 0

  if (type === 'buy') {
    breakdown.buyCount += 1
    breakdown.buyAmount += safeAmount
  } else if (type === 'sell') {
    breakdown.sellCount += 1
    breakdown.sellAmount += safeAmount
  } else if (type === 'div') {
    breakdown.divCount += 1
    breakdown.divAmount += safeAmount
  }
}

type SplitMultiplierPoint = {
  day: number
  multiplier: number
}

export function getSharesAtDate(
  transactions: StockTransaction[],
  date: string,
  splitTimeline: SplitMultiplierPoint[]
): number {
  let totalShares = 0

  for (const transaction of transactions) {
    const transactionDate = toDateOnly(transaction.transactionDate)
    if (!transactionDate || transactionDate > date) {
      continue
    }

    const rawQuantity = transaction.type === 'exchange'
      ? Number(transaction.exchangeSourceQuantity)
      : Number(transaction.quantity)
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
      continue
    }

    const transactionDay = toUtcDayTimestamp(transaction.transactionDate)
    let cumulativeMultiplier = 1
    if (Number.isFinite(transactionDay)) {
      for (const split of splitTimeline) {
        if (split.day <= toUtcDayTimestamp(date) && transactionDay <= split.day) {
          cumulativeMultiplier *= split.multiplier
        }
      }
    }

    const adjustedQuantity = rawQuantity * cumulativeMultiplier
    if (transaction.type === 'buy' || transaction.type === 'div') {
      totalShares += adjustedQuantity
    } else if (transaction.type === 'sell' || transaction.type === 'exchange') {
      totalShares -= adjustedQuantity
    }
  }

  return totalShares
}

export function findPriceOnOrBefore(
  prices: Array<{ priceDate: string; closePrice: number }>,
  date: string
): number | null {
  let bestDate = ''
  let bestPrice: number | null = null

  for (const price of prices) {
    const priceDate = toDateOnly(price.priceDate)
    const closePrice = Number(price.closePrice)
    if (!priceDate || priceDate > date || !Number.isFinite(closePrice) || closePrice <= 0) {
      continue
    }

    if (priceDate > bestDate) {
      bestDate = priceDate
      bestPrice = closePrice
    }
  }

  return bestPrice
}

export type YearPerformanceRow = {
  year: number
  performance: number | null
  isCurrentYear: boolean
}

export function calculateYearlyPerformance(args: {
  transactions: StockTransaction[]
  historicalPrices: Array<{ priceDate: string; closePrice: number }>
  splitEvents: StockSplitEvent[]
  finalValue: number | null
  asOfDate: string
}): { years: YearPerformanceRow[]; overall: number | null } {
  const { transactions, historicalPrices, splitEvents, finalValue, asOfDate } = args

  const splitTimeline: SplitMultiplierPoint[] = splitEvents
    .filter((split) => split.isActive !== false)
    .map((split) => ({
      day: toUtcDayTimestamp(split.splitDate),
      multiplier: Number(split.multiplier),
    }))
    .filter((entry) => Number.isFinite(entry.day) && Number.isFinite(entry.multiplier) && entry.multiplier > 0)

  const normalizedTransactions = transactions
    .filter((transaction) => toDateOnly(transaction.transactionDate))
    .slice()
    .sort((first, second) => toDateOnly(first.transactionDate).localeCompare(toDateOnly(second.transactionDate)))

  const firstTransactionDate = normalizedTransactions.length > 0
    ? toDateOnly(normalizedTransactions[0].transactionDate)
    : ''
  const startYear = firstTransactionDate ? Number(firstTransactionDate.slice(0, 4)) : NaN
  const currentYear = Number(asOfDate.slice(0, 4))

  if (!Number.isFinite(startYear) || !Number.isFinite(currentYear) || startYear > currentYear) {
    return { years: [], overall: null }
  }

  const years: YearPerformanceRow[] = []
  let netInvested = 0
  let previousValue = 0

  for (let year = startYear; year <= currentYear; year += 1) {
    const yearStartDate = `${year}-01-01`
    const isCurrentYear = year === currentYear
    const yearEndDate = isCurrentYear ? asOfDate : `${year}-12-31`
    const investedAtYearStart = netInvested

    for (const transaction of normalizedTransactions) {
      const transactionDate = toDateOnly(transaction.transactionDate)
      if (transactionDate < yearStartDate || transactionDate > yearEndDate) {
        continue
      }

      const amount = Number(transaction.amount)
      if (!Number.isFinite(amount)) {
        continue
      }

      if (transaction.type === 'buy' || transaction.type === 'div') {
        netInvested += amount
      } else if (transaction.type === 'sell') {
        netInvested -= amount
      }
    }

    const yearEndValue = isCurrentYear
      ? finalValue
      : (() => {
          const yearEndPrice = findPriceOnOrBefore(historicalPrices, yearEndDate)
          if (yearEndPrice == null) {
            return null
          }
          return getSharesAtDate(normalizedTransactions, yearEndDate, splitTimeline) * yearEndPrice
        })()

    const performance = yearEndValue == null
      ? null
      : yearEndValue - previousValue - (netInvested - investedAtYearStart)
    years.push({ year, performance, isCurrentYear })

    if (yearEndValue != null) {
      previousValue = yearEndValue
    }
  }

  const overall = finalValue == null ? null : finalValue - netInvested

  return { years, overall }
}

function formatBreakdownPerformance(value: number | null) {
  return value == null ? '--' : formatCurrency2(value)
}

function getBreakdownPerformanceClassName(value: number | null) {
  if (value == null) {
    return ''
  }
  if (value > ALLOCATION_TOLERANCE) {
    return 'value-positive'
  }
  if (value < -ALLOCATION_TOLERANCE) {
    return 'value-negative'
  }
  return ''
}

export default function StockHistoryPage() {
  const { ticker: tickerParam } = useParams<{ ticker: string }>()
  const ticker = useMemo(() => decodeURIComponent(tickerParam ?? '').trim().toUpperCase(), [tickerParam])
  const [summary, setSummary] = useState<TickerSummary | null>(null)
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [allTickerTransactions, setAllTickerTransactions] = useState<StockTransaction[]>([])
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null)
  const [form, setForm] = useState<StockFormState>(EMPTY_STOCK_FORM)
  const [showAddTransactionModal, setShowAddTransactionModal] = useState(false)
  const [showLotsModal, setShowLotsModal] = useState(false)
  const [showInitialPurchaseModal, setShowInitialPurchaseModal] = useState(false)
  const [initialPurchaseSelections, setInitialPurchaseSelections] = useState<Record<string, boolean>>({})
  const [savingInitialPurchases, setSavingInitialPurchases] = useState(false)
  const [initialPurchaseError, setInitialPurchaseError] = useState<string | null>(null)
  const [availableLots, setAvailableLots] = useState<PurchaseLot[]>([])
  const [openLots, setOpenLots] = useState<PurchaseLot[]>([])
  const [displayLots, setDisplayLots] = useState<DisplayLot[]>([])
  const [positiveTransactionStates, setPositiveTransactionStates] = useState<Record<string, PositiveTransactionState>>({})
  const [remainingSharesByTransactionId, setRemainingSharesByTransactionId] = useState<Record<string, number>>({})
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [displayLotInputs, setDisplayLotInputs] = useState<string[]>([])
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleAllocations, setSaleAllocations] = useState<Record<string, SaleAllocation[]>>({})
  const [splitEvents, setSplitEvents] = useState<StockSplitEvent[]>([])
  const [showOriginalPreSplit, setShowOriginalPreSplit] = useState(false)
  const [availableCash, setAvailableCash] = useState<number | null>(null)
  const [latestHistoricalPrice, setLatestHistoricalPrice] = useState<number | null>(null)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPrice[]>([])
  const [sellLotsSource, setSellLotsSource] = useState<PurchaseLot[]>([])
  const [loadingAllocations, setLoadingAllocations] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingLots, setLoadingLots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lotsBusy, setLotsBusy] = useState(false)
  const [lotsError, setLotsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const addTransactionFormRef = useRef<HTMLFormElement | null>(null)

  const currentSaleDay = useMemo(() => toUtcDayTimestamp(new Date().toISOString().slice(0, 10)), [])

  function getOpenPurchaseLotsFromCache(lots: PurchaseLot[]) {
    return lots.filter((lot) => String(lot.sourceType).toLowerCase() === 'purchase' && Number(lot.remainingQuantity) > ALLOCATION_TOLERANCE)
  }

  const displayLotEntries = useMemo<DisplayLotEntry[]>(() => {
    const entries: DisplayLotEntry[] = []
    for (const row of displayLots) {
      const lots = Array.isArray(row.lots) ? row.lots : []
      lots.forEach((qty, index) => {
        entries.push({
          id: `${row.id}:${index}`,
          rowId: row.id,
          index,
          totalQuantity: Number(qty),
          createdAt: row.createdAt,
        })
      })
    }
    return entries
  }, [displayLots])

  const isSell = form.type === 'sell'
  const isDividend = form.type === 'div'
  const isExchange = form.type === 'exchange'

  const allocationTotal = useMemo(() => {
    return Object.values(allocations).reduce((sum, value) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? sum + parsed : sum
    }, 0)
  }, [allocations])

  const quantityValue = Number(form.quantity)
  const sharesLeftToAllocate = Number.isFinite(quantityValue)
    ? Math.max(0, quantityValue - allocationTotal)
    : 0
  const allocationMatches = Number.isFinite(quantityValue)
    ? Math.abs(allocationTotal - quantityValue) <= ALLOCATION_TOLERANCE
    : false

  const hasRequiredValues =
    Boolean(form.transactionDate) &&
    (isExchange
      ? form.newTicker.trim() !== '' && form.exchangeRate.trim() !== ''
      : form.quantity.trim() !== '' && (isDividend ? form.totalAmount.trim() !== '' : form.price.trim() !== ''))

  const hasValidNumericValues =
    (isExchange
      ? Number.isFinite(Number(form.exchangeRate)) && Number(form.exchangeRate) > 0
      : Number.isFinite(quantityValue)
        && quantityValue > 0
        && (isDividend
          ? Number.isFinite(Number(form.totalAmount)) && Number(form.totalAmount) > 0
          : Number.isFinite(Number(form.price)) && Number(form.price) > 0))

  const hasSellAllocationInput = availableLots.some((lot) => {
    const value = Number(allocations[lot.id] || 0)
    return Number.isFinite(value) && value > 0
  })

  const canSubmit =
    hasRequiredValues &&
    hasValidNumericValues &&
    (!isSell || (!loadingLots && availableLots.length > 0 && hasSellAllocationInput && allocationMatches))

  const salePriceValue = isSell ? Number(form.price) : null

  const buyCost = Number(form.quantity) * Number(form.price)
  const hasInsufficientCashForBuy = form.type === 'buy'
    && Number.isFinite(buyCost)
    && Number.isFinite(Number(availableCash))
    && buyCost > Number(availableCash)

  const displayLotSummary = useMemo(() => {
    if (displayLotEntries.length === 0) {
      return '--'
    }
    return displayLotEntries
      .map((lot) => Number(lot.totalQuantity))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((q) => Number(q.toFixed(6)).toString())
      .join(', ')
  }, [displayLotEntries])

  const savedDisplayLotTotal = useMemo(
    () => displayLotEntries.reduce((sum, lot) => sum + lot.totalQuantity, 0),
    [displayLotEntries]
  )

  const editedDisplayLotQuantities = useMemo(
    () => displayLotInputs.map(Number),
    [displayLotInputs]
  )

  const editedDisplayLotTotal = useMemo(
    () => editedDisplayLotQuantities.reduce((sum, quantity) => sum + quantity, 0),
    [editedDisplayLotQuantities]
  )

  const canSaveDisplayLots =
    displayLotInputs.length > 0 &&
    editedDisplayLotQuantities.every((quantity) => Number.isFinite(quantity) && quantity > 0) &&
    Math.abs(editedDisplayLotTotal - savedDisplayLotTotal) <= ALLOCATION_TOLERANCE

  const totalDisplayLotShares = useMemo(() => {
    return displayLotEntries.reduce((sum, lot) => {
      const quantity = Number(lot.totalQuantity)
      return Number.isFinite(quantity) ? sum + quantity : sum
    }, 0)
  }, [displayLotEntries])

  const totalOpenPurchaseShares = useMemo(() => {
    return openLots.reduce((sum, lot) => {
      const quantity = Number(lot.remainingQuantity)
      return Number.isFinite(quantity) ? sum + quantity : sum
    }, 0)
  }, [openLots])

  const displayLotShareDelta = totalDisplayLotShares - totalOpenPurchaseShares
  const displayLotsOutOfSync = Math.abs(displayLotShareDelta) > ALLOCATION_TOLERANCE

  const effectivePrice = livePrice ?? latestHistoricalPrice

  const currentValue = useMemo(() => {
    if (!summary || effectivePrice == null) {
      return null
    }

    const totalShares = Number(summary.totalShares)
    const latestPrice = Number(effectivePrice)

    if (!Number.isFinite(totalShares) || !Number.isFinite(latestPrice)) {
      return null
    }

    return totalShares * latestPrice
  }, [summary, effectivePrice])

  const costBasis = useMemo(() => {
    return allTickerTransactions.reduce((sum, transaction) => {
      const amount = Number(transaction.amount)
      if (!Number.isFinite(amount)) {
        return sum
      }

      if (transaction.type === 'buy' || transaction.type === 'div') {
        return sum + amount
      }

      if (transaction.type === 'sell') {
        return sum - amount
      }

      return sum
    }, 0)
  }, [allTickerTransactions])

  const summaryPerformance = useMemo(() => {
    if (currentValue == null) {
      return null
    }

    return currentValue - costBasis
  }, [currentValue, costBasis])

  const salesSummary = useMemo(() => {
    const activeShares = Number(summary?.totalShares)
    const latestPrice = Number(effectivePrice)

    const salesCostBasis = transactions
      .filter((transaction) => transaction.type === 'sell')
      .reduce((sum, transaction) => {
        const amount = Number(transaction.amount)
        return Number.isFinite(amount) ? sum + amount : sum
      }, 0)

    const totalConsumedPurchaseCostBasis = Object.values(saleAllocations)
      .flat()
      .filter((allocation) => allocation.sourceType === 'purchase')
      .reduce((sum, allocation) => {
        const unitCost = Number(allocation.unitCost)
        const quantity = Number(allocation.quantity)
        if (!Number.isFinite(unitCost) || !Number.isFinite(quantity)) {
          return sum
        }
        return sum + (unitCost * quantity)
      }, 0)

    const consumedFromPartialOpenPurchaseLots = openLots.reduce((sum, lot) => {
      const original = Number(lot.originalQuantity)
      const remaining = Number(lot.remainingQuantity)
      const unitCost = Number(lot.unitCost)
      if (!Number.isFinite(original) || !Number.isFinite(remaining) || !Number.isFinite(unitCost)) {
        return sum
      }

      const consumedQuantity = Math.max(0, original - remaining)
      return sum + (consumedQuantity * unitCost)
    }, 0)

    const exhaustedPurchaseLotsCostBasis = Math.max(
      0,
      totalConsumedPurchaseCostBasis - consumedFromPartialOpenPurchaseLots
    )

    const hasValidPerformanceInputs = Number.isFinite(activeShares) && Number.isFinite(latestPrice)
    const performance = hasValidPerformanceInputs
      ? (activeShares * latestPrice) + salesCostBasis - exhaustedPurchaseLotsCostBasis
      : null

    return {
      saleCount: transactions.filter((transaction) => transaction.type === 'sell').length,
      salesCostBasis,
      exhaustedPurchaseLotsCostBasis,
      performance,
    }
  }, [summary, effectivePrice, transactions, saleAllocations, openLots])

  const performanceBreakdown = useMemo(() => {
    const overall = buildEmptyBreakdown()
    const byYear = new Map<number, TransactionBreakdown>()

    for (const transaction of allTickerTransactions) {
      const date = new Date(transaction.transactionDate)
      if (Number.isNaN(date.getTime())) {
        continue
      }

      accumulateBreakdown(overall, transaction)

      const year = date.getUTCFullYear()
      const yearBreakdown = byYear.get(year) ?? buildEmptyBreakdown()
      accumulateBreakdown(yearBreakdown, transaction)
      byYear.set(year, yearBreakdown)
    }

    const years = Array.from(byYear.keys())
      .sort((a, b) => b - a)
      .map((year) => ({ year, ...byYear.get(year)! }))

    return { overall, years }
  }, [allTickerTransactions])

  const yearlyPerformance = useMemo(() => {
    const tickerHistoricalPrices = historicalPrices.filter(
      (price) => String(price.ticker || '').toUpperCase() === ticker
    )

    const result = calculateYearlyPerformance({
      transactions: allTickerTransactions,
      historicalPrices: tickerHistoricalPrices,
      splitEvents,
      finalValue: currentValue,
      asOfDate: new Date().toISOString().slice(0, 10),
    })

    const performanceByYear = new Map<number, YearPerformanceRow>()
    for (const row of result.years) {
      performanceByYear.set(row.year, row)
    }

    return { performanceByYear, overall: result.overall }
  }, [allTickerTransactions, currentValue, historicalPrices, splitEvents, ticker])

  const initialPurchasePerformance = useMemo(() => {
    const initialPurchaseTransactions = allTickerTransactions.filter(
      (transaction) => transaction.type === 'buy' && transaction.isInitialPurchase
    )

    if (initialPurchaseTransactions.length === 0) {
      return null
    }

    const splitTimeline = splitEvents
      .filter((split) => split.isActive !== false)
      .map((split) => ({
        day: toUtcDayTimestamp(split.splitDate),
        multiplier: Number(split.multiplier),
      }))
      .filter((entry) => Number.isFinite(entry.day) && Number.isFinite(entry.multiplier) && entry.multiplier > 0)

    let totalShares = 0
    let totalCost = 0

    for (const transaction of initialPurchaseTransactions) {
      const transactionDay = toUtcDayTimestamp(transaction.transactionDate)
      let cumulativeMultiplier = 1

      if (Number.isFinite(transactionDay)) {
        for (const split of splitTimeline) {
          if (transactionDay <= split.day) {
            cumulativeMultiplier *= split.multiplier
          }
        }
      }

      const quantity = Number(transaction.quantity)
      const price = Number(transaction.price)
      if (!Number.isFinite(quantity) || !Number.isFinite(price)) {
        continue
      }

      totalShares += quantity * cumulativeMultiplier
      totalCost += quantity * price
    }

    const latestPrice = Number(effectivePrice)
    const currentValue = Number.isFinite(latestPrice) ? totalShares * latestPrice : null
    const performance = currentValue == null ? null : currentValue - totalCost
    const returnPercent = performance == null || totalCost <= ALLOCATION_TOLERANCE
      ? null
      : (performance / totalCost) * 100

    return {
      count: initialPurchaseTransactions.length,
      totalShares,
      totalCost,
      currentValue,
      performance,
      returnPercent,
    }
  }, [allTickerTransactions, splitEvents, effectivePrice])

  const summaryReturnPercent = useMemo(() => {
    if (!initialPurchasePerformance || initialPurchasePerformance.totalCost <= ALLOCATION_TOLERANCE || summaryPerformance == null) {
      return null
    }

    return (summaryPerformance / initialPurchasePerformance.totalCost) * 100
  }, [summaryPerformance, initialPurchasePerformance])

  const transactionTimeline = useMemo(() => {
    type TimelineEntry =
      | { kind: 'transaction'; date: number; transaction: StockTransaction }
      | { kind: 'split'; date: number; split: StockSplitEvent }

    const txEntries: TimelineEntry[] = transactions.map((transaction) => ({
      kind: 'transaction',
      date: new Date(transaction.transactionDate).getTime(),
      transaction,
    }))

    const splitEntries: TimelineEntry[] = splitEvents.map((split) => ({
      kind: 'split',
      date: new Date(split.splitDate).getTime(),
      split,
    }))

    return [...txEntries, ...splitEntries].sort((a, b) => b.date - a.date)
  }, [transactions, splitEvents])

  const adjustedTransactionValuesById = useMemo(() => {
    const splitTimeline = splitEvents
      .filter((split) => split.isActive !== false)
      .map((split) => ({
        day: toUtcDayTimestamp(split.splitDate),
        multiplier: Number(split.multiplier),
      }))
      .filter((entry) => Number.isFinite(entry.day) && Number.isFinite(entry.multiplier) && entry.multiplier > 0)

    const values: Record<string, { quantity: number | null; price: number | null; hadSplitAdjustments: boolean }> = {}

    for (const transaction of transactions) {
      if (transaction.type === 'sell') {
        values[transaction.id] = {
          quantity: transaction.quantity == null
            ? null
            : Number.isFinite(Number(transaction.quantity))
              ? Number(transaction.quantity)
              : null,
          price: transaction.price == null
            ? null
            : Number.isFinite(Number(transaction.price))
              ? Number(transaction.price)
              : null,
          hadSplitAdjustments: false,
        }
        continue
      }

      const transactionDay = toUtcDayTimestamp(transaction.transactionDate)
      let cumulativeMultiplier = 1

      if (Number.isFinite(transactionDay)) {
        for (const split of splitTimeline) {
          if (transactionDay <= split.day) {
            cumulativeMultiplier *= split.multiplier
          }
        }
      }

      const quantity = transaction.quantity == null
        ? null
        : Number.isFinite(Number(transaction.quantity))
          ? Number(transaction.quantity) * cumulativeMultiplier
          : null

      const price = transaction.price == null
        ? null
        : Number.isFinite(Number(transaction.price))
          ? Number(transaction.price) / cumulativeMultiplier
          : null

      values[transaction.id] = {
        quantity,
        price,
        hadSplitAdjustments: Math.abs(cumulativeMultiplier - 1) > ALLOCATION_TOLERANCE,
      }
    }

    return values
  }, [transactions, splitEvents])

  const preSplitLotValuesById = useMemo(() => {
    const values: Record<string, { remaining: number; unitCost: number; hasAdjustment: boolean }> = {}

    if (!isSell) {
      return values
    }

    const saleDay = toUtcDayTimestamp(form.transactionDate)
    if (!Number.isFinite(saleDay)) {
      return values
    }

    const splitTimeline = splitEvents
      .filter((split) => split.isActive !== false)
      .map((split) => ({
        day: toUtcDayTimestamp(split.splitDate),
        multiplier: Number(split.multiplier),
      }))
      .filter((entry) => Number.isFinite(entry.day) && Number.isFinite(entry.multiplier) && entry.multiplier > 0)

    for (const lot of availableLots) {
      let cumulativeMultiplier = 1

      for (const split of splitTimeline) {
        if (saleDay <= split.day) {
          cumulativeMultiplier *= split.multiplier
        }
      }

      const currentRemaining = Number(lot.remainingQuantity)
      const currentUnitCost = Number(lot.unitCost)

      const preSplitRemaining = Number.isFinite(currentRemaining) && cumulativeMultiplier > 0
        ? currentRemaining / cumulativeMultiplier
        : currentRemaining

      const preSplitUnitCost = Number.isFinite(currentUnitCost)
        ? currentUnitCost * cumulativeMultiplier
        : currentUnitCost

      values[lot.id] = {
        remaining: preSplitRemaining,
        unitCost: preSplitUnitCost,
        hasAdjustment: Math.abs(cumulativeMultiplier - 1) > ALLOCATION_TOLERANCE,
      }
    }

    return values
  }, [isSell, form.transactionDate, splitEvents, availableLots])

  const hasPreSplitLotAdjustments = useMemo(
    () => Object.values(preSplitLotValuesById).some((value) => value.hasAdjustment),
    [preSplitLotValuesById]
  )

  function toDateSafe(value: string): Date | null {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  function getSellLotsForSelectedDate(lots: PurchaseLot[], selectedDateText: string): PurchaseLot[] {
    const selectedDate = selectedDateText ? toDateSafe(selectedDateText) : null
    const dateFilteredLots = selectedDate
      ? lots.filter((lot) => {
          const lotDate = toDateSafe(lot.purchaseDate)
          return lotDate != null && lotDate <= selectedDate
        })
      : lots

    // Sort: purchases first (newest first), then dividends (newest first)
    return [...dateFilteredLots].sort((a, b) => {
      if (a.sourceType !== b.sourceType) {
        return a.sourceType === 'purchase' ? -1 : 1
      }
      return new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()
    })
  }

  function validateStockForm(formState: StockFormState): string | null {
    if (formState.type === 'exchange') {
      const nextTicker = String(formState.newTicker || '').trim().toUpperCase()
      if (!nextTicker) {
        return 'New ticker is required for an exchange.'
      }

      if (nextTicker === ticker) {
        return 'New ticker must be different from current ticker.'
      }

      const rate = Number(formState.exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        return 'Exchange rate must be greater than 0.'
      }
    }

    if (formState.type !== 'exchange') {
    const quantity = Number(formState.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return 'Shares must be greater than 0.'
    }

    if (formState.type === 'div') {
      const totalAmount = Number(formState.totalAmount)
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return 'Total amount must be greater than 0.'
      }
    } else {
      const price = Number(formState.price)
      if (!Number.isFinite(price) || price <= 0) {
        return 'Price must be greater than 0.'
      }
    }
    }

    if (!formState.transactionDate) {
      return 'Date is required.'
    }

    const selectedDate = new Date(formState.transactionDate)
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

  function resetForm() {
    setForm(EMPTY_STOCK_FORM)
    setAvailableLots([])
    setAllocations({})
  }

  function openAddTransactionModal() {
    setError(null)
    setSuccess(null)
    resetForm()
    setShowAddTransactionModal(true)
  }

  function closeAddTransactionModal() {
    setShowAddTransactionModal(false)
    resetForm()
  }

  function setAllocation(lotId: string, value: string) {
    setAllocations((prev) => ({ ...prev, [lotId]: value }))
  }

  function onAllocationInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()

    if (!canSubmit || saving || hasInsufficientCashForBuy) {
      return
    }

    addTransactionFormRef.current?.requestSubmit()
  }

  function buildAllocationPayload() {
    return availableLots
      .map((lot) => ({
        lotId: lot.id,
        quantity: Number(allocations[lot.id] || 0),
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
  }

  async function loadTransactions() {
    setLoading(true)
    setError(null)
    try {
      const [tickerSummaryData, txData, tickerLots, displayLotsData, cashSummaryData, splitEventsData] = await Promise.all([
        getStockSummaryByTicker(ticker),
        getStockTransactionsByTicker(ticker),
        getPurchaseLotsByTicker(ticker),
        getDisplayLotsByTicker(ticker),
        getCashSummary(),
        getStockSplitsByTicker(ticker),
      ])
      setSummary(tickerSummaryData)
      setSaleAllocations({})

      const earliestTxDate = txData.reduce((earliest, transaction) => {
        const transactionDate = toDateOnly(transaction.transactionDate)
        return transactionDate && (!earliest || transactionDate < earliest) ? transactionDate : earliest
      }, '')
      const priceStartDate = earliestTxDate ? `${earliestTxDate.slice(0, 4)}-01-01` : '1980-01-01'

      getHistoricalPrices(priceStartDate, new Date().toISOString().slice(0, 10))
        .then((prices) => setHistoricalPrices(prices))
        .catch(() => setHistoricalPrices([]))

      const sellTransactionIds = txData
        .filter((transaction) => transaction.type === 'sell')
        .map((transaction) => transaction.id)

      if (sellTransactionIds.length > 0) {
        getSaleAllocationsByTransactionIds(sellTransactionIds)
          .then((allocationsByTransactionId) => setSaleAllocations(allocationsByTransactionId))
          .catch(() => {
            // Cost basis falls back to per-lot totals if allocation history fails to preload.
          })
      }

      const openBuyTransactionIds = new Set(
        tickerLots
          .filter((lot) => lot.sourceType === 'purchase')
          .map((lot) => lot.transactionId)
      )

      const openDividendTransactionIds = new Set(
        tickerLots
          .filter((lot) => lot.sourceType === 'dividend')
          .map((lot) => lot.transactionId)
      )

      const visibleTransactions = txData.filter((transaction) => {
        if (transaction.type === 'buy') {
          return openBuyTransactionIds.has(transaction.id)
        }
        if (transaction.type === 'div') {
          return openDividendTransactionIds.has(transaction.id)
        }
        return true
      })

      setTransactions(visibleTransactions)
      setAllTickerTransactions(txData)
      setDisplayLots(displayLotsData)
      setAvailableCash(Number(cashSummaryData.availableCash))
      setSellLotsSource(tickerLots)
      setOpenLots(getOpenPurchaseLotsFromCache(tickerLots))
      setSplitEvents(splitEventsData)

      const nextStates: Record<string, PositiveTransactionState> = {}
      const nextRemainingShares: Record<string, number> = {}
      for (const lot of tickerLots) {
        nextStates[lot.transactionId] = getPositiveTransactionState(lot)

        const remaining = Number(lot.remainingQuantity)
        if (Number.isFinite(remaining)) {
          nextRemainingShares[lot.transactionId] = (nextRemainingShares[lot.transactionId] ?? 0) + remaining
        }
      }
      setPositiveTransactionStates(nextStates)
      setRemainingSharesByTransactionId(nextRemainingShares)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load transaction history.')
    } finally {
      setLoading(false)
    }
  }

  async function reloadDisplayLots() {
    const data = await getDisplayLotsByTicker(ticker)
    setDisplayLots(data)
    setDisplayLotInputs(data.flatMap((row) => row.lots.map(String)))
  }

  useEffect(() => {
    if (!ticker) {
      setLoading(false)
      setError('Ticker is required.')
      return
    }

    loadTransactions()
  }, [ticker])

  useEffect(() => {
    if (!ticker) {
      setCompanyProfile(null)
      return
    }

    let cancelled = false

    getStockProfileByTicker(ticker)
      .then((profile) => {
        if (!cancelled) {
          setCompanyProfile(profile)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyProfile(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [ticker])

  useEffect(() => {
    if (!ticker) {
      setLatestHistoricalPrice(null)
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    setLatestHistoricalPrice(findPriceOnOrBefore(
      historicalPrices.filter((row) => String(row.ticker).toUpperCase() === ticker),
      today
    ))
  }, [historicalPrices, ticker])

  useEffect(() => {
    if (!ticker) {
      setLivePrice(null)
      return
    }

    let cancelled = false

    getCurrentPrices([ticker])
      .then((result) => {
        if (cancelled) {
          return
        }
        const match = result.prices.find((row) => String(row.ticker || '').toUpperCase() === ticker)
        const price = Number(match?.price)
        setLivePrice(Number.isFinite(price) && price > 0 ? price : null)
      })
      .catch(() => {
        if (!cancelled) {
          setLivePrice(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [ticker])


  useEffect(() => {
    if (!isSell || !showAddTransactionModal || !ticker) {
      setAvailableLots([])
      setAllocations({})
      return
    }

    let cancelled = false

    async function loadLots() {
      setLoadingLots(true)
      try {
        const selectedSaleDay = toUtcDayTimestamp(form.transactionDate)
        const hasValidSelectedDate = Number.isFinite(selectedSaleDay)
        const useCachedLots = hasValidSelectedDate && selectedSaleDay === currentSaleDay && sellLotsSource.length > 0
        const lots = useCachedLots
          ? sellLotsSource
          : hasValidSelectedDate
            ? await getOpenPurchaseLots(ticker, form.transactionDate)
            : sellLotsSource
        if (!cancelled) {
          const sorted = getSellLotsForSelectedDate(lots, form.transactionDate)
          setAvailableLots(sorted)
          setAllocations((prev) => {
            const next: Record<string, string> = {}
            for (const lot of sorted) {
              next[lot.id] = prev[lot.id] ?? ''
            }
            return next
          })
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load lots for ticker.')
          setSellLotsSource([])
          setAvailableLots([])
        }
      } finally {
        if (!cancelled) {
          setLoadingLots(false)
        }
      }
    }

    loadLots()

    return () => {
      cancelled = true
    }
  }, [isSell, showAddTransactionModal, ticker, form.transactionDate, sellLotsSource, currentSaleDay])

  useEffect(() => {
    if (!isSell || !showAddTransactionModal || !ticker) {
      return
    }

    const sorted = getSellLotsForSelectedDate(sellLotsSource, form.transactionDate)
    setAvailableLots(sorted)
    setAllocations((prev) => {
      const next: Record<string, string> = {}
      for (const lot of sorted) {
        next[lot.id] = prev[lot.id] ?? ''
      }
      return next
    })
  }, [isSell, showAddTransactionModal, ticker, form.transactionDate, sellLotsSource])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const validationError = validateStockForm(form)
    if (validationError) {
      setError(validationError)
      return
    }

    const payload: CreateStockInput = {
      ticker,
      type: form.type,
      transactionDate: new Date(form.transactionDate).toISOString(),
    }

    if (!isExchange) {
      const qty = Number(form.quantity)
      const price = isDividend ? Number(form.totalAmount) / qty : Number(form.price)
      payload.quantity = qty
      payload.price = price
    } else {
      payload.newTicker = String(form.newTicker || '').trim().toUpperCase()
      payload.exchangeRate = Number(form.exchangeRate)
    }

    if (form.type === 'buy') {
      const available = Number(availableCash)
      const requiredCash = Number(payload.quantity || 0) * Number(payload.price || 0)
      if (Number.isFinite(available) && Number.isFinite(requiredCash) && requiredCash > available) {
        setError(
          `Insufficient available cash. Buy requires ${formatCurrency2(requiredCash)} but only ${formatCurrency2(available)} is available.`
        )
        return
      }
    }

    if (form.type === 'sell') {
      if (availableLots.length === 0) {
        setError('No open lots are available for this ticker.')
        return
      }

      const allocationPayload = buildAllocationPayload()
      const allocatedQuantity = allocationPayload.reduce((sum, row) => sum + row.quantity, 0)
      if (Math.abs(allocatedQuantity - Number(form.quantity)) > ALLOCATION_TOLERANCE) {
        setError(`Allocated quantity (${allocatedQuantity.toFixed(6)}) must equal sell shares (${Number(form.quantity).toFixed(6)}).`)
        return
      }

      payload.allocations = allocationPayload
    }

    setSaving(true)
    try {
      await createStockTransaction(payload)
      setSaving(false)
      setSuccess('Transaction created.')
      emitPortfolioUpdated()
      setShowAddTransactionModal(false)
      resetForm()
      void loadTransactions()
    } catch (err: unknown) {
      setSaving(false)
      setError(err instanceof Error ? err.message : 'Unable to create transaction.')
    }
  }

  async function onDeleteTransaction(id: string) {
    const confirmed = window.confirm('Delete this stock transaction?')
    if (!confirmed) {
      return
    }

    setError(null)
    setSuccess(null)
    try {
      await deleteStockTransaction(id)
      setSuccess('Transaction deleted.')
      await loadTransactions()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete transaction.')
    }
  }

  async function toggleSaleAllocations(transactionId: string) {
    if (expandedSaleId === transactionId) {
      setExpandedSaleId(null)
      return
    }

    if (saleAllocations[transactionId]) {
      setExpandedSaleId(transactionId)
      return
    }

    setLoadingAllocations(true)
    try {
      const allocationsData = await getSaleAllocations(transactionId)
      setSaleAllocations((prev) => ({ ...prev, [transactionId]: allocationsData }))
      setExpandedSaleId(transactionId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load allocations.')
    } finally {
      setLoadingAllocations(false)
    }
  }

  async function onInitializeDisplayLots() {
    setLotsError(null)
    setLotsBusy(true)
    try {
      const quantities = openLots
        .filter((lot) => String(lot.sourceType).toLowerCase() === 'purchase')
        .map((lot) => Number(lot.remainingQuantity))
        .filter((qty) => Number.isFinite(qty) && qty > 0)

      if (quantities.length === 0) {
        setLotsError('No open purchase-lot quantities available to initialize display lots.')
        return
      }

      await createDisplayLot(ticker, { quantities })
      await reloadDisplayLots()
    } catch (err: unknown) {
      setLotsError(err instanceof Error ? err.message : 'Unable to initialize display lots.')
    } finally {
      setLotsBusy(false)
    }
  }

  function openDisplayLotsModal() {
    setLotsError(null)
    setDisplayLotInputs(displayLotEntries.map((lot) => String(lot.totalQuantity)))
    setShowLotsModal(true)
  }

  const buyTransactionsAscending = useMemo(() => {
    return allTickerTransactions
      .filter((transaction) => transaction.type === 'buy')
      .sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime())
  }, [allTickerTransactions])

  function openInitialPurchaseModal() {
    setInitialPurchaseError(null)
    setInitialPurchaseSelections(
      Object.fromEntries(buyTransactionsAscending.map((transaction) => [transaction.id, Boolean(transaction.isInitialPurchase)]))
    )
    setShowInitialPurchaseModal(true)
  }

  function toggleInitialPurchaseSelection(transactionId: string) {
    setInitialPurchaseSelections((previous) => ({
      ...previous,
      [transactionId]: !previous[transactionId],
    }))
  }

  async function onSaveInitialPurchases() {
    setSavingInitialPurchases(true)
    setInitialPurchaseError(null)
    try {
      const changedTransactions = buyTransactionsAscending.filter(
        (transaction) => Boolean(transaction.isInitialPurchase) !== Boolean(initialPurchaseSelections[transaction.id])
      )

      await Promise.all(
        changedTransactions.map((transaction) =>
          setInitialPurchaseFlag(transaction.id, Boolean(initialPurchaseSelections[transaction.id]))
        )
      )

      await loadTransactions()
      setShowInitialPurchaseModal(false)
    } catch (err: unknown) {
      setInitialPurchaseError(err instanceof Error ? err.message : 'Unable to update initial purchases.')
    } finally {
      setSavingInitialPurchases(false)
    }
  }

  function updateDisplayLotInput(index: number, value: string) {
    setDisplayLotInputs((previous) => previous.map((quantity, inputIndex) => inputIndex === index ? value : quantity))
  }

  function removeDisplayLotInput(index: number) {
    setDisplayLotInputs((previous) => previous.filter((_, inputIndex) => inputIndex !== index))
  }

  async function onSaveDisplayLots() {
    if (!canSaveDisplayLots) {
      setLotsError(`Display lots must be positive and sum to ${formatNumber(savedDisplayLotTotal, 6)} shares.`)
      return
    }

    setLotsError(null)
    setLotsBusy(true)
    try {
      await createDisplayLot(ticker, { quantities: editedDisplayLotQuantities })
      await reloadDisplayLots()
      setShowLotsModal(false)
    } catch (err: unknown) {
      setLotsError(err instanceof Error ? err.message : 'Unable to save display lots.')
    } finally {
      setLotsBusy(false)
    }
  }

  return (
    <section>
      <div className="panel row-between">
        <div>
          <h2>{ticker || 'Ticker'} Transaction History</h2>
          <p>All stock transactions recorded for this ticker.</p>
          {companyProfile ? (
            <p className="hint">
              {companyProfile.companyName ?? ticker}
              {companyProfile.sector ? ` \u00b7 ${companyProfile.sector}` : ''}
              {companyProfile.industry ? ` \u00b7 ${companyProfile.industry}` : ''}
              {companyProfile.sizeClassification ? ` \u00b7 ${companyProfile.sizeClassification}` : ''}
            </p>
          ) : null}
        </div>
        <div className="inline-actions">
          <button className="button button-primary" type="button" onClick={openAddTransactionModal} disabled={!ticker}>
            Add Transaction
          </button>
          <button className="button" type="button" onClick={openInitialPurchaseModal} disabled={!ticker || buyTransactionsAscending.length === 0}>
            Mark Initial Purchases
          </button>
          <Link className="button" to="/">
            Back to Dashboard
          </Link>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}
      {success ? <div className="panel status status-success">{success}</div> : null}

      {loading ? (
        <>
          <div className="panel skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="panel">Loading transactions...</div>
        </>
      ) : null}

      {!loading && !error && summary ? (
        <>
          <div className="panel stat-grid">
            <div className="stat"><div className="label">Total Shares</div><div className="value">{formatNumber(summary.totalShares, 6)}</div></div>
            <button
              className="stat stat-clickable"
              type="button"
              onClick={openDisplayLotsModal}
            >
              <div className="label">Display Lots ({displayLotEntries.length})</div>
              <div className="value">{displayLotSummary}</div>
              <div className="hint">click to manage</div>
            </button>
            <div className="stat"><div className="label">Cost Basis</div><div className="value">{formatCurrency2(costBasis)}</div></div>
            <div className="stat"><div className="label">Current Value</div><div className="value">{formatCurrency2(currentValue)}</div></div>
            <div className="stat"><div className="label">Performance</div><div className={getPerformanceClassName(summaryPerformance)}>{formatCurrency2(summaryPerformance)}</div></div>
            {summaryReturnPercent != null ? (
              <div className="stat"><div className="label">Return %</div><div className={getPerformanceClassName(summaryPerformance)}>{formatPercent2(summaryReturnPercent)}</div></div>
            ) : null}
          </div>

          {salesSummary.saleCount > 0 ? (
            <div className="panel stat-grid" style={{ marginTop: '0.75rem' }}>
              <div className="stat"><div className="label">Sales Cost Basis</div><div className="value">{formatCurrency2(salesSummary.salesCostBasis)}</div></div>
              <div className="stat"><div className="label">Exhausted Purchase Lots Cost Basis (No Div)</div><div className="value">{formatCurrency2(salesSummary.exhaustedPurchaseLotsCostBasis)}</div></div>
              <div className="stat"><div className="label">Sales Performance</div><div className={getPerformanceClassName(salesSummary.performance)}>{formatCurrency2(salesSummary.performance)}</div></div>
            </div>
          ) : null}

          {initialPurchasePerformance ? (
            <div className="panel stat-grid" style={{ marginTop: '0.75rem' }}>
              <div className="stat"><div className="label">Initial Buy Shares ({initialPurchasePerformance.count})</div><div className="value">{formatNumber(initialPurchasePerformance.totalShares, 6)}</div></div>
              <div className="stat"><div className="label">Initial Buy Cost Basis</div><div className="value">{formatCurrency2(initialPurchasePerformance.totalCost)}</div></div>
              <div className="stat"><div className="label">Initial Buy Current Value</div><div className="value">{formatCurrency2(initialPurchasePerformance.currentValue)}</div></div>
              <div className="stat"><div className="label">Initial Buy Performance</div><div className={getPerformanceClassName(initialPurchasePerformance.performance)}>{formatCurrency2(initialPurchasePerformance.performance)}</div></div>
              <div className="stat"><div className="label">Initial Buy Return %</div><div className={getPerformanceClassName(initialPurchasePerformance.performance)}>{formatPercent2(initialPurchasePerformance.returnPercent)}</div></div>
            </div>
          ) : null}

          <div className="panel" style={{ marginTop: '0.75rem' }}>
            <h3 style={{ marginTop: 0 }}>Performance Breakdown</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Buys</th>
                  <th>Buy Amount</th>
                  <th>Sales</th>
                  <th>Sale Amount</th>
                  <th>Dividends</th>
                  <th>Dividend Amount</th>
                  <th>Performance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>All Time</td>
                  <td>{performanceBreakdown.overall.buyCount}</td>
                  <td>{formatCurrency2(performanceBreakdown.overall.buyAmount)}</td>
                  <td>{performanceBreakdown.overall.sellCount}</td>
                  <td>{formatCurrency2(performanceBreakdown.overall.sellAmount)}</td>
                  <td>{performanceBreakdown.overall.divCount}</td>
                  <td>{formatCurrency2(performanceBreakdown.overall.divAmount)}</td>
                  <td className={getBreakdownPerformanceClassName(yearlyPerformance.overall)}>{formatBreakdownPerformance(yearlyPerformance.overall)}</td>
                </tr>
                {performanceBreakdown.years.map((row) => (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    <td>{row.buyCount}</td>
                    <td>{formatCurrency2(row.buyAmount)}</td>
                    <td>{row.sellCount}</td>
                    <td>{formatCurrency2(row.sellAmount)}</td>
                    <td>{row.divCount}</td>
                    <td>{formatCurrency2(row.divAmount)}</td>
                    <td className={getBreakdownPerformanceClassName(yearlyPerformance.performanceByYear.get(row.year)?.performance ?? null)}>
                      {formatBreakdownPerformance(yearlyPerformance.performanceByYear.get(row.year)?.performance ?? null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Performance is the total return for the period, including unrealized gains: period-end market value minus net amount invested (buys plus dividend reinvestments minus sales). All Time matches the summary performance above.</p>
          </div>

          {splitEvents.length > 0 ? (
            <div className="panel" style={{ marginTop: '0.75rem' }}>
              <h3 style={{ marginTop: 0 }}>Split Events</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ratio</th>
                    <th>Multiplier</th>
                    <th>Activation</th>
                  </tr>
                </thead>
                <tbody>
                  {splitEvents.map((split) => (
                    <tr key={split.id}>
                      <td>{formatDate(split.splitDate)}</td>
                      <td>{split.ratioNumerator}:{split.ratioDenominator}</td>
                      <td>{formatNumber(split.multiplier, 8)}x</td>
                      <td>
                        <span className={getSplitStatusClassName(split)}>{getSplitStatusLabel(split)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {displayLotsOutOfSync ? (
            <div className="panel status status-warning">
              Display lots are out of sync by {formatNumber(Math.abs(displayLotShareDelta), 6)} shares.
              Display lots total {formatNumber(totalDisplayLotShares, 6)} while open purchase lots total {formatNumber(totalOpenPurchaseShares, 6)}.
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && !error ? (
        <div className="panel">
          {splitEvents.length > 0 ? (
            <div className="row-between" style={{ marginBottom: '0.75rem' }}>
              <p style={{ margin: 0, color: '#5b6472' }}>
                Toggle between split-adjusted values and original pre-split values for quantity and price.
              </p>
              <button
                className="button"
                type="button"
                onClick={() => setShowOriginalPreSplit((prev) => !prev)}
              >
                {showOriginalPreSplit ? 'Showing: Original Pre-Split' : 'Showing: Current Split-Adjusted'}
              </button>
            </div>
          ) : null}

          {transactionTimeline.length === 0 ? (
            <p>No transactions found for {ticker}.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Lot State</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactionTimeline.map((entry) => {
                  if (entry.kind === 'split') {
                    return (
                      <tr key={`split-${entry.split.id}`} style={{ backgroundColor: '#fff7e6' }}>
                        <td>{formatDate(entry.split.splitDate)}</td>
                        <td colSpan={6}>
                          <strong>Stock Split</strong> {entry.split.ratioNumerator}:{entry.split.ratioDenominator}
                          {' '}({formatNumber(entry.split.multiplier, 8)}x). Status:{' '}
                          <span className={getSplitStatusClassName(entry.split)}>{getSplitStatusLabel(entry.split)}</span>
                          . Older transactions below this row are pre-split.
                        </td>
                      </tr>
                    )
                  }

                  const transaction = entry.transaction
                  const adjustedValues = adjustedTransactionValuesById[transaction.id]
                  const displayQuantity = showOriginalPreSplit ? transaction.quantity : (adjustedValues?.quantity ?? transaction.quantity)
                  const displayPrice = showOriginalPreSplit ? transaction.price : (adjustedValues?.price ?? transaction.price)
                  const lotState = positiveTransactionStates[transaction.id]
                  const partialRemainingShares = remainingSharesByTransactionId[transaction.id]
                  const isPartialLotRow =
                    (transaction.type === 'buy' || transaction.type === 'div') &&
                    lotState === 'partial' &&
                    Number.isFinite(partialRemainingShares)
                  const quantityToDisplay = isPartialLotRow ? partialRemainingShares : displayQuantity
                  return [
                      <tr key={transaction.id}>
                        <td>{formatDate(transaction.transactionDate)}</td>
                        <td>{transaction.type}</td>
                        <td>
                          {transaction.type === 'buy' || transaction.type === 'div' ? (
                            lotState ? (
                              <>
                                <span className={getStatePillClassName(lotState)}>
                                  {lotState}
                                </span>
                                {lotState === 'partial' && Number.isFinite(partialRemainingShares) ? (
                                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                                    {formatNumber(displayQuantity, 6)} original shares
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <span className="pill pill-muted">--</span>
                            )
                          ) : (
                            <span className="pill pill-muted">--</span>
                          )}
                        </td>
                        <td>
                          {formatNumber(quantityToDisplay)}
                          {showOriginalPreSplit && adjustedValues?.hadSplitAdjustments && !isPartialLotRow ? (
                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>pre-split</div>
                          ) : null}
                        </td>
                        <td>
                          {formatStockPrice4(displayPrice)}
                          {showOriginalPreSplit && adjustedValues?.hadSplitAdjustments ? (
                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>pre-split</div>
                          ) : null}
                        </td>
                        <td>{formatCurrency2(transaction.amount)}</td>
                        <td>
                          {transaction.type === 'sell' ? (
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => toggleSaleAllocations(transaction.id)}
                              disabled={loadingAllocations}
                            >
                              {expandedSaleId === transaction.id ? '▼' : '▶'} Lots
                            </button>
                          ) : null}
                          {!transaction.isDeletionLocked ? (
                            <button
                              className="button button-danger"
                              type="button"
                              onClick={() => onDeleteTransaction(transaction.id)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </td>
                      </tr>,
                      transaction.type === 'sell' && expandedSaleId === transaction.id ? (
                        <tr key={`${transaction.id}-allocations`}>
                          <td colSpan={7}>
                            <div style={{ padding: '1rem', backgroundColor: '#f5f5f5' }}>
                              <h4 style={{ marginTop: 0 }}>Purchase Lots Consumed</h4>
                              {saleAllocations[transaction.id] && saleAllocations[transaction.id].length > 0 ? (
                                <table style={{ width: '100%', fontSize: '0.9em', borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid #ddd' }}>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Original Type</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Purchase Date</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Unit Cost</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Quantity Consumed</th>
                                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Total Cost</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {saleAllocations[transaction.id].map((alloc, index) => (
                                      <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '0.5rem' }}>{alloc.sourceType === 'purchase' ? 'buy' : 'div'}</td>
                                        <td style={{ padding: '0.5rem' }}>{formatDate(alloc.purchaseDate)}</td>
                                        <td style={{ padding: '0.5rem' }}>
                                          <div className="sale-lot-cost-cell">
                                            <span>{formatStockPrice4(alloc.unitCost)}</span>
                                            <span className={getSalePriceComparisonClassName(Number(alloc.unitCost), Number(transaction.price))}>
                                              {getSalePriceComparisonLabel(Number(alloc.unitCost), Number(transaction.price))}
                                            </span>
                                          </div>
                                        </td>
                                        <td style={{ padding: '0.5rem' }}>{formatNumber(alloc.quantity)}</td>
                                        <td style={{ padding: '0.5rem' }}>{formatCurrency2(alloc.unitCost * alloc.quantity)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p>No purchase lots found for this sale.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null,
                  ]
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {showAddTransactionModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-stock-history-transaction-title">
          <div className="modal-card modal-card-wide modal-card-scrollable">
            <h3 id="add-stock-history-transaction-title">Add Transaction ({ticker})</h3>
            <p>Enter date and transaction details.</p>

            <form ref={addTransactionFormRef} className="form-grid" onSubmit={onSubmit}>
              <label>
                Date
                <input
                  type="date"
                  min="1980-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.transactionDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, transactionDate: event.target.value }))}
                  disabled={saving}
                />
              </label>

              <label>
                Transaction Type
                <select
                  value={form.type}
                  onChange={(event) => {
                    const nextType = event.target.value as StockTransactionType
                    setForm((prev) => ({ ...prev, type: nextType }))
                    setError(null)
                    setSuccess(null)
                  }}
                  disabled={saving}
                >
                  <option value="buy">Buy</option>
                  <option value="div">Dividend</option>
                  <option value="sell">Sell</option>
                  <option value="exchange">Exchange</option>
                </select>
              </label>

              {!isExchange ? (
              <label>
                Shares
                <input
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={form.quantity}
                  onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                  disabled={saving}
                />
              </label>
              ) : null}

              {isExchange ? (
                <label>
                  New Ticker
                  <input
                    type="text"
                    value={form.newTicker}
                    onChange={(event) => setForm((prev) => ({ ...prev, newTicker: event.target.value.toUpperCase() }))}
                    disabled={saving}
                  />
                </label>
              ) : null}

              {isExchange ? (
                <label>
                  Exchange Rate
                  <input
                    type="number"
                    min="0.00000001"
                    step="0.00000001"
                    value={form.exchangeRate}
                    onChange={(event) => setForm((prev) => ({ ...prev, exchangeRate: event.target.value }))}
                    disabled={saving}
                  />
                </label>
              ) : null}

              {!isExchange && isDividend ? (
                <label>
                  Total Amount
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={form.totalAmount}
                    onChange={(event) => setForm((prev) => ({ ...prev, totalAmount: event.target.value }))}
                    disabled={saving}
                  />
                </label>
              ) : !isExchange ? (
                <label>
                  Price
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={form.price}
                    onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                    disabled={saving}
                  />
                </label>
              ) : null}

              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={saving || !canSubmit || hasInsufficientCashForBuy}>
                  {saving ? 'Saving...' : 'Add Transaction'}
                </button>
                <button className="button" type="button" onClick={closeAddTransactionModal} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>

            {hasInsufficientCashForBuy ? (
              <div className="status status-error">
                Insufficient available cash. Buy requires {formatCurrency2(buyCost)} and available cash is {formatCurrency2(Number(availableCash || 0))}.
              </div>
            ) : null}

            {isSell ? (
              <div className="allocation-panel">
                <div className="allocation-header">
                  <h4>Lot Allocation</h4>
                  <span className={allocationMatches ? 'pill pill-good' : 'pill pill-warn'}>
                    Shares left to be allocated: {sharesLeftToAllocate.toFixed(6)}
                  </span>
                </div>

                {loadingLots ? <p>Loading lots for {ticker}...</p> : null}

                {!loadingLots && availableLots.length === 0 ? (
                  <p>No open lots found for {ticker}. Create a buy/dividend lot first.</p>
                ) : null}

                {!loadingLots && availableLots.length > 0 ? (
                  <>
                    {hasPreSplitLotAdjustments ? (
                      <div className="status status-warning" style={{ marginBottom: '0.75rem' }}>
                        Showing pre-split lot values based on selected sale date.
                        Allocation inputs use pre-split share quantities.
                      </div>
                    ) : null}
                  <div className="allocation-table-wrap">
                    <table className="table allocation-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Date</th>
                          <th>Remaining</th>
                          <th>Unit Cost</th>
                          <th>Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableLots.map((lot) => {
                        const preSplitLot = preSplitLotValuesById[lot.id]
                        const displayRemaining = preSplitLot ? preSplitLot.remaining : Number(lot.remainingQuantity)
                        const displayUnitCost = preSplitLot ? preSplitLot.unitCost : Number(lot.unitCost)
                        const inputMax = Number.isFinite(displayRemaining)
                          ? displayRemaining.toFixed(8)
                          : Number(lot.remainingQuantity).toString()

                        return (
                          <tr key={lot.id}>
                            <td>{lot.sourceType === 'purchase' ? 'Buy' : 'Dividend'}</td>
                            <td>{formatDate(lot.purchaseDate)}</td>
                            <td>{formatNumber(displayRemaining, 6)}</td>
                            <td>
                              <div className="sale-lot-cost-cell">
                                <span>{formatStockPrice4(displayUnitCost)}</span>
                                <span className={getSalePriceComparisonClassName(displayUnitCost, salePriceValue)}>
                                  {getSalePriceComparisonLabel(displayUnitCost, salePriceValue)}
                                </span>
                              </div>
                            </td>
                            <td className="allocation-input-cell">
                              <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*[.]?[0-9]*"
                                placeholder="0.00000000"
                                value={allocations[lot.id] ?? ''}
                                onChange={(event) => setAllocation(lot.id, event.target.value)}
                                onKeyDown={onAllocationInputKeyDown}
                                disabled={saving}
                                className="allocation-input"
                              />
                            </td>
                          </tr>
                        )
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {error ? <div className="status status-error">{error}</div> : null}
          </div>
        </div>
      ) : null}

      {showLotsModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="lots-modal-title">
          <div className="modal-card">
            <div className="row-between">
              <h3 id="lots-modal-title">Display Lots — {ticker}</h3>
              <button className="button" type="button" onClick={() => setShowLotsModal(false)} disabled={lotsBusy}>
                Close
              </button>
            </div>
            <p>Edit the quantity of each display lot. The total must remain {formatNumber(savedDisplayLotTotal, 6)} shares.</p>

            {displayLotsOutOfSync ? (
              <div className="status status-warning">
                Display lots are out of sync by {formatNumber(Math.abs(displayLotShareDelta), 6)} shares.
                You can still combine or split display lots, but totals may not match purchase lots until corrected.
              </div>
            ) : null}

            {lotsError ? <div className="status status-error">{lotsError}</div> : null}

            {displayLotEntries.length === 0 ? (
              <>
                <p>No display lots exist yet for {ticker}. You have {openLots.length} open purchase lot{openLots.length !== 1 ? 's' : ''} with the following share counts:</p>
                {openLots.length > 0 ? (
                  <ul>
                    {openLots.map((lot) => (
                      <li key={lot.id}>{formatNumber(lot.remainingQuantity, 6)} shares</li>
                    ))}
                  </ul>
                ) : null}
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={onInitializeDisplayLots}
                    disabled={lotsBusy || openLots.length === 0}
                  >
                    {lotsBusy ? 'Creating...' : `Create one display lot per purchase lot (${openLots.length})`}
                  </button>
                </div>
              </>
            ) : (
              <div className="display-lot-editor">
                {displayLotInputs.map((quantity, index) => (
                  <div className="display-lot-editor-row" key={`display-lot-input-${index}`}>
                    <label htmlFor={`display-lot-${index}`}>Lot {index + 1}</label>
                    <input
                      id={`display-lot-${index}`}
                      type="number"
                      min="0"
                      step="any"
                      value={quantity}
                      onChange={(event) => updateDisplayLotInput(index, event.target.value)}
                      disabled={lotsBusy}
                    />
                    <button className="button" type="button" onClick={() => removeDisplayLotInput(index)} disabled={lotsBusy}>
                      Remove
                    </button>
                  </div>
                ))}
                <div className="display-lot-editor-total">
                  Total: {formatNumber(editedDisplayLotTotal, 6)} / {formatNumber(savedDisplayLotTotal, 6)} shares
                </div>
              </div>
            )}

            <div className="form-actions">
              {displayLotEntries.length > 0 ? (
                <>
                  <button
                    className="button"
                    type="button"
                    onClick={() => setDisplayLotInputs((previous) => [...previous, ''])}
                    disabled={lotsBusy}
                  >
                    Add Lot
                  </button>
                  <button className="button button-primary" type="button" onClick={onSaveDisplayLots} disabled={lotsBusy || !canSaveDisplayLots}>
                    {lotsBusy ? 'Saving...' : 'Save Display Lots'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showInitialPurchaseModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="initial-purchase-modal-title">
          <div className="modal-card">
            <div className="row-between">
              <h3 id="initial-purchase-modal-title">Initial Purchases — {ticker}</h3>
              <button className="button" type="button" onClick={() => setShowInitialPurchaseModal(false)} disabled={savingInitialPurchases}>
                Close
              </button>
            </div>
            <p>Select the buy transactions that should count as initial purchases, ordered oldest to newest.</p>

            {initialPurchaseError ? <div className="status status-error">{initialPurchaseError}</div> : null}

            {buyTransactionsAscending.length === 0 ? (
              <p>No buy transactions exist yet for {ticker}.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th>Initial Purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {buyTransactionsAscending.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{formatDate(transaction.transactionDate)}</td>
                      <td>{formatNumber(transaction.quantity, 6)}</td>
                      <td>{formatStockPrice4(transaction.price)}</td>
                      <td>{formatCurrency2(transaction.amount)}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(initialPurchaseSelections[transaction.id])}
                          onChange={() => toggleInitialPurchaseSelection(transaction.id)}
                          disabled={savingInitialPurchases}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="form-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={onSaveInitialPurchases}
                disabled={savingInitialPurchases || buyTransactionsAscending.length === 0}
              >
                {savingInitialPurchases ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Stock History Page</div>
    </section>
  )
}
