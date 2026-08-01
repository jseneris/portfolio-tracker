---
applyTo: "stock-tracker-backend/tests/**/*.test.ts"
excludeAgent: "code-review"
---

# Current Test Scenarios

Last updated: 2026-08-01

## Scope

The suite validates cash, stock transactions, source-lot accounting, display-lot operations, split activation, and schema integrity.

## Current Behavioral Contracts

### Display lots
- Stored as CSV quantities per `(userId, ticker)` row.
- Helper/test read model may expand CSV quantities into per-entry records for assertion convenience.
- Combine/split/delete operate by index.

### Splits
- Manual split endpoint records global split and user activation.
- Summaries apply active split multipliers dynamically.
- Split activation is not expected to mutate all historical rows in place.

## Test Groups

### Foundation (01-05)
- Cash workflows.
- Buy/sell/div transaction effects.
- Split activation and projection behavior.

### Display Lots (06-16)
- Creation and query shape under CSV/index model.
- Combine/split/delete index behavior and validation errors.
- Dividend isolation and smallest-first consumption effects.
- Edge-case precision and high-volume quantity lists.

### Scale (17)
- High-count display quantities.
- Multi-ticker display rows.
- Combine/split at larger list sizes.

### Schema and Auth (19-20)
- Schema presence, columns, and required indexes.
- Auth middleware behavior and scoped access.

## Assertion Guidance

- Prefer order-insensitive checks for table/column sets unless order is part of API contract.
- For display-lot totals, assert summed quantities when helper returns expanded entries.
- For split behavior, assert summary projection outputs and activation records rather than persisted historical rewrites.
