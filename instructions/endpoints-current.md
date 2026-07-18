---
applyTo: "stock-tracker-backend/src/routes/**/*.ts"
excludeAgent: "code-review"
---

# API Endpoints (Current Implementation)

All endpoints run behind auth middleware and use JSON request/response bodies.

Authentication accepted by middleware:
- `x-user-id: <user-id>`
- `Authorization: Bearer <token>` (uses `x-user-id` when provided, otherwise falls back to `dev-user`)

## Cash Endpoints

### GET /api/cash
Returns all cash transactions for the authenticated user, newest first.

Workflow:
1. Read `req.user.id` from middleware context.
2. Query `CashTransactions` filtered by `userId`.
3. Sort by `transactionDate DESC`.
4. Return the recordset as JSON.

### GET /api/cash/summary
Returns aggregate cash and stock cash-flow summary.

Workflow:
1. Aggregate cash totals from `CashTransactions` (`deposit`, `withdrawal`, `interest`, `fee`).
2. Aggregate stock cash totals from `StockTransactions` (`buy`, `sell`).
3. Compute derived fields:
   - `availableCash = deposits - withdrawals + interest - fees - buys + sells`
   - `costBasis = deposits - withdrawals`
   - `adjustments = interest - fees`
4. Return computed summary JSON.

### POST /api/cash
Creates a cash transaction.

Request body:
```json
{
  "type": "deposit|withdrawal|interest|fee",
  "amount": 1000.0,
  "transactionDate": "2026-01-15T00:00:00Z"
}
```

Workflow:
1. Validate required fields: `type`, `amount`, `transactionDate`.
2. Generate UUID for new cash transaction.
3. Insert row into `CashTransactions`.
4. Return `201` with created transaction payload.

### PUT /api/cash/:id
Updates an existing cash transaction for the authenticated user.

Workflow:
1. Read `id` path param and payload fields.
2. Update matching `CashTransactions` row scoped by `id` and `userId`.
3. Set `updatedAt = GETUTCDATE()`.
4. Return updated object payload.

### DELETE /api/cash/:id
Deletes an existing cash transaction for the authenticated user.

Workflow:
1. Read `id` path param.
2. Delete row from `CashTransactions` where `id` and `userId` match.
3. Return `204` with empty body.

## Stock Endpoints

### GET /api/stocks/portfolio/summary
Returns cash summary plus open holdings rollup.

Workflow:
1. Run CTE-based summary query:
   - Cash aggregates from `CashTransactions`.
   - Buy/sell cash aggregates from `StockTransactions`.
   - Open stock totals from `PurchaseLots` (`remainingQuantity > 0`).
2. Run grouped holdings query by `ticker` from `PurchaseLots`.
3. Convert nullable numeric fields to numbers.
4. Return combined summary object with `stocks` array.

### GET /api/stocks
Returns all stock transactions for the authenticated user.

Workflow:
1. Query `StockTransactions` by `userId`.
2. Sort by `transactionDate DESC, ticker ASC`.
3. Return recordset JSON.

### GET /api/stocks/:ticker
Returns all stock transactions for one ticker.

Workflow:
1. Normalize path `ticker` to uppercase.
2. Query `StockTransactions` filtered by `userId` and ticker.
3. Sort by `transactionDate DESC`.
4. Return recordset JSON.

### GET /api/stocks/:ticker/summary
Returns open position summary for one ticker.

Workflow:
1. Normalize ticker to uppercase.
2. Aggregate open lots from `PurchaseLots` (`remainingQuantity > 0`) for that ticker.
3. Return summary:
   - `totalShares`
   - `numberOfLots`
   - `costBasis`

### GET /api/stocks/:transactionId/allocations
Returns purchase-lot allocations for a sale transaction.

Workflow:
1. Query `PurchaseLotAllocations` joined to `PurchaseLots` by `purchaseLotId`.
2. Filter by `saleTransactionId` and `userId`.
3. Map decimals to numeric response fields.
4. Return allocation list in purchase-date order.

### POST /api/stocks
Creates a stock transaction (`buy`, `sell`, or `div`) and applies side effects transactionally.

Request body (buy/div):
```json
{
  "ticker": "AAPL",
  "type": "buy|div",
  "quantity": 10,
  "price": 150.0,
  "transactionDate": "2026-01-15T00:00:00Z"
}
```

