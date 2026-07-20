# Priority Backlog (P1 And Above)

This backlog includes items with priority P1, P2, and P3.

## P1

1. Create a Symbols/Securities reference table and start using symbol foreign keys for all price-oriented future features.
2. Add SecurityPrices table for intraday and close prices with source, as-of timestamp, and uniqueness constraints for idempotent writes.
3. Add IndexPrices table for SP500/DOW/NASDAQ daily closes with source and date uniqueness.
4. Add JobRuns and JobLocks tables for cron observability, retry diagnostics, and single-run protection.
5. Build manual quote refresh flow (provider abstraction + endpoint + caching/throttling + freshness timestamp storage/return).
6. Build target price schema: TargetRules (user/ticker settings) and optional TargetSnapshots (materialized computed targets).
7. Implement target recalculation pipeline triggered by buy/sell/dividend-lot changes.
8. Daily close job: implement backend service to compute open-holding ticker universe from PurchaseLots (remainingQuantity > 0) and ingest closes idempotently.
9. Daily close job: add protected run endpoint for one execution window with per-ticker success/failure counts and run summary payload.
10. Daily close job: persist close records with uniqueness on ticker + priceDate + source and MERGE/upsert semantics for safe reruns.
11. Daily close job: implement single-run safeguards with JobLocks + JobRuns status transitions (running/succeeded/failed).
12. Daily close job: wire external scheduler trigger (not frontend session) and secure invocation via service credential/header.

## P2

1. Add historical close backfill utility support tables/state (job status and progress tracking) for earliest holding date imports.
2. Add portfolio-vs-index comparison support tables for contribution-adjusted performance calculations.
3. Add daily contribution ledger/summary table to avoid expensive recalculation for every comparison request.
4. Implement market-hours cron scheduling with holiday/session gating, retries, and stale-data alarms.
5. Daily close job: add market-calendar/day-close gating with grace window and explicit non-trading-day skip reason logging.
6. Daily close job: add admin replay/backfill endpoint(s) for date or date-range reruns with bounded batch controls.
7. Daily close job: add stale-close alerting and partial-failure retry policy with capped exponential backoff.
8. Daily close job: add observability endpoint/query for recent runs, duration, ticker coverage, and latest successful market date.

## P3

1. Normalize transaction types into lookup tables if richer metadata and easier future expansion are needed.
2. Add a Users table and foreign key relationships when user lifecycle/profile/authorization metadata becomes necessary.
3. Daily close job: add an operations UI panel for run history, replay controls, and failure drill-down once backend observability is stable.
