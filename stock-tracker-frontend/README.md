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

- **Charts > Stocks** includes a saved **Watchlist** section. Add a ticker and watch start date; items persist per user independently of portfolio holdings. Check a row to plot its dotted price-performance line on the same chart; uncheck it to hide the line. New and reloaded items start unchecked. Watching uses the first available close on or after the saved date as the baseline, retains that baseline across year changes, and clips the line to the displayed period. Watchlist years are available even without portfolio transactions. The All chart expands to include selected watchlist histories. Return labels stay fixed during hover. Watchlist returns do not affect combined/group holding performance.
- Watchlist prices are Yahoo split-adjusted daily closes (mutual-fund NAVs when supported), not distribution-reinvested total returns. Prices load only for selected rows and successful histories are cached daily. The last available close is carried across dates without new prices. Market-data and save/remove failures are shown explicitly. Remove and re-add a ticker to change its watch date.
- The Watchlist add form previews the company or fund name after ticker entry, and saved rows include a Name column. Names use the existing cached company-profile lookup; lookup failures are displayed without preventing watchlist management.

- Ordinary buy, sell, and reinvested dividend rows offer **Edit date** in stock transaction history and ticker-detail history. The inline date picker changes only the date, with Save date and Cancel actions. Exchange-locked rows do not offer editing. The backend synchronizes purchase-lot dates, checks purchase/sale chronology and split boundaries, rejects stale edits, and handles loss-sale buying restrictions atomically. Backend validation errors are displayed without discarding the proposed date. Successful saves refresh the page data and notify other portfolio views. Historical prices may require Recalculate after moving activity to a previously unused date.

- Yearly Stocks performance fetches only selected-year closes plus one latest pre-year close per ticker, rather than downloading prices since the first purchase. Transaction and split events are processed once in chronological order. Both combined and initial-buy lines start at zero relative to the opening valuation; purchases/sales change invested capital, not performance. Switching away cancels obsolete chart requests, and Stocks no longer loads the index comparison in the background.

- Newly saved Insights review sections preserve headings, tables, ticker wait-day colors, yearly gain/loss, concentration commentary, timestamps, and limitations when opened in Messages. Formatting is stored with the message and survives page reloads and report expiry. Existing messages and saved AI Q&A remain plain text; re-save a review section to retain its formatting. Review text is rendered as text, not executable HTML.

- The Stocks graph uses thinner lines and shows **Initial buys (buy and hold)** only when **All** years is selected and purchases are marked as Initial Purchases on the ticker page. This line tracks the combined marked purchases' hypothetical market value minus their purchase cost, ignoring later sales, later unmarked purchases, and dividend reinvestments. It applies active splits, starts at zero, and shows gaps when required prices are unavailable. Individual years show actual performance only and do not require prices for hypothetical sold initial holdings.

- Dashboard Weight compares display-lot count with the ticker's editable base size (default 3). A matching weight displays `--`; positive weights retain progressively darker green badges and negative weights are yellow.
- Performance replaces the Compare menu label. Its graph selector offers **vs Indexes** (the existing portfolio/cash/index comparison without the Initial Buys Value series) and **Stocks** (an always-visible combined cumulative dollar gain/loss line, with individual ticker lines defaulted off and selectable below the chart). The combined line includes all stocks regardless of individual selections; if any stock's valuation is unavailable, the total shows a gap rather than a partial sum. Stocks includes realized and unrealized gains plus reinvested dividends, excludes new invested capital from gains, handles active splits and exchange transfers, and retains sold positions. Each selected year starts at zero using the prior year's stored close; All starts before the first purchase. Missing valuations produce gaps and a warning rather than fabricated zero returns. Historical closes are reused until the next available close; Recalculate refreshes stored prices and the graph.
- Loss Timing Review colors tickers green for zero remaining tracked prior-window days and red when days remain, and shows yearly gain/loss amounts. Unknown waits remain neutral. Saved timing sections include the yearly amounts; colors do not establish wash-sale eligibility.

- The sell-lot picker checks all tracked same-ticker buys and dividend reinvestments within 30 calendar days before or after the selected sale date (inclusive). It lists matching dates and offsets, even for acquisitions whose shares have since been sold. The warning updates with the sale date and is informational, not confirmed wash-sale status; outside accounts and unrecorded future transactions are not checked.

- Selling any allocated lot below its cost basis automatically enables Buy Restricted through sale date plus 31 days, preserving later existing restrictions and Buy on Dip settings. The same rule applies when editing a sale into a loss. Restrictions remain manually editable; sale edits/deletions do not automatically remove them.

