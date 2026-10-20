import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildRedGreenGeometry, formatNet, getRedGreenTicks, RedGreenChartView } from './RedGreenChart'

const points = [
  { date: '2026-01-05', up: 4, down: 1, unchanged: 0 },
  { date: '2026-01-06', up: 1, down: 3, unchanged: 1 },
  { date: '2026-01-07', up: 2, down: 2, unchanged: 0 },
]

describe('red/green chart', () => {
  it('plots green counts above and red counts below a shared zero midline', () => {
    const geometry = buildRedGreenGeometry(points)
    const midY = 18 + (360 - 18 - 56) / 2
    expect(geometry.maxCount).toBe(4)
    expect(geometry.greenY(points[0])).toBeCloseTo(18)
    expect(geometry.redY(points[1])).toBeCloseTo(midY + 3 * geometry.scale)
    expect(geometry.greenY(points[0])).toBeLessThan(midY)
    expect(geometry.redY(points[0])).toBeGreaterThan(midY)
  })

  it('closes each fill area back to the midline at both ends', () => {
    const { green, red } = buildRedGreenGeometry(points)
    for (const area of [green.area, red.area]) {
      expect(area).toMatch(/^M 60\.00 161\.00 L /)
      expect(area).toMatch(/L 904\.00 161\.00 Z$/)
    }
    expect(green.line.startsWith('M 60.00 18.00')).toBe(true)
  })

  it('uses whole-number, mirrored axis ticks', () => {
    expect(getRedGreenTicks(4)).toEqual([4, 2, 0, -2, -4])
    expect(getRedGreenTicks(3)).toEqual([3, 0, -3])
    expect(getRedGreenTicks(1)).toEqual([1, 0, -1])
  })

  it('plots the net difference (up minus down) on the same scale', () => {
    const geometry = buildRedGreenGeometry(points)
    const midY = 18 + (360 - 18 - 56) / 2
    expect(geometry.netY(points[0])).toBeCloseTo(midY - 3 * geometry.scale)
    expect(geometry.netY(points[1])).toBeCloseTo(midY + 2 * geometry.scale)
    expect(geometry.netY(points[2])).toBeCloseTo(midY)
    expect(geometry.net.line.split(' L ')).toHaveLength(3)
    expect(formatNet(3)).toBe('+3')
    expect(formatNet(-2)).toBe('-2')
    expect(formatNet(0)).toBe('0')
  })

  it('renders light green and light red fills with green and red lines', () => {
    const html = renderToStaticMarkup(createElement(RedGreenChartView, { points }))
    expect(html).toContain('fill="#16a34a" fill-opacity="0.18"')
    expect(html).toContain('fill="#dc2626" fill-opacity="0.18"')
    expect(html).toContain('<title>Stocks up</title>')
    expect(html).toContain('<title>Stocks down</title>')
    expect(html).toContain('<title>Net (up minus down)</title>')
    expect(html).toContain('stroke="#2563eb"')
    expect(html).toContain('Average up/down/net: 2.3 / 2.0 / +0.3')
    expect(html).toContain('Green days: 1 · Red days: 1 · Trading days: 3')
  })

  it('shows an empty-state message when there are no points', () => {
    expect(renderToStaticMarkup(createElement(RedGreenChartView, { points: [] }))).toContain('No daily closes for held stocks')
  })
})
