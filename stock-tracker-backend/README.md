# Stock Tracker Backend API

Node.js/Express backend for the Stock Tracker application with SQL Server database connectivity.

## Setup

### 1. Install Dependencies

```bash
cd stock-tracker-backend
npm install
```

### 2. Configure Database

Edit `.env.local` with your SQL Server connection details:

```env
DB_SERVER=your-server.com
DB_USER=your-user
DB_PASSWORD=your-password
DB_NAME=your-db
```

### 3. Start Development Server

```bash
npm run dev
```

The API will start on `http://localhost:5000` and automatically create the required database tables. The API does not start scheduled jobs.

### 4. Start Local Scheduled Jobs

Run this in a separate VS Code terminal when you want the local scheduler active:

```bash
npm run scheduler
```

The scheduler process connects to the configured SQL Server, checks price targets every five minutes during market hours, and runs the daily EOD sync at its configured time. Stop the process to stop future scheduled runs.

### 5. Run Daily EOD Sync Once

Build the backend, then run the one-shot command below. This is the command used by a Railway Cron Job and exits after completing the sync:

```bash
npm run build
npm run daily-eod
```

Individual ticker lookup failures are logged as warnings and do not fail the cron run. Database initialization failures and job-level exceptions still exit unsuccessfully.

For Railway, deploy the API with build command `npm run build` and start command `npm start`. Deploy a second, always-on service from this same `stock-tracker-backend` directory for scheduled jobs, with build command `npm run build` and start command `node dist/jobs/scheduler-entry.js`. Both services need the same database, authentication, CORS, and notification environment variables. The optional one-shot `npm run daily-eod` command can still be used for a separate Railway Cron Job, but do not schedule it if the always-on scheduler is already running the daily EOD sync.

## Phone Notifications

During scheduled market-hour price-target checks, reaching or falling below a buy target automatically saves **Buy on Dip** when the holding has three or fewer display lots (including zero). The trigger quote is captured as `buyOnDipPrice`; subsequent targets use the existing 1%-below buy and 10%-above sell rules. Active buying restrictions suppress this change. Already-enabled preferences retain their captured price. The change is independent of unread-message deduplication, so an existing unread alert does not prevent it. New buy alerts mention automatic activation. This requires the scheduler to be running; it does not execute a trade.

Web Push uses the browser's service worker and sends alerts only after a new price-target message is inserted. Generate a VAPID key pair once with `npx web-push generate-vapid-keys`, then configure these secrets on both the API and scheduler Railway services:

```env
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:you@example.com
```

Keep the private key secret. The public key is returned to the authenticated frontend by `/api/push/config`. The frontend must be served over HTTPS. On iPhone or iPad, users must add Stock Tracker to the Home Screen before enabling notifications.

The backend test-push endpoint sends a push to the signed-in user's registered devices without creating a fake portfolio message. The frontend no longer exposes a button for it.

Messages can be marked read or deleted in selected batches. Both operations apply only to message IDs owned by the authenticated user.



## Authentication

Currently runs in development mode with `x-user-id` header or `Authorization: Bearer` token support.

For production, configure Auth0 domain and audience in `.env.local`:

```env
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=your-api-identifier
```

## Portfolio Insights

Creating or editing an allocated stock sale automatically enables Buy Restricted when **any sold source lot** has a unit cost above the sale price, even if other sold lots make the overall sale profitable. The restriction end date is the UTC sale calendar date plus 31 days; existing longer active restrictions and Buy on Dip settings are preserved. The change commits atomically with the sale. Backdated sales use their sale date, not today's date. Existing restriction semantics remain inclusive of the stored end date. Editing/deleting a sale does not automatically shorten or remove an existing restriction; users can adjust it in ticker preferences. This is a guardrail, not a determination of tax treatment.

`POST /api/messages/review-section` accepts `{ title, content }` for `Largest concentrations`, `Loss-review timing` or `Recommended lot amount`, with up to 50,000 characters of section content. Like saved chat, it requires insights access and stores an unread, user-owned message. Section saves include the generated timestamp, displayed results/commentary and limitations, are independent of chat limits, and never truncate content.

The Insights page offers an explicit **Save and enable these assumptions** control for the signed-in user: a 10-year horizon, comfort with volatility while avoiding excessive single-stock concentration, tracked-stocks-only risk scope, and loss-review filters of negative holding Yearly Gain/Loss and more than three **display** lots. `GET /api/user-settings/ai-assumptions` returns the current seed or null; `PUT` with `{ enabled: boolean }` persists opt-in on the authenticated insights-enabled user. Disabling restores the unfiltered review. Existing snapshots do not change; refresh to apply preferences.

Enabled snapshots include separately labeled assumptions and per-holding review context. Yearly Gain/Loss follows the app formula: current stored-close value minus prior-year-end holding value minus current-year buys and reinvested dividends plus sales. Prior-year-end shares are reconstructed from transactions, exchanges, and activated splits. Missing prices remain unknown. Loss facts require the YTD/display-lot filters **and** an actual open-lot loss; negative YTD alone is never treated as proof of unrealized losses. Concentration facts and the full holdings snapshot are not filtered.

