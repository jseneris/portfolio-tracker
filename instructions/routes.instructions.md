---
applyTo: "stock-tracker-backend/src/routes/**/*.ts"
excludeAgent: "code-review"
---

This file lists and describes the current api endpoints.

## API Endpoints

### Cash Transactions
- `GET /api/cash` - Get all cash transactions
- `GET /api/cash/summary` - Get cash summary (deposits, withdrawals, interest, fees, available cash, cost basis)
- `POST /api/cash` - Create cash transaction
- `PUT /api/cash/:id` - Update cash transaction
- `DELETE /api/cash/:id` - Delete cash transaction

### Stock Transactions
- `GET /api/stocks` - Get all stock transactions
- `GET /api/stocks/portfolio/summary` - Get unified portfolio summary for one user (cash totals, available cash, cash basis, adjustments, total stock cost basis, stock count, and stock list with ticker/totalShares/costBasis/lotCount)
- `GET /api/stocks/:ticker` - Get transactions for ticker
- `GET /api/stocks/:ticker/summary` - Get ticker summary (total shares across all lots, lot count, cost basis)
- `POST /api/stocks` - Create stock transaction (`buy`, `sell`, `div`)
  - `buy`: creates a new `purchase` lot for `quantity` shares at `price`
  - `div`: creates a new `dividend` lot (reinvested shares); does not affect available cash
  - `sell`: **requires** a body field `allocations: [{ lotId, quantity }, ...]` whose quantities sum to the sale `quantity`. The API validates each referenced lot belongs to the user/ticker and has enough remaining shares, then decrements each lot's `remainingQuantity` and writes a `LotAllocations` audit row per lot. There is no default/automatic lot selection - the caller must explicitly choose which lot(s) to consume. Requests missing or mismatched allocations are rejected with `400`.
- `PUT /api/stocks/:id` - Update stock transaction (`type`, `quantity`, `price`, `transactionDate`; recalculates `amount` for `buy`/`sell` and uses `quantity` for `div`)
- `DELETE /api/stocks/:id` - Delete stock transaction

### Lots
- `GET /api/lots` - Get all purchase-lot attribution rows (`PurchaseLots`)
- `GET /api/lots/:ticker` - Get open operational lots for ticker with `remainingQuantity > 0`. Supports an optional `?sourceType=purchase` or `?sourceType=dividend` query filter.
- `PUT /api/lots/:id` - Update lot (adjust remaining quantity)
- `POST /api/lots/lot/:id/split` - Split a single open lot into child lots whose quantities sum to the lot's current remaining quantity.
- `POST /api/lots/ticker/:ticker/split` - Apply a stock split. Body: `{ ratioNumerator, ratioDenominator, splitDate }` - the split is specified as a ratio matching how splits are actually announced (e.g. a 2-for-1 split is `{ ratioNumerator: 2, ratioDenominator: 1 }`, a 5-for-3 split is `{ ratioNumerator: 5, ratioDenominator: 3 }`). The API derives `multiplier = ratioNumerator / ratioDenominator` internally. Runs as a single database transaction: rejects (`409`) re-applying the exact same `(ticker, ratioNumerator, ratioDenominator, splitDate)` split twice, inserts a `StockSplits` audit row (storing the ratio and the derived multiplier), then for every lot/`buy`/`sell`/`div` transaction/lot allocation dated on or before `splitDate` across all users: multiplies `quantity`/`originalQuantity`/`remainingQuantity`/`quantityConsumed` by `multiplier`, divides `price`/`unitCost` by `multiplier` (so cost basis is unchanged), sets `splitAdjusted = true` with `lastSplitId` pointing at the new split record, and logs each affected row to `SplitAdjustments` so multiple sequential splits on the same ticker each remain traceable rather than only the most recent one.
