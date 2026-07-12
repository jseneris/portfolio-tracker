# MVP Scope Lock

Status: Active

This project is currently operating under MVP scope lock.

## In Scope (Phase 1)

- Dashboard summary page wired to portfolio summary endpoint
- Cash transaction CRUD (list, create, edit, delete)
- Stock buy and dividend transaction flows
- Stock sell flow with explicit lot allocation validation
- Holdings detail views (per ticker transactions and lots)
- MVP tests and acceptance checks

## Out of Scope Until MVP Sign-Off

- Login/auth rollout UX
- Stock split management UI
- Current price refresh workflows
- Target price configuration UX
- Historical close retrieval UX
- Index comparison dashboards
- Cron/job observability screens

## Exit Criteria

Scope lock can be lifted only after:

1. Core MVP workflows pass frontend tests.
2. Manual validation confirms summary and holdings stay consistent after mutations.
3. Sell allocation validation blocks invalid submissions before API call.
4. MVP defect backlog is triaged and critical defects are closed.
