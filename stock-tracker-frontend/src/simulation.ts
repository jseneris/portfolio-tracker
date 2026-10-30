import type { CashTransaction, SimulationBar, SimulationPriceHistory, StockSplitEvent, StockTransaction, TickerPreference, UserTargetSettings } from './api'
import { BUY_TARGET_PRESETS } from './buyTargetPresets'
import { calculatePortfolioSnapshot, createSplitMultiplierResolver } from './portfolioSnapshot'
import { buildLatestBuyOrSellByTicker, calculateTickerTargets, getSplitAdjustedTargetBasePrice } from './targetPrices'

const DAY = 86400000
const EPSILON = 1e-6
export type SimulationName = 'Actual' | typeof BUY_TARGET_PRESETS[number]['name']
export type SimulationPoint = { date: string; values: Record<SimulationName, number> }
export type SimulationTrade = {
  date: string
  ticker: string
  action: 'buy' | 'sell' | 'buy-on-dip' | 'skip-both'
  quantity: number
  price: number
}
export type SimulationResult = {
  points: SimulationPoint[]
  scenarios: Array<{ name: SimulationName; cash: number; trades: SimulationTrade[] }>
  warnings: string[]
}
export type SimulationInput = {
  startDate: string
  endDate: string
  transactions: StockTransaction[]
  cashTransactions: CashTransaction[]
  splits: StockSplitEvent[]
  preferences: TickerPreference[]
  settings: UserTargetSettings
  bars: SimulationBar[]
  marketSplits?: SimulationPriceHistory['marketSplits']
}

type Lot = { quantity: number; cost: number }
type Holding = {
  lots: Lot[]
  dividendShares: number
  basePrice: number | null
  dipPrice: number | null
  restrictedUntil: string
}

function dateOnly(value: string) { return value.slice(0, 10) }
function shares(holding: Holding) {
  return holding.dividendShares + holding.lots.reduce((total, lot) => total + lot.quantity, 0)
}
function consume(lots: Lot[], quantity: number) {
  lots.sort((a, b) => a.quantity - b.quantity)
  let remaining = quantity
  for (const lot of lots) {
    const used = Math.min(remaining, lot.quantity)
    lot.quantity -= used
    remaining -= used
    if (remaining <= EPSILON) break
  }
  return lots.filter((lot) => lot.quantity > EPSILON)
}
function cashEffect(transaction: CashTransaction) {
  return Number(transaction.amount) * (transaction.type === 'deposit' || transaction.type === 'interest' ? 1 : -1)
}

export function getSimulationDateRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY)
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1))
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
  start.setUTCDate(Math.min(end.getUTCDate(), lastDay))
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
}

