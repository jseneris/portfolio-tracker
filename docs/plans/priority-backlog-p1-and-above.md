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

## P2

1. Add historical close backfill utility support tables/state (job status and progress tracking) for earliest holding date imports.
2. Add portfolio-vs-index comparison support tables for contribution-adjusted performance calculations.
3. Add daily contribution ledger/summary table to avoid expensive recalculation for every comparison request.
4. Implement market-hours cron scheduling with holiday/session gating, retries, and stale-data alarms.

## P3

1. Normalize transaction types into lookup tables if richer metadata and easier future expansion are needed.
2. Add a Users table and foreign key relationships when user lifecycle/profile/authorization metadata becomes necessary.
