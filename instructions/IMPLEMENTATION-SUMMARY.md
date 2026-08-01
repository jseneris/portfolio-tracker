# Portfolio Tracker Backend - Implementation Summary

Last updated: 2026-08-01

## Architecture Summary

The backend now uses two distinct concepts:

- Source lots (`PurchaseLots`): transaction-derived inventory and cost-basis records.
- Display lots (`DisplayLots.lotsCsv`): user-facing organizational quantities per ticker.

Display lots are no longer persisted as a composition graph in active workflow logic. Instead, they are represented as comma-separated quantities in one row per user+ticker and manipulated by index.

## Key Workflow Decisions

### Display lots
- Storage: `DisplayLots` with `lotsCsv`.
- Read model: parse CSV into `lots`, plus derived `lotCount` and `totalQuantity`.
- Composition endpoint: synthetic entries based on index.
- Operations:
- Create/replace by ticker using `{ quantities: number[] }`.
- Combine by index set `{ indices: number[] }`.
- Split by index `{ index, quantities }`.
- Delete one entry by index.

### Stock transactions
- Buy: creates purchase lot and appends display quantity.
- Dividend: creates dividend purchase lot; does not append display lot quantity.
- Sell: explicit source-lot allocations; display quantity consumed smallest-first for purchase-sourced shares only.
- Delete sell: restores purchase allocations and appends restored display quantity.

### Splits
- Global split registry: `StockSplits`.
- Per-user applicability: `UserSplitActivations`.
- Dynamic effect in summary queries via split multipliers.
- No bulk historical mutation required for activation.

## Compatibility Note

Current operational behavior is driven by CSV display lots and split activations; legacy display-lot and split-audit compatibility tables have been removed from the active schema.

## Testing Direction

Tests are being updated to validate:
- Index-based display-lot operations.
- Expanded display entries from CSV values.
- Dynamic split projection behavior instead of persisted quantity/price rewrites.
