import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CreateStockInput,
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
} from '../api'

const DEFAULT_SALE_TARGET_PERCENT = 10
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25

function formatMoney(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) {
    return '--'
  }
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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
  return value.toFixed(6)
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return 'Never'
  }
  return value.toLocaleString()
}

function buildLatestHistoricalPriceByTicker(rows: Array<{ ticker: string; priceDate: string; closePrice: number }>): Record<string, number> {
  const latestByTicker: Record<string, { date: string; price: number }> = {}

  for (const row of rows) {
    const ticker = String(row.ticker || '').toUpperCase()
    const priceDate = String(row.priceDate || '')
    const closePrice = Number(row.closePrice)

    if (!ticker || !priceDate || !Number.isFinite(closePrice)) {
      continue
    }

    const existing = latestByTicker[ticker]
    if (!existing || priceDate > existing.date) {
      latestByTicker[ticker] = { date: priceDate, price: closePrice }
    }
  }

  const flattened: Record<string, number> = {}
  for (const [ticker, row] of Object.entries(latestByTicker)) {
    flattened[ticker] = row.price
  }
  return flattened
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

export default function DashboardPage() {
  const [data, setData] = useState<PortfolioSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addStockError, setAddStockError] = useState<string | null>(null)
  const [addStockSaving, setAddStockSaving] = useState(false)
  const [showAddStockModal, setShowAddStockModal] = useState(false)
  const [addStockForm, setAddStockForm] = useState<AddStockFormState>(EMPTY_ADD_STOCK_FORM)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [saleTargetsByTicker, setSaleTargetsByTicker] = useState<Record<string, number | null>>({})
  const [buyTargetsByTicker, setBuyTargetsByTicker] = useState<Record<string, number | null>>({})

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

  const [holdingsMarketValue, setHoldingsMarketValue] = useState<number | null>(null)
  const [stockCostBasisExcludingDividends, setStockCostBasisExcludingDividends] = useState<number | null>(null)
  const [stockPerformance, setStockPerformance] = useState<number | null>(null)

  const cashBasisExcludingDividends = data
    ? Number(data.deposits || 0) - Number(data.withdrawals || 0)
    : null

  const hasInsufficientCashForBuy = Boolean(
    data && Number.isFinite(buyTotalCost) && buyTotalCost > Number(data.availableCash)
  )

  async function loadSummary(backgroundRefresh = false) {
    if (backgroundRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const today = new Date().toISOString().slice(0, 10)
      const [summary, transactionsResult, settingsResult, displayLotsResult, purchaseLotsResult, historicalPricesResult] = await Promise.all([
        getPortfolioSummary(),
        getStockTransactions(),
        getUserTargetSettings(),
        getDisplayLots(),
        getPurchaseLots(),
        getHistoricalPrices('1980-01-01', today),
      ])

      const normalizedSettings = normalizeSettings(settingsResult)
      const latestByTicker = buildLatestBuyOrSellByTicker(transactionsResult)
      const displayLotCountsByTicker: Record<string, number> = {}
      for (const lot of displayLotsResult) {
        const ticker = String(lot.ticker || '').toUpperCase()
        if (!ticker) {
          continue
        }
        displayLotCountsByTicker[ticker] = Number(displayLotCountsByTicker[ticker] || 0) + 1
      }

      setData(summary)
      setSaleTargetsByTicker(calculateSaleTargetsByTicker(summary, latestByTicker, normalizedSettings.saleTargetPercent))
      setBuyTargetsByTicker(calculateBuyTargetsByTicker(summary, latestByTicker, displayLotCountsByTicker, normalizedSettings))

      const latestHistoricalPriceByTicker = buildLatestHistoricalPriceByTicker(historicalPricesResult)
      const nextHoldingsMarketValue = calculateHoldingsMarketValue(summary, latestHistoricalPriceByTicker)
      const nextStockCostBasisExcludingDividends = calculateStockCostBasisExcludingDividends(purchaseLotsResult)
      const nextStockPerformance = nextHoldingsMarketValue == null
        ? null
        : nextHoldingsMarketValue - nextStockCostBasisExcludingDividends

      setHoldingsMarketValue(nextHoldingsMarketValue)
      setStockCostBasisExcludingDividends(nextStockCostBasisExcludingDividends)
      setStockPerformance(nextStockPerformance)

      setLastUpdatedAt(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load summary')
    } finally {
      setLoading(false)
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
              <div className="stat"><div className="label">Cash Basis</div><div className="value">{formatMoney(cashBasisExcludingDividends)}</div></div>
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
        `Insufficient available cash. Buy requires ${formatMoney(buyCost)} but only ${formatMoney(availableCash)} is available.`
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
          <p>Portfolio summary from a single backend endpoint. Refreshes after cash and stock mutations.</p>
        </div>
        <div className="stack-right">
          <div className="inline-actions">
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

      {loading ? (
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

      {!loading && data ? (
        <>
          <div className="panel stat-grid">
            <div className="stat"><div className="label">Available Cash</div><div className="value">{formatMoney(data.availableCash)}</div></div>
            <div className="stat"><div className="label">Cash Basis</div><div className="value">{formatMoney(data.cashBasis)}</div></div>
            <div className="stat"><div className="label">Holdings Market Value</div><div className="value">{formatMoney(holdingsMarketValue)}</div></div>
            <div className="stat"><div className="label">Performance</div><div className="value">{formatMoney(stockPerformance)}</div></div>
            <div className="stat"><div className="label">Adjustments</div><div className="value">{formatMoney(data.adjustments)}</div></div>
            <div className="stat"><div className="label">Stock Cost Basis (No Div)</div><div className="value">{formatMoney(stockCostBasisExcludingDividends)}</div></div>
            <div className="stat"><div className="label">Stock Count</div><div className="value">{data.stockCount}</div></div>
          </div>

          <div className="panel">
            <h3>Holdings</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Total Shares</th>
                  <th>Cost Basis</th>
                  <th>Buy Target</th>
                  <th>Sale Target</th>
                  <th>Lots</th>
                </tr>
              </thead>
              <tbody>
                {data.stocks.map((row) => (
                  <tr key={row.ticker}>
                    <td>
                      <Link className="link-button" to={`/stocks/${encodeURIComponent(row.ticker)}`}>
                        {row.ticker}
                      </Link>
                    </td>
                    <td>{formatShares(row.totalShares)}</td>
                    <td>{formatMoney(row.costBasis)}</td>
                    <td>{formatMoney(buyTargetsByTicker[row.ticker] ?? null)}</td>
                    <td>{formatMoney(saleTargetsByTicker[row.ticker] ?? null)}</td>
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
                Insufficient available cash. Buy requires {formatMoney(buyTotalCost)} and available cash is {formatMoney(Number(data?.availableCash || 0))}.
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
