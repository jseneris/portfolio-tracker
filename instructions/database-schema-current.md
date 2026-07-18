---
applyTo: "stock-tracker-backend/src/db/**/*.ts"
excludeAgent: "code-review"
---

# Current Database Schema

This document describes the **actual** current database schema as implemented in `stock-tracker-backend/src/db/connection.ts`.

## Core Tables

### CashTransactions
Tracks user cash deposits, withdrawals, interest, and fees.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier from Auth0
- `type` (NVARCHAR(50)): `deposit`, `withdrawal`, `interest`, or `fee`
- `amount` (DECIMAL(18,4)): Transaction amount, must be > 0
- `transactionDate` (DATETIME2): Date of transaction
- `createdAt` (DATETIME2): Record creation timestamp
- `updatedAt` (DATETIME2): Record update timestamp

**Indexes:**
- `IX_CashTransactions_UserId`
- `IX_CashTransactions_Date` on `transactionDate`
- `IX_CashTransactions_UserId_TransactionDate` composite index

---

### StockTransactions
Tracks stock purchases, sales, and dividend transactions.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `ticker` (NVARCHAR(10)): Stock ticker symbol (e.g., AAPL)
- `type` (NVARCHAR(50)): `buy`, `sell`, or `div`
- `quantity` (DECIMAL(18,8)): Number of shares (adjusted by stock splits)
- `price` (DECIMAL(18,8)): Price per share (adjusted by stock splits, widened for precision)
- `amount` (DECIMAL(18,4)): Total transaction amount
- `transactionDate` (DATETIME2): Date of transaction
- `splitAdjusted` (BIT): Flag indicating if affected by at least one stock split
- `lastSplitId` (UNIQUEIDENTIFIER FK): Reference to most recent `StockSplits` record
- `createdAt` (DATETIME2): Record creation timestamp
- `updatedAt` (DATETIME2): Record update timestamp

**Constraints:**
- `CK_StockTransactions_Type`: type must be `buy`, `sell`, or `div`
- `CK_StockTransactions_PositiveValues`: For buy/sell, quantity>0, price>0, amount>0. For div, amount>0.
- Foreign key to `StockSplits(id)` on `lastSplitId`

**Indexes:**
- `IX_StockTransactions_UserId`
- `IX_StockTransactions_Ticker`
- `IX_StockTransactions_Date`
- `IX_StockTransactions_UserId_Ticker_TransactionDate` composite index

---

### StockSplits
Audit record of each stock split event. Enables retroactive adjustment of lots and transactions.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `ticker` (NVARCHAR(10)): Stock ticker symbol
- `ratioNumerator` (DECIMAL(18,8)): "New shares" side of ratio (e.g., `2` for 2-for-1)
- `ratioDenominator` (DECIMAL(18,8)): "Old shares" side of ratio (e.g., `1` for 2-for-1)
- `multiplier` (DECIMAL(18,8)): Derived as `ratioNumerator / ratioDenominator` (factor applied to quantities)
- `splitDate` (DATETIME2): Effective date of split
- `createdAt` (DATETIME2): Record creation timestamp

**Constraints:**
- `CK_StockSplits_PositiveRatio`: ratioNumerator>0, ratioDenominator>0, multiplier>0
- Unique constraint on `(ticker, ratioNumerator, ratioDenominator, splitDate)` to prevent duplicate splits

**Indexes:**
- `IX_StockSplits_UserId`
- `IX_StockSplits_Ticker`
- `UX_StockSplits_Ticker_Ratio_Date` unique on `(ticker, ratioNumerator, ratioDenominator, splitDate)`

---

### SplitAdjustments
Full history of every record touched by every split. Preserves audit trail when ticker splits multiple times.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `splitId` (UNIQUEIDENTIFIER FK): Reference to `StockSplits` record
- `entityType` (NVARCHAR(20)): `lot`, `transaction`, or `allocation` - which table affected
- `entityId` (UNIQUEIDENTIFIER): ID of affected `PurchaseLots`, `StockTransactions`, or `PurchaseLotAllocations` row
- `multiplier` (DECIMAL(18,8)): The multiplier applied by this split
- `createdAt` (DATETIME2): Record creation timestamp

**Constraints:**
- Foreign key to `StockSplits(id)`

**Indexes:**
- `IX_SplitAdjustments_UserId`
- `IX_SplitAdjustments_SplitId`
- `IX_SplitAdjustments_EntityId`

---

## Source Lots

### PurchaseLots
Represents individual purchase or dividend lots. Created automatically by buy/dividend transactions.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `ticker` (NVARCHAR(10)): Stock ticker symbol
- `transactionId` (UNIQUEIDENTIFIER FK): Reference to buy/dividend `StockTransactions` record
- `sourceType` (NVARCHAR(20)): `purchase` (from buy) or `dividend` (from dividend reinvestment)
- `originalQuantity` (DECIMAL(18,8)): Initial shares in lot
- `remainingQuantity` (DECIMAL(18,8)): Current shares after sales (mutable)
- `unitCost` (DECIMAL(18,8)): Cost per share (adjusted by stock splits, widened for precision)
- `purchaseDate` (DATETIME2): Date lot was acquired
- `splitAdjusted` (BIT): Flag indicating if affected by at least one stock split
- `lastSplitId` (UNIQUEIDENTIFIER FK): Reference to most recent `StockSplits` record
- `createdAt` (DATETIME2): Record creation timestamp
- `updatedAt` (DATETIME2): Record update timestamp

**Constraints:**
- Foreign key to `StockTransactions(id)` with CASCADE on delete
- Foreign key to `StockSplits(id)` on `lastSplitId`

