import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAppAuth } from './auth'
import { getUnreadMessageCount, getUserProfile } from './api'
import { updateAppBadge } from './appBadge'
import DashboardPage from './pages/DashboardPage'
import CashPage from './pages/CashPage'
import StocksPage from './pages/StocksPage'
import HoldingsPage from './pages/HoldingsPage'
import StockHistoryPage from './pages/StockHistoryPage'
import ComparisonPage from './pages/ComparisonPage'
import StockSplitsPage from './pages/StockSplitsPage'
import UserSettingsPage from './pages/UserSettingsPage'
import AllocationsPage from './pages/AllocationsPage'
import PortfolioInsightsPage from './pages/PortfolioInsightsPage'
import ReviewPage from './pages/ReviewPage'
import MessagesPage, { MESSAGES_UPDATED_EVENT } from './pages/MessagesPage'

const UNREAD_MESSAGES_POLL_MS = 5 * 60 * 1000

export default function App() {
  const auth = useAppAuth()
  const location = useLocation()
  const [aiInsightsEnabled, setAiInsightsEnabled] = useState(false)
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const [openMenu, setOpenMenu] = useState<'transactions' | 'charts' | 'account' | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setOpenMenu(null)
    setMobileNavOpen(false)
  }, [location])

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated) {
      setUnreadMessageCount(0)
      if (!auth.isLoading) void updateAppBadge(0)
      return
    }

    let cancelled = false
    let refreshVersion = 0

    function refreshUnreadCount() {
      const version = ++refreshVersion
      getUnreadMessageCount()
        .then((count) => {
          if (!cancelled && version === refreshVersion) {
            setUnreadMessageCount(count)
            void updateAppBadge(count)
          }
        })
        .catch((error) => {
          console.error('[messages] Unable to refresh the unread count:', error)
        })
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refreshUnreadCount()
    }

    function onServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === MESSAGES_UPDATED_EVENT) refreshUnreadCount()
    }

    refreshUnreadCount()
    const intervalId = window.setInterval(refreshUnreadCount, UNREAD_MESSAGES_POLL_MS)
    window.addEventListener('focus', refreshUnreadCount)
    window.addEventListener(MESSAGES_UPDATED_EVENT, refreshUnreadCount)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
    }

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshUnreadCount)
      window.removeEventListener(MESSAGES_UPDATED_EVENT, refreshUnreadCount)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage)
      }
    }
  }, [auth.isAuthenticated, auth.isLoading])

  useEffect(() => {
    let cancelled = false

    if (auth.isLoading || !auth.isAuthenticated) {
      setAiInsightsEnabled(false)
      return () => {
        cancelled = true
      }
    }

    getUserProfile()
      .then((profile) => {
        if (!cancelled) setAiInsightsEnabled(profile.aiInsightsEnabled)
      })
      .catch(() => {
        if (!cancelled) setAiInsightsEnabled(false)
      })

    return () => {
      cancelled = true
    }
  }, [auth.isAuthenticated, auth.isLoading])

  if (auth.isLoading) {
    return (
      <div className="app-shell auth-shell">
        <main className="app-main auth-main">
          <section className="panel auth-panel">
            <p className="eyebrow">Authenticating</p>
            <h1>Preparing your workspace</h1>
            <p>Connecting to Auth0 and restoring your session.</p>
          </section>
        </main>
      </div>
    )
  }

  if (auth.isConfigured && !auth.isAuthenticated) {
    return (
      <div className="app-shell auth-shell">
        <main className="app-main auth-main">
          <section className="panel auth-panel">
            <p className="eyebrow">Sign in required</p>
            <h1>Stock Tracker</h1>
            <p>Sign in with Auth0 to access your portfolio.</p>
            <button className="button button-primary" onClick={() => void auth.login()}>
              Sign in with Auth0
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">{auth.isConfigured ? 'Auth0 enabled' : 'Dev mode'}</p>
          <h1>Stock Tracker</h1>
          <p className="header-caption">
            {auth.isConfigured
              ? auth.userEmail || auth.userName || 'Authenticated portfolio workspace'
              : 'Using the local dev user fallback'}
          </p>
        </div>
        <div className="header-actions">
          <button ref={mobileNavButton} className="mobile-nav-toggle" type="button"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen} aria-controls="main-navigation"
            onClick={() => {
              setMobileNavOpen((open) => !open)
              setOpenMenu(null)
            }}>
            <span aria-hidden="true">{'\u2630'}</span>
            {unreadMessageCount > 0 ? <span className="nav-badge">{unreadMessageCount}</span> : null}
          </button>
          <nav id="main-navigation" className={mobileNavOpen ? 'mobile-nav-open' : undefined}
            aria-label="Main navigation" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpenMenu(null)
              if (window.matchMedia('(max-width: 640px)').matches) {
                setMobileNavOpen(false)
                mobileNavButton.current?.focus()
              } else {
                event.currentTarget.querySelector<HTMLDetailsElement>('details[open]')?.querySelector('summary')?.focus()
              }
            }
          }} onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a')) {
              setOpenMenu(null)
              setMobileNavOpen(false)
            }
          }}>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/holdings">Holdings</NavLink>
            <details className="nav-menu" open={openMenu === 'transactions'}>
              <summary onClick={(event) => {
                event.preventDefault()
                setOpenMenu((current) => current === 'transactions' ? null : 'transactions')
              }}>Transactions</summary>
              <div className="nav-submenu">
                <NavLink to="/cash">Cash</NavLink>
                <NavLink to="/stocks">Stocks</NavLink>
                <NavLink to="/splits">Splits</NavLink>
              </div>
            </details>
            <details className="nav-menu" open={openMenu === 'charts'}>
              <summary onClick={(event) => {
                event.preventDefault()
                setOpenMenu((current) => current === 'charts' ? null : 'charts')
              }}>Charts</summary>
              <div className="nav-submenu">
                <NavLink to="/comparison">vs Indexes</NavLink>
                <NavLink to="/stock-performance">Stocks</NavLink>
                <NavLink to="/red-green">Red/Green</NavLink>
                <NavLink to="/allocations">Allocations</NavLink>
              </div>
            </details>
            <NavLink to="/review">Review</NavLink>
            {window.location.hostname === 'localhost' && aiInsightsEnabled ? (
              <NavLink to="/insights">Insights</NavLink>
            ) : null}
            <details className="nav-menu" open={openMenu === 'account'}>
              <summary onClick={(event) => {
                event.preventDefault()
                setOpenMenu((current) => current === 'account' ? null : 'account')
              }}>
                Account
                {unreadMessageCount > 0 ? <span className="nav-badge">{unreadMessageCount}</span> : null}
              </summary>
              <div className="nav-submenu">
                <NavLink to="/user-settings">Settings</NavLink>
                <NavLink to="/messages">Messages</NavLink>
                {auth.isConfigured ? (
                  <button className="nav-logout" type="button" onClick={() => {
                    setOpenMenu(null)
                    setMobileNavOpen(false)
                    auth.logout()
                  }}>Log out</button>
                ) : null}
              </div>
            </details>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cash" element={<CashPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/stocks/:ticker" element={<StockHistoryPage />} />
          <Route path="/holdings" element={<HoldingsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/allocations" element={<AllocationsPage />} />
          <Route path="/splits" element={<StockSplitsPage />} />
          <Route path="/comparison" element={<ComparisonPage />} />
          <Route path="/comparison-all" element={<ComparisonPage />} />
          <Route path="/stock-performance" element={<ComparisonPage graph="stocks" />} />
          <Route path="/red-green" element={<ComparisonPage graph="redGreen" />} />
          <Route
            path="/insights"
            element={window.location.hostname === 'localhost' && aiInsightsEnabled ? <PortfolioInsightsPage /> : <Navigate to="/" replace />}
          />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/user-settings" element={<UserSettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
