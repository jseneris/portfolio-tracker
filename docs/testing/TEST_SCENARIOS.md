# Test Scenarios Documentation

Last updated: 2026-08-01

## Core Concepts

### Source Lots
- Source lots come from stock transactions.
- `purchase` lots represent buys.
- `dividend` lots represent reinvested dividends.
- Sales consume source lots only through explicit allocation.

### Display Lots
- Display lots are user organizational quantities per ticker.
- Backend stores display lots as CSV quantities in one row per `(userId, ticker)`.
- Display lot operations use index-based manipulation of the parsed quantity array.

### Splits
- Splits are global ticker events.
- User applicability is tracked in `UserSplitActivations`.
- Summary endpoints apply active split multipliers dynamically.

## Workflow Coverage Areas

### Foundation workflows
- Cash creation, update, delete, and summary math.
- Buy/sell/div transaction creation and rollback behavior.
- Source-lot allocation integrity and validation.

### Display-lot workflows
- Create/replace with `{ quantities: number[] }`.
- Combine with `{ indices: number[] }`.
- Split with `{ index, quantities }` where split sum equals selected lot.
- Delete by `{ index }` and delete-row-on-empty behavior.
- Synthetic composition endpoint behavior.

### Split workflows
- Split event insertion and idempotency.
- User activation record creation.
- Dynamic summary effect for active splits.
- No assumption of mass historical row mutation.

### Edge and scale workflows
- Precision and fractional quantities.
- Large quantity lists for one ticker.
- Multi-ticker isolation.
- Invalid payload/indices and not-found handling.

## Test Design Notes

- Prefer validating externally visible behavior (responses and summaries) over internal implementation details.
- Where helper methods return expanded display-lot entries, assert both entry counts and summed totals.
- Use tolerance-based numeric assertions for fractional operations.