**Indexes:**
- `IX_PurchaseLots_UserId`
- `IX_PurchaseLots_Ticker`
- `IX_PurchaseLots_Date` on `purchaseDate`
- `IX_PurchaseLots_SourceType`
- `IX_PurchaseLots_UserId_Ticker_PurchaseDate` composite index
- `IX_PurchaseLots_OpenPositions_UserId_Ticker_PurchaseDate` filtered index (where remainingQuantity > 0) with included columns `remainingQuantity, unitCost`

---

### PurchaseLotAllocations
Explicit user-directed allocation of sales to source lots. Provides audit trail for lot-specific consumption.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `saleTransactionId` (UNIQUEIDENTIFIER FK): Reference to `sell` `StockTransactions` record
- `purchaseLotId` (UNIQUEIDENTIFIER FK): Reference to `PurchaseLots` record being consumed
- `quantityConsumed` (DECIMAL(18,8)): Shares taken from lot for this sale, must be > 0
- `createdAt` (DATETIME2): Record creation timestamp
- `updatedAt` (DATETIME2): Record update timestamp

**Constraints:**
- Foreign key to `StockTransactions(id)` with CASCADE on delete
- Foreign key to `PurchaseLots(id)`

**Indexes:**
- `IX_PurchaseLotAllocations_UserId`
- `IX_PurchaseLotAllocations_SaleTransactionId`
- `IX_PurchaseLotAllocations_PurchaseLotId`

---

## Display Lots

### DisplayLots
User-created organizational groupings of purchase lots to determine target purchase prices. Not transaction-tied.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `ticker` (NVARCHAR(10)): Stock ticker symbol
- `totalQuantity` (DECIMAL(18,8)): Sum of all purchase lot allocations in this display lot, must be ≥ 0
- `createdAt` (DATETIME2): Record creation timestamp
- `updatedAt` (DATETIME2): Record update timestamp

**Constraints:**
- `totalQuantity >= 0`

**Indexes:**
- `IX_DisplayLots_UserId`
- `IX_DisplayLots_Ticker`

---

### DisplayLotComposition
Maps each display lot to its underlying purchase lot allocations.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `displayLotId` (UNIQUEIDENTIFIER FK): Reference to `DisplayLots` record
- `purchaseLotId` (UNIQUEIDENTIFIER FK): Reference to `PurchaseLots` record
- `quantityAllocated` (DECIMAL(18,8)): Shares from purchase lot allocated to this display lot, must be > 0
- `createdAt` (DATETIME2): Record creation timestamp
- `updatedAt` (DATETIME2): Record update timestamp

**Constraints:**
- Foreign key to `DisplayLots(id)` with CASCADE on delete
- Foreign key to `PurchaseLots(id)`
- `quantityAllocated > 0`

**Indexes:**
- `IX_DisplayLotComposition_DisplayLotId`
- `IX_DisplayLotComposition_PurchaseLotId`

---

### DisplayLotAllocations
Tracks which display lots are consumed during sales, reversible when sale is deleted.

**Columns:**
- `id` (UNIQUEIDENTIFIER): Primary key, auto-generated
- `userId` (NVARCHAR(255)): User identifier
- `saleTransactionId` (UNIQUEIDENTIFIER FK): Reference to `sell` `StockTransactions` record
- `displayLotId` (UNIQUEIDENTIFIER FK): Reference to `DisplayLots` record being consumed
- `quantityConsumed` (DECIMAL(18,8)): Shares from display lot consumed in this sale, must be > 0
- `createdAt` (DATETIME2): Record creation timestamp

**Constraints:**
- Foreign key to `StockTransactions(id)` with CASCADE on delete
- Foreign key to `DisplayLots(id)`
- `quantityConsumed > 0`

**Indexes:**
- `IX_DisplayLotAllocations_UserId`
- `IX_DisplayLotAllocations_SaleTransactionId`
- `IX_DisplayLotAllocations_DisplayLotId`

---

## Key Design Patterns

### Precision & Stock Splits
- Share quantities use `DECIMAL(18,8)` for precision after repeated splits
- Unit costs widened to `DECIMAL(18,8)` (previously `DECIMAL(18,4)`) to prevent rounding error accumulation
- Stock split adjustment factors stored alongside original ratio numerator/denominator for auditability

### Split Audit Trail
- `SplitAdjustments` table preserves **full history** of every split applied to every record
- `lastSplitId` columns on `StockTransactions` and `PurchaseLots` only track the **most recent** split
- Together they enable both retroactive recalculation and complete audit trails

### Display Lot Architecture
- Display lots are independent of transactions—never auto-created, only manually composed by users
- Smallest-first consumption: when sales are recorded, they consume display lots in ascending quantity order
- Display lot invariant: sum of all display lot quantities = sum of all purchase lot remaining quantities (dividend lots excluded)

### Cascade Deletions
- Deleting a `DisplayLots` row cascades to `DisplayLotComposition` rows
- Deleting a `StockTransactions` row cascades to `PurchaseLotAllocations` and `DisplayLotAllocations` rows
- Deleting a `PurchaseLots` row does NOT cascade (to prevent accidental data loss)

---

## Normalization & Indexing Strategy

All tables are indexed for common query patterns:
- User-specific queries: indexed on `userId`
- Ticker-specific rollups: indexed on `ticker`
- Open positions: filtered index on `remainingQuantity > 0`
- Composite queries: multi-column indexes for common WHERE + ORDER BY patterns

Foreign keys enforced at database level to prevent orphaned records.
