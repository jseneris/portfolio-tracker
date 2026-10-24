import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PortfolioInsightsPage from './PortfolioInsightsPage'

describe('local AI chat page', () => {
  it('shows an availability indicator instead of a generate-review button', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('Checking AI availability...')
    expect(html).toContain('ai-status-light')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('Generate review')
    expect(html).not.toContain('Refresh review')
  })

  it('offers only chat, without calculated sections, assumptions controls, or Messages actions', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('<textarea')
    expect(html).toContain('maxLength="2000"')
    expect(html).toContain('Ask AI')
    expect(html).toContain('disabled=""')
    for (const text of ['Recommended lot amount', 'Largest concentrations', 'Loss Timing Review',
      'Distance from buy and sell targets', 'Send to Messages', 'Save and enable these assumptions']) {
      expect(html).not.toContain(text)
    }
  })

  it('explains fresh snapshot context, stored prices, and provider data sharing', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('fresh read-only snapshot')
    expect(html).toContain('not live quotes')
    expect(html).toContain('configured AI provider')
    expect(html).toContain('does not mean the AI runs offline')
  })
})
