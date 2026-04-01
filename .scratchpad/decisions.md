# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## NetworkSystem

- **`RequestID` as a typed string ID** — Follows the established pattern in `ids.ts` (like `EntityID`, `TileID`). Used throughout `NetworkFetchOptions`, `InflightRequest`, `QueuedFetch`, and all public API methods. Default requestID is `'${METHOD} ${url}'` (e.g. `'GET https://example.com/data'`). Services pass domain-specific IDs like `'keepright-tile-0,0,14'`.
- **Regex `.test()` for `abortMatching` predicates** — All predicates use `/^prefix-/.test(requestID)` instead of `requestID.startsWith('prefix-')`. ~10% faster per jsbench, and consistent across all services. Domain dots escaped (e.g. `/nominatim\.openstreetmap\.org/`).
- **Worker offloading is transparent** — `network.fetch<T>()` automatically routes through `dispatch('fetchAndParse', ...)` when scheduler + workerURL are available and no custom `fetchFn` is provided. Callers don't know or care whether the fetch ran on main thread or worker. `fetchRaw()` always runs on main thread (returns `Response` object, not serializable).
- **Task registry for domain-specific worker tasks** — `WorkerSystem` has a `registerListener(name, handler)` / `getListener(name)` API. Services register their `*.worker.ts` handlers at init time (e.g. `worker.registerListener('mapwithai:fetchAndParse', handler)`). Callers pass `task` + `taskData` in `NetworkFetchOptions`. NetworkSystem's `_dispatchFetch` routes named tasks to the worker when available, or calls the registered handler (via `worker.getListener()`) directly on the main thread as fallback. This eliminates dual dispatch paths in services — a single `network.fetch()` call handles both. NetworkSystem owns all inflight tracking, dedup, and abort for both paths.
- **Concurrency limiting with FIFO queue** — When `numActive >= maxInflight`, new requests queue. Queued requests are abortable for free (no network request started). Queue drains in `.finally()` of completed requests. Default `maxInflight: 100`.
- **`hasMatching()` checks `_inflight` only, not `_queue` separately** — All requests (both active and queued) are registered in `_inflight` at the bottom of `_trackAndDispatch`. The queue is a *subset* of inflight. `abortMatching()` touches `_queue` separately only to *splice out* entries (preventing them from dispatching on drain), not for visibility. Used by OsmService's `_isChangesetInflight()` guard.
- **Note tile request IDs use `osm-note-tile-` prefix** — Original `osm-note-${tileID}` collided with `osm-note-post-create-*` and `osm-note-post-update-*`, requiring a complex abort predicate with negative lookahead. Renamed to `osm-note-tile-${tileID}` so `abortMatching` can simply test `/^osm-note-tile-/`. The broader `/^osm-note-/` regex in `setRateLimit` correctly aborts ALL note requests (tiles + posts) during rate limiting.
- **OsmService request ID prefix conventions** — `osm-tile-${tileID}` (map data tiles), `osm-note-tile-${tileID}` (note tiles), `osm-note-post-create-${noteID}` (note creation), `osm-note-post-update-${noteID}` (note update), `osm-changeset-create` / `osm-changeset-upload-${id}` / `osm-changeset-close-${id}` (changeset operations). The `osm-` prefix lets `resetAsync` abort everything with one regex.
- **WaybackService metadata cache key is NOT a requestID** — `getMetadataAsync()` has `const key = \`${tile.id}_${releaseDate}\`` which is a local cache lookup key. Only the property passed to `network.fetch()` uses the `requestID` name: `{ requestID: \`wayback-meta-${key}\` }`. Don't blindly rename all `key` variables in services.

## 3-System Split: SchedulerSystem / WorkerSystem / NetworkSystem

