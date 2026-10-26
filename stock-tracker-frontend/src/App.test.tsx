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
