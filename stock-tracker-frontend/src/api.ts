const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'dev-user'

export type CashTransactionType = 'deposit' | 'withdrawal' | 'interest' | 'fee'
export type StockTransactionType = 'buy' | 'sell' | 'div'

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

export type StockTransaction = {
  id: string
  userId: string
  ticker: string
  type: StockTransactionType
  quantity: number | null
  price: number | null
  amount: number | null
  transactionDate: string
  createdAt?: string
  updatedAt?: string
}

export type TickerSummary = {
  ticker: string
  totalShares: number
  numberOfLots: number
  costBasis: number
}

export type Lot = {
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

export type CreateCashInput = {
  type: CashTransactionType
  amount: number
  transactionDate: string
}

export type UpdateCashInput = CreateCashInput

export type CreateStockInput = {
  ticker: string
  type: StockTransactionType
  quantity?: number
  price?: number
  transactionDate: string
  allocations?: AllocationInput[]
}

export type UpdateStockInput = {
  ticker: string
  type: StockTransactionType
  quantity?: number
  price?: number
  transactionDate: string
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

type RequestOptions = {
  method?: RequestMethod
  body?: unknown
}

function getDefaultHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-user-id': DEV_USER_ID,
  }
}

async function requestApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: getDefaultHeaders(),
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

export async function updateCashTransaction(id: string, payload: UpdateCashInput): Promise<CashTransaction> {
  return requestApi<CashTransaction>(`/api/cash/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteCashTransaction(id: string): Promise<void> {
  return requestApi<void>(`/api/cash/${id}`, { method: 'DELETE' })
}

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

export async function updateStockTransaction(id: string, payload: UpdateStockInput): Promise<StockTransaction> {
  return requestApi<StockTransaction>(`/api/stocks/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteStockTransaction(id: string): Promise<void> {
  return requestApi<void>(`/api/stocks/${id}`, { method: 'DELETE' })
}

export async function getLots(): Promise<Lot[]> {
  return requestApi<Lot[]>('/api/lots')
}

export async function getLotsByTicker(ticker: string, sourceType?: string): Promise<Lot[]> {
  const query = sourceType ? `?sourceType=${encodeURIComponent(sourceType)}` : ''
  return requestApi<Lot[]>(`/api/lots/${encodeURIComponent(ticker)}${query}`)
}

export async function updateLotRemainingQuantity(id: string, remainingQuantity: number): Promise<{ id: string; remainingQuantity: number }> {
  return requestApi<{ id: string; remainingQuantity: number }>(`/api/lots/${id}`, {
    method: 'PUT',
    body: { remainingQuantity },
  })
}