- **WorkerSystem owns "where to run"** — Worker pool (lazy spawn, round-robin, workerURL config, maxWorkers, terminateWorkers) + listener registry (registerListener, unregisterListener, getListener). Extracted from SchedulerSystem (pool) and NetworkSystem (handlers) to avoid a 1000+ line monolith and give worker management a clear home.
- **SchedulerSystem owns "when to run"** — Game loop (rAF), priority queues (urgent/normal/idle), timers (debounce/throttle/setTimeout/setInterval), frame callbacks, backpressure. No worker knowledge.
- **NetworkSystem owns network I/O** — Fetch lifecycle, inflight tracking, dedup, abort, concurrency limiting, timeout. Dispatches to WorkerSystem when available (`worker` is an optional dependency). Falls back to main-thread handler via `worker.getListener()`.
- **Host app sets `worker.workerURL`** — in `dist/index.html` / `dist/index-dev.html` after `initAsync()`. This is the only configuration needed for worker support.

## Worker Architecture Vision

- **Named operation registry** — Current worker only handles `'fetchAndParse'`. Future: workers register named handlers (e.g. `'processOsmTile'`), callers pass operation name + serializable data. Can't send closures across `postMessage`.
- **Worker Context with limited systems** — Workers would get their own lightweight `Context` with `network`, `spatial`, etc. — but no `gfx`, `ui`, or DOM. Registry pattern already supports partial system sets.
- **Stable graph snapshots for worker validation** — `EditSystem.stable` graph is the right trigger point. Only send to workers on stable transitions (not during drag/staging). Worker rebuilds spatial index from snapshot, runs validators, posts back issue props. No debouncing needed — edit workflow already produces the right cadence.
- **Transferable snapshot format** — Large spatial snapshots should use `ArrayBuffer`/typed arrays for near-zero-copy `postMessage` transfer. R-tree bounding boxes are naturally float arrays.

## Worker Companion Convention (`*.worker.ts`)

- **Co-located companion files** — Worker-side listeners live in `Foo.worker.ts` next to the main-thread `Foo.ts`. Each exports individual named handlers (e.g. `fetchAndParse`, `reset`) plus a `workerListeners: Record<string, WorkerListener>` for the worker barrel. Task names are namespaced: `'mapwithai:fetchAndParse'`, `'osm:parseTile'`, etc.
- **Dual registration** — The same handler functions are registered in two places: (1) the worker imports them via `index.worker.ts` barrel → `worker.ts`, and (2) the service imports them directly and calls `worker.registerListener()` at init time. Each execution context gets its own module-scope state (e.g. its own `OsmXMLParser` instance).
- **Folder-level `index.worker.ts` barrels** — Each module folder with worker companions has an `index.worker.ts` that re-exports them (e.g. `services/index.worker.ts`), sitting alongside the main-thread `index.ts` barrel. The worker entry point (`modules/worker.ts`) imports from these barrels only — never from the main barrels (`services/index.ts`), which pull in main-thread code.
- **Worker-safe by construction** — `.worker.ts` files must only import worker-safe code (parsers, utilities). They cannot import `Context`, systems, or anything DOM-dependent.
- **`WorkerListener` type** in `modules/worker_types.ts` — `(data: unknown, signal: AbortSignal) => unknown | Promise<unknown>`. Shared between `worker.ts` and all companion files.
- **Long-lived instances** — Companion files may instantiate stateful objects (e.g. `OsmXMLParser`) at module scope. These persist for the lifetime of their execution context (worker or main thread). A `'service:reset'` listener clears accumulated state (e.g. `_seen` caches) when needed.
- **NetworkSystem owns inflight tracking** — Services pass `task` + `taskData` in `NetworkFetchOptions`. NetworkSystem routes to worker or calls the registered handler directly. No local `inflight` Map needed in services — `isInflight()`, `abortMatching()`, and `hasMatching()` all work transparently.
- **Structured-clone constraint** — Worker task results must be structured-clone safe: plain objects, arrays, Sets, Maps, typed arrays. No DOM nodes, no prototype methods. Parse XML in the worker, return `ParserResult` (not `Document`).
- **`resetAsync` should not terminate workers (future)** — Current behavior terminates workers on reset. Future: send `'reset'` message instead, letting workers clear state without paying the respawn cost. Workers are expensive to restart (script parse + compile).

