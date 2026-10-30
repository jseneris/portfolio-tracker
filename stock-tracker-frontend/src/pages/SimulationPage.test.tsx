import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SimulationPage, { loadSimulation, SimulationChart } from './SimulationPage'
import * as api from '../api'

vi.mock('../api', () => ({
  getStockTransactions: vi.fn(), getCashTransactions: vi.fn(), getAllStockSplits: vi.fn(),
  getTickerPreferences: vi.fn(), getUserTargetSettings: vi.fn(), getSimulationPrices: vi.fn(),
}))

describe('Simulation page', () => {
  it('renders the read-only date range controls and assumptions before loading', () => {
    const html = renderToStaticMarkup(createElement(SimulationPage))
    expect(html).toContain('Simulation')
    expect(html).toContain('Run Simulation')
    expect(html).toContain('does not save settings')
    expect(html.match(/type="date"/g)).toHaveLength(2)
  })

  it('renders five labeled chart paths with an accessible date inspector', () => {
    const html = renderToStaticMarkup(createElement(SimulationChart, { result: {
      points: [{ date: '2026-01-01', values: { Actual: 100, Aggressive: 102, Base: 101, Scared: 99, Fearful: 98 } }],
      scenarios: [], warnings: [],
    } }))
    expect(html.match(/<path /g)).toHaveLength(5)
    for (const name of ['Actual', 'Aggressive', 'Base', 'Scared', 'Fearful']) expect(html).toContain(`<title>${name}</title>`)
    expect(html).toContain('Inspect date')
    expect(html).not.toContain('NaN')
  })

  it('requests only starting holdings and tickers acquired during the period, not long-sold positions', async () => {
    vi.mocked(api.getStockTransactions).mockResolvedValue([
      { id: 'oldbuy', userId: 'u', ticker: 'OLD', type: 'buy', quantity: 1, price: 100, amount: 100, transactionDate: '2020-01-01' },
      { id: 'oldsell', userId: 'u', ticker: 'OLD', type: 'sell', quantity: 1, price: 100, amount: 100, transactionDate: '2020-01-02' },
      { id: 'buy', userId: 'u', ticker: 'AAA', type: 'buy', quantity: 1, price: 100, amount: 100, transactionDate: '2025-12-01' },
      { id: 'new', userId: 'u', ticker: 'NEW', type: 'buy', quantity: 1, price: 100, amount: 100, transactionDate: '2026-01-02' },
    ])
    vi.mocked(api.getCashTransactions).mockResolvedValue([])
    vi.mocked(api.getAllStockSplits).mockResolvedValue([])
    vi.mocked(api.getTickerPreferences).mockResolvedValue([])
    vi.mocked(api.getUserTargetSettings).mockResolvedValue({
      basePurchaseSize: 300, saleTargetPercent: 10, buyOnDipBuyTargetPercent: 1,
      buyTargetPercentAtBaseSize: 10, buyTargetPercentBasePlus1: 15, buyTargetPercentBasePlus2: 20, buyTargetPercentBasePlus3OrMore: 25,
    })
    vi.mocked(api.getSimulationPrices).mockRejectedValueOnce(new Error('Deliberate provider failure'))
    await expect(loadSimulation('2026-01-01', '2026-01-03')).rejects.toThrow('Deliberate provider failure')
    expect(api.getSimulationPrices).toHaveBeenCalledWith(['AAA', 'NEW'], '2026-01-01', '2026-01-03')
  })
})
