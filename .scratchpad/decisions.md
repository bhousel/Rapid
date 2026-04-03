# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## NetworkSystem

- **`RequestID` as a typed string ID** — Follows the established pattern in `ids.ts` (like `EntityID`, `TileID`). Used throughout `NetworkFetchOptions`, `InflightRequest`, `QueuedFetch`, and all public API methods. Default requestID is `'${METHOD} ${url}'` (e.g. `'GET https://example.com/data'`). Services pass domain-specific IDs like `'keepright-tile-0,0,14'`.
- **Regex `.test()` for `abortMatching` predicates** — All predicates use `/^prefix-/.test(requestID)` instead of `requestID.startsWith('prefix-')`. ~10% faster per jsbench, and consistent across all services. Domain dots escaped (e.g. `/nominatim\.openstreetmap\.org/`).
- **Worker offloading is transparent** — `network.fetch<T>()` automatically routes through `dispatch('fetchAndParse', ...)` when scheduler + workerURL are available and no custom `fetchFn` is provided. Callers don't know or care whether the fetch ran on main thread or worker. `fetchRaw()` always runs on main thread (returns `Response` object, not serializable).
- **Listener registry for domain-specific worker functions** — `WorkerSystem` has a `registerListener(listenerID, listener)` / `getListener(listenerID)` API. Systems register their `*.worker.ts` listeners at init time (e.g. NetworkSystem registers `'network:fetchAndParse'` etc.). Callers pass `listenerID` + `listenerData` in `NetworkFetchOptions`. NetworkSystem's `_dispatchFetch` routes named tasks to the worker when available, or calls the registered listener (via `worker.getListener()`) directly on the main thread as fallback. If a `listenerID` is provided but not registered, the promise rejects with an error — never silently falls through to generic fetch+parse. This eliminates dual dispatch paths in services — a single `network.fetch()` call handles both. NetworkSystem owns all inflight tracking, dedup, and abort for both paths.
- **Concurrency limiting with FIFO queue** — When `numActive >= maxInflight`, new requests queue. Queued requests are abortable for free (no network request started). Queue drains in `.finally()` of completed requests. Default `maxInflight: 100`.
- **`hasMatching()` checks `_inflight` only, not `_queue` separately** — All requests (both active and queued) are registered in `_inflight` at the bottom of `_trackAndDispatch`. The queue is a *subset* of inflight. `abortMatching()` touches `_queue` separately only to *splice out* entries (preventing them from dispatching on drain), not for visibility. Used by OsmService's `_isChangesetInflight()` guard.
- **Note tile request IDs use `osm-note-tile-` prefix** — Original `osm-note-${tileID}` collided with `osm-note-post-create-*` and `osm-note-post-update-*`, requiring a complex abort predicate with negative lookahead. Renamed to `osm-note-tile-${tileID}` so `abortMatching` can simply test `/^osm-note-tile-/`. The broader `/^osm-note-/` regex in `setRateLimit` correctly aborts ALL note requests (tiles + posts) during rate limiting.
- **OsmService request ID prefix conventions** — `osm-tile-${tileID}` (map data tiles), `osm-note-tile-${tileID}` (note tiles), `osm-note-post-create-${noteID}` (note creation), `osm-note-post-update-${noteID}` (note update), `osm-changeset-create` / `osm-changeset-upload-${id}` / `osm-changeset-close-${id}` (changeset operations). The `osm-` prefix lets `resetAsync` abort everything with one regex.
- **WaybackService metadata cache key is NOT a requestID** — `getMetadataAsync()` has `const key = \`${tile.id}_${releaseDate}\`` which is a local cache lookup key. Only the property passed to `network.fetch()` uses the `requestID` name: `{ requestID: \`wayback-meta-${key}\` }`. Don't blindly rename all `key` variables in services.

## 3-System Split: SchedulerSystem / WorkerSystem / NetworkSystem

- **WorkerSystem owns "where to run"** — Worker pool (lazy spawn, round-robin, workerURL config, maxWorkers, terminateWorkers) + listener registry (registerListener, unregisterListener, getListener). Extracted from SchedulerSystem (pool) and NetworkSystem (listener registry) to avoid a 1000+ line monolith and give worker management a clear home.
- **SchedulerSystem owns "when to run"** — Game loop (rAF), priority queues (urgent/normal/idle), timers (debounce/throttle/setTimeout/setInterval), frame callbacks, backpressure. No worker knowledge.
- **NetworkSystem owns network I/O** — Fetch lifecycle, inflight tracking, dedup, abort, concurrency limiting, timeout. Dispatches to WorkerSystem when available (`worker` is an optional dependency). Falls back to main-thread listener via `worker.getListener()`.
- **Host app sets `worker.workerURL`** — in `dist/index.html` / `dist/index-dev.html` after `initAsync()`. This is the only configuration needed for worker support.

