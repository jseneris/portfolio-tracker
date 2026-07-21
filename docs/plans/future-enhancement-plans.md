# FUTURE ENHANCEMENTS

## SET TARGET PRICES
### DESCRIPTION
    -new page to set buy and sell targets
    -set a sell target based on a user entered percentage
    -set a purchase target based on user entered percentage and # of lots
        -set 4 levels of purchase targets, 3 or fewer lots, 4 lots, 5 lots, 6 or more lots
    -sell and purchase targets are based on last Buy or Sale of each stock and should be displayed on dashboard page
### PLAN
        1. Define target formulas and rule inputs for sell percentage and 4-tier buy thresholds by lot count.
        2. Add database tables for target settings and computed per-ticker target values with migrations.
        3. Build backend endpoints to create, update, and fetch target configurations and computed targets.
        4. Recompute targets automatically when buy/sell/dividend-lot events change reference prices.
        5. Add a target management page in frontend for editing all rule inputs.
        6. Show computed buy/sell target levels on dashboard with source trade date and calculation metadata.
        7. Add unit and integration tests for formula correctness, API behavior, and recalculation triggers.

## GET CURRENT PRICES
### DESCRIPTION
    -on dashboard page show current price for each stock
    -as temporary measure until cron job set up, retrieve current stock prices when update price button on dashboard is hit
### PLAN
        1. Add a market-data provider abstraction for quote retrieval and response normalization.
        2. Implement backend endpoint to refresh current prices for all tickers in portfolio on demand.
        3. Add cache and throttle logic to avoid redundant provider calls during rapid repeated refreshes.
        4. Store and return quote timestamps so dashboard can display freshness.
        5. Wire dashboard Update Price button to call refresh endpoint and update each ticker row.
        6. Handle partial failures gracefully with per-ticker error statuses.
        7. Add tests for provider mapping, endpoint behavior, throttling, and frontend refresh flow.

## STORE CLOSING PRICES
### DESCRIPTION
    -Save daily closing price of each stock 
    -Add utility page to retrieve historical closing prices for each stock in portfolio going back to earliest holding date
### PLAN
        1. Add closing-price table schema with unique ticker and date constraint plus source metadata.
        2. Build idempotent backend ingestion logic for daily end-of-day closing prices.
        3. Add utility endpoints to backfill historical closes from earliest holding date for each ticker.
        4. Add utility page to trigger and monitor historical backfill jobs.
        5. Implement query endpoints to retrieve historical closes by ticker and date range.
        6. Add validation and logging for market-closed days, duplicates, and missing data.
        7. Add tests for migrations, idempotent writes, backfill correctness, and retrieval accuracy.

## COMPARE AGAINST INDEXES (S&P, DOW, NASDAQ)
### DESCRIPTION
    -Get daily closing price of each index
    -Compare performance to cash added to portfolio
### PLAN
        1. Add index metadata and index-closing-price storage tables.
        2. Implement daily index close ingestion using the same idempotent pattern as stock closes.
        3. Define comparison formulas for portfolio performance versus net cash contributions and index baselines.
        4. Build backend comparison endpoint returning aligned time series for portfolio and indexes.
        5. Add frontend comparison view with selectable date ranges and portfolio-versus-index charts.
        6. Include summary metrics for absolute return, relative return, and contribution-adjusted deltas.
        7. Add tests for date alignment, formula correctness, and missing-day handling.

## CRON JOB
### DESCRIPTION
    -Cron job that updates stock prices every 5 minutes on days/times the stock market is open
### PLAN
        1. Select scheduler architecture (in-process scheduler or external scheduler) with single-run safeguards.
        2. Implement market calendar gating so jobs run only during valid US market sessions.
        3. Schedule 5-minute intraday quote refresh runs for portfolio tickers during open market hours.
        4. Add retry/backoff, idempotency checks, and failure recording for job reliability.
        5. Add job observability with run logs, durations, error counts, and stale-data alerts.
        6. Keep manual refresh endpoint active as fallback until cron reliability is proven.
        7. Add tests for schedule windows, holiday handling, duplicate-run prevention, and recovery behavior.

## DAILY CLOSE JOB FOR OPEN HOLDINGS
### DESCRIPTION
    -Run once per day after market close
    -Get closing price for each ticker with open shares across all users
    -Store closes idempotently and expose run status for troubleshooting
### PLAN
        1. Create a backend close-ingestion service that resolves the global set of open-holding tickers from PurchaseLots where remainingQuantity > 0.
        2. Add a protected backend endpoint that executes one daily-close ingestion run and returns per-ticker results and totals.
        3. Use market calendar/time window gating so runs occur only on valid US trading days after close, with optional grace period before execution.
        4. Persist each close with MERGE/upsert semantics keyed by ticker + priceDate + source to guarantee idempotent reruns.
        5. Add JobRuns/JobLocks tables (or equivalent) to enforce single-run execution and capture start/end time, outcome, and error summary.
        6. Trigger the endpoint from an external scheduler (GitHub Actions cron, cloud scheduler, or host cron) rather than frontend or browser sessions.
        7. Add retry and alerting behavior for partial failures, including stale-close detection when no successful run exists for the latest market date.
        8. Add admin utility endpoints for backfill and replay by date range so missed days can be recovered safely.
        9. Add tests for ticker selection correctness, market-day gating, idempotent writes, lock behavior, and recovery workflows.

## BASE TRANSACTIONS BY TICKER (FROZEN BENCHMARK)
### DESCRIPTION
    -Each ticker can have one or more transactions marked as Base
    -Only Buy transactions are eligible to be marked as Base
    -Base performance is frozen: if base shares are later sold in actual activity, base comparison still acts as if those base shares were never sold
    -Stock History summary should compare Actual performance versus Base performance for that ticker
### PLAN
        1. Add StockTransactions.isBase boolean column (default false) with migration and backfill for existing rows.
        2. Enforce server-side rule that only buy transactions can be set isBase=true; reject sell/div updates.
        3. Add endpoint to toggle base state per transaction (for example PUT /api/stocks/:id/base) with ownership checks.
        4. Update stock transaction API responses to include isBase so frontend can render and persist base flags.
        5. In Stock History UI, add Base toggle action on buy rows only and display clear state (base or non-base).
        6. Compute base metrics per ticker from base buys only: baseShares, baseCost, baseCurrentValue (baseShares * latest historical close), baseGainLoss, baseReturnPercent.
        7. Keep base track frozen by design: ignore all sells/div adjustments when calculating baseShares and baseCost.
        8. Extend Stock History summary cards to show Actual vs Base values plus deltas (value delta and return delta).
        9. Add validation and UX messaging for no-base-selected and no-historical-price scenarios.
        10. Add backend and frontend tests covering eligibility rules, frozen-benchmark behavior, calculations, and summary rendering.
