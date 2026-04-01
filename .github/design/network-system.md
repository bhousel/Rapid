# Network System Design

This document describes the design for Rapid's centralized network request system, which consolidates fetch lifecycle management, inflight tracking, request deduplication, timeouts, and worker-based fetch offloading — all currently duplicated across 15+ services.

## Problem

Every service in Rapid independently manages its own fetch lifecycle. This has led to:

- **4 different AbortController patterns** — `Map<TileID, AbortController>`, `InflightEntry { promise, controller }`, `Record<string, AbortController>`, split GET/POST Maps
- **Zero request timeouts** across all 19 services — a dead server hangs the fetch indefinitely (see [#1487](https://github.com/facebook/Rapid/issues/1487))
- **Aborted requests staying in inflight caches** — when an AbortError is caught but the cleanup happens in the success path, the inflight entry leaks (see [#1451](https://github.com/facebook/Rapid/issues/1451))
- **Duplicated boilerplate** — abort-old-tiles, check-if-loaded, create-controller, fetch, parse, handle-abort-error, cleanup-in-finally — repeated in every tile-loading service
- **No coordination** — when backpressure is heavy, services keep firing requests that just add to the congestion
- **Main-thread parsing** — all JSON/XML/protobuf parsing happens on the main thread, blocking frame rendering

## Goals

1. **Single source of truth** for inflight request tracking — eliminates the leaking-inflight bug class entirely
2. **Automatic timeouts** — every request gets a configurable `AbortSignal.timeout`, solving #1487
3. **Worker offloading** — fetch + parse runs in a web worker when SchedulerSystem is available, keeping the main thread free for rendering
4. **Deduplication** — same-key requests return the existing promise rather than firing a duplicate
5. **Centralized abort** — `abortAll()`, `abort(key)`, and viewport-based cleanup in one place
6. **Backpressure awareness** — can pause or throttle new requests when the scheduler reports heavy pressure
7. **Gradual adoption** — services migrate incrementally; the old `fetch()` + `utilFetchResponse` pattern still works during transition

## Non-Goals

- Replacing `osm-auth` — OsmService's OAuth flow stays in OsmService. NetworkSystem provides a hook for custom fetch functions.
- Response caching / spatial indexing — services own their domain-specific caches. NetworkSystem tracks only what's *in flight*, not what's *loaded*.
- Rate limiting — OsmService's rate limit logic is domain-specific (429 response parsing, duration extraction). NetworkSystem provides the abort-all hook that rate limiting calls into, but doesn't own the policy.
- PMTiles — the PMTiles library manages its own fetch internally. Not a NetworkSystem concern.

## Design

### System Identity

```
ID:                   'network'
requiredDependencies: (none)
optionalDependencies: ['scheduler']
autoStart:            true
```

NetworkSystem has **no required dependencies**. It works without SchedulerSystem — it just does `fetch()` on the main thread instead of dispatching to a worker. This is the `if (scheduler) { /* worker */ } else { /* just fetch */ }` guard, and it lives in exactly one place.

### Core Data Structures

```typescript
/** Tracks a single inflight request */
interface InflightRequest<T = unknown> {
  /** Unique identifier for dedup and cancellation */
  requestID: RequestID;
  /** The AbortController for this request */
  controller: AbortController;
  /** The in-progress promise (for dedup — second caller gets same promise) */
  promise: Promise<T>;
  /** Timestamp when the request was created (for diagnostics) */
  created: number;
}
```

All inflight requests live in one `Map<string, InflightRequest>`. No per-service tracking needed.

### Public API

```typescript
class NetworkSystem extends AbstractSystem {

  /**
   * fetch
   * The primary API.  Fetches a URL with automatic:
   *   - Inflight dedup (by `key`)
   *   - Timeout (default 30s, configurable)
   *   - AbortController management
   *   - Worker offloading (when scheduler + workerURL are available)
   *   - Response parsing via `utilFetchResponse`
   *
   * @param url      - The URL to fetch
   * @param options  - Fetch options + NetworkSystem extensions
   * @returns The parsed response
   */
  fetch<T = unknown>(url: string, options?: NetworkFetchOptions): Promise<T>;

  /**
   * fetchRaw
   * Like `fetch` but returns the raw `Response` object without
   * parsing through `utilFetchResponse`.  Useful for binary data,
   * streams, or when the caller needs response headers.
   *
   * Inflight tracking, dedup, timeout, and abort still apply.
   * Always runs on main thread (no worker dispatch).
   */
  fetchRaw(url: string, options?: NetworkFetchOptions): Promise<Response>;

  /**
   * abort
   * Aborts a specific inflight request by key.
   * No-op if the key is not inflight.
   */
  abort(key: string): void;

  /**
   * abortAll
   * Aborts every inflight request.  Called by `resetAsync()`.
   * Also useful for rate-limit situations.
   */
  abortAll(): void;

  /**
   * abortMatching
   * Aborts all inflight requests whose key matches a predicate.
   * Useful for viewport-based cleanup:
   *   network.abortMatching(key => key.startsWith('osm-') && !neededKeys.has(key));
   */
  abortMatching(predicate: (key: string) => boolean): void;

  /**
   * isInflight
   * Returns true if a request with the given key is currently in progress.
   */
  isInflight(key: string): boolean;

  /** Number of inflight requests (for diagnostics / tests) */
  get numInflight(): number;

  /** Default timeout in milliseconds (default: 30000) */
  get defaultTimeout(): number;
  set defaultTimeout(ms: number);
}
```

### Options

```typescript
interface NetworkFetchOptions extends Omit<RequestInit, 'signal'> {
  /**
   * Unique key for dedup and cancellation.  If another request with the
   * same key is already inflight, the existing promise is returned.
   * Default: the URL itself.
   */
  key?: string;

  /**
   * Timeout in milliseconds.  Overrides `defaultTimeout`.
   * Set to 0 to disable.
   */
  timeout?: number;

  /**
   * Custom fetch function.  Replaces `globalThis.fetch` for this request.
   * Used by OsmService to pass `this._oauth.fetch` for authenticated requests.
   */
  fetchFn?: typeof globalThis.fetch;

  /**
   * If true, skip worker dispatch and always fetch on the main thread.
   * Default: false.
   */
  mainThread?: boolean;
}
```

### Fetch Flow

```
network.fetch(url, { key, timeout, fetchFn })
│
├── Dedup check: is `key` already inflight?
│   └── YES → return existing promise
│
├── Create AbortController
│   ├── Combine with AbortSignal.timeout(timeout)
│   └── Store as InflightRequest in _inflight Map
│
├── Dispatch decision:
│   ├── Has scheduler + workerURL + !mainThread + !fetchFn?
│   │   └── YES → dispatch('fetchAndParse', { url, init })
│   └── NO  → fetch(url, { ...init, signal }) on main thread
│             → utilFetchResponse(response)
│
├── On success: resolve promise, delete from _inflight
├── On AbortError: reject promise (silently), delete from _inflight
├── On other error: reject promise, delete from _inflight
│
└── .finally(() => _inflight.delete(key))  ← ALWAYS cleanup
```

The `.finally()` cleanup is the critical fix for #1451 — the inflight entry is removed regardless of how the request completes.

### AbortController + Timeout Composition

```typescript
private _createController(timeout: number): AbortController {
  const controller = new AbortController();

  if (timeout > 0) {
    // AbortSignal.any() combines our manual signal with a timeout signal.
    // When either fires, the fetch is aborted.
    const timeoutSignal = AbortSignal.timeout(timeout);
    const combined = AbortSignal.any([controller.signal, timeoutSignal]);
    // We return the controller for manual abort, but pass `combined` to fetch.
    // Store combined on the InflightRequest so fetch() uses it.
    (controller as any)._combinedSignal = combined;
  }

  return controller;
}
```

This uses `AbortSignal.any()` (baseline 2024, all modern browsers) to combine manual abort with automatic timeout. The caller can still call `controller.abort()` manually, and the timeout fires independently.

### Worker Integration

When SchedulerSystem is available with a configured `workerURL`, `network.fetch()` dispatches work to the worker pool:

```typescript
// In worker.ts — register the fetch+parse listener
registerListener('fetchAndParse', async (data: unknown, signal: AbortSignal) => {
  const { url, init } = data as { url: string; init?: RequestInit };
  const response = await fetch(url, { ...init, signal });
  return utilFetchResponse(response);
});
```

**What moves to the worker**: The `fetch()` call itself, the response parsing (JSON decode, XML parse via xmldom, protobuf ArrayBuffer read), and any data transformation that `utilFetchResponse` does.

**What stays on the main thread**: Timeout management (the main-thread AbortController composes timeout + manual abort). Inflight tracking. Domain-specific post-processing (creating MarkerData, updating Graph, etc.).

**Graceful fallback**: If `scheduler` is absent or `workerURL` isn't set, `network.fetch()` does a normal main-thread `fetch()` + `utilFetchResponse()`. Same API, same behavior, just synchronous parsing.

### Worker-Side Abort

Proper abort support in workers is essential.  A single screen of map can contain
dozens of tiles (a 6×7 grid of zoom-16 tiles is ~42 tile fetches just for OSM
data).  When the user pans, all of those tiles become stale.  Without worker-side
abort, the workers would still be downloading and parsing every stale tile,
wasting bandwidth on potentially large responses (dense urban areas can return
hundreds of KB per tile) and — worse — **starving the worker pool**.  With only
2 workers servicing 42 stale fetches, the *new* tiles the user actually needs
queue behind them.  The user experiences this as lag loading data after a pan,
which is the opposite of what moving to workers should achieve.

**Protocol extension** — one new message type, alongside the existing task dispatch:

```
Main → Worker:  { id: number, listenerID: ListenerID, data: unknown }   // existing
Main → Worker:  { type: 'cancel', id: number }                    // new
Worker → Main:  { id: number, result?: unknown, error?: string }  // existing
```

**Worker side** — the worker entry point maintains a `Map<requestID, AbortController>`.
When a listener receives its data, it also receives an `AbortSignal` that is
wired to a local controller.  When a `'cancel'` message arrives, the worker looks
up the controller and calls `.abort()`.  The listener's `fetch()` throws
`AbortError`, and the worker posts back `{ id, error: 'AbortError' }`.

```typescript
// Inside worker.ts
const activeControllers = new Map<number, AbortController>();

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  // Handle cancel messages
  if (msg.type === 'cancel') {
    const controller = activeControllers.get(msg.id);
    if (controller) controller.abort();
    activeControllers.delete(msg.id);
    return;
  }

  // Normal task dispatch
  const { id, listenerID, data } = msg;
  const controller = new AbortController();
  activeControllers.set(id, controller);

  const listener = listeners.get(listenerID);
  if (!listener) {
    activeControllers.delete(id);
    self.postMessage({ id, error: `Unknown listener: '${listenerID}'` });
    return;
  }

  try {
    const result = await listener(data, controller.signal);
    self.postMessage({ id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ id, error: message });
  } finally {
    activeControllers.delete(id);
  }
};
```

**Main thread side** — `dispatch` accepts an optional `AbortSignal`:

```typescript
dispatch<T>(listenerID: ListenerID, data?: unknown, signal?: AbortSignal): Promise<T>
```

When the signal fires, SchedulerSystem:
1. Sends `{ type: 'cancel', id }` to the worker that owns the request
2. Rejects the pending promise with an `AbortError`
3. Removes the request from `_pendingRequests`

NetworkSystem wires this together naturally:
```typescript
// In NetworkSystem.fetch(), worker path:
const result = await scheduler.dispatch(
  'fetchAndParse', { url, init }, controller.signal
);
```

When `network.abort(key)` is called (e.g., during viewport change), the
controller fires, SchedulerSystem forwards the cancel to the worker, and the
worker's `fetch()` is actually aborted.  No wasted bandwidth, no worker
starvation.

The cancel message is fire-and-forget — if the request already completed, the
cancel is a no-op.  No race conditions.

**All worker tasks are abortable**, not just fetch tasks.  The cancel protocol
is generic: any listener that receives an `AbortSignal` can use it to bail
out of long-running work.  For fetch-based tasks, this means aborting the HTTP
request.  For CPU-bound tasks, it could mean checking `signal.aborted`
periodically.

### Concurrency Limiting and Fetch Storm Protection

Map tiling is exponential — zooming out one level quadruples the area, and each
service independently tiles the viewport.  It's easy for a user to zoom out
slightly and kick off hundreds of tile fetches across all services simultaneously.
This has been a recurring problem in Rapid (e.g., the original MapRoulette
service, various intern-written services).

NetworkSystem is the natural place to enforce a global concurrency limit:

```typescript
/** Maximum concurrent inflight requests (across all services) */
get maxInflight(): number;
set maxInflight(n: number);
```

When `numInflight >= maxInflight`, new `fetch()` calls enter a FIFO queue
rather than dispatching immediately.  As inflight requests complete, queued
requests are dispatched in order.

**Key behaviors:**

- **Queued requests are still abortable.**  If `abort(key)` is called for a
  queued (not yet dispatched) request, it's removed from the queue and the
  promise rejects with `AbortError`.  This is cheap — no network request was
  even started.

- **Priority hint** (optional, future): Services that are critical for the
  current view (OSM data) could pass `{ priority: 'high' }` to jump ahead
  of services that are supplementary (photo overlays, QA layers).  For now,
  FIFO ordering is sufficient — the viewport-based abort ensures stale
  requests are cleaned up quickly.

- **Per-host limits are handled by the browser** (typically 6 connections per
  host for HTTP/1.1, unlimited for HTTP/2).  NetworkSystem's limit is a
  global cap across all hosts, preventing the "storm of fetches" scenario
  where dozens of services each fire dozens of requests simultaneously.

- **Sensible default**: Something like 50–100 concurrent requests.  This is
  generous enough to not bottleneck normal usage (a single tile-loading service
  might need ~40 tiles) but prevents the pathological case of 5 services each
  firing 40+ requests simultaneously.

This is the centralized fix for the fetch storm problem — instead of each
service implementing its own queue-size guard (like OsmService's
`if (cache.toLoad.size > 50) return`), the limit is enforced once, globally.

### Service Migration

**Before (GeoScribbleService today)**:
```typescript
loadTiles(): void {
  if (cache.lastv === viewport.v) return;
  cache.lastv = viewport.v;

  const tiles = this._tiler.getTiles(viewport).tiles;

  // Abort tiles no longer visible
  for (const [tileID, controller] of cache.inflight) {
    const isNeeded = tiles.some(t => t.id === tileID);
    if (!isNeeded) controller.abort();
  }

  for (const tile of tiles) {
    if (spatial.hasTile('geoscribble', tileID)) continue;
    if (cache.inflight.has(tileID)) continue;

    const controller = new AbortController();
    cache.inflight.set(tileID, controller);

    fetch(url, { signal: controller.signal })
      .then(utilFetchResponse)
      .then(response => this._gotTile(tile, response))
      .catch(err => {
        if (err.name === 'AbortError') return;
        spatial.addTiles('geoscribble', [tile]);
      })
      .finally(() => cache.inflight.delete(tileID));
  }
}
```

**After (with NetworkSystem)**:
```typescript
loadTiles(): void {
  const network = this.context.systems.network!;

  if (cache.lastv === viewport.v) return;
  cache.lastv = viewport.v;

  const tiles = this._tiler.getTiles(viewport).tiles;
  const neededKeys = new Set(tiles.map(t => `geoscribble-${t.id}`));

  // Abort tiles no longer visible — one call
  network.abortMatching(requestID => /^geoscribble-/.test(requestID) && !neededKeys.has(requestID));

  for (const tile of tiles) {
    const requestID = `geoscribble-${tile.id}`;
    if (spatial.hasTile('geoscribble', tileID)) continue;
    if (network.isInflight(requestID)) continue;

    network.fetch(url, { requestID })
      .then(response => this._gotTile(tile, response))
      .catch(err => {
        if (err.name === 'AbortError') return;
        spatial.addTiles('geoscribble', [tile]);
      });
    // No .finally() needed — NetworkSystem handles inflight cleanup
    // No AbortController management — NetworkSystem handles it
    // Timeout included automatically — no more hanging requests
    // Fetch + parse happens on worker — main thread stays free
  }
}
```

The service no longer owns `inflight`, `AbortController`, or `.finally()` cleanup.

**For OsmService** (authenticated requests):
```typescript
// Pass the oauth fetch function — everything else works the same
const controller = network.fetch(url, {
  requestID: `osm-data-${tileID}`,
  fetchFn: this.authenticated() ? this._oauth.fetch : undefined,
  mainThread: true,  // oauth.fetch can't run in a worker
});
```

### Backpressure Integration

When SchedulerSystem reports `'heavy'` pressure, NetworkSystem can defer new requests:

```typescript
// In initAsync — listen for pressure changes
const scheduler = this.context.systems.scheduler;
if (scheduler) {
  scheduler.on('pressure', (level: PressureLevel) => {
    this._pressure = level;
  });
}

// In fetch() — gate on pressure
if (this._pressure === 'heavy' && !options?.urgent) {
  // Queue the request for later, or reject immediately
  // (Design TBD — depends on how aggressively we want to shed load)
}
```

This is optional and can be added after the core system is working. It's listed here to show the integration point exists.

### Error Events

NetworkSystem emits events for observability:

```typescript
Events:
  'fetchstart'   { requestID, url }              — request dispatched
  'fetchend'     { requestID, url, ok, elapsed } — request completed (success or error)
  'timeout'      { requestID, url, elapsed }     — request timed out
```

These are useful for debugging, the Performer-style stats display, and future telemetry. They fire on every request, not just errors.

## Migration Path

### Phase 1 — Core system (done)

Create `NetworkSystem` with:
- `fetch()`, `fetchRaw()` — main-thread only (no worker dispatch yet)
- Inflight tracking with `Map<RequestID, InflightRequest>`
- `AbortSignal.timeout` on every request
- `abort()`, `abortAll()`, `abortMatching()`
- Deduplication by key
- `.finally()` cleanup (fixes #1451)

Register as `'network'` system. No services migrated yet.

### Phase 2 — Worker dispatch (done)

Add `fetchAndParse` listener to `worker.ts`. Wire `network.fetch()` to use `dispatch` when scheduler is available. Test that responses match the main-thread path.

This needs `utilFetchResponse` + its dependencies (`@xmldom/xmldom`, `json5`) bundled into the worker. Since `worker.ts` would import `utilFetchResponse`, Bun handles this automatically.

### Phase 3 — Migrate easy-tier services (done)

Migrated WikipediaService, WikidataService, TaginfoService, OsmWikibaseService, NominatimService, GeoScribbleService.

### Phase 4 — Migrate medium-tier services (done)

Migrated WaybackService, MapRouletteService, OsmoseService, KeepRightService.

### Phase 5 — Migrate complex services

Migrate OsmService (with `fetchFn` for oauth), EsriService, MapWithAIService, etc. These need `mainThread: true` or custom fetch functions.

### Phase 6 — Cleanup (done)

Removed per-service inflight tracking, AbortController management, and `.finally()` boilerplate.
`key` renamed to `requestID` with `RequestID` global string ID type.
`abortMatching` predicates use regex `.test()` for ~10% perf improvement.
Tests updated across 8 test files. 2939 tests pass.

## Open Questions

1. **Request queuing under pressure** — When under heavy backpressure, should `network.fetch()` queue the request and resolve it later, or reject immediately with a "backpressure" error? Queuing is friendlier but adds complexity. Leaning toward queuing with a max queue size.

2. **Retry** — Should NetworkSystem retry on transient errors (5xx, network errors)? Services don't retry today (they just skip the tile and it re-triggers on next viewport change). Leaning toward no retry — the existing viewport-driven retry is simple and works.

3. **Cache-Control / ETag** — Some responses could be cached at the HTTP level. The browser's cache handles this for main-thread fetches, but worker fetches bypass it. Should NetworkSystem handle `If-None-Match` / `304`? Leaning toward not initially — workers use the standard `fetch` API which respects browser cache semantics even in workers.

4. **Concurrency limit tuning** — The default `maxInflight` needs real-world testing. Too low and normal tile loading is bottlenecked; too high and we don't prevent fetch storms. Likely in the 50–100 range. Could also be adaptive based on backpressure level.

## Decisions

Resolved design questions:

1. **NetworkSystem owns inflight tracking only, not loaded/cached data.** Services know their own domain — what constitutes "loaded" is tile-ID-based for some, URL-based for others, or spatial-extent-based. NetworkSystem just knows "is this key currently being fetched."

2. **`.finally()` is mandatory for all requests.** This is the fix for #1451. The inflight entry is always removed, regardless of success, error, or abort. No exceptions.

3. **Worker-side abort is mandatory.** Map tiling is exponential — a single viewport can generate 40+ tile fetches per service, and Rapid runs many services simultaneously. When the user pans, all those fetches become stale. Without worker-side abort, stale fetches starve the worker pool and waste bandwidth on large responses. The cancel protocol (`{ type: 'cancel', id }`) is simple, fire-and-forget, and race-condition-free. All worker listeners receive an `AbortSignal`, making every worker task abortable — not just fetch tasks.

4. **Global concurrency limit prevents fetch storms.** Instead of each service implementing its own queue-size guard, NetworkSystem enforces a global cap on simultaneous inflight requests. Requests that exceed the limit are queued (FIFO) and dispatched as slots free up. Queued requests are abortable for free (no network request was started).

5. **`fetchFn` option covers OAuth** without NetworkSystem knowing about auth. OsmService passes `this._oauth.fetch` and sets `mainThread: true`. Clean separation.

6. **Default timeout: 30 seconds.** Based on #1487 discussion — Chrome's 300s default is far too long. Most tile/API requests should complete in 2–5s. 30s is generous enough for slow connections while catching dead servers.
