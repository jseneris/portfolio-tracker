# Portfolio Tracker

Monorepo for a portfolio tracking MVP with a TypeScript backend and React frontend.

## Repositories In This Workspace

- stock-tracker-backend: API routes for cash, stocks, lots, and portfolio summary.
- stock-tracker-frontend: MVP UI for dashboard, cash, stocks, and holdings workflows.

## Documentation

- Start with [docs/README.md](docs/README.md) for the cleaned-up docs hub.
- Canonical living technical docs remain under [instructions/](instructions/).

## Recent Frontend Changes

- Dashboard Add Stock modal added (ticker, shares, price, date).
- Dashboard ticker links route to stock-specific page at /stocks/:ticker.
- Holdings provides a date-based summary of portfolio value, available cash, stock value, and per-ticker market values, applying the selected date when its field loses focus.
- Stock-specific page now includes summary cards (Total Shares, Open Lots, Cost Basis).
- Stock transaction records now support edit/delete actions on both:
	- Stocks page
	- Stock-specific page
- Date rendering now uses UTC calendar display to avoid timezone-based day shifts.
