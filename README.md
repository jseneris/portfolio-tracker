# Portfolio Tracker

Monorepo for a portfolio tracking MVP with a TypeScript backend and React frontend.

## Repositories In This Workspace

- stock-tracker-backend: API routes for cash, stocks, lots, and portfolio summary.
- stock-tracker-frontend: MVP UI for dashboard, cash, stocks, and holdings workflows.

## Recent Frontend Changes

- Dashboard Add Stock modal added (ticker, shares, price, date).
- Dashboard ticker links route to stock-specific page at /stocks/:ticker.
- Stock-specific page now includes summary cards (Total Shares, Open Lots, Cost Basis).
- Stock transaction records now support edit/delete actions on both:
	- Stocks page
	- Stock-specific page
- Date rendering now uses UTC calendar display to avoid timezone-based day shifts.
