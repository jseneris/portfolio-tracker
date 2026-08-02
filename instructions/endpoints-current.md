---
applyTo: "stock-tracker-backend/src/routes/**/*.ts"
excludeAgent: "code-review"
---

# API Endpoints (Current Implementation)

Last updated: 2026-08-02

Authentication and scoping notes:
- `authenticateRequest` middleware is applied globally before route handlers.
- Data routes are user-scoped via `req.user.id` where applicable.

## Cash

### GET /api/cash
- Returns all cash transactions for the current user.
- Ordered by `transactionDate DESC`.

### GET /api/cash/summary
- Returns computed cash totals using `CashTransactions` plus stock cash impact from `StockTransactions`.
- Response includes: `deposits`, `withdrawals`, `interest`, `fees`, `buys`, `sells`, `availableCash`, `costBasis`, `adjustments`.

### POST /api/cash
- Creates a cash transaction (`type`, `amount`, `transactionDate`).
- Returns the inserted row identity payload.

### PUT /api/cash/:id
- Updates one cash transaction owned by the current user.

### DELETE /api/cash/:id
- Deletes one cash transaction owned by the current user.

## Stocks

### GET /api/stocks/portfolio/summary
- Returns one response with:
  - aggregate cash totals,
  - `availableCash`,
  - `cashBasis` and `adjustments`,
  - stock rollup (`totalStockCostBasis`, `stockCount`),
  - per-ticker holdings (`ticker`, `totalShares`, `costBasis`, `lotCount`).
- Uses `PurchaseLots` for holdings calculations.

### GET /api/stocks
- Returns all stock transactions for the current user.
- Ordered by `transactionDate DESC, ticker ASC`.

### GET /api/stocks/:ticker
- Returns all stock transactions for one ticker and user.
- Ordered by `transactionDate DESC`.

### GET /api/stocks/:ticker/summary
- Returns ticker summary from open `PurchaseLots`:
  - `totalShares`,
  - `numberOfLots`,
  - `costBasis`.

### GET /api/stocks/:transactionId/allocations
- Returns sale allocations (`PurchaseLotAllocations`) joined with lot metadata.
- Useful for rendering sell lot attribution history.

### POST /api/stocks/historical-prices/sync-year?year=2021|2022
- Incrementally backfills yearly historical closes (including benchmark tickers `^DJI`, `^IXIC`, `^GSPC`).
- Prioritizes cash-flow dates and year-end date, then fills remaining dates.
- Also attempts split discovery per owned ticker in range from first transaction date to today.
- Writes price rows with idempotent `MERGE` behavior.

### POST /api/stocks/historical-prices/sync-2021
- Legacy convenience variant for 2021 backfill behavior.
- Performs date-prioritized historical close sync for 2021.

### GET /api/stocks/historical-prices
- Dual-mode endpoint:
  - Date range mode (`startDate` + `endDate`): returns raw historical rows for that range.
  - Comparison mode (`year=2021|2022`): returns computed portfolio-vs-benchmark time series points.
- Date-range mode validates `YYYY-MM-DD` format and start/end ordering.

### GET /api/stocks/portfolio/comparison-2021
- Returns portfolio-vs-benchmark time series points based on stored historical prices up to 2021-12-31.
- Includes benchmark values for DOW/NASDAQ/S&P500 and missing-ticker diagnostics.

### POST /api/stocks
- Creates buy/sell/div transaction.
- `sell` requires explicit `allocations` whose total equals sell quantity.
- `buy` creates a `PurchaseLots` row and appends quantity to display lots.
- `div` creates a dividend `PurchaseLots` row only.
- `sell` updates `PurchaseLots`, writes `PurchaseLotAllocations`, and consumes display quantities smallest-first for purchase-sourced shares.
- On first transaction for a ticker, backend attempts backdated market-data/split discovery (non-blocking on failure).
- Split discovery does not auto-activate split events for the user.

### PUT /api/stocks/:id
- Updates one stock transaction row.

### DELETE /api/stocks/:id
- Deletes transaction and reverses side effects.
- `sell` deletion restores `PurchaseLots` and appends restored purchase shares back into display lots.
- `buy/div` deletion removes related purchase lot inventory and reconciles display quantities.

## Purchase Lots and Splits

### GET /api/lots
- Returns open `PurchaseLots` rows (`remainingQuantity > 0`) for the user.

### GET /api/lots/:ticker
- Returns open lots for ticker, with optional `?sourceType=` filter.

### GET /api/lots/:ticker/open
- Returns open purchase-source lots only (`sourceType = 'purchase'`).

### GET /api/lots/splits
- Returns all recorded split events with per-user flags:
  - `isActive` (user has activation row),
  - `canActivate` (eligibility satisfied).

### GET /api/lots/ticker/:ticker/splits
- Returns all recorded split events for a ticker with per-user flags:
  - `isActive`,
  - `canActivate`.
- Includes inactive known splits.

### PUT /api/lots/:id
- Updates lot remaining quantity.

### POST /api/lots/ticker/:ticker/split
Request body:
```json
{
  "ratioNumerator": 2,
  "ratioDenominator": 1,
  "splitDate": "2026-01-15T00:00:00Z"
}
```
- Upserts/finds a global split event in `StockSplits`.
- Does not activate automatically for the calling user.
- Returns eligibility flags so UI can decide whether activation is currently allowed.

### POST /api/lots/splits/:splitId/activate
- Activates a split for current user if eligible.
- Writes `UserSplitActivations` row.
- Applies multiplier adjustments to eligible `PurchaseLots` (`purchaseDate <= splitDate`) and reconciles display lots.

## Display Lots

### GET /api/display-lots
- Returns all display-lot rows mapped to:
- `lots` (parsed array)
- `lotCount`
- `totalQuantity`

### GET /api/display-lots/ticker/:ticker
- Same as above, ticker-scoped.

### GET /api/display-lots/:id/composition
- Returns synthetic composition entries from `lotsCsv`:
- `{ id: "<rowId>:<index>", index, quantityAllocated, ticker }`

### POST /api/display-lots/:ticker
Request body:
```json
{
  "quantities": [5, 5, 10]
}
```
- Creates or replaces the ticker row for the user.
- Stores values in `DisplayLots.lotsCsv`.

### POST /api/display-lots/:id/combine
Request body:
```json
{
  "indices": [0, 1, 2]
}
```
- Combines selected lot indices into one index slot.

### POST /api/display-lots/:id/split
Request body:
```json
{
  "index": 0,
  "quantities": [2.5, 7.5]
}
```
- Splits one lot entry by index.
- Sum of `quantities` must equal original lot quantity (within tolerance).

### DELETE /api/display-lots/:id
Request body:
```json
{
  "index": 0
}
```
- Deletes one lot entry by index.
- Deletes the row when it becomes empty.

## User Settings

### GET /api/user-settings/targets
- Returns user target settings with defaults if row is missing.
- Fields include sale target percent and buy target thresholds by display-lot count bands.

### PUT /api/user-settings/targets
- Upserts user target settings.
- Validates all target fields are finite positive numbers and bounds-checks large values.

## Health

### GET /api/health
- Returns `{ "status": "ok" }`.

## Notes

- Display-lot workflows are centered on `DisplayLots.lotsCsv` with index-based operations.
- Sell attribution is explicit and persisted in `PurchaseLotAllocations`.
- Split workflows use global `StockSplits` plus per-user `UserSplitActivations`.
