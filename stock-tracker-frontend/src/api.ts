import { getRequestHeaders } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
export const PORTFOLIO_UPDATED_EVENT = 'portfolio:updated'

export function emitPortfolioUpdated() {
  window.dispatchEvent(new Event(PORTFOLIO_UPDATED_EVENT))
}

// ============================================================================
// Enums & Basic Types
// ============================================================================

export type CashTransactionType = 'deposit' | 'withdrawal' | 'interest' | 'fee'
export type StockTransactionType = 'buy' | 'sell' | 'div' | 'exchange'

// ============================================================================
// Cash Types
// ============================================================================

export type CashTransaction = {
  id: string
  userId: string
  type: CashTransactionType
  amount: number
  transactionDate: string
  createdAt?: string
  updatedAt?: string
}

export type CashSummary = {
  deposits: number
  withdrawals: number
  interest: number
  fees: number
  buys: number
  sells: number
  availableCash: number
  costBasis: number
  adjustments: number
}

export type CreateCashInput = {
  type: CashTransactionType
  amount: number
  transactionDate: string
}

// ============================================================================
// Stock & Portfolio Types
// ============================================================================

export type StockTransaction = {
  id: string
  userId: string
  ticker: string
  type: StockTransactionType
  quantity: number | null
  price: number | null
  amount: number | null
  transactionDate: string
  isDeletionLocked?: boolean
  exchangeSourceQuantity?: number
  createdAt?: string
  updatedAt?: string
}

export type TickerSummary = {
  ticker: string
  totalShares: number
  numberOfLots: number
  costBasis: number
}

export type PortfolioSummary = {
  deposits: number
  withdrawals: number
  interest: number
  fees: number
  buys: number
  sells: number
  availableCash: number
  cashBasis: number
  adjustments: number
  totalStockCostBasis: number
  stockCount: number
  stocks: Array<{
    ticker: string
    totalShares: number
    costBasis: number
    lotCount: number
  }>
}

export type AllocationInput = {
  lotId: string
  quantity: number
}

export type SaleAllocation = {
  lotId: string
  quantity: number
  ticker: string
  sourceType: 'purchase' | 'dividend'
  purchaseDate: string
  unitCost: number
}

export type CreateStockInput = {
  ticker: string
  type: StockTransactionType
  quantity?: number
  price?: number
  amount?: number
  transactionDate: string
  allocations?: AllocationInput[]
  newTicker?: string
  exchangeRate?: number
}

// ============================================================================
// Purchase Lot Types (Source Lots - Auto-Created from Transactions)
// ============================================================================

export type PurchaseLot = {
  id: string
  userId: string
  ticker: string
  transactionId: string
  sourceType: 'purchase' | 'dividend'
  originalQuantity: number
  remainingQuantity: number
  unitCost: number
  purchaseDate: string
  createdAt?: string
  updatedAt?: string
}

// ============================================================================
// Display Lot Types (User-Created Organizational Groupings)
// ============================================================================

export type DisplayLot = {
  id: string
  userId: string
  ticker: string
  lots: number[]
  lotCount: number
  totalQuantity: number
  createdAt: string
  updatedAt: string
}

export type DisplayLotComposition = {
  id: string
  index: number
  quantityAllocated: number
  ticker: string
}

export type CreateDisplayLotInput = {
  quantities: number[]
}

export type SplitDisplayLotInput = {
  index: number
  quantities: number[]
}

export type CreateDisplayLotResponse = {
  id: string
  ticker: string
  lotCount: number
  totalQuantity: number
}

export type CombineDisplayLotsResponse = {
  id: string
  ticker: string
  lotCount: number
  totalQuantity: number
  combinedIndices: number[]
}

export type SplitDisplayLotResponse = {
  id: string
  ticker: string
  lotCount: number
  totalQuantity: number
  splitIndex: number
}

// ============================================================================
// Stock Split Types
// ============================================================================

export type RecordStockSplitResponse = {
  splitId: string
  message: string
  ticker: string
  ratioNumerator: number
  ratioDenominator: number
  multiplier: number
  isActive: boolean
  canActivate: boolean
}

export type ActivateStockSplitResponse = RecordStockSplitResponse

export type StockSplitEvent = {
  id: string
  ticker: string
  ratioNumerator: number
  ratioDenominator: number
  multiplier: number
  splitDate: string
  createdAt?: string
  isActive?: boolean
  canActivate?: boolean
}

export type HistoricalPrice = {
  ticker: string
  priceDate: string
  marketDate: string
  closePrice: number
  source: string
  createdAt?: string
  updatedAt?: string
}

export type CurrentPrice = {
  ticker: string
  price: number
  source: string
  asOf: string
}

export type CurrentPricesResponse = {
  source: string
  prices: CurrentPrice[]
  missingTickers: string[]
}