Enabled loss reviews and chat summarize once per ticker, not individual lots. The timing table shows ticker, days remaining until the prior window clears after the latest tracked same-ticker buy or dividend reinvestment, and dividend timing. The window clears on transaction date plus 31 calendar days; a transaction today means 31 days remaining, day 30 means one day remaining, and day 31 onward means zero. Transaction history includes buys/dividends whose shares were subsequently sold. These are not confirmed wash-sale eligibility dates: substantially identical securities, outside accounts, and purchases in the 30 days after a loss sale remain unknown. When no verified future dividend date is available, the AI and table show days since the last tracked dividend instead. No tracked dividend is explicitly unknown, not zero. Elapsed days do not predict a future dividend.

The authenticated `POST /api/portfolio-insights` endpoint builds a complete read-only snapshot of current tracked holdings, all open lots (including profitable and small positions), cash, and available stored company classifications. It calculates quantities, cost basis, market values, unrealized gains/losses, and holding weights using the latest stored closing prices. It also identifies concentrated equity positions and unrealized-loss lots and asks GitHub Copilot for explanations tied to those facts with the full snapshot as context. The response includes the snapshot. It does not create trade instructions or determine tax treatment. Requests are limited to one per user per minute.

Each generated review can be used for follow-up questions about any holding or cash through `POST /api/portfolio-insights/chat`. The complete snapshot and review facts are retained in server memory for 30 minutes, scoped to the authenticated user, and are removed on expiry or process restart. Chat uses that fixed snapshot, not a fresh database query; refresh the review after portfolio changes. Chat history is kept only in the page and sent as bounded context with each question; it is not stored in the database. Chat is limited to 10 questions per user per minute.

Missing prices produce null valuations, not zero. `pricedEquityValue` is explicitly a partial total when prices are missing; full equity value, portfolio value, total unrealized gain/loss, and portfolio weights are null in that case. Cash uses the same calculation as `/api/cash/summary`, including exclusion of exchange-generated buys. The snapshot includes no user, account, transaction, or lot identifiers. It does not include full transaction history, realized gains, performance returns, external accounts, goals, or live market/news data. Stored company classifications include their update timestamps and may be missing or stale.

Chat accepts questions up to 2,000 characters and answers up to 8,000 characters. Each history message uses its role's corresponding limit, so every returned answer is valid as follow-up context. The page sends up to 12 recent messages; the server drops older question/answer pairs if their combined text exceeds 30,000 characters. This budget covers conversation text only, not the portfolio snapshot or instructions, and is an application guardrail rather than a model token limit. The visible conversation is retained. Invalid inputs receive specific errors. The AI is instructed to stay within the answer limit; oversized answers produce an explicit error asking for a more focused question rather than being silently truncated. Review-fact explanations remain limited to 600 characters.

Users with insights enabled can explicitly save a question and answer through `POST /api/messages/ai-chat` with `{ question, answer }` (up to 2,000 and 8,000 characters respectively). This creates an unread `ai-chat` message belonging to the authenticated user, without a ticker or price. The full text persists in the database independently of the ephemeral review and can be opened, marked read, or deleted through the existing Messages endpoints. Saving does not invoke AI or send a push notification. Database initialization upgrades existing Messages tables to accept this type, nullable ticker/trigger price, and a full-length body while preserving existing alerts.

For personal local use, install and sign in to the GitHub Copilot CLI with the same account as your Copilot subscription. The Node SDK uses that local sign-in; it does not use an OpenAI API key. Set `COPILOT_MODEL` in `.env.local` if you want a model other than `gpt-5.6-luna`. Model availability and credit costs depend on your Copilot plan.

The Copilot SDK runs with tools and memory disabled for this feature, receives the complete snapshot and computed portfolio facts (plus questions and recent history for chat), and removes each inspection session after use. The AI has no database or portfolio-editing tools. Snapshot queries are read-only and scoped to the authenticated user. This setup is intended for a single local user; do not deploy a shared backend using your personal Copilot sign-in. Review the provider's data-handling terms before enabling this broader data sharing. Insights are educational estimates, not financial or tax advice.

## CORS Origins

Set `FRONTEND_URL` to one allowed browser origin or to a comma-separated list. For local development and the deployed Vercel frontend, use:

```env
FRONTEND_URL=http://localhost:5173,https://portfolio-tracker-ten-gamma.vercel.app
```

## Scripts

- `npm run dev` - Start development server with watch mode
- `npm run scheduler` - Start the local scheduled-job process
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled HTTP API (Railway command)
- `npm run daily-eod` - Run the compiled daily EOD sync once (Railway Cron command)
- `npm run seed` - (Future) Seed database with sample data
# GitHub write access verified 2026-07-05T20:43:01Z
