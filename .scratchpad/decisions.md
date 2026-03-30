# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## NetworkSystem

- **`RequestID` as a typed string ID** — Follows the established pattern in `ids.ts` (like `EntityID`, `TileID`). Used throughout `NetworkFetchOptions`, `InflightRequest`, `QueuedFetch`, and all public API methods. Default requestID is `'${METHOD} ${url}'` (e.g. `'GET https://example.com/data'`). Services pass domain-specific IDs like `'keepright-tile-0,0,14'`.
- **Regex `.test()` for `abortMatching` predicates** — All predicates use `/^prefix-/.test(requestID)` instead of `requestID.startsWith('prefix-')`. ~10% faster per jsbench, and consistent across all services. Domain dots escaped (e.g. `/nominatim\.openstreetmap\.org/`).
- **Worker offloading is transparent** — `network.fetch<T>()` automatically routes through `scheduleWorkerTask('fetchAndParse', ...)` when scheduler + workerURL are available and no custom `fetchFn` is provided. Callers don't know or care whether the fetch ran on main thread or worker. `fetchRaw()` always runs on main thread (returns `Response` object, not serializable).
- **Concurrency limiting with FIFO queue** — When `numActive >= maxInflight`, new requests queue. Queued requests are abortable for free (no network request started). Queue drains in `.finally()` of completed requests. Default `maxInflight: 100`.
- **`hasMatching()` checks `_inflight` only, not `_queue` separately** — All requests (both active and queued) are registered in `_inflight` at the bottom of `_trackAndDispatch`. The queue is a *subset* of inflight. `abortMatching()` touches `_queue` separately only to *splice out* entries (preventing them from dispatching on drain), not for visibility. Used by OsmService's `_isChangesetInflight()` guard.
- **Note tile request IDs use `osm-note-tile-` prefix** — Original `osm-note-${tileID}` collided with `osm-note-post-create-*` and `osm-note-post-update-*`, requiring a complex abort predicate with negative lookahead. Renamed to `osm-note-tile-${tileID}` so `abortMatching` can simply test `/^osm-note-tile-/`. The broader `/^osm-note-/` regex in `setRateLimit` correctly aborts ALL note requests (tiles + posts) during rate limiting.
- **OsmService request ID prefix conventions** — `osm-tile-${tileID}` (map data tiles), `osm-note-tile-${tileID}` (note tiles), `osm-note-post-create-${noteID}` (note creation), `osm-note-post-update-${noteID}` (note update), `osm-changeset-create` / `osm-changeset-upload-${id}` / `osm-changeset-close-${id}` (changeset operations). The `osm-` prefix lets `resetAsync` abort everything with one regex.
- **WaybackService metadata cache key is NOT a requestID** — `getMetadataAsync()` has `const key = \`${tile.id}_${releaseDate}\`` which is a local cache lookup key. Only the property passed to `network.fetch()` uses the `requestID` name: `{ requestID: \`wayback-meta-${key}\` }`. Don't blindly rename all `key` variables in services.

## Worker Architecture Vision

- **Named operation registry** — Current worker only handles `'fetchAndParse'`. Future: workers register named handlers (e.g. `'processOsmTile'`), callers pass operation name + serializable data. Can't send closures across `postMessage`.
- **Worker Context with limited systems** — Workers would get their own lightweight `Context` with `network`, `spatial`, etc. — but no `gfx`, `ui`, or DOM. Registry pattern already supports partial system sets.
- **Stable graph snapshots for worker validation** — `EditSystem.stable` graph is the right trigger point. Only send to workers on stable transitions (not during drag/staging). Worker rebuilds spatial index from snapshot, runs validators, posts back issue props. No debouncing needed — edit workflow already produces the right cadence.
- **Transferable snapshot format** — Large spatial snapshots should use `ArrayBuffer`/typed arrays for near-zero-copy `postMessage` transfer. R-tree bounding boxes are naturally float arrays.

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
