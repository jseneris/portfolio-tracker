---
applyTo: "stock-tracker-backend/src/routes/**/*.ts"
excludeAgent: "code-review"
---

This file lists and describes the current api endpoints.

Last updated: 2026-08-02

Canonical source of truth: see `endpoints-current.md` for full behavior and request/response notes.

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
- `POST /api/stocks/historical-prices/sync-year?year=2021|2022` - Backfill historical closes for supported comparison year.
- `POST /api/stocks/historical-prices/sync-all` - Legacy convenience backfill for 2021.
- `GET /api/stocks/historical-prices` - Dual mode: date-range row retrieval or year-based comparison series.
- `GET /api/stocks/portfolio/comparison-all` - Portfolio vs benchmark series based on stored historical prices.
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
- `GET /api/lots/:ticker/open` - Get open purchase-only lots (`sourceType='purchase'`) for ticker.
- `GET /api/lots/splits` - Get all global split rows with per-user `isActive` and `canActivate` flags.
- `GET /api/lots/ticker/:ticker/splits` - Get ticker split rows with per-user `isActive` and `canActivate` flags.
- `PUT /api/lots/:id` - Update lot (adjust remaining quantity)
- `POST /api/lots/ticker/:ticker/split` - Record or return a global stock split. Body: `{ ratioNumerator, ratioDenominator, splitDate }`. Returns inactive split plus `canActivate` status.
- `POST /api/lots/splits/:splitId/activate` - Activate a split for current user when eligible. Activation updates purchase lots and reconciles display lots.

### Display Lots
- `GET /api/display-lots` - List all display-lot rows for user, with parsed `lots`, `lotCount`, and `totalQuantity`.
- `GET /api/display-lots/ticker/:ticker` - List display-lot rows for one ticker.
- `GET /api/display-lots/:id/composition` - Synthetic per-index composition view for one row.
- `POST /api/display-lots/:ticker` - Create/replace row from `quantities: number[]`.
- `POST /api/display-lots/:id/combine` - Combine selected indices.
- `POST /api/display-lots/:id/split` - Split one index into provided quantities.
- `DELETE /api/display-lots/:id` - Delete one lot index; delete row if it becomes empty.

### User Settings
- `GET /api/user-settings/targets` - Get user target rule settings (with defaults when missing).
- `PUT /api/user-settings/targets` - Upsert user target rule settings.
