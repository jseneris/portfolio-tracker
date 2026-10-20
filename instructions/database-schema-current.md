---
applyTo: "stock-tracker-backend/src/db/**/*.ts"
excludeAgent: "code-review"
---

# Current Database Schema

This document reflects the schema currently created by [stock-tracker-backend/src/db/connection.ts](stock-tracker-backend/src/db/connection.ts).

## Core Transaction Tables

### WatchlistItems
- Purpose: per-user Stocks-chart watchlist, independent of holdings and transactions.
- `id` UNIQUEIDENTIFIER primary key; `userId` NVARCHAR(255); `ticker` NVARCHAR(10); `startDate` DATE; `createdAt` DATETIME2.
- Unique `(userId, ticker)` prevents duplicate symbols for one user.
- `pricesThrough` DATE and `pricesUpdatedAt` DATETIME2 track the daily price-cache refresh.
- Checkbox selections are browser-session state and are not stored.

### WatchlistPrices
- Purpose: cached daily Yahoo Finance closing prices for each watchlist item.
- Composite primary key `(watchlistId, priceDate)`; `closePrice` DECIMAL(18,8) must be positive.
- Foreign key to `WatchlistItems(id)` with cascading deletion.
- Cache is separate from portfolio `HistoricalPrices`; watchlist downloads do not alter holdings, lots, transactions, or split activations.
- Provider close prices are split-adjusted; adjusted-close/distribution total returns are not used.

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
- `aiInsightsEnabled` (`BIT NOT NULL DEFAULT 0`) controls access to AI portfolio insights. It is not user-editable through the public API.
- Admins can grant or revoke access with `UPDATE Users SET aiInsightsEnabled = 1 WHERE id = N'<user-id>'` or `UPDATE Users SET aiInsightsEnabled = 0 WHERE id = N'<user-id>'`.

### UserSettings
- Purpose: per-user target settings and thresholds.
- `buyOnDipBuyTargetPercent` (`DECIMAL(9,4) NOT NULL DEFAULT 1`): percent below the captured Buy on Dip price used for the buy target. Startup adds the column to existing databases.

### UserTickerPreferences
- Purpose: persistent per-user/per-ticker dashboard buying signals.
- Key fields:
- `buyOnDip` (enables captured-price target overrides).
- `buyOnDipPrice` (`DECIMAL(18,8) NULL`): ticker price captured when checking Buy on Dip and persisted on Save Preferences. Sell target = price * 1.10; buy target = price * (1 - `UserSettings.buyOnDipBuyTargetPercent` / 100), default 1%. Cleared when disabled; missing captured prices fall back to normal target rules. Startup adds the nullable column to existing databases.
- `buyRestricted` and `buyRestrictedUntil` (restriction remains active through the stored date).
- Unique index: `UX_UserTickerPreferences_UserId_Ticker`.

## Current Split Model

- Split events are stored globally in `StockSplits`.
- User applicability is tracked in `UserSplitActivations`.
- Activated splits are reflected by updating purchase lots and reconciling display lots.
- Split activation does not retroactively mutate all `PurchaseLots` or `StockTransactions` rows.

## Indexing Highlights

- User and ticker query paths are indexed across transaction and lot tables.
- Open positions are accelerated by filtered/open-position indexes on `PurchaseLots`.
- Display lots are keyed by `userId + ticker` via a unique index.