export type SyncHistoricalPricesResponse = {
  source: string
  targetEndDate: string
  requestedDates: string[]
  syncedDates?: string[]
  remainingDates?: number
  tickers: string[]
  storedRows: number
  missingPrices: Array<{ ticker: string; priceDate: string }>
  splitCheckPerformed?: boolean
  splitTickersChecked?: number
  splitsDiscovered?: number
  splitsInserted?: number
}

export type PortfolioComparisonPoint = {
  date: string
  hasCashFlowEvent: boolean
  availableCash: number
  cashCostBasis: number
  stockValue: number
  portfolioValue: number
  dowBenchmarkValue: number
  dowBenchmarkShares: number
  nasdaqBenchmarkValue: number
  nasdaqBenchmarkShares: number
  sp500BenchmarkValue: number
  sp500BenchmarkShares: number
  missingTickers: string[]
}

export type PortfolioComparisonResponse = {
  source: string
  points: PortfolioComparisonPoint[]
}

export type PortfolioComparisonAllResponse = PortfolioComparisonResponse

export type UserTargetSettings = {
  saleTargetPercent: number
  buyTargetPercentUnder3DisplayLots: number
  buyTargetPercentFor3DisplayLots: number
  buyTargetPercentFor4DisplayLots: number
  buyTargetPercentFor5DisplayLots: number
  buyTargetPercentFor6OrMoreDisplayLots: number
}

// ============================================================================
// Internal Request Helpers
// ============================================================================

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

type RequestOptions = {
  method?: RequestMethod
  body?: unknown
}

function getDefaultHeaders() {
  return {
    'Content-Type': 'application/json',
  }
}

