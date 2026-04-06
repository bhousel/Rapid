# Current Work

## Active

### Validator classes (schema-aware lifecycle)
Validators are still factory functions instantiated once at init time. They now use **time-of-use** access for schema prerequisites (variables, rulesets) — lookups happen inline when needed, not hoisted to factory scope. Guard patterns vary by validator file (optional chaining, nullish coalescing, early returns).

The longer-term fix is converting validators to proper classes with lifecycle management (subscribe to `schemachange` events, refresh cached prerequisites). Tracked in `backlog.md`.


## Future Investigation

### AbortError handling centralization
Nearly every service `catch` handler has `if (err.name === 'AbortError') return;` before any real error handling. Two possible approaches to centralize:
1. **`ignoreAbort(fn)` utility** — wraps the error handler, filters AbortErrors at the wrapper level, zero type changes
2. **`fetch<T>` returns `Promise<T | undefined>`** — NetworkSystem swallows AbortErrors internally, callers guard on `!result` in `.then()` instead — requires broad churn

`MapRouletteService` is the outlier: its AbortError handlers do `cache.tileRequest.delete(tile.id)` / `cache.challengeRequest.delete(challengeID)` to "allow retry". This is arguably a bug — the service maintains its own inflight state (`tileRequest`, `challengeRequest`) that is redundant with NetworkSystem's requestID dedup. On abort, NetworkSystem already cleans up its inflight map and `spatial.hasTile()` returns false, so retry would happen naturally without the manual delete. The redundant cache creates a consistency window where `tileRequest` and NetworkSystem's inflight map can disagree.


