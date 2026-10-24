# Portfolio Tracker

Monorepo for a portfolio tracking MVP with a TypeScript backend and React frontend.

## Repositories In This Workspace

- stock-tracker-backend: API routes for cash, stocks, lots, and portfolio summary.
- stock-tracker-frontend: MVP UI for dashboard, cash, stocks, and holdings workflows.

## Documentation

- Start with [docs/README.md](docs/README.md) for the cleaned-up docs hub.
- Canonical living technical docs remain under [instructions/](instructions/).

## Recent Frontend Changes

- **Review** (`/review`) is available to all signed-in users and loads automatically without AI. It includes the portfolio snapshot, recommended lot amount, largest concentrations, open-lot losses, Loss Timing Review, missing prices, and limitations. Loss timing uses its fixed calculated filters regardless of saved AI assumptions. Sections no longer offer Send to Messages; previously saved review messages remain readable.
- **Insights** remains restricted to localhost and AI-enabled accounts, including direct routes and backend AI endpoints. It now contains only portfolio chat and a status light that checks local Copilot sign-in/model availability instead of a Generate review button. Each question uses a fresh read-only stored-close portfolio snapshot plus recent conversation and saved AI assumptions; no generated report is needed. Availability checks do not prompt the model. Local-only access still uses the configured AI provider, not offline inference.
- Review includes **Distance from buy and sell targets**. Current holdings must be at least 20% above their buy target and 20% below their sell target, measured from each target. Each ticker appears once in the highest qualifying tier (30%+, 25% to under 30%, or 20% to under 25%), ranked by the smaller distance. Tables show price, source/as-of time, both targets, and both dollar and percentage distances. Targets share dashboard settings, display-lot counts, split adjustments, and buy-on-dip rules. Prices use regular-session live quotes when available, otherwise the latest stored close; missing quotes and excluded tickers are reported. All Review sections are snapshots as of page load, with no refresh buttons, polling, or focus/portfolio-change refreshes. Reload the page to update them.
- Installed Home Screen web apps now mirror the total unread Messages count on their app icon where the Badging API is supported. Push notifications carry the server's unread count so the badge can update while the app is closed; opening, reading, or deleting messages refreshes the badge, and zero unread messages clears it. Foreground counts refresh on focus, visibility, push arrival, message changes, and every five minutes. Updates on another device are reflected on the next refresh or push.
- On iPhone/iPad, add the site to the Home Screen, use iOS/iPadOS 16.4 or newer, and enable notifications and Badges in system settings. Enable push notifications in Account > Settings for background updates. Browser tabs and unsupported browsers/launchers retain the existing in-app count without an icon badge; Android may show only a notification dot.
- Dashboard Add Stock modal (ticker, shares, price, date) opens from the right side of the Portfolio Value section. Manual Refresh and Update buttons are removed; automatic price and portfolio-event refreshes remain enabled.
- Dashboard ticker links route to stock-specific page at /stocks/:ticker.
- Dashboard ticker prices use live quotes only during the regular US market session. Before opening and at/after closing (including early closes, weekends, and holidays), they use the latest saved historical close with its "as of" date. Visible dashboards refresh saved prices at close and every five minutes afterward to pick up delayed backend closing-price updates; until then, the latest available saved close retains its actual date.
- Dashboard "Change vs Prev. Day" compares portfolio snapshots at the latest saved close and the preceding close while the market is closed, including pre-market, weekends, and holidays. During regular trading it compares the current portfolio value with the previous close. Closed-market comparisons exclude transactions dated after the latest saved close and update when a newer close arrives.
- Dashboard "# of stocks" shows the count of held tickers with positive daily change in green / negative daily change in red, using the same live-or-historical changes as the holdings table. Unchanged tickers and those without a daily change are excluded.
- Charts menu adds **Red/Green**: daily counts of held tickers closing up (green, above a zero midline) and down (red, below it), with light-colored fills and a blue net line (up minus down), using the same Year options as the other charts.
- Holdings provides a date-based summary of portfolio value, available cash, stock value, and per-ticker market values, applying the selected date when its field loses focus.
- Stock-specific page now includes summary cards (Total Shares, Open Lots, Cost Basis).
- Stock transaction records now support edit/delete actions on both:
	- Stocks page
	- Stock-specific page
- Date rendering now uses UTC calendar display to avoid timezone-based day shifts.
