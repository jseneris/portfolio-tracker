# Implementation Status

Last updated: 2026-08-01

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

### Tests
- Test files are being refactored from legacy composition assumptions to CSV/index-based semantics.
- Recent fixes include schema-order assertion hardening and stale large-scale display-lot assertions.

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
