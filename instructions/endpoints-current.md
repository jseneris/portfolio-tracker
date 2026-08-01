---
applyTo: "stock-tracker-backend/src/routes/**/*.ts"
excludeAgent: "code-review"
---

# API Endpoints (Current Implementation)

All routes are authenticated and user-scoped via middleware.

## Cash

### GET /api/cash
- Returns user cash transactions.

### GET /api/cash/summary
- Returns deposits, withdrawals, interest, fees, buys/sells impact, and available cash.

### POST /api/cash
- Creates a cash transaction.

### PUT /api/cash/:id
- Updates a cash transaction.

### DELETE /api/cash/:id
- Deletes a cash transaction.

## Stocks

### GET /api/stocks
- Returns user stock transactions.

### GET /api/stocks/:ticker
- Returns transactions for one ticker.

### GET /api/stocks/:ticker/summary
- Returns ticker summary (`totalShares`, `numberOfLots`, `costBasis`) with activated splits applied dynamically.

### GET /api/stocks/portfolio/summary
- Returns full portfolio summary with dynamic split projection.

### GET /api/stocks/:transactionId/allocations
- Returns purchase-lot allocations for a sell transaction.

### POST /api/stocks
- Creates buy/sell/div transaction.
- `sell` requires explicit `allocations` whose total equals sell quantity.
- `buy` creates a `PurchaseLots` row and appends quantity to display lots.
- `div` creates a dividend `PurchaseLots` row only.
- `sell` updates `PurchaseLots`, writes `PurchaseLotAllocations`, and consumes display quantities smallest-first for purchase-sourced shares.
- After insert, automatic split catch-up writes activation rows when applicable.

### PUT /api/stocks/:id
- Updates one stock transaction row.

### DELETE /api/stocks/:id
- Deletes transaction and reverses side effects.
- `sell` deletion restores `PurchaseLots` and appends restored purchase shares back into display lots.
- `buy/div` deletion removes related purchase lot inventory and reconciles display quantities.

## Purchase Lots and Splits

### GET /api/lots
- Returns open lots for user.

### GET /api/lots/:ticker
- Returns open lots for ticker, optional `sourceType` filter.

### GET /api/lots/:ticker/open
- Returns open purchase-only lots for ticker (`sourceType = purchase`).

### GET /api/lots/splits
### GET /api/lots/ticker/:ticker/splits
- Returns split history (global split events).

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
- Activates it for the calling user in `UserSplitActivations`.
- Does not bulk-rewrite all historical transaction/lot rows.

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

## Health

### GET /api/health
- Returns `{ "status": "ok" }`.

## Notes

- Display-lot and split workflows are centered on `DisplayLots.lotsCsv`, `PurchaseLotAllocations`, `StockSplits`, and `UserSplitActivations`.
