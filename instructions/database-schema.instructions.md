---
applyTo: "stock-tracker-backend/src/db/**/*.ts"
excludeAgent: "code-review"
---

This file describes the current database schema.  Any changes should be reflected here. 

## Database Schema

### SchemaMigrations
Tracks schema hardening/migration steps applied by startup bootstrap logic.
- **id**: Unique identifier
- **migrationKey**: Unique migration identifier (for example `2026-07-12-p0-hardening`)
- **appliedAt**: UTC timestamp when the migration step was recorded
- **notes**: Optional migration notes

### CashTransactions
- **id**: Unique identifier
- **userId**: User identifier (from Auth0)
- **type**: `deposit`, `withdrawal`, `interest`, `fee`
- **amount**: Transaction amount (decimal)
- **transactionDate**: Date of transaction
- **createdAt/updatedAt**: Timestamps
- **indexes**:
	- `IX_CashTransactions_UserId`
	- `IX_CashTransactions_Date`
	- `IX_CashTransactions_UserId_TransactionDate` (composite)

### StockTransactions
- **id**: Unique identifier
- **userId**: User identifier
- **ticker**: Stock ticker symbol (e.g., AAPL)
- **type**: `buy`, `sell`, `div`
- **quantity**: Number of shares
- **price**: Price per share, `DECIMAL(18,8)` (adjusted by any applicable stock split(s); widened precision keeps this accurate across repeated splits)
- **amount**: Total transaction amount
- **transactionDate**: Date of transaction
- **createdAt/updatedAt**: Timestamps
- **splitAdjusted**: flag to indicate if affected by at least one stock split
- **lastSplitId**: Foreign key to the most recent `StockSplits` record applied to this transaction (see `SplitAdjustments` for the *full* split history, not just the latest one)
- **validation constraints**:
	- `type` must be one of `buy`, `sell`, `div`
	- `quantity > 0`, `price > 0`, and `amount > 0`
- **indexes**:
	- `IX_StockTransactions_UserId`
	- `IX_StockTransactions_Ticker`
	- `IX_StockTransactions_Date`
	- `IX_StockTransactions_UserId_Ticker_TransactionDate` (composite)

### Lots
- **id**: Unique identifier
- **userId**: User identifier
- **ticker**: Stock ticker symbol
- **transactionId**: Reference to the buy or dividend transaction that created this lot
- **sourceType**: `purchase` or `dividend` - distinguishes lots created by a buy from lots created by a reinvested dividend
- **originalQuantity**: Initial shares in the lot
- **remainingQuantity**: Current shares in the lot after any sale allocations
- **unitCost**: Cost per share, `DECIMAL(18,8)` (adjusted by any applicable stock split(s); widened precision keeps cost basis accurate across repeated splits)
- **purchaseDate**: Date lot was acquired
- **createdAt/updatedAt**: Timestamps
- **splitAdjusted**: flag to indicate if affected by at least one stock split
- **lastSplitId**: Foreign key to the most recent `StockSplits` record applied to this lot (see `SplitAdjustments` for the *full* split history, not just the latest one)
- **indexes**:
	- `IX_Lots_UserId`
	- `IX_Lots_Ticker`
	- `IX_Lots_Date`
	- `IX_Lots_SourceType`
	- `IX_Lots_UserId_Ticker_PurchaseDate` (composite)
	- `IX_Lots_OpenPositions_UserId_Ticker_PurchaseDate` (filtered where `remainingQuantity > 0`, includes `remainingQuantity` and `unitCost`)

### LotAllocations
Records which lot(s) a sale transaction drew from and how much of each lot was consumed. This is the audit trail behind the user's explicit lot-selection on every sell - there is no automatic FIFO/LIFO allocation.
- **id**: Unique identifier
- **userId**: User identifier
- **saleTransactionId**: Reference to the `sell` StockTransactions row
- **lotId**: Reference to the Lots row this allocation consumed shares from
- **quantityConsumed**: Number of shares taken from the lot for this sale. Rescaled by any stock split whose `splitDate` is on or after the sale's `transactionDate`, so this stays consistent with the split-adjusted lot it references.
- **createdAt/updatedAt**: Timestamps

### StockSplits
Audit record of each stock split applied to a ticker, used to retroactively adjust affected lots/transactions/allocations and to flag which records were touched. A given ticker can have any number of `StockSplits` rows (one per split event); the same `(ticker, ratioNumerator, ratioDenominator, splitDate)` combination cannot be applied twice.
- **id**: Unique identifier
- **ticker**: Stock ticker symbol
- **ratioNumerator**: The "new shares" side of the split ratio as entered by the caller (e.g. `2` for a 2-for-1 split, `5` for a 5-for-3 split)
- **ratioDenominator**: The "old shares" side of the split ratio as entered by the caller (e.g. `1` for a 2-for-1 split, `3` for a 5-for-3 split)
- **multiplier**: Derived as `ratioNumerator / ratioDenominator`; this is the factor actually applied to share quantities (and its inverse to price/unitCost)
- **splitDate**: Effective date of the split; lots/transactions/allocations dated on or before this date are adjusted
- **createdAt**: Timestamp
- **validation constraints**:
	- `ratioNumerator > 0`
	- `ratioDenominator > 0`
	- `multiplier > 0`
- **uniqueness/indexes**:
	- `UX_StockSplits_Ticker_Ratio_Date` on `(ticker, ratioNumerator, ratioDenominator, splitDate)`
	- `IX_StockSplits_Ticker`

### SplitAdjustments
Full history of every individual record touched by every split, so a ticker can be split multiple times without losing track of what happened at each step (the `lastSplitId`/`splitAdjusted` columns on `Lots`/`StockTransactions` only ever show the *most recent* split - this table has one row per split per affected record).
- **id**: Unique identifier
- **userId**: User identifier
- **splitId**: Reference to the `StockSplits` row that caused this adjustment
- **entityType**: `lot`, `transaction`, or `allocation` - which table the affected record lives in
- **entityId**: Id of the affected `Lots` / `StockTransactions` / `LotAllocations` row
- **multiplier**: The multiplier applied to this record by this split
- **createdAt**: Timestamp

