import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./auth', () => ({
  useAppAuth: () => ({
    isLoading: false, isConfigured: true, isAuthenticated: true,
    userEmail: 'test@example.com', login: vi.fn(), logout: vi.fn(),
  }),
  getRequestHeaders: vi.fn(),
}))

afterEach(() => vi.unstubAllGlobals())

describe('Review navigation', () => {
  it('keeps every standard destination inside the shared main navigation', () => {
    vi.stubGlobal('window', { location: { hostname: 'portfolio.example.com' } })
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/review' }, createElement(App)))
    const nav = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0]
    expect(nav).toContain('aria-label="Main navigation"')
    for (const path of ['/', '/holdings', '/cash', '/stocks', '/splits', '/comparison',
      '/stock-performance', '/red-green', '/allocations', '/review', '/user-settings', '/messages']) {
      expect(nav).toContain(`href="${path}"`)
    }
    expect(nav).toContain('Account')
    expect(nav).toContain('Log out')
  })

  it.each(['localhost', 'portfolio.example.com'])('offers Review at %s without AI feature access', (hostname) => {
    vi.stubGlobal('window', { location: { hostname } })
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/review' }, createElement(App)))
    expect(html).toContain('href="/review"')
    expect(html).toContain('Calculated portfolio review')
    expect(html).toContain('Loading portfolio review...')
    expect(html).not.toContain('href="/insights"')
    expect(html).not.toContain('Send to Messages')
  })
})
