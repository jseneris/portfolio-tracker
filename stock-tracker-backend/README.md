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

Web Push uses the browser's service worker and sends alerts only after a new price-target message is inserted. Generate a VAPID key pair once with `npx web-push generate-vapid-keys`, then configure these secrets on both the API and scheduler Railway services:

```env
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:you@example.com
```

Keep the private key secret. The public key is returned to the authenticated frontend by `/api/push/config`. The frontend must be served over HTTPS. On iPhone or iPad, users must add Stock Tracker to the Home Screen before enabling notifications.

The Messages page includes a **Send Test Notification** action. It sends a push to the signed-in user's registered devices without creating a fake portfolio message.

Messages can be marked read or deleted in selected batches. Both operations apply only to message IDs owned by the authenticated user.



## Authentication

Currently runs in development mode with `x-user-id` header or `Authorization: Bearer` token support.

For production, configure Auth0 domain and audience in `.env.local`:

```env
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=your-api-identifier
```

## Portfolio Insights

The authenticated `POST /api/portfolio-insights` endpoint builds a complete read-only snapshot of current tracked holdings, all open lots (including profitable and small positions), cash, and available stored company classifications. It calculates quantities, cost basis, market values, unrealized gains/losses, and holding weights using the latest stored closing prices. It also identifies concentrated equity positions and unrealized-loss lots and asks GitHub Copilot for explanations tied to those facts with the full snapshot as context. The response includes the snapshot. It does not create trade instructions or determine tax treatment. Requests are limited to one per user per minute.

Each generated review can be used for follow-up questions about any holding or cash through `POST /api/portfolio-insights/chat`. The complete snapshot and review facts are retained in server memory for 30 minutes, scoped to the authenticated user, and are removed on expiry or process restart. Chat uses that fixed snapshot, not a fresh database query; refresh the review after portfolio changes. Chat history is kept only in the page and sent as bounded context with each question; it is not stored in the database. Chat is limited to 10 questions per user per minute.

Missing prices produce null valuations, not zero. `pricedEquityValue` is explicitly a partial total when prices are missing; full equity value, portfolio value, total unrealized gain/loss, and portfolio weights are null in that case. Cash uses the same calculation as `/api/cash/summary`, including exclusion of exchange-generated buys. The snapshot includes no user, account, transaction, or lot identifiers. It does not include full transaction history, realized gains, performance returns, external accounts, goals, or live market/news data. Stored company classifications include their update timestamps and may be missing or stale.

Users with insights enabled can explicitly save a question and answer through `POST /api/messages/ai-chat` with `{ question, answer }` (up to 1000 and 4000 characters respectively). This creates an unread `ai-chat` message belonging to the authenticated user, without a ticker or price. The full text persists in the database independently of the ephemeral review and can be opened, marked read, or deleted through the existing Messages endpoints. Saving does not invoke AI or send a push notification. Database initialization upgrades existing Messages tables to accept this type, nullable ticker/trigger price, and a full-length body while preserving existing alerts.

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
