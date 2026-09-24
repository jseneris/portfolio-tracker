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

The scheduler process connects to the configured SQL Server and runs the daily EOD sync at its configured time. Stop the terminal process to stop future scheduled runs.

### 5. Run Daily EOD Sync Once

Build the backend, then run the one-shot command below. This is the command used by a Railway Cron Job and exits after completing the sync:

```bash
npm run build
npm run daily-eod
```

Individual ticker lookup failures are logged as warnings and do not fail the cron run. Database initialization failures and job-level exceptions still exit unsuccessfully.

For Railway, deploy a second service from this same `stock-tracker-backend` directory. Set its build command to `npm run build`, start command to `npm run daily-eod`, and configure the service Cron Schedule in UTC. The service needs the same `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` variables as the API.



## Authentication

Currently runs in development mode with `x-user-id` header or `Authorization: Bearer` token support.

For production, configure Auth0 domain and audience in `.env.local`:

```env
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=your-api-identifier
```

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
