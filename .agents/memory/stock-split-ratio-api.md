---
name: Stock split ratio API
description: Why stock splits are entered as a ratio (numerator/denominator) instead of a single decimal multiplier
---

The `POST /api/lots/ticker/:ticker/split` endpoint accepts `ratioNumerator` and `ratioDenominator` (e.g. `{ ratioNumerator: 2, ratioDenominator: 1 }` for a 2-for-1 split, `{ ratioNumerator: 5, ratioDenominator: 3 }` for a 5-for-3 split) instead of a single pre-computed `multiplier`.

**Why:** Stock splits are always announced and understood as a ratio ("2-for-1", "5-for-3"), not a decimal. Requiring callers to pre-divide the ratio into a multiplier is an unnecessary and error-prone translation step, and loses the original announced ratio for display/audit purposes.

**How to apply:** The server derives `multiplier = ratioNumerator / ratioDenominator` internally and applies it exactly as before (quantities multiply, price/unitCost divide, so cost basis is preserved). The `StockSplits` table stores `ratioNumerator`, `ratioDenominator`, AND `multiplier` (derived) so the original ratio is preserved for audit/display while the multiplier remains available for any downstream computation. The idempotency dupe-check key is `(ticker, ratioNumerator, ratioDenominator, splitDate)` (global per ticker/ratio/date). Existing rows created before this change are backfilled as `ratioNumerator = multiplier, ratioDenominator = 1` via an ALTER TABLE migration in `connection.ts`. If a future change touches the split endpoint, keep request/response bodies and the `SplitAdjustments`/`StockSplits` schema consistent with the ratio-first contract rather than reintroducing a raw multiplier as the primary input.
