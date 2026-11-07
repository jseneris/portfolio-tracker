import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PortfolioInsightsPage, { ChatResponseActions } from './PortfolioInsightsPage'

describe('local AI chat page', () => {
  it('shows an availability indicator instead of a generate-review button', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('Checking AI availability...')
    expect(html).toContain('ai-status-light')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('Generate review')
    expect(html).not.toContain('Refresh review')
  })

  it('offers only chat, without calculated sections or assumptions controls', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('<textarea')
    expect(html).toContain('maxLength="2000"')
    expect(html).toContain('Ask AI')
    expect(html).toContain('disabled=""')
    for (const text of ['Recommended lot amount', 'Largest concentrations', 'Loss Timing Review',
      'Distance from buy and sell targets', 'Save and enable these assumptions']) {
      expect(html).not.toContain(text)
    }
  })

  it('renders an enabled Send to Messages action for an unsaved answer', () => {
    const html = renderToStaticMarkup(createElement(ChatResponseActions, {
      saved: false, saving: false, onSend: () => undefined,
    }))
    expect(html).toContain('Send to Messages')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  it('disables the Send to Messages action while sending or after saving', () => {
    const saving = renderToStaticMarkup(createElement(ChatResponseActions, {
      saved: false, saving: true, onSend: () => undefined,
    }))
    expect(saving).toContain('Sending...')
    expect(saving).toContain('disabled')
    const saved = renderToStaticMarkup(createElement(ChatResponseActions, {
      saved: true, saving: false, onSend: () => undefined,
    }))
    expect(saved).toContain('Sent to Messages')
    expect(saved).toContain('disabled')
  })

  it('shows a send failure next to the affected answer', () => {
    const html = renderToStaticMarkup(createElement(ChatResponseActions, {
      saved: false, saving: false, error: 'Unable to send this response to Messages.', onSend: () => undefined,
    }))
    expect(html).toContain('Unable to send this response to Messages.')
    expect(html).toContain('role="alert"')
  })

  it('explains fresh snapshot context, stored prices, and provider data sharing', () => {
    const html = renderToStaticMarkup(createElement(PortfolioInsightsPage))
    expect(html).toContain('fresh read-only snapshot')
    expect(html).toContain('not live quotes')
    expect(html).toContain('configured AI provider')
    expect(html).toContain('does not mean the AI runs offline')
  })
})