- Largest concentrations, Loss-review timing and Recommended lot amount each have a Send to Messages button that saves the complete section (including the lot amount's Next steps table), review timestamp and limitations. Saved sections use their section title in Messages, persist beyond the review, and support read/delete actions. Save state resets when a new review is generated.

- The background price-target checker automatically saves Buy on Dip at the trigger price when a holding with three or fewer display lots reaches its buy target, unless buying is restricted or Buy on Dip is already enabled. The dashboard reloads saved ticker preferences during price refresh/polling. Subsequent targets use the captured Buy on Dip price; the scheduler must be running.

- Insights can save and enable the user's seeded assumptions (10-year horizon, volatility tolerance, tracked-stock-only risk assessment). Enabled reviews limit loss items to negative holding Yearly Gain/Loss and more than three display lots, verify actual open-lot losses internally, and show a ticker-level summary rather than individual lots: days to wait after the latest tracked buy/dividend reinvestment and dividend timing. Without a verified future dividend date, timing falls back to days since the last tracked dividend (or "No tracked dividend"). Wait days are not confirmed wash-sale eligibility. Refresh a review after enabling/disabling assumptions or changing tracked transactions.

- Allocations grouped by Industry or Size list the included tickers alphabetically beneath each category in the slice list.
- The Messages page supports selecting alerts to mark as read or delete. Read message summaries use normal font weight (400), while unread summaries remain bold (700), including their ticker or review title.
- Account is a navigation dropdown containing Settings, Messages, and Log out (when authentication is configured). Unread message counts appear on the Account label.
- Dashboard Target % bars show the current price across the full range from the buy target (left) to the sell target (right), with a vertical marker for the split-adjusted transaction price used to calculate the targets, or the saved Buy on Dip base price when enabled. The marker and fill use the same range scale and the marker extends 3px above and below the bar; the displayed percentage remains the proximity to the nearer target.
- Outside the US market polling window (including its ten-minute closing buffer), dashboard prices use the latest stored historical close and show `as of {date}` beneath each price. Loading or manually refreshing after hours does not apply live quote overrides.
- The base-price marker's tooltip identifies the latest buy or sale transaction. The marker is green for a buy and red for a sale, including when Buy on Dip supplies the base price; it stays neutral if no buy/sale transaction is available.
- Each AI chat answer has a Send to Messages button that saves its question and full response as an unread Portfolio Q&A message. Saved items persist after the review expires and support the existing read/delete actions.
- AI chat supports 2,000-character questions and 8,000-character answers, including saving to Messages. Up to 12 recent messages are sent; older pairs are omitted from AI context when conversation text exceeds 30,000 characters, without removing the visible conversation.
- The Insights menu item is restored as a top-level link in the tiered navigation, appearing only on localhost when AI insights are enabled for the user. The existing AI-enabled route guard remains unchanged.
- Generated portfolio reviews support ephemeral follow-up chat grounded in that report; the conversation resets when the review is refreshed or the page is reloaded.
- Partial source lots can be expanded on individual stock pages to show the sales that consumed them, including proceeds, cost basis, and gain/loss; expanded sell transactions show the same gain/loss breakdown by consumed lot and in total.
- Checking Buy on Dip on an individual stock page captures its current displayed ticker price (live quote when available, otherwise latest historical close). Save Preferences persists that price: the sell target is 10% above it and the buy target is 1% below it. Targets stay fixed as quotes change; unchecking restores normal target rules. Dashboard Target % and background alerts use these thresholds, with buying restrictions taking precedence for buy signals. Previously checked preferences without a captured price use normal rules until unchecked and checked again.
- All frontend routes now use an iPhone-responsive layout with compact navigation, shrink-safe forms and summary grids, touch-sized controls, viewport-contained tables, charts, and modals.
- Dashboard holdings use compact mobile rows showing ticker, price, and target percentage, with an expandable detail view for the remaining fields.
- Dashboard now includes an Add Stock modal (ticker, shares, price, date) for quick buy-entry workflow.
- Dashboard holdings ticker values now link to a stock-specific route at /stocks/:ticker.
- Holdings now provides a dashboard-style historical snapshot selected by date, applying the selected date when the date field loses focus, with summary cards and a Stock Ticker, Shares, Price, Value, Performance, and Initial table. Performance is each ticker's all-time dollar gain/loss through the selected date: current market value plus sale/exchange proceeds minus purchase capital. Reinvested dividends add shares without adding purchase capital, so their value and subsequent gains are included without double-counting the dividend amount. Initial is each ticker's hypothetical buy-and-hold dollar gain/loss for purchases marked as Initial Purchases (excluding exchange-generated purchases), applying active splits but ignoring subsequent sales, unmarked purchases, and dividend reinvestments. Both columns reuse the Stocks chart gain calculations and display currency, with positive gains in green, negative gains in red, and zero neutral; unavailable prices or no marked initial purchases display `--`.
- Performance, Initial, and Result values use bold text. Result is Performance minus Initial, uses explicit `+`/`-` signs for nonzero values, and can be sorted descending then ascending by clicking its header; unavailable results remain last. The Show closed holdings / Hide closed holdings button includes or hides tickers previously held but no longer active on the selected date. Closed rows show zero shares and market value, no active price, realized all-time performance, and hypothetical initial buy-and-hold performance through the selected date. Closed rows do not affect portfolio summary values.
- The Result column has a bold, signed, color-coded total at the bottom for the currently displayed holdings. Showing closed holdings includes their results in the total; hiding them excludes them. Unavailable results are excluded with an explicit count and a "Total available results" label; if no results are available, the total displays `--`.
- Stock-specific page now includes:
	- per-ticker summary cards (Total Shares, Open Lots, Cost Basis)
	- transaction history table
	- Show dividends and Show sales default to unchecked and reset when navigating to another ticker. If the ticker has no tracked dividend transactions, dividend counts/amounts in the left performance breakdown and the Show dividends checkbox are hidden. These display filters do not change performance calculations or saved trading preferences.
	- Add Transaction modal without ticker field (ticker inferred from route)
	- edit and delete actions for transaction records
- Main Stocks page transaction table now supports edit and delete actions.
- Both stock transaction tables place Edit date and Delete inside a `...` dropdown, preserving transaction eligibility restrictions. On ticker pages, the partial-lot Sales expander is an arrow-only control immediately before the transaction date.
- Date display was standardized to UTC calendar rendering to prevent day-shift issues from local timezone conversion.

## Current Delivery Mode

MVP scope lock is active. Enhancements are frozen until MVP acceptance criteria pass.
See `MVP_SCOPE_LOCK.md` for in-scope and out-of-scope items.
