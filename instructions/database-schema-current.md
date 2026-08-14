---
applyTo: "stock-tracker-backend/src/db/**/*.ts"
excludeAgent: "code-review"
---

# Current Database Schema

This document reflects the schema currently created by [stock-tracker-backend/src/db/connection.ts](stock-tracker-backend/src/db/connection.ts).

## Core Transaction Tables

### CashTransactions
- Purpose: user cash ledger (`deposit`, `withdrawal`, `interest`, `fee`).
- Amount precision: `DECIMAL(18,4)`.

### StockTransactions
- Purpose: user stock ledger (`buy`, `sell`, `div`, `exchange`).
- Quantity/price precision: `DECIMAL(18,8)`.
- Includes legacy split tracking columns:
- `splitAdjusted` (BIT)
- `lastSplitId` (FK -> StockSplits)
- Current split workflow does not persistently rewrite these rows.

### StockSplits
- Purpose: global split event registry by ticker.
- Key fields:
- `ratioNumerator`, `ratioDenominator`, `multiplier`, `splitDate`
- Unique index: `UX_StockSplits_Ticker_Ratio_Date`.

### UserSplitActivations
- Purpose: per-user split activation state.
- Key fields:
- `userId`, `splitId`, `activatedBy`, `activationTransactionId`
- Unique index: `UX_UserSplitActivations_UserId_SplitId`.

## Source Lot Tables

### PurchaseLots
- Purpose: open/closed source lots for `purchase` and `dividend` inventory.
- Key fields:
- `sourceType` (`purchase` | `dividend`)
- `originalQuantity`, `remainingQuantity`, `unitCost`, `purchaseDate`
- Includes legacy split columns (`splitAdjusted`, `lastSplitId`) for compatibility.

### PurchaseLotAllocations
- Purpose: explicit sale attribution to source lots.
- Key fields:
- `saleTransactionId`, `purchaseLotId`, `quantityConsumed`.

## Display Lot Tables

### DisplayLots
- Purpose: simplified display-lot storage, one row per `(userId, ticker)`.
- Key fields:
- `lotsCsv` (`NVARCHAR(MAX)`) storing comma-separated positive lot quantities.
- Unique index:
- `UX_DisplayLots_UserId_Ticker`.

## Historical/Identity Tables

### HistoricalPrices
- Purpose: shared historical close cache (`ticker`, `priceDate`, `source`).
- Global table (no `userId`).

### Users
- Purpose: identity profile table.

### UserSettings
- Purpose: per-user target settings and thresholds.

## Current Split Model

- Split events are stored globally in `StockSplits`.
- User applicability is tracked in `UserSplitActivations`.
- Activated splits are reflected by updating purchase lots and reconciling display lots.
- Split activation does not retroactively mutate all `PurchaseLots` or `StockTransactions` rows.

## Indexing Highlights

- User and ticker query paths are indexed across transaction and lot tables.
- Open positions are accelerated by filtered/open-position indexes on `PurchaseLots`.
- Display lots are keyed by `userId + ticker` via a unique index.
