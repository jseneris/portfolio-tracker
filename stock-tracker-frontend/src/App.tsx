import { NavLink, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import CashPage from './pages/CashPage'
import StocksPage from './pages/StocksPage'
import HoldingsPage from './pages/HoldingsPage'

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
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cash" element={<CashPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/holdings" element={<HoldingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