export function simulatePortfolio(input: SimulationInput): SimulationResult {
  const { startDate, endDate, cashTransactions, splits, settings, bars, preferences } = input
  if (![startDate, endDate].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date)
    || startDate > endDate || Date.parse(endDate) - Date.parse(startDate) > 400 * DAY) throw new Error('Invalid simulation date range (maximum 400 days).')
  if (!Number.isFinite(settings.basePurchaseSize) || settings.basePurchaseSize <= 0) throw new Error('Base Purchase Size must be positive.')
  if (bars.some((bar) => ![bar.open, bar.high, bar.low, bar.close].every((price) => Number.isFinite(price) && price > 0)
    || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close))) throw new Error('Invalid daily OHLC prices.')
  const marketSplits = input.marketSplits
  if (marketSplits) {
    const tickers = new Set(bars.map((bar) => bar.ticker))
    const recorded = splits.filter((split) => split.isActive !== false && tickers.has(split.ticker.toUpperCase())
      && dateOnly(split.splitDate) > startDate && dateOnly(split.splitDate) <= endDate)
      .map((split) => ({ ticker: split.ticker.toUpperCase(), date: dateOnly(split.splitDate), multiplier: split.multiplier }))
    const same = (a: typeof recorded[number], b: typeof recorded[number]) =>
      a.ticker === b.ticker && a.date === b.date && Math.abs(a.multiplier - b.multiplier) < 1e-8
    if (marketSplits.some((split) => !recorded.some((event) => same(split, event)))
      || recorded.some((split) => !marketSplits.some((event) => same(split, event)))) {
      throw new Error('Market split history does not match your active recorded splits for this period. Reconcile splits before simulating.')
    }
  }
  const transactions = [...input.transactions].sort((a, b) =>
    a.transactionDate.localeCompare(b.transactionDate) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id))
  if (transactions.some((tx) => dateOnly(tx.transactionDate) > startDate && dateOnly(tx.transactionDate) <= endDate
    && (tx.type === 'exchange' || tx.isExchangeGenerated))) {
    throw new Error('This period includes a stock exchange. Choose a start date after the exchange; hypothetical exchange conversion is not supported.')
  }
  const warnings = new Set<string>([
    'Starting display lots and costs are approximated from recorded buys and smallest-lot-first sales; historical manual lot edits and sale allocations are not available.',
    'Current Base Size, Base Purchase Size, Sale Target %, and Buy on Dip % apply throughout. Historical manual Buy on Dip flags and buying restrictions are not replayed.',
    'Recorded reinvested-dividend shares per actual share are applied to simulated holdings on the recorded date. Different eligibility/ex-dividend holdings can change real dividends.',
    'Cash may be negative. Borrowing interest, commissions, taxes, and slippage are excluded. Results are hypothetical, not guaranteed fills.',
  ])
  if (endDate > startDate && !bars.some((bar) => bar.date > startDate && bar.date <= endDate)) {
    warnings.add('No OHLC sessions after the starting date in this range. Prices carry forward and no simulated trades execute.')
  }
  const history = bars.map((bar) => ({
    ticker: bar.ticker, priceDate: bar.date, marketDate: bar.date, closePrice: bar.close, source: 'simulation-ohlc',
  }))
  const initial = calculatePortfolioSnapshot({
    stockTransactions: transactions, cashTransactions, historicalPrices: history, splitEvents: splits, snapshotDate: startDate,
  })
  if (initial.portfolioValue == null) throw new Error('A starting holding has no historical price. Simulation cannot value a partial portfolio.')
  for (const stock of initial.holdings) {
    if (splits.some((split) => split.isActive !== false && split.ticker.toUpperCase() === stock.ticker
      && stock.priceDate != null && dateOnly(split.splitDate) > stock.priceDate && dateOnly(split.splitDate) <= startDate)) {
      throw new Error(`${stock.ticker}: starting price precedes a split. A post-split price is required for valuation.`)
    }
  }
  const initialMultiplier = createSplitMultiplierResolver(splits, startDate)
  const latest = buildLatestBuyOrSellByTicker(transactions.filter((tx) => dateOnly(tx.transactionDate) <= startDate).reverse())
  const baseSizes = new Map(preferences.map((preference) => [preference.ticker.toUpperCase(), preference.baseSize]))
  if ([...baseSizes.values()].some((size) => !Number.isInteger(size) || size < 0)) throw new Error('Ticker Base Size must be a non-negative whole number.')
  const reconstructed = new Map<string, Lot[]>()
  for (const tx of transactions) {
    if (dateOnly(tx.transactionDate) > startDate) continue
    const ticker = tx.ticker.toUpperCase()
    const multiplier = initialMultiplier(ticker, dateOnly(tx.transactionDate))
    const lots = reconstructed.get(ticker) ?? []
    if (tx.type === 'buy' && Number(tx.quantity) > 0) {
      lots.push({ quantity: Number(tx.quantity) * multiplier, cost: Number(tx.price) / multiplier })
      reconstructed.set(ticker, lots)
    } else if (tx.type === 'sell' || tx.type === 'exchange') {
      reconstructed.set(ticker, consume(lots, Number(tx.type === 'exchange' ? tx.exchangeSourceQuantity : tx.quantity) * multiplier))
    }
  }
  const initialHoldings = new Map<string, Holding>()
  for (const stock of initial.holdings) {
    let lots = reconstructed.get(stock.ticker) ?? []
    const lotShares = lots.reduce((total, lot) => total + lot.quantity, 0)
    if (lotShares > stock.totalShares + EPSILON) lots = consume(lots, lotShares - stock.totalShares)
    const basePrice = getSplitAdjustedTargetBasePrice(latest.get(stock.ticker), splits, startDate)
    if (basePrice == null) throw new Error(`${stock.ticker}: no valid starting buy/sell anchor for target calculation.`)
    initialHoldings.set(stock.ticker, {
      lots,
      dividendShares: Math.max(0, stock.totalShares - lots.reduce((total, lot) => total + lot.quantity, 0)),
      basePrice,
      dipPrice: lots.length < (baseSizes.get(stock.ticker) ?? 3) ? basePrice : null,
      restrictedUntil: '',
    })
  }
  if (!initialHoldings.size) throw new Error('No holdings at the selected starting date. Choose a start date with an existing portfolio.')
  const dividendRates = new Map<string, number>()
  for (let index = 0; index < transactions.length; index += 1) {
    const tx = transactions[index]
    if (tx.type !== 'div' || dateOnly(tx.transactionDate) <= startDate || dateOnly(tx.transactionDate) > endDate) continue
    const prior = calculatePortfolioSnapshot({
      stockTransactions: transactions.slice(0, index), cashTransactions: [],
      historicalPrices: [], splitEvents: splits, snapshotDate: dateOnly(tx.transactionDate),
    }).holdings.find((stock) => stock.ticker === tx.ticker.toUpperCase())?.totalShares
    if (!prior || prior <= 0) {
      warnings.add(`${tx.ticker}: a dividend has no reconstructable prior share balance and is omitted from simulated dividends.`)
    } else {
      dividendRates.set(tx.id, Number(tx.quantity) / prior)
    }
  }
  const states = BUY_TARGET_PRESETS.map((preset) => ({
    name: preset.name,
    settings: {
      ...settings, buyTargetPercentAtBaseSize: preset.percentages[0], buyTargetPercentBasePlus1: preset.percentages[1],
      buyTargetPercentBasePlus2: preset.percentages[2], buyTargetPercentBasePlus3OrMore: preset.percentages[3],
    },
    holdings: new Map([...initialHoldings].map(([ticker, holding]) => [ticker, {
      ...holding, lots: holding.lots.map((lot) => ({ ...lot })),
    }])),
    cash: initial.availableCash,
    trades: [] as SimulationTrade[],
  }))
  const prices = new Map<string, number>()
  for (const bar of [...bars].sort((a, b) => a.date.localeCompare(b.date))) {
    if (bar.date <= startDate) prices.set(bar.ticker, bar.close)
  }
  const byDate = new Map<string, Map<string, SimulationBar>>()
  for (const bar of bars) {
    const rows = byDate.get(bar.date) ?? new Map<string, SimulationBar>()
    rows.set(bar.ticker, bar)
    byDate.set(bar.date, rows)
  }
  for (const split of splits) {
    const date = dateOnly(split.splitDate)
    const ticker = split.ticker.toUpperCase()
    if (split.isActive !== false && date > startDate && date <= endDate && initialHoldings.has(ticker)
      && !byDate.get(date)?.has(ticker)) {
      throw new Error(`${ticker}: missing OHLC on split date ${date}; cannot carry a pre-split nominal price into post-split valuation.`)
    }
  }
  const points: SimulationPoint[] = []
  let finalActualCash = initial.availableCash
  for (let timestamp = Date.parse(startDate); timestamp <= Date.parse(endDate); timestamp += DAY) {
    const date = new Date(timestamp).toISOString().slice(0, 10)
    const dailyBars = byDate.get(date) ?? new Map<string, SimulationBar>()
    for (const [ticker, bar] of dailyBars) prices.set(ticker, bar.close)
    for (const state of states) {
      if (date > startDate) {
        state.cash += cashTransactions.filter((tx) => dateOnly(tx.transactionDate) === date).reduce((total, tx) => total + cashEffect(tx), 0)
        for (const split of splits.filter((event) => event.isActive !== false && dateOnly(event.splitDate) === date)) {
          const holding = state.holdings.get(split.ticker.toUpperCase())
          if (!holding) continue
          for (const lot of holding.lots) { lot.quantity *= split.multiplier; lot.cost /= split.multiplier }
          holding.dividendShares *= split.multiplier
          if (holding.basePrice != null) holding.basePrice /= split.multiplier
          if (holding.dipPrice != null) holding.dipPrice /= split.multiplier
        }
        for (const tx of transactions.filter((event) => event.type === 'div' && dateOnly(event.transactionDate) === date)) {
          const holding = state.holdings.get(tx.ticker.toUpperCase())
          const rate = dividendRates.get(tx.id)
          if (holding && rate != null) holding.dividendShares += shares(holding) * rate
        }
        for (const [ticker, holding] of state.holdings) {
          const bar = dailyBars.get(ticker)
          if (!bar || shares(holding) <= EPSILON || holding.basePrice == null) continue
          const baseSize = baseSizes.get(ticker) ?? 3
          if (holding.lots.length < baseSize && holding.dipPrice == null) holding.dipPrice = holding.basePrice
          const targets = calculateTickerTargets(holding.basePrice, holding.lots.length, state.settings, {
            ticker, baseSize, buyOnDip: holding.dipPrice != null, buyOnDipPrice: holding.dipPrice,
            buyRestricted: false, buyRestrictedUntil: null, isBuyRestricted: false, restrictionSalePrice: null,
          })
          if (targets.buy != null) targets.buy = Number(targets.buy.toFixed(8))
          if (targets.sell != null) targets.sell = Number(targets.sell.toFixed(8))
          const buyHit = targets.buy != null && targets.buy > 0 && bar.low <= targets.buy
          const sellHit = targets.sell != null && bar.high >= targets.sell
          if (buyHit && sellHit) {
            state.trades.push({ date, ticker, action: 'skip-both', quantity: 0, price: bar.close })
            continue
          }
          if (sellHit && targets.sell != null) {
            const price = Math.max(bar.open, targets.sell)
            if (holding.lots.length <= baseSize) {
              if (holding.dipPrice == null) {
                holding.dipPrice = price
                state.trades.push({ date, ticker, action: 'buy-on-dip', quantity: 0, price })
              }
            } else {
              holding.lots.sort((a, b) => a.quantity - b.quantity)
              const lot = holding.lots.shift()
              if (!lot) throw new Error(`${ticker}: no display lot available for simulated sale.`)
              state.cash += lot.quantity * price
              holding.basePrice = price
              holding.dipPrice = null
              if (price < lot.cost) holding.restrictedUntil = new Date(timestamp + 31 * DAY).toISOString().slice(0, 10)
              state.trades.push({ date, ticker, action: 'sell', quantity: lot.quantity, price })
            }
          } else if (buyHit && targets.buy != null && (!holding.restrictedUntil || date > holding.restrictedUntil)) {
            const price = Math.min(bar.open, targets.buy)
            const quantity = Math.max(1, Math.ceil(settings.basePurchaseSize / price))
            state.cash -= quantity * price
            holding.lots.push({ quantity, cost: price })
            holding.basePrice = price
            holding.dipPrice = null
            state.trades.push({ date, ticker, action: 'buy', quantity, price })
          }
        }
      }
    }
    const actual = calculatePortfolioSnapshot({
      stockTransactions: transactions, cashTransactions, historicalPrices: history, splitEvents: splits, snapshotDate: date,
    })
    if (actual.portfolioValue == null) throw new Error(`${date}: actual holdings have missing historical prices; comparison cannot be calculated.`)
    if (actual.holdings.some((stock) => splits.some((split) => split.isActive !== false
      && split.ticker.toUpperCase() === stock.ticker && stock.priceDate != null
      && dateOnly(split.splitDate) > stock.priceDate && dateOnly(split.splitDate) <= date))) {
      throw new Error(`${date}: a holding has only a pre-split price; cannot value post-split shares.`)
    }
    finalActualCash = actual.availableCash
    const values: Record<SimulationName, number> = {
      Actual: actual.portfolioValue, Aggressive: 0, Base: 0, Scared: 0, Fearful: 0,
    }
    for (const state of states) {
      let total = state.cash
      for (const [ticker, holding] of state.holdings) {
        const price = prices.get(ticker)
        if (price == null) throw new Error(`${ticker}: missing price for simulation valuation.`)
        total += shares(holding) * price
        if (date > startDate && dailyBars.size > 0 && !dailyBars.has(ticker)) {
          warnings.add(`${ticker}: some sessions have no OHLC bar; those trades are skipped and valuation carries forward the last available close.`)
        }
      }
      values[state.name] = total
    }
    points.push({ date, values })
  }
  if (transactions.some((tx) => dateOnly(tx.transactionDate) > startDate && tx.type === 'buy'
    && !initialHoldings.has(tx.ticker.toUpperCase()))) {
    warnings.add('Actual purchases of new tickers after the start are not copied into simulations; simulated trades cover starting holdings only.')
  }
  return {
    points, warnings: [...warnings],
    scenarios: [{ name: 'Actual', cash: finalActualCash, trades: [] }, ...states.map((state) => ({
      name: state.name, cash: state.cash, trades: state.trades,
    }))],
  }
}
