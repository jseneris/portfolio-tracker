import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatResponseActions } from './PortfolioInsightsPage'

function render(overrides: Partial<Parameters<typeof ChatResponseActions>[0]> = {}) {
  return renderToStaticMarkup(createElement(ChatResponseActions, {
    saved: false, saving: false, disabled: false, onSend: () => undefined, ...overrides,
  }))
}

describe('AI response save action', () => {
  it('renders an enabled Send to Messages button for an unsaved answer', () => {
    const html = render()
    expect(html).toContain('Send to Messages')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  it('disables the action during saving or refreshing', () => {
    expect(render({ saving: true })).toContain('Sending...')
    expect(render({ saving: true })).toContain('disabled')
    expect(render({ disabled: true })).toContain('disabled')
  })

  it('confirms success and prevents resending the same answer', () => {
    const html = render({ saved: true })
    expect(html).toContain('Sent to Messages')
    expect(html).toContain('disabled')
    expect(html).toContain('role="status"')
    expect(html).toContain('Question and response saved.')
  })

  it('shows an explicit error while allowing a retry', () => {
    const html = render({ error: 'Unable to save' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Unable to save')
    expect(html).not.toContain('disabled')
  })
})
