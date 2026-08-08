# Implementation Status

Last updated: 2026-08-08

## Current State

Backend behavior has shifted to:
- Display lots stored as one row per `(userId, ticker)` with `lotsCsv` values.
- Split events recorded globally and activated per user.
- Split effects applied dynamically in summary queries rather than by bulk mutation.

## Implemented

### Schema
- Cash, stock, source-lot, split, display-lot, historical-price, users/settings tables are present.
- `DisplayLots.lotsCsv` and `UserSplitActivations` are active parts of current workflows.
- Legacy compatibility tables for display-lot composition/allocation and split-adjustment audit have been removed from the active schema.

### Routes
- Display lot endpoints are index-based for combine/split/delete operations.
- Stock create/delete flows reconcile display quantities through CSV parsing/serialization helpers.
- Manual split endpoint is on `/api/lots/ticker/:ticker/split` and uses activation model.
- Compare endpoints now share one continuous calculation path:
	- all-series runs from earliest deposit through the capped end date,
	- requested years are returned as slices of that same series,
	- stock valuation on non-trading days falls back to the closest prior close.

### Frontend
- Compare page year dropdown is dynamic from transaction years plus `All`.
- Compare page `All` view uses the backend continuous series directly instead of stitching per-year results.
- Dashboard holdings table includes a `Gain/Loss` column combining realized sales performance with open-position performance for the selected snapshot date.

### Tests
- Test files are being refactored from legacy composition assumptions to CSV/index-based semantics.
- Recent fixes include schema-order assertion hardening and stale large-scale display-lot assertions.
- Comparison benchmark tests now also cover pre-period deposit effects and yearly-slice-vs-all-series behavior.

## In Progress

- Remaining stale test narratives and markdown references are being aligned.
- Frontend type/contracts still include legacy display-lot composition assumptions in several places.

## Not Yet Updated Everywhere

- Some non-canonical docs and planning notes still reference retroactive split mutation and composition-first display-lot workflows.
- Frontend API types still need a coordinated contract refresh.

## Recommended Next Steps

1. Complete frontend API type alignment with current backend contracts.
2. Remove or clearly mark legacy tables as compatibility-only in docs.
3. Finish stale test naming/assertion cleanup in remaining display-lot test files.
