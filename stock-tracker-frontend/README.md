# Stock Tracker Frontend

React + TypeScript frontend scaffold for MVP-first development.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run test
```

## Environment

Create `.env` or use Replit Secrets:

- `VITE_API_BASE_URL` (default: `http://localhost:5000`)
- `VITE_DEV_USER_ID` (default: `dev-user`)
- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_AUTH0_REDIRECT_URI` (default: `http://localhost:5173`)

## MVP Scope

- Dashboard summary
- Cash CRUD
- Stock buy/dividend/sell (with explicit lot allocation)
- Holdings detail views

## Recent MVP Updates

- Dashboard now includes an Add Stock modal (ticker, shares, price, date) for quick buy-entry workflow.
- Dashboard holdings ticker values now link to a stock-specific route at /stocks/:ticker.
- Stock-specific page now includes:
	- per-ticker summary cards (Total Shares, Open Lots, Cost Basis)
	- transaction history table
	- Add Transaction modal without ticker field (ticker inferred from route)
	- edit and delete actions for transaction records
- Main Stocks page transaction table now supports edit and delete actions.
- Date display was standardized to UTC calendar rendering to prevent day-shift issues from local timezone conversion.

## Current Delivery Mode

MVP scope lock is active. Enhancements are frozen until MVP acceptance criteria pass.
See `MVP_SCOPE_LOCK.md` for in-scope and out-of-scope items.
