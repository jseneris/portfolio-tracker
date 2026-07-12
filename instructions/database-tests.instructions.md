---
applyTo: "stock-tracker-backend/tests/**/*.ts"
excludeAgent: "code-review"
---

This file lists the current backend test coverage and expected outcomes.

### Current Test Cases

- Cash transaction API (`cash.test.ts`)
   - Create a deposit transaction.
   - Retrieve transaction list and verify created id exists.
   - Delete transaction and verify it is removed.

- Cash summary (`cash-summary.test.ts`)
   - Deposit 1000, withdrawal 200, interest 50, fee 10.
   - Available cash progression: 1000 -> 800 -> 850 -> 840.
   - Cost basis remains deposits - withdrawals = 800.

- Stock purchase flow (`stock-purchases.test.ts`)
   - Deposit 1000 then buy 2 shares at 100.
   - Available cash: 1000 -> 800.
   - One purchase lot exists with quantity 2.

- Multiple purchases (`stock-multiple-purchase.test.ts`)
   - Deposit 1000; buy 3 then buy 2 shares.
   - Available cash after purchases: 500.
   - Two lots exist with remaining quantities 3 and 2.

- Stock sale with explicit lot allocation (`stock-sale.test.ts`)
   - Deposit 1000; buy 3 and 2 shares; sell 2 shares at 110 allocated to the 2-share lot.
   - Available cash after sale: 720.
   - Remaining lots: one lot with remaining quantity 3.

- Non-LIFO lot selection (`stock-non-lifo-sale.test.ts`)
   - Deposit 1000; buy 2 then 3 shares; sell 2 shares allocated to newer lot.
   - Available cash after sale: 720.
   - Older lot remains 2; newer lot reduced from 3 to 1.

- Dividend reinvestment (`stock-dividend.test.ts`)
   - Deposit 1000; buy 3 and 2 shares; apply dividend lot of 0.1 share at 100.
   - Available cash unchanged by dividend transaction.
   - Purchase lots remain 3 and 2; dividend lot is separate with 0.1 share.

- Sale with dividend lot untouched (`stock-sale-with-dividend.test.ts`)
   - Deposit 1000; buy 3 and 2 shares; dividend 0.1 share.
   - Sell 4 shares from purchase lots only.
   - Available cash after sale: 940.
   - Purchase lots reduce to one lot with remaining quantity 1.
   - Ticker summary totalShares: 1.1.

- Sale consuming dividend lot (`stock-sale-of-dividend.test.ts`)
   - Deposit 1000; buy 3 and 2 shares; dividend 0.1 share.
   - Sell 4.1 shares consuming both purchase and dividend lots.
   - Available cash after sale: 951.
   - Dividend lot removed; ticker summary totalShares: 1.

- Split retroactivity and flags (`stock-split.test.ts`)
   - Deposit 1000; buy 3 and 2 shares.
   - Apply split ratio 2/1 at date between the two buys.
   - Affected lot doubles to 6 shares; unaffected lot remains 2 shares.
   - Cost basis before and after split is preserved.
   - Affected lot/transaction records are flagged splitAdjusted with lastSplitId.

- Sale after split (`stock-sale-after-split.test.ts`)
   - Deposit 1000; buy 3 and 2 shares.
   - Apply split ratio 5/3 at date between buys.
   - Post-split lots: split-adjusted lot 5 shares, unsplit lot 2 shares.
   - Sell 4 shares (2 from each lot).
   - Available cash after sale: 940.
   - Remaining lot is split-adjusted lot with remaining quantity approximately 3.

- Global + sequential split behavior (`stock-split-global-and-sequential.test.ts`)
   - Two users each buy same ticker.
   - A single split request applies to both users' lots.
   - Sequential splits compound correctly (final quantity and unit cost assertions).
   - `SplitAdjustments` contains per-user, per-entity audit rows for each split.

- Portfolio summary endpoint (`portfolio-summary.test.ts`)
   - Validates `GET /api/stocks/portfolio/summary` returns cash summary and stock list in one call.
   - Scenario asserts: availableCash 630, cashBasis 1000, totalStockCostBasis 400, stockCount 2.
   - Per-stock checks include AAPL (2 shares, cost basis 200) and MSFT (1 share, cost basis 200).

- Table CRUD coverage (`table-crud.test.ts`)
   - Verifies insert/read/delete operations across all tables:
      `CashTransactions`, `StockTransactions`, `StockSplits`, `Lots`, `LotAllocations`, `SplitAdjustments`.

- P0 database hardening (`db-p0-hardening.test.ts`)
   - Verifies `SchemaMigrations` exists and contains `2026-07-12-p0-hardening`.
   - Verifies required indexes exist:
      `IX_CashTransactions_UserId_TransactionDate`,
      `IX_StockTransactions_UserId_Ticker_TransactionDate`,
      `IX_Lots_UserId_Ticker_PurchaseDate`,
      `IX_Lots_OpenPositions_UserId_Ticker_PurchaseDate`,
      `UX_StockSplits_Ticker_Ratio_Date`.
   - Verifies DB-level uniqueness blocks duplicate split inserts for the same ticker/ratio/date.
   - Verifies positivity constraints reject invalid stock transaction values and invalid split ratio values.

