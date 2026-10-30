import { FormEvent, useEffect, useState } from 'react'
import {
  getAllStockSplits, getCashTransactions, getSimulationPrices, getStockTransactions,
  getTickerPreferences, getUserTargetSettings,
} from '../api'
import { formatCurrency2 } from '../formatters'
import { calculatePortfolioSnapshot } from '../portfolioSnapshot'
import { getSimulationDateRange, simulatePortfolio, type SimulationName, type SimulationResult } from '../simulation'

const SERIES: Array<{ name: SimulationName; color: string }> = [
  { name: 'Actual', color: '#0f172a' }, { name: 'Aggressive', color: '#dc2626' },
  { name: 'Base', color: '#2563eb' }, { name: 'Scared', color: '#9333ea' },
  { name: 'Fearful', color: '#15803d' },
]

export async function loadSimulation(startDate: string, endDate: string) {
  const [transactions, cashTransactions, splits, preferences, settings] = await Promise.all([
    getStockTransactions(), getCashTransactions(), getAllStockSplits(), getTickerPreferences(), getUserTargetSettings(),
  ])
  const initial = calculatePortfolioSnapshot({
    stockTransactions: transactions, cashTransactions, splitEvents: splits, historicalPrices: [], snapshotDate: startDate,
  })
  const tickers = [...new Set([
    ...initial.holdings.map((stock) => stock.ticker),
    ...transactions.filter((tx) => tx.transactionDate.slice(0, 10) > startDate && tx.transactionDate.slice(0, 10) <= endDate
      && (tx.type === 'buy' || tx.type === 'div')).map((tx) => tx.ticker.toUpperCase()),
  ])]
  if (!tickers.length) throw new Error('No recorded stocks in this period.')
  const history = await getSimulationPrices(tickers, startDate, endDate)
  const result = simulatePortfolio({ startDate, endDate, transactions, cashTransactions, splits, preferences, settings,
    bars: history.bars, marketSplits: history.marketSplits })
  return { ...result, warnings: [...history.warnings, ...result.warnings] }
}

export function SimulationChart({ result }: { result: SimulationResult }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [hidden, setHidden] = useState<SimulationName[]>([])
  const { points } = result
  if (!points.length) return <p>No simulation points.</p>
  const values = points.flatMap((point) => SERIES.filter((series) => !hidden.includes(series.name)).map((series) => point.values[series.name]))
  const low = values.reduce((minimum, value) => Math.min(minimum, value), Infinity)
  const high = values.reduce((maximum, value) => Math.max(maximum, value), -Infinity)
  const padding = Math.max(1, (high - low) * 0.1)
  const minimum = low - padding
  const maximum = high + padding
  const x = (index: number) => 100 + index / Math.max(1, points.length - 1) * 780
  const y = (value: number) => 20 + (maximum - value) / (maximum - minimum) * 280
  const active = points[Math.min(selected ?? points.length - 1, points.length - 1)]
  return <>
    <div className="comparison-legend">
      {SERIES.map((series) => <label key={series.name}>
        <input type="checkbox" checked={!hidden.includes(series.name)} onChange={() => setHidden((current) =>
          current.includes(series.name) ? current.filter((name) => name !== series.name)
            : current.length < SERIES.length - 1 ? [...current, series.name] : current)} />
        <i className="legend-dot" style={{ backgroundColor: series.color }} />{series.name}
      </label>)}
    </div>
    <div className="line-chart-viewport" tabIndex={0} role="region" aria-label="Simulation chart; scroll horizontally on smaller screens">
      <svg className="comparison-chart" viewBox="0 0 920 350" role="img"
        aria-label="Actual and four preset simulations: total portfolio value including cash"
        onMouseLeave={() => setSelected(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const plotX = (event.clientX - bounds.left) / bounds.width * 920
          setSelected(Math.round(Math.min(1, Math.max(0, (plotX - 100) / 780)) * (points.length - 1)))
        }}>
        {Array.from({ length: 5 }, (_, index) => {
          const value = minimum + (maximum - minimum) * index / 4
          return <g key={index}>
            <line x1="100" x2="880" y1={y(value)} y2={y(value)} stroke="#e2e8f0" />
            <text x="92" y={y(value) + 4} textAnchor="end" fontSize="11">{formatCurrency2(value)}</text>
          </g>
        })}
        {points.map((point, index) => index % Math.max(1, Math.ceil(points.length / 5)) === 0 || index === points.length - 1
          ? <text key={point.date} x={x(index)} y="326" fontSize="11" textAnchor={index === points.length - 1 ? 'end' : 'middle'}>{point.date}</text> : null)}
        {SERIES.filter((series) => !hidden.includes(series.name)).map((series) => (
          <path key={series.name} d={points.map((point, index) =>
            `${index ? 'L' : 'M'} ${x(index)} ${y(point.values[series.name])}`).join(' ')}
          fill="none" stroke={series.color} strokeWidth={series.name === 'Actual' ? 2.5 : 1.5}>
            <title>{series.name}</title>
          </path>
        ))}
        {selected != null ? <line x1={x(selected)} x2={x(selected)} y1="20" y2="300" stroke="#64748b" strokeDasharray="4" /> : null}
      </svg>
    </div>
    <label>Inspect date
      <select aria-label="Inspect date" value={active.date} onChange={(event) => setSelected(points.findIndex((point) => point.date === event.target.value))}>
        {points.map((point) => <option key={point.date} value={point.date}>{point.date}</option>)}
      </select>
    </label>
    <div className="comparison-legend" aria-live="polite">
      <strong>{active.date}</strong>
      {SERIES.map((series) => <span key={series.name}>{series.name}: {formatCurrency2(active.values[series.name])}</span>)}
    </div>
  </>
}

