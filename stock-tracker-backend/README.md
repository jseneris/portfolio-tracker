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

The authenticated `POST /api/portfolio-insights` endpoint compares open-lot cost basis with the latest stored close, identifies concentrated equity positions and unrealized-loss lots, and asks GitHub Copilot for explanations tied to those facts. It does not create trade instructions or determine tax treatment. Requests are limited to one per user per minute.

Each generated review can be used for follow-up questions through `POST /api/portfolio-insights/chat`. Review facts are retained in server memory for 30 minutes, scoped to the authenticated user, and are removed on expiry or process restart. Chat history is kept only in the page and sent as bounded context with each question; it is not stored in the database. Chat is limited to 10 questions per user per minute.

For personal local use, install and sign in to the GitHub Copilot CLI with the same account as your Copilot subscription. The Node SDK uses that local sign-in; it does not use an OpenAI API key. Set `COPILOT_MODEL` in `.env.local` if you want a model other than `gpt-5.6-luna`. Model availability and credit costs depend on your Copilot plan.

The Copilot SDK runs with tools disabled for this feature, receives only computed portfolio facts, and removes each inspection session after use. This setup is intended for a single local user; do not deploy a shared backend using your personal Copilot sign-in. Insights are educational estimates, not financial or tax advice.

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
