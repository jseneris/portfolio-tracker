import { NavLink, Route, Routes } from 'react-router-dom'
import { useAppAuth } from './auth'
import DashboardPage from './pages/DashboardPage'
import CashPage from './pages/CashPage'
import StocksPage from './pages/StocksPage'
import HoldingsPage from './pages/HoldingsPage'
import StockHistoryPage from './pages/StockHistoryPage'
import ComparisonPage from './pages/ComparisonPage'
import StockSplitsPage from './pages/StockSplitsPage'
import UserSettingsPage from './pages/UserSettingsPage'
import AllocationsPage from './pages/AllocationsPage'

export default function App() {
  const auth = useAppAuth()

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
          <nav>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/cash">Cash</NavLink>
            <NavLink to="/stocks">Stocks</NavLink>
            <NavLink to="/holdings">Holdings</NavLink>
            <NavLink to="/allocations">Allocations</NavLink>
            <NavLink to="/splits">Splits</NavLink>
            <NavLink to="/comparison">Compare</NavLink>
            <NavLink to="/user-settings">User</NavLink>
          </nav>
          {auth.isConfigured ? (
            <button className="button" onClick={() => auth.logout()}>
              Log out
            </button>
          ) : null}
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cash" element={<CashPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/stocks/:ticker" element={<StockHistoryPage />} />
          <Route path="/holdings" element={<HoldingsPage />} />
          <Route path="/allocations" element={<AllocationsPage />} />
          <Route path="/splits" element={<StockSplitsPage />} />
          <Route path="/comparison" element={<ComparisonPage />} />
          <Route path="/comparison-all" element={<ComparisonPage />} />
          <Route path="/user-settings" element={<UserSettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
