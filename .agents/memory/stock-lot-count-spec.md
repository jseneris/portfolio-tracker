---
name: Stock lot "count" spec ambiguity
description: How projectdescription.md's ambiguous "purchase lots"/"Lot count" wording in dividend and sale test cases was resolved in the backend API design.
---

`projectdescription.md`'s test cases (Stock Dividend Test, Stock Sale with Dividend Test, Stock Sale of Dividend Test) say things like "AAPL should have two purchase lots... AAPL Lot count should be 2" even after a dividend transaction has created its own lot. Taken literally and unscoped, that would undercount by one (the dividend lot).

**Resolution:** treat "Lot count" in those sentences as scoped to whatever the immediately preceding sentence was talking about (purchase lots, in context) — not a global lot count. Implemented as an optional `?sourceType=purchase|dividend` query filter on `GET /api/lots/:ticker` (`stock-tracker-backend/src/routes/lots.ts`), so "purchase lot count" and "total lots for a ticker" are two different, explicit queries instead of one ambiguous one.

**Why:** without the filter, dividend reinvestment (which must create its own `Lots` row with `sourceType='dividend'` to support later "sale of dividend" scenarios) would make every existing "Lot count" assertion in the spec ambiguous or wrong depending on interpretation.

**How to apply:** when writing/reading tests against this API, "N purchase lots" means query with `sourceType=purchase`; total remaining shares across all sources (purchase + dividend) come from `GET /api/stocks/:ticker/summary`'s `totalShares`, which is unfiltered by design.
