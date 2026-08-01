# Documentation Index

Last updated: 2026-08-01

## Canonical Backend Docs

1. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)
- High-level architecture and current workflow model.

2. [database-schema-current.md](./database-schema-current.md)
- Current schema reference, including active and legacy-compatible tables.

3. [endpoints-current.md](./endpoints-current.md)
- Current request/response contracts and route behavior.

4. [test-scenarios-current.md](./test-scenarios-current.md)
- Current testing expectations and assertion guidance.

5. [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md)
- Status snapshot and remaining alignment work.

## Current Core Model

- Display lots: one row per `(userId, ticker)` using `DisplayLots.lotsCsv`.
- Display lot operations: index-based combine/split/delete.
- Splits: global event in `StockSplits` plus per-user activation in `UserSplitActivations`.
- Split effect: dynamic projection in summaries, not mandatory bulk historical mutation.

## Suggested Reading Order

1. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)
2. [database-schema-current.md](./database-schema-current.md)
3. [endpoints-current.md](./endpoints-current.md)
4. [test-scenarios-current.md](./test-scenarios-current.md)
5. [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md)

## Legacy/Reference Docs

The following files may contain older narratives and should be treated as historical context unless explicitly refreshed:
- [database-schema.instructions.md](./database-schema.instructions.md)
- [routes.instructions.md](./routes.instructions.md)
- [database-tests.instructions.md](./database-tests.instructions.md)
- [front-end-functionality.instructions.md](./front-end-functionality.instructions.md)
- [backend-functionality.instructions.md](./backend-functionality.instructions.md)
