# Portfolio Tracker

Monorepo for a portfolio tracking MVP with a TypeScript backend and React frontend.

## Repositories In This Workspace

- stock-tracker-backend: API routes for cash, stocks, lots, and portfolio summary.
- stock-tracker-frontend: MVP UI for dashboard, cash, stocks, and holdings workflows.

## Documentation

- Start with [docs/README.md](docs/README.md) for the cleaned-up docs hub.
- Canonical living technical docs remain under [instructions/](instructions/).

## Recent Frontend Changes

- Dashboard Add Stock modal (ticker, shares, price, date) opens from the right side of the Portfolio Value section. Manual Refresh and Update buttons are removed; automatic price and portfolio-event refreshes remain enabled.
- Dashboard ticker links route to stock-specific page at /stocks/:ticker.
- Dashboard ticker prices use live quotes only during the regular US market session. Before opening and at/after closing (including early closes, weekends, and holidays), they use the latest saved historical close with its "as of" date. Visible dashboards refresh saved prices at close and every five minutes afterward to pick up delayed backend closing-price updates; until then, the latest available saved close retains its actual date.
- Dashboard "Change vs Prev. Day" compares portfolio snapshots at the latest saved close and the preceding close while the market is closed, including pre-market, weekends, and holidays. During regular trading it compares the current portfolio value with the previous close. Closed-market comparisons exclude transactions dated after the latest saved close and update when a newer close arrives.
- Holdings provides a date-based summary of portfolio value, available cash, stock value, and per-ticker market values, applying the selected date when its field loses focus.
- Stock-specific page now includes summary cards (Total Shares, Open Lots, Cost Basis).
- Stock transaction records now support edit/delete actions on both:
	- Stocks page
	- Stock-specific page
- Date rendering now uses UTC calendar display to avoid timezone-based day shifts.