## Architecture

- **Scoped data, no aggregate caches** — Both StyleSystem and SchemaSystem store data in `_scopes: Map<ScopeID, ScopeData>`. No aggregate maps across scopes. Callers access scope data directly: `schema.getScope('osm')?.fields.get(id)`.
- **`'*'` common scope** — Holds geometry fallback presets and default styles. Created by `resetAll()`. Always available even without loaded data. Production `rapid_style.json5` uses `scope: '*'`.
- **Scoped format only** — `merge()` only accepts `{ scopes: [{ scope: 'osm', ... }] }`. External flat data (id-tagging-schema, NsiService) gets wrapped before merging.

## Rulesets & Variables

- **Separate `osm_rulesets.json5`** — Not inside `rapid_schema.json5`. Load order: id_tagging_schema → osm_rulesets → rapid_schema.
- **Lookup tables stay as Records** — `areaKeys`/`pointTags`/`vertexTags` are O(1) Record lookups on SchemaScope. Rulesets would be 50-150x slower on these hot paths.
- **`lifecycle` ruleset as config container** — The Set of prefixes is derived from its key patterns, not used for `match()` directly. `lifecycle_prefixes` variable is the canonical source.
- **`match()` and excludes subtlety** — `match({k: v})` only sees the key/value pairs you pass. When excludes reference different keys than includes, pass the full tag object.
- **Actions access schema via `graph.context.systems.schema`** — `Graph.context` is always set. This is fine and explicit.

## PMTiles Fetching Bypasses NetworkSystem

- **PMTiles library owns its own fetch** — `PMTiles.getZxy()` delegates to `Source.getBytes(offset, length, signal)` internally. The default `FetchSource` issues HTTP Range requests with `globalThis.fetch`. These requests bypass NetworkSystem entirely, so `inflightPMTiles: Map<string, AbortController>` tracks them separately on VTSource.
- **Future unification** — A custom PMTiles `Source` adapter could delegate `getBytes()` to `network.fetchRaw()` with Range headers. This would eliminate `inflightPMTiles` and let NetworkSystem be the single source of truth for all inflight traffic. Low priority for now.

## Generic Type Parameters Over Element Casts

- **Annotate the container, not elements** — `new Set<RequestID>(...)` over `new Set(... as RequestID)`. One annotation vs. repeated casts. Already the pattern for `SystemID`; now applied consistently to `RequestID` and other ID types in Set/Map constructors.

## Dual-Props Pattern

Used when a class resolves references (`var()`, locale strings) in its props:
- `props` = raw/immutable (never mutated after construction)
- `_resolved` / `_resolvedValue` = lazy resolved copy
- Getter returns `resolved ?? raw` (zero overhead when no vars)
- `reset()` = null out the resolved copy
- Applied to: `Style`, `PropMatcher`. NOT needed for `Preset`/`Field` (localization cached in `_strings` Map).

## Scheduler Fallback Pattern

- **Services must fall through when scheduler is absent** — `scheduler?.debounce('id', request, opts)` silently drops the `request()` when scheduler is undefined. For services where the wrapped function MUST execute (API calls, data fetches), use: `if (shouldDebounce && scheduler) { scheduler.debounce(...) } else { request() }`. UI render deferrals (`redraws`, `renders`) are safe as no-ops — missing one is harmless.
- **`scheduler` is an optional dependency** — Services that use it add `'scheduler'` to `optionalDependencies`. This keeps services testable without SchedulerSystem and supports future CLI contexts.

## Context Lifecycle

- **No backward compat for old `initAsync()`** — It now only inits (doesn't start). Simple consumers use `context.run()`. v3 breaking change.
- **`prepareAsync()` → `initAsync()` → `startAsync()`** — Each phase chains the previous. All idempotent. `run()` is a convenience that chains everything.

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.