## Request Interceptor API

- **Interceptors run on the main thread before dispatch** — They produce a serializable `RequestInit` that can be sent to a web worker. This is the key design: auth headers are added on the main thread (where localStorage/token access is available), then the modified init goes to the worker.
- **Registration order matters** — Interceptors run in registration order, each receiving the output of the previous. This allows composable request modification.
- **OsmService `_authInterceptor`** — Uses `oauth.getAccessToken()` from osm-auth v3.2.0, which was added specifically for this use case (osmlab/osm-auth#149). Previous approach probed `globalThis.localStorage` directly with a fallback to `oauth.options().access_token`. The public API is cleaner and works correctly in all environments (browser, workers, Node/test).
- **Interceptors replace `fetchFn` for auth** — OsmService no longer passes `fetchFn: this._oauth.fetch` to `network.fetch()`. Instead, the interceptor adds the Authorization header transparently. `fetchFn` remains in the API as an escape hatch.
- **Write operations stay `mainThread: true`** — Changeset create/upload/close and note post operations are infrequent and don't benefit from worker offloading.
- **`.trimStart()` before `parseFromString()`** — xmldom 0.9.x throws `ParseError` if an XML declaration (`<?xml ...>`) is not at byte position 0. Applied `.trimStart()` at all three production XML parsing sites (`fetch_response.ts`, `OsmXMLParser.ts`, `PixiLayerCustomData.ts`). Handles real-world server responses with leading whitespace. Alternative considered: `onError` handler to suppress the specific error — rejected because it requires matching on error message strings and risks masking real parse errors.

## Worker Architecture Vision

- **Deferred result resolution via `resultPriority`** — `WorkerSystem.dispatch()` accepts an optional `{ resultPriority: 'urgent' | 'normal' | 'idle' }`. When set, the promise returned by `dispatch()` is resolved through `SchedulerSystem.schedule()` instead of immediately in the worker's `onmessage` handler. This prevents heavy `.then()` chains (entity construction, `graph.rebase`, `tree.rebase`) from running as uninterruptible microtask avalanches that blow frame budgets. Each deferred result gets its own slot in the scheduler's drain loop, so the browser can yield between tiles. When SchedulerSystem is unavailable (tests, CLI), resolution is immediate — no worse than before. OsmService's `loadFromAPI` uses `resultPriority: 'normal'` as the first consumer.
- **Why at WorkerSystem, not at call sites** — Deferral at the dispatch level means every service that uses worker fetch+parse benefits automatically. If instead each callback wrapped itself in `scheduler.schedule(...)`, it would be easy to forget, and every service would need its own boilerplate. The `resultPriority` option is opt-in — callers that omit it get immediate resolution (suitable for small metadata fetches that don't trigger heavy graph work).
- **Wired through NetworkSystem** — `NetworkFetchOptions.resultPriority` passes through `_dispatchFetch()` → `worker.dispatch(_, _, _, { resultPriority })`. This keeps the option visible at the fetch call site where the caller knows the weight of the expected result.
- **Named operation registry** — Workers support multiple named listeners (e.g. `'network:fetchAndParse'`, `'osmService:fetchAndParse'`, `'osmService:reset'`). Each `*.worker.ts` companion file exports a `ListenerRegistry`. Callers pass a `listenerID` + serializable data. Can't send closures across `postMessage`.
- **Worker Context with limited systems** — Workers would get their own lightweight `Context` with `network`, `spatial`, etc. — but no `gfx`, `ui`, or DOM. Registry pattern already supports partial system sets.
- **Stable graph snapshots for worker validation** — `EditSystem.stable` graph is the right trigger point. Only send to workers on stable transitions (not during drag/staging). Worker rebuilds spatial index from snapshot, runs validators, posts back issue props. No debouncing needed — edit workflow already produces the right cadence.
- **Transferable snapshot format** — Large spatial snapshots should use `ArrayBuffer`/typed arrays for near-zero-copy `postMessage` transfer. R-tree bounding boxes are naturally float arrays.

## Worker Companion Convention (`*.worker.ts`)

- **Co-located companion files** — Worker-side listeners live in `Foo.worker.ts` next to the main-thread `Foo.ts`. Each exports individual named listeners (e.g. `fetchAndParse`, `reset`) plus a `listeners: Record<string, Listener>` for the worker barrel. Listener names are namespaced: `'network:fetchAndParse'`, `'osm:parseTile'`, etc.
- **Dual registration** — The same listener functions are registered in two places: (1) the worker imports them via `index.worker.ts` barrel → `worker.ts`, and (2) the service imports them directly and calls `worker.registerListener()` at init time. Each execution context gets its own module-scope state (e.g. its own `OsmXMLParser` instance).
- **Folder-level `index.worker.ts` barrels** — Each module folder with worker companions has an `index.worker.ts` that re-exports them (e.g. `services/index.worker.ts`), sitting alongside the main-thread `index.ts` barrel. The worker entry point (`modules/worker.ts`) imports from these barrels only — never from the main barrels (`services/index.ts`), which pull in main-thread code.
- **Worker-safe by construction** — `.worker.ts` files must only import worker-safe code (parsers, utilities). They cannot import `Context`, systems, or anything DOM-dependent.
- **`Listener` and `ListenerRegistry` types** in `global.d.ts` — `Listener = (data: unknown, signal: AbortSignal) => unknown | Promise<unknown>`. Declared globally for convenience since they're used across bundle boundaries (worker entry point, companion files, main-thread systems). Avoids cross-bundle import concerns. `ListenerRegistry = Record<ListenerID, Listener>` is the barrel export type for `index.worker.ts` files.
- **Long-lived instances** — Companion files may instantiate stateful objects (e.g. `OsmXMLParser`) at module scope. These persist for the lifetime of their execution context (worker or main thread). A `'service:reset'` listener clears accumulated state (e.g. `_seen` caches) when needed.
- **NetworkSystem owns inflight tracking** — Services pass `task` + `taskData` in `NetworkFetchOptions`. NetworkSystem routes to worker or calls the registered listener directly. No local `inflight` Map needed in services — `isInflight()`, `abortMatching()`, and `hasMatching()` all work transparently.
- **Structured-clone constraint** — Worker task results must be structured-clone safe: plain objects, arrays, Sets, Maps, typed arrays. No DOM nodes, no prototype methods. Parse XML in the worker, return `ParserResult` (not `Document`).
- **`resetAsync` does not terminate workers** — Workers are long-lived and persist across resets. Each system dispatches its own reset message to its listener functions (e.g. `'network:reset'`). Terminating workers on reset would race with reset messages and is expensive (script re-parse + re-compile on respawn). Workers only terminate on explicit `terminateWorkers()` calls or system destruction.

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

## Canvas Renderer Atlas Support

- **Canvas renderer bypasses the upload pipeline** — Pixi's canvas renderer has no `_uploads` map. It reads `TextureSource.resource` directly via `canvasUtils.getCanvasSource()` at draw time. If `resource` is falsy, it returns `null` and nothing draws.
- **Canvas-backed `AtlasSource` as the fix** — When `useCanvas: true`, `AtlasSource` creates an `HTMLCanvasElement` matching the slab size and sets it as `this.resource`. The canvas renderer's `getCanvasSource()` returns this directly — zero copies, zero conversions (not PMA, no resize needed).
- **Blit at allocation time, not upload time** — Because there's no upload hook for canvas, `_blitItemToCanvas()` is called in `AtlasAllocator.allocate()` right after the item is added. For GL/GPU, upload handlers still fire lazily at render time as before.
- **`_getItemPixels()` shared across all three render paths** — Extracted the padded-pixel-copy loop (1px edge duplication) from the GL and GPU upload handlers into `AtlasSource._getItemPixels()`. This eliminates duplicated code and ensures all renderers produce identical atlas content.
- **Canvas overhead only when needed** — The `useCanvas` option is only set to `true` when `RendererType.CANVAS` is detected. GL/GPU paths don't create backing canvases, avoiding the extra ~16MB per 2048×2048 slab.
- **`(this as any).resource = canvas`** — Type mismatch: `AtlasSource extends TextureSource<BufferSourceOptions>` where the generic expects a TypedArray resource, but the canvas renderer needs an `HTMLCanvasElement`. The `as any` cast is intentional — the canvas renderer inspects `resource` dynamically, not via generic type constraints.
- **No clear-on-free** — Freed atlas regions aren't cleared on the backing canvas, matching the GL/GPU behavior (they just `texSubImage2D` / `writeTexture` over freed space when it's reallocated).

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.
