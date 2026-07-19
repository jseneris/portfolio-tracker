import { NavLink, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import CashPage from './pages/CashPage'
import StocksPage from './pages/StocksPage'
import HoldingsPage from './pages/HoldingsPage'
import StockHistoryPage from './pages/StockHistoryPage'
import Comparison2021Page from './pages/Comparison2021Page'
import StockSplitsPage from './pages/StockSplitsPage'
import UserSettingsPage from './pages/UserSettingsPage'

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Stock Tracker</h1>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/cash">Cash</NavLink>
          <NavLink to="/stocks">Stocks</NavLink>
          <NavLink to="/holdings">Holdings</NavLink>
          <NavLink to="/splits">Splits</NavLink>
          <NavLink to="/comparison-2021">2021 Compare</NavLink>
          <NavLink to="/user-settings">User</NavLink>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cash" element={<CashPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/stocks/:ticker" element={<StockHistoryPage />} />
          <Route path="/holdings" element={<HoldingsPage />} />
          <Route path="/splits" element={<StockSplitsPage />} />
          <Route path="/comparison-2021" element={<Comparison2021Page />} />
          <Route path="/user-settings" element={<UserSettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