async function requestApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options
  const authHeaders = await getRequestHeaders()

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...getDefaultHeaders(),
      ...authHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    let details = ''
    try {
      const errorPayload = (await response.json()) as { error?: string }
      details = errorPayload.error ? `: ${errorPayload.error}` : ''
    } catch {
      details = ''
    }

    throw new Error(`Request failed (${response.status})${details}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

// ============================================================================
// Cash API
// ============================================================================

// ============================================================================
// Cash API
// ============================================================================

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  return requestApi<PortfolioSummary>('/api/stocks/portfolio/summary')
}

export async function getCashTransactions(): Promise<CashTransaction[]> {
  return requestApi<CashTransaction[]>('/api/cash')
}

export async function getCashSummary(): Promise<CashSummary> {
  return requestApi<CashSummary>('/api/cash/summary')
}

export async function createCashTransaction(payload: CreateCashInput): Promise<CashTransaction> {
  return requestApi<CashTransaction>('/api/cash', {
    method: 'POST',
    body: payload,
  })
}

export async function deleteCashTransaction(id: string): Promise<void> {
  return requestApi<void>(`/api/cash/${id}`, { method: 'DELETE' })
}

// ============================================================================
// Stock Transactions API
// ============================================================================

export async function getStockTransactions(): Promise<StockTransaction[]> {
  return requestApi<StockTransaction[]>('/api/stocks')
}

export async function getStockTransactionsByTicker(ticker: string): Promise<StockTransaction[]> {
  return requestApi<StockTransaction[]>(`/api/stocks/${encodeURIComponent(ticker)}`)
}

export async function getStockSummaryByTicker(ticker: string): Promise<TickerSummary> {
  return requestApi<TickerSummary>(`/api/stocks/${encodeURIComponent(ticker)}/summary`)
}

export async function createStockTransaction(payload: CreateStockInput): Promise<StockTransaction> {
  return requestApi<StockTransaction>('/api/stocks', {
    method: 'POST',
    body: payload,
  })
}

export async function deleteStockTransaction(id: string): Promise<void> {
  return requestApi<void>(`/api/stocks/${id}`, { method: 'DELETE' })
}

export async function getSaleAllocations(transactionId: string): Promise<SaleAllocation[]> {
  return requestApi<SaleAllocation[]>(`/api/stocks/${transactionId}/allocations`)
}

export async function getSaleAllocationsByTransactionIds(transactionIds: string[]): Promise<Record<string, SaleAllocation[]>> {
  if (transactionIds.length === 0) {
    return {}
  }

  return requestApi<Record<string, SaleAllocation[]>>('/api/stocks/allocations/batch', {
    method: 'POST',
    body: { transactionIds },
  })
}

export async function recordStockSplit(
  ticker: string,
  numerator: number,
  denominator: number,
  splitDate?: string
): Promise<RecordStockSplitResponse> {
  return requestApi<RecordStockSplitResponse>(`/api/lots/ticker/${encodeURIComponent(ticker)}/split`, {
    method: 'POST',
    body: {
      ratioNumerator: numerator,
      ratioDenominator: denominator,
      splitDate,
    },
  })
}

export async function getStockSplitsByTicker(ticker: string): Promise<StockSplitEvent[]> {
  return requestApi<StockSplitEvent[]>(`/api/lots/ticker/${encodeURIComponent(ticker)}/splits`)
}

export async function getAllStockSplits(): Promise<StockSplitEvent[]> {
  return requestApi<StockSplitEvent[]>('/api/lots/splits')
}

export async function getCurrentPrices(tickers: string[]): Promise<CurrentPricesResponse> {
  return requestApi<CurrentPricesResponse>('/api/stocks/current-prices', {
    method: 'POST',
    body: { tickers },
  })
}

export async function activateStockSplit(splitId: string): Promise<ActivateStockSplitResponse> {
  return requestApi<ActivateStockSplitResponse>(`/api/lots/splits/${encodeURIComponent(splitId)}/activate`, {
    method: 'POST',
  })
}

export async function syncHistoricalPricesByYear(year: number): Promise<SyncHistoricalPricesResponse> {
  return requestApi<SyncHistoricalPricesResponse>(`/api/stocks/historical-prices/sync-year?year=${encodeURIComponent(String(year))}`, {
    method: 'POST',
  })
}

export async function getHistoricalPrices(
  startDate = '2021-01-01',
  endDate = '2021-12-31',
  tickers: string[] = []
): Promise<HistoricalPrice[]> {
  const tickerQuery = tickers.length > 0
    ? `&tickers=${encodeURIComponent(tickers.join(','))}`
    : ''

  return requestApi<HistoricalPrice[]>(
    `/api/stocks/historical-prices?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}${tickerQuery}`
  )
}

export async function getPortfolioComparisonAll(): Promise<PortfolioComparisonAllResponse> {
  return requestApi<PortfolioComparisonAllResponse>('/api/stocks/portfolio/comparison-all')
}

export async function getPortfolioComparisonByYear(year: number): Promise<PortfolioComparisonResponse> {
  return requestApi<PortfolioComparisonResponse>(`/api/stocks/historical-prices?year=${encodeURIComponent(String(year))}`)
}

export async function getUserTargetSettings(): Promise<UserTargetSettings> {
  return requestApi<UserTargetSettings>('/api/user-settings/targets')
}

export async function updateUserTargetSettings(payload: UserTargetSettings): Promise<UserTargetSettings> {
  return requestApi<UserTargetSettings>('/api/user-settings/targets', {
    method: 'PUT',
    body: payload,
  })
}

// ============================================================================
// Purchase Lot API (Source Lots - Auto-Created from Transactions)
// ============================================================================

export async function getPurchaseLots(): Promise<PurchaseLot[]> {
  return requestApi<PurchaseLot[]>('/api/lots')
}

export async function getPurchaseLotsByTicker(ticker: string): Promise<PurchaseLot[]> {
  return requestApi<PurchaseLot[]>(`/api/lots/${encodeURIComponent(ticker)}`)
}

export async function getOpenPurchaseLots(ticker: string, asOfDate?: string): Promise<PurchaseLot[]> {
  const query = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : ''
  return requestApi<PurchaseLot[]>(`/api/lots/${encodeURIComponent(ticker)}/open${query}`)
}

// ============================================================================
// Display Lot API (User-Created Organizational Groupings)
// ============================================================================

export async function getDisplayLots(): Promise<DisplayLot[]> {
  return requestApi<DisplayLot[]>('/api/display-lots')
}

export async function getDisplayLotsByTicker(ticker: string): Promise<DisplayLot[]> {
  return requestApi<DisplayLot[]>(`/api/display-lots/ticker/${encodeURIComponent(ticker)}`)
}

export async function getDisplayLotComposition(displayLotId: string): Promise<DisplayLotComposition[]> {
  return requestApi<DisplayLotComposition[]>(`/api/display-lots/${displayLotId}/composition`)
}

export async function createDisplayLot(
  ticker: string,
  payload: CreateDisplayLotInput
): Promise<CreateDisplayLotResponse> {
  return requestApi<CreateDisplayLotResponse>(`/api/display-lots/${encodeURIComponent(ticker)}`, {
    method: 'POST',
    body: payload,
  })
}

export async function combineDisplayLots(
  displayLotId: string,
  indices: number[]
): Promise<CombineDisplayLotsResponse> {
  return requestApi<CombineDisplayLotsResponse>(`/api/display-lots/${displayLotId}/combine`, {
    method: 'POST',
    body: { indices },
  })
}

export async function splitDisplayLot(
  displayLotId: string,
  payload: SplitDisplayLotInput
): Promise<SplitDisplayLotResponse> {
  return requestApi<SplitDisplayLotResponse>(`/api/display-lots/${displayLotId}/split`, {
    method: 'POST',
    body: payload,
  })
}

export async function deleteDisplayLot(displayLotId: string): Promise<void> {
  return requestApi<void>(`/api/display-lots/${displayLotId}`, {
    method: 'DELETE',
    body: { index: 0 },
  })
}

export async function deleteDisplayLotIndex(displayLotId: string, index: number): Promise<void> {
  return requestApi<void>(`/api/display-lots/${displayLotId}`, {
    method: 'DELETE',
    body: { index },
  })
}