Request body (sell):
```json
{
  "ticker": "AAPL",
  "type": "sell",
  "quantity": 5,
  "price": 160.0,
  "transactionDate": "2026-01-20T00:00:00Z",
  "allocations": [
    { "lotId": "purchase-lot-uuid", "quantity": 5 }
  ]
}
```

Workflow:
1. Validate required fields and normalize ticker.
2. Compute `amount = quantity * price` for supported types.
3. For `sell`:
   - Require explicit `allocations`.
   - Validate allocation totals equal sell `quantity`.
   - Validate each lot exists and has enough remaining shares.
   - Validate allocated purchase dates are not after sale date.
   - Build smallest-lot-first operational consumption plan for open lots.
4. Open SQL transaction.
5. Insert row into `StockTransactions`.
6. Apply type-specific side effects:
   - `buy`: create `PurchaseLots` row (`sourceType = purchase`) and matching `DisplayLots` + `DisplayLotComposition`.
  - `div`: create `PurchaseLots` row (`sourceType = dividend`) only.
  - `sell`: decrement `PurchaseLots.remainingQuantity`, insert `PurchaseLotAllocations`, consume `DisplayLots` smallest-first only for shares allocated from `sourceType = purchase`, then insert `DisplayLotAllocations`.
7. Commit transaction and return `201` with created transaction payload.

### PUT /api/stocks/:id
Updates a stock transaction row (no lot recomputation logic).

Workflow:
1. Read path `id` and payload fields.
2. Recompute `amount` from payload.
3. Update matching `StockTransactions` row by `id` and `userId`.
4. Set `updatedAt = GETUTCDATE()`.
5. Return updated payload.

### DELETE /api/stocks/:id
Deletes a stock transaction and reverses side effects transactionally.

Workflow:
1. Lookup transaction by `id` and `userId`.
2. If not found, return `404`.
3. Start SQL transaction.
4. If type is `sell`:
   - Restore consumed shares to `PurchaseLots` from `PurchaseLotAllocations`.
   - Restore display quantities in `DisplayLots` from `DisplayLotAllocations`.
5. If type is `buy` or `div`:
   - Locate related `PurchaseLots`.
   - Delete related `DisplayLotComposition`, `DisplayLots`, then `PurchaseLots`.
6. Delete the `StockTransactions` row.
7. Commit and return `204`.

## Purchase Lots Endpoints

### GET /api/lots
Returns open purchase lots (all tickers) for user.

Workflow:
1. Query `PurchaseLots` by `userId` with `remainingQuantity > 0`.
2. Sort by `purchaseDate ASC`.
3. Return recordset JSON.

### GET /api/lots/:ticker
Returns open purchase lots for a ticker, optional source-type filter.

Optional query:
- `sourceType=purchase|dividend`

Workflow:
1. Normalize ticker to uppercase.
2. Query `PurchaseLots` with `remainingQuantity > 0`.
3. If `sourceType` provided, add filter.
4. Sort by `purchaseDate ASC`.
5. Return recordset JSON.

### GET /api/lots/:ticker/open
Returns open purchase-only lots for a ticker (dividend lots excluded).

Workflow:
1. Normalize ticker to uppercase.
2. Query `PurchaseLots` where:
   - `sourceType = 'purchase'`
   - `remainingQuantity > 0`
3. Sort by `purchaseDate ASC`.
4. Return recordset JSON.

### PUT /api/lots/:id
Updates remaining quantity for one purchase lot.

Workflow:
1. Read path `id` and `remainingQuantity` from body.
2. Update matching `PurchaseLots` row by `id` and `userId`.
3. Set `updatedAt = GETUTCDATE()`.
4. Return updated payload.

### POST /api/lots/ticker/:ticker/split
Applies a stock split for one ticker, retroactively up to `splitDate`.

Request body:
```json
{
  "ratioNumerator": 2,
  "ratioDenominator": 1,
  "splitDate": "2026-01-15T00:00:00Z"
}
```

Workflow:
1. Validate split ratio and `splitDate`.
2. Normalize ticker and compute `multiplier`.
3. Start SQL transaction.
4. Prevent duplicate split by checking `StockSplits` for same ticker, ratio, and date.
5. Insert split event into `StockSplits`.
6. Update split-eligible rows (`<= splitDate`) across:
   - `PurchaseLots` (quantities multiplied, unit cost divided)
   - `StockTransactions` for `buy|sell|div` (quantity/price adjusted)
   - `PurchaseLotAllocations` (quantity consumed scaled)
