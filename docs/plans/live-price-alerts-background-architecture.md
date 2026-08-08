# Live Price Updates, Target Alerts, and Background Execution Plan

Last updated: 2026-08-08

## Goal

Enable:
- live price updates for current holdings,
- alerts when user price targets are hit,
- processing that continues even when no browser tab is open.

## Current Baseline in This Repo

- User target preferences already exist via User Settings endpoints.
- Holdings summary exists, but it does not include true live quote streaming.
- Historical price sync exists for backfill/comparison workflows.
- No realtime transport, no always-on quote worker, and no notification delivery pipeline yet.

## Required Architecture

### 1. Always-On Quote Worker (Server-Side)

Run a separate backend worker process that:
- polls latest quotes for active tickers every 15 to 60 seconds during market hours,
- writes/upserts latest values to a LiveQuotes store,
- runs independently of browser sessions.

Why: browser polling cannot satisfy the requirement to run when the browser is inactive.

### 2. Alert Evaluation Engine

Add a server-side alert engine that evaluates each refresh cycle:
- inputs: latest quote + user target settings + holdings/ticker context,
- outputs: triggered/cleared alert events,
- protections: cooldown and hysteresis to prevent duplicate alert spam.

Suggested tables:
- AlertRules
- AlertState
- AlertEvents

### 3. Notification Channels

Use at least one non-tab-dependent channel:
- Email and/or SMS: most reliable when browser is closed.
- Web Push: works with service worker even when tab is closed (user permission required).
- In-app realtime stream (WebSocket or SSE): best for active dashboard sessions.

### 4. Live API Surface

Add endpoints for:
- live portfolio summary (holdings joined with latest quotes),
- alert rules CRUD,
- alert event history,
- optional realtime stream endpoint.

Keep current endpoints stable and add new ones incrementally.

### 5. Deployment Model

Run API and worker as separate always-on services/processes.

If scaled horizontally:
- use a queue and/or distributed lock to avoid duplicate quote polling,
- add retry and backoff for market data provider limits,
- enforce market-hours scheduling.

## Phased Rollout (Recommended)

1. LiveQuotes table + quote worker + live summary endpoint.
2. AlertRules/AlertState/AlertEvents + server alert evaluation.
3. In-app alert visibility (badge/log) and status endpoints.
4. Email/SMS notifications.
5. Web Push service worker integration.
6. Optional websocket/SSE low-latency streaming enhancements.

## Practical Notes

- The core requirement is server-driven background processing.
- Frontend realtime updates are a presentation layer; they cannot be the only execution path.
- Start with polling architecture first; add streaming after correctness and reliability are stable.

## Success Criteria

- Quote refresh continues with zero active browser tabs.
- Alerts trigger once per crossing event, with spam protection.
- Users can view latest prices and alert history on next login.
- Notification channel delivery is observable and retryable.
