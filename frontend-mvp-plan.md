# Frontend Plan: MVP First, Enhancements After

## Goal
Deliver a usable stock tracker frontend quickly with core portfolio workflows first, then layer future enhancements without destabilizing the MVP.

## Phase 0: Foundation
1. Set up React + TypeScript app structure in stock-tracker-frontend.
2. Configure routing, API client, global error handling, and shared UI layout.
3. Define typed API contracts for existing backend endpoints:
   - /api/cash
   - /api/stocks
   - /api/lots
4. Implement auth/header strategy compatible with current backend user model.
5. Add baseline frontend test setup and lint/format tooling.

## Phase 1: MVP (Highest Priority)
1. Dashboard
   - Use portfolio summary endpoint as primary data source.
   - Display available cash, cash basis, adjustments, stock cost basis, and holdings table.
   - Add quick Add Stock modal for buy entry from dashboard.
   - Make ticker cells navigable to stock-specific history page.
2. Cash Management
   - Build create, edit, delete, and list flows for cash transactions.
   - Refresh summary after mutations.
3. Stock Transactions
   - Build buy and dividend transaction forms.
   - Support historical transaction dates.
   - Add edit/delete actions for stock transaction records.
4. Sell With Explicit Lot Allocation
   - Fetch available lots by ticker.
   - Require user-selected lot allocations.
   - Validate allocation total equals sell quantity before submit.
5. Holdings Detail
   - Per-ticker transaction view and lots view.
   - Show remaining shares and lot-level cost information.
   - Show per-ticker summary metrics on stock-specific page (Total Shares, Open Lots, Cost Basis).
   - Keep stock-specific Add Transaction modal tickerless by inferring ticker from route.
6. MVP Quality Gate
   - Add frontend tests for critical workflows and validations.
   - Run manual acceptance checklist against backend behavior.

## MVP Done Criteria
1. User can complete cash CRUD end to end.
2. User can submit buy, dividend, and sell transactions.
3. Sell flow enforces explicit lot allocation correctly.
4. Dashboard reflects backend-calculated summary values.
5. App is stable for normal and validation-error paths.
6. Transaction dates render as entered dates without timezone day-shift regressions.

## Phase 2: Enhancement-Ready Platform
1. Add feature flags to isolate post-MVP functionality.
2. Add reusable chart/time-series components.
3. Add reusable async status components (loading, partial failure, retries).
4. Standardize notifications and error surfaces across pages.

## Phase 3: P1 Enhancements
1. Stock Splits UI
   - Split form and result feedback.
   - Display split status/history context on relevant pages.
2. Current Prices
   - Add manual quote refresh button on dashboard.
   - Show quote freshness timestamps and partial-failure states.
3. Target Prices
   - Add target settings page.
   - Show target levels on dashboard and holdings views.

## Phase 4: P2/P3 Enhancements
1. Historical Closing Prices
   - Add utility workflows for backfill and retrieval.
   - Add historical price displays.
2. Index Comparison
   - Add portfolio vs index comparison views with date range controls.
3. Cron Observability
   - Add job status/health UI when backend observability endpoints are ready.
4. Longer-Term Data Model Features
   - Add admin/maintenance views as normalization changes are introduced.

## Dependency Order
1. MVP does not depend on pricing, cron, or index features.
2. P1 depends on backend readiness for quote refresh and target rules.
3. P2/P3 depends on backend readiness for historical/index/cron APIs.
4. Enhancements should remain behind feature flags until fully validated.

## Risks and Mitigation
1. Lot allocation UX complexity
   - Mitigation: clear allocation table, live total indicator, blocking validation.
2. Split and precision confusion
   - Mitigation: show before/after context and explicit ratio display in UI.
3. Stale pricing data during early rollout
   - Mitigation: freshness timestamp and manual refresh feedback.
4. Scope creep before MVP completion
   - Mitigation: strict phase gates and definition-of-done checks.

## Suggested Execution Cadence
1. Week 1: Foundation + dashboard + cash flows.
2. Week 2: Stock buy/dividend + sell with lot allocation + holdings detail.
3. Week 3: MVP hardening, tests, bug fixes, and release.
4. Week 4+: P1 rollout behind feature flags, then P2/P3.