export default function SimulationPage() {
  const [range, setRange] = useState(() => getSimulationDateRange())
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState(range)
  const [tradeScenario, setTradeScenario] = useState<SimulationName>('Aggressive')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    setError(null)
    loadSimulation(request.startDate, request.endDate)
      .then((next) => { if (!cancelled) setResult(next) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to run simulation.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRequest({ ...range })
  }
  const first = result?.points[0]
  const last = result?.points[result.points.length - 1]
  const yesterday = getSimulationDateRange().endDate
  return <section>
    <div className="panel">
      <h2>Simulation</h2>
      <p>Actual total portfolio value, including cash, compared with each buy-target preset. Defaults to the last three months through yesterday; all lines start from the same portfolio at the starting close.</p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>Start date<input type="date" required value={range.startDate} max={range.endDate}
          onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} disabled={loading} /></label>
        <label>End date<input type="date" required value={range.endDate} min={range.startDate} max={yesterday}
          onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} disabled={loading} /></label>
        <div className="form-actions"><button className="button button-primary" disabled={loading}>
          {loading ? 'Simulating...' : 'Run Simulation'}
        </button></div>
      </form>
      <p className="hint">Read-only: does not save settings, enable actual Buy on Dip flags, place trades, or modify your portfolio.</p>
    </div>
    {error ? <div className="panel status status-error" role="alert">{error}</div> : null}
    {loading ? <div className="panel" role="status">Loading daily OHLC history and simulating all four presets...</div> : null}
    {result && first && last ? <>
      <div className="panel comparison-chart-panel">
        <h3>{first.date} through {last.date}</h3>
        <div className="comparison-chart-wrap"><SimulationChart result={result} /></div>
        <div className="table-scroll"><table className="table">
          <thead><tr><th>Scenario</th><th>Ending value</th><th>Vs actual</th><th>Ending cash</th><th>Buys</th><th>Sells</th><th>Buy on Dip</th><th>Both-hit days skipped</th></tr></thead>
          <tbody>{result.scenarios.map((scenario) => <tr key={scenario.name}>
            <td>{scenario.name}</td><td>{formatCurrency2(last.values[scenario.name])}</td>
            <td>{formatCurrency2(last.values[scenario.name] - last.values.Actual)}</td><td>{formatCurrency2(scenario.cash)}</td>
            {(['buy', 'sell', 'buy-on-dip', 'skip-both'] as const).map((action) => (
              <td key={action}>{scenario.name === 'Actual' ? '-' : scenario.trades.filter((trade) => trade.action === action).length}</td>
            ))}
          </tr>)}</tbody>
        </table></div>
      </div>
      <div className="panel">
        <h3>Rules and assumptions</h3>
        <p>Daily lows trigger buys; highs trigger sells. A ticker hitting both targets skips trading and trigger-time Buy on Dip changes for that day. Above base weight, sell the smallest display lot. At even weight or below, capture Buy on Dip instead of selling. Below-base holdings use Buy on Dip automatically. An active dip anchor stays fixed until a trade; its sell target is 10% above that anchor, matching the portfolio rule. Buys use the minimum whole shares reaching Base Purchase Size. One action per ticker per day; fill at the target, or the opening price if it gaps past the target.</p>
        <p>Actual stock trades are not copied into simulations. Recorded cash deposits, withdrawals, interest, and fees apply to all scenarios. Negative cash is allowed. Simulated loss sales block further buys through sale date plus 31 days. Weekends carry the last close; missing ticker bars do not execute trades.</p>
        <ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </div>
      <details className="panel">
        <summary>Simulated action log</summary>
        <label>Preset<select value={tradeScenario} onChange={(event) => {
          const scenario = result.scenarios.find((item) => item.name === event.target.value)
          if (scenario) setTradeScenario(scenario.name)
        }}>{SERIES.filter((series) => series.name !== 'Actual').map((series) => <option key={series.name}>{series.name}</option>)}</select></label>
        <div className="table-scroll"><table className="table">
          <thead><tr><th>Date</th><th>Ticker</th><th>Action</th><th>Shares</th><th>Price</th></tr></thead>
          <tbody>{result.scenarios.find((scenario) => scenario.name === tradeScenario)?.trades.map((trade, index) => <tr key={index}>
            <td>{trade.date}</td><td>{trade.ticker}</td><td>{trade.action}</td><td>{trade.quantity}</td><td>{formatCurrency2(trade.price)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </> : null}
  </section>
}