7. Insert audit rows into `SplitAdjustments` for touched entities.
8. Commit and return split summary payload.

## Display Lots Endpoints

### GET /api/display-lots
Returns all open display lots for user.

Workflow:
1. Query `DisplayLots` filtered by `userId` and `totalQuantity > 0`.
2. Sort by `ticker ASC, totalQuantity ASC`.
3. Map numeric fields and return JSON list.

### GET /api/display-lots/ticker/:ticker
Returns open display lots for one ticker.

Workflow:
1. Normalize ticker to uppercase.
2. Query `DisplayLots` by `userId`, ticker, and `totalQuantity > 0`.
3. Sort by `totalQuantity ASC, createdAt ASC`.
4. Return mapped list.

### GET /api/display-lots/:id/composition
Returns composition rows for a display lot.

Workflow:
1. Verify display lot exists and belongs to user.
2. If not found, return `404`.
3. Query `DisplayLotComposition` joined to `PurchaseLots`.
4. Return composition list with lot metadata.

### POST /api/display-lots/:ticker
Creates one display lot from provided purchase-lot composition.

Request body:
```json
{
  "composition": [
    { "purchaseLotId": "lot-uuid-1", "quantityAllocated": 10 },
    { "purchaseLotId": "lot-uuid-2", "quantityAllocated": 10 }
  ]
}
```

Workflow:
1. Validate `composition` array and positive quantities.
2. Normalize ticker.
3. Start SQL transaction.
4. Validate each `purchaseLotId` belongs to user and ticker.
5. Insert new `DisplayLots` row with summed `totalQuantity`.
6. Insert `DisplayLotComposition` rows.
7. Commit and return `201` with new display lot summary.

### POST /api/display-lots/:id/combine
Combines one source display lot (`:id`) plus additional lot IDs into one new lot.

Request body:
```json
{
  "displayLotIds": ["display-lot-uuid-1", "display-lot-uuid-2"]
}
```

Workflow:
1. Validate `displayLotIds` is non-empty.
2. Build merge set: `:id` + request IDs.
3. Start SQL transaction.
4. Verify all source lots exist for user.
5. Validate all source lots share the same ticker.
6. Insert new combined `DisplayLots` row with total summed quantity.
7. Copy all source composition rows into the new lot.
8. Delete old source lots (composition rows cascade-delete).
9. Commit and return `201` with merge summary.

### POST /api/display-lots/:id/split
Splits one display lot into multiple new display lots.

Request body:
```json
{
  "splits": [
    { "quantityAllocated": 10 },
    { "quantityAllocated": 10 }
  ]
}
```

Workflow:
1. Validate `splits` has at least 2 items and positive quantities.
2. Start SQL transaction.
3. Load source display lot by `id` and `userId`; return `404` if missing.
4. Validate split quantities sum to source lot total (within tolerance).
5. Load source `DisplayLotComposition`.
6. For each split target:
   - Insert new `DisplayLots` row.
   - Distribute each source composition proportionally into new composition rows.
7. Delete original source display lot.
8. Commit and return `201` with new display lot IDs.

### DELETE /api/display-lots/:id
Deletes a display lot when it has no active sale allocations.

Workflow:
1. Check `DisplayLotAllocations` count for the display lot.
2. If allocations exist, return `400` with dependency error.
3. Delete `DisplayLots` row scoped by `id` and `userId`.
4. If row not found, return `404`.
5. Return `204` with empty body.

## Health Endpoint

### GET /api/health
Simple API health check.

Workflow:
1. Return static JSON `{ "status": "ok" }`.

## Error Handling

Standard error shape:
```json
{
  "error": "Description of the error"
}
```

Common status codes in current routes:
- `200`: Successful read/update responses.
- `201`: Successful creation endpoints.
- `204`: Successful delete with empty body.
- `400`: Validation and business-rule failures.
- `404`: Missing resources.
- `409`: Duplicate split application attempt.
- `500`: Unexpected server/database errors.

## Notes

- Cash amounts are persisted using SQL `DECIMAL` precision.
- Share quantities use `DECIMAL(18,8)` to preserve split math accuracy.
- Most complex write operations run in SQL transactions.
- Sell processing uses explicit purchase-lot attribution plus smallest-first operational consumption for open lots and display lots.
- Split processing is implemented on lots routes at `POST /api/lots/ticker/:ticker/split`.
