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
- Historical holdings snapshot with date-based portfolio value, cash, stock value, and per-ticker market values
- Optional phone notifications for new price-target messages (requires server-side VAPID configuration and browser permission)

## Recent MVP Updates

- The sell-lot picker checks all tracked same-ticker buys and dividend reinvestments within 30 calendar days before or after the selected sale date (inclusive). It lists matching dates and offsets, even for acquisitions whose shares have since been sold. The warning updates with the sale date and is informational, not confirmed wash-sale status; outside accounts and unrecorded future transactions are not checked.

- Selling any allocated lot below its cost basis automatically enables Buy Restricted through sale date plus 31 days, preserving later existing restrictions and Buy on Dip settings. The same rule applies when editing a sale into a loss. Restrictions remain manually editable; sale edits/deletions do not automatically remove them.

- Largest concentrations and Loss-review timing each have a Send to Messages button that saves the complete section, review timestamp and limitations. Saved sections use their section title in Messages, persist beyond the review, and support read/delete actions. Save state resets when a new review is generated.

- The background price-target checker automatically saves Buy on Dip at the trigger price when a holding with three or fewer display lots reaches its buy target, unless buying is restricted or Buy on Dip is already enabled. The dashboard reloads saved ticker preferences during price refresh/polling. Subsequent targets use the captured Buy on Dip price; the scheduler must be running.

- Insights can save and enable the user's seeded assumptions (10-year horizon, volatility tolerance, tracked-stock-only risk assessment). Enabled reviews limit loss items to negative holding Yearly Gain/Loss and more than three display lots, verify actual open-lot losses internally, and show a ticker-level summary rather than individual lots: days to wait after the latest tracked buy/dividend reinvestment and dividend timing. Without a verified future dividend date, timing falls back to days since the last tracked dividend (or "No tracked dividend"). Wait days are not confirmed wash-sale eligibility. Refresh a review after enabling/disabling assumptions or changing tracked transactions.

- Allocations grouped by Industry or Size list the included tickers alphabetically beneath each category in the slice list.
- The Messages page supports selecting alerts to mark as read or delete.
- Each AI chat answer has a Send to Messages button that saves its question and full response as an unread Portfolio Q&A message. Saved items persist after the review expires and support the existing read/delete actions.
- AI chat supports 2,000-character questions and 8,000-character answers, including saving to Messages. Up to 12 recent messages are sent; older pairs are omitted from AI context when conversation text exceeds 30,000 characters, without removing the visible conversation.
- The Insights menu item appears only on localhost when AI insights are enabled for the user.
- Generated portfolio reviews support ephemeral follow-up chat grounded in that report; the conversation resets when the review is refreshed or the page is reloaded.
- Partial source lots can be expanded on individual stock pages to show the sales that consumed them, including proceeds, cost basis, and gain/loss; expanded sell transactions show the same gain/loss breakdown by consumed lot and in total.
- Checking Buy on Dip on an individual stock page captures its current displayed ticker price (live quote when available, otherwise latest historical close). Save Preferences persists that price: the sell target is 10% above it and the buy target is 1% below it. Targets stay fixed as quotes change; unchecking restores normal target rules. Dashboard Target % and background alerts use these thresholds, with buying restrictions taking precedence for buy signals. Previously checked preferences without a captured price use normal rules until unchecked and checked again.
- All frontend routes now use an iPhone-responsive layout with compact navigation, shrink-safe forms and summary grids, touch-sized controls, viewport-contained tables, charts, and modals.
- Dashboard holdings use compact mobile rows showing ticker, price, and target percentage, with an expandable detail view for the remaining fields.
- Dashboard now includes an Add Stock modal (ticker, shares, price, date) for quick buy-entry workflow.
- Dashboard holdings ticker values now link to a stock-specific route at /stocks/:ticker.
- Holdings now provides a dashboard-style historical snapshot selected by date, applying the selected date when the date field loses focus, with summary cards and a Stock Ticker, Shares, Price, and Value table.
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
