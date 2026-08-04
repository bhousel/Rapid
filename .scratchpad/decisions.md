# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## UI events: EventEmitter over d3_dispatch/utilRebind

All UI class components that emit events extend `EventEmitter` from `tseep/lib/ee-safe` — the same
library used by `AbstractSystem`, `AbstractMode`, `AbstractBehavior`, and `Context`. This gives a
single, consistent event API across the whole codebase (`.on` / `.off` / `.emit`) and removes the
d3-dispatch + `utilRebind` + `public on!` boilerplate that every emitting class had to repeat.

The two factory functions `combobox.ts` and `disclosure.ts` still use `d3_dispatch` (they rebind
the dispatch onto a returned function-object, not a class instance). Converting them would require
changing their call-site API; deferred until their remaining JS consumers are converted.

`UiFieldRestrictions` was the only disabled/stub class; it still extends `EventEmitter` even though
its `render()` is a placeholder, because the field registry (`uiFields`) instantiates it just like
any other field type.

- **Use explicit strict sanitization only at known trust boundaries.** External QA content, notes, remote metadata, Markdown, and reusable HTML widgets pass through Rapid's detached-document allowlist. The sanitizer rejects foreign namespaces and unsafe URL schemes, hardens new-window links, and reparses until serialization is stable. It fails closed to escaped text when DOM parsing is unavailable.
- **Do not install a document-wide Trusted Types default policy.** Rapid's registries and embedding model let extensions own their rendering. A global policy rewrites those extension sinks, and DOMPurify's assumptions did not hold in live Chrome. Keep sanitization local to the core trust boundaries instead.
- **Keep CSP inline scripts hash-based and extension-aware.** `script-src` has no `unsafe-inline`; exact SHA-256 hashes authorize the bootstraps and `strict-dynamic` propagates that trust to registered service scripts. HTTPS styles and fonts remain available to extension assets. The editor documents explicitly opt into `unsafe-eval` because Mapillary JS 4 unconditionally compiles filters with `new Function`; the OAuth callback does not. Core Pixi and event emitters use their no-eval implementations.
- **Refresh CSP hashes after deploy-time rewriting.** The predeploy step regenerates the policy after embedding build data, and `check:csp` catches stale committed policies with the capability options for each document.

## Pixi World-Coord Rendering (render_worldcoord)

- **Scene graph hierarchy**: `stage → origin → world → groups → features`. `stage` centers [0,0] at screen center for rotation. `origin` shifts back to top-left and absorbs panning offset (via Pixi's own `x/y`). `world` maps z16 world coordinates to screen pixels via `world.scale = 2^(pixiTransform.z - WORLD_ZOOM)` and `world.position = (pixiTransform.x - WORLD_HALF * scale, pixiTransform.y - WORLD_HALF * scale)`. All layers that render entity geometry live under `world`.
- **Use `pixiTransform` not `mapTransform` for `world`** — Panning is absorbed by the `origin` container. `pixiTransform` already includes all pending panning deltas. `mapTransform` lags behind by one frame during drags. Using `pixiTransform` means small panning moves don't dirty `world` at all.
- **`background` (tile imagery) stays under `origin`** — Tile textures are in screen space; there is no benefit to putting them under `world`. Only entity-geometry layers move.
- **Container position = `world.origin` (extent center)** — Each feature's `container.position` is set to the extent center of its geometry in z16 world coordinates. All vertex drawing is then origin-relative. This keeps vertex magnitudes small (~thousands not ~8 million), making float32 drawing safe and d3-polygon numerics stable.
- **Points: counter-scale + counter-rotate** — The `world` container scales geometry up with zoom. Point sprites are fixed-size in screen pixels. Fix: set `container.scale = baseScale / worldScale` and `container.rotation = -bearing`. This keeps child sprites screen-sized regardless of zoom/bearing. Halos and hit areas live in the counter-scaled local space, so they work unchanged.
- **Lines + polygons: world-local stroke widths** — Instead of counter-scaling (which would shrink geometry), express stroke widths in world-local units: `localWidth = pixelWidth * 2^(WORLD_ZOOM - zoom)`. At render time the `world` container's scale inverts this back to screen pixels. Dash patterns and buffer widths use the same conversion.
- **Hit areas are in container-local space** — `container.hitArea = new PIXI.Polygon(...)` coordinates must be in the container's local frame. For world-path features the local frame is world-local (origin-relative). `lineToPoly()` is called with world-local points and a world-local buffer width. Pixi composes the container transform when doing hit testing, so no extra projection is needed.
- **DashLine halos: `scale` only, no per-caller workaround** — DashLine's `scale` option multiplies `width` and each `dash[i]` to convert drawing-coord units to screen pixels. Line/Polygon halo containers have `scale=1` (drawing in world units), so they pass `scale: 2^(WORLD_ZOOM - zoom)` (a.k.a. `localScale`) to keep dashes at fixed screen-pixel sizes. Point halo containers have a counter-scale (`1/worldScale`) that puts halo-local units in CSS pixels, so `scale=1` (default) is correct. DashLine itself uses `textureSpace: 'global'` (normalizes UV by texture pixel dimensions, no per-segment stretch), keeps pow2 padding for WebGL1 REPEAT-wrap, and compensates in the per-segment matrix using `texW`/`texH` instance fields so one full cycle covers exactly `dashSize * userScale` local units. Matrix composed scale-then-rotate for non-uniform scale correctness.
- **`viewZoom` vs `styleZoom` naming convention** — Throughout the Pixi layer and feature files: `viewZoom = viewport.transform.zoom` is used for scale chain math (world↔screen scale factors, `worldScale = 2^(viewZoom - WORLD_ZOOM)`). `styleZoom = map?.effectiveZoom() ?? viewZoom` is the latitude-adjusted zoom used only for LOD thresholds (`< 16`, `< 17`) and styling decisions. The two are explicitly named at the top of each method that needs both. `PixiFeaturePolygon` has no LOD thresholds so it only has `viewZoom` — intentional.
- **`MapSystem.effectiveZoom()` formula** — `z + (-log2(cos(lat * DEG2RAD)))`. The old implementation used two `geoMetersToLon(1, lat)` / `geoMetersToLon(1, 0)` calls whose ratio is exactly `1/cos(lat)`, i.e. `sec(lat)`. The direct formula is equivalent but avoids the detour through longitude-scale math.
- **Dual-path migration pattern**: `_geom !== null` → world path; else legacy screen path. Branch on `if (this._geom)` in feature `update()`. Legacy `geom` (PixiGeometryPart) is kept alive until all callers migrate. Final cleanup (Step 5) removes `geom`, `PixiGeometryPart`, all `setCoords` calls, and merges both paths.

## World Coordinate System (render_worldcoord)

- **Use SDK-native z16 world coordinates as the canonical world space** — We removed Rapid's temporary `worldScaled` bridge and now rely on `@rapid-sdk/math` world coordinates directly (`WORLD_ZOOM = 16`, world range `0..16,777,216`). This avoids duplicate geometry caches and keeps rendering/spatial math aligned with SDK primitives.
- **Keep world-coordinate grouping in PixiScene** — Feature groups continue using a single zoom-dependent group transform (`scale = 2^(zoom - WORLD_ZOOM)`) so features can stay in world-coordinate local geometry without per-vertex reprojection each frame.

## World Coordinate Numerics

- **World coordinates are safe for affine transforms, risky for shoelace-style derived metrics** — Rotation, translation, scaling in world space work correctly. But d3-polygon's centroid/area formulas involve cross-products (x₀*y₁ - x₁*y₀) where the products are ~1e13 and their differences are ~1e7, leading to catastrophic cancellation when accumulating ~1e14-magnitude terms. The final centroid can land far outside the polygon's hull.
- **Compute d3-polygon metrics in a local translated frame** — For centroid and area, translate all points by subtracting the extent center (world.origin), compute the metric locally, then translate the result back. This keeps intermediate values small (~1e-6) and preserves precision. Example: centroid in world space landed outside the hull; same computation on translated points (offset by `world.origin`) placed centroid correctly inside.
- **GeometryPart caches `.local` coordinates for numerical stability** — Each GeometryPart now stores three coordinate frames: (1) `.orig` in WGS84, (2) `.world` in z16 world coordinates, (3) `.local` relative to world origin. All d3-polygon computations (hull, centroid, area, ssr) happen on `.local` coordinates, then results are translated back to world space. This eliminates the need for the `stablePolygonCentroid()` workaround and enables future Pixi rendering optimization: local arrays can be rendered directly with Pixi container transforms (position at origin, no per-vertex reprojection).
- **Hull and geometric tests are robust** — `polygonHull()` and orientation tests (like `cross(a,b,c)`) work correctly on large coordinates because they compare point membership (combinatorial) rather than accumulating cancelling terms.
- **Area drifts less than centroid** — In a test case (0.00456% drift for area vs. >100% for centroid), but both use local frame for consistency and to avoid future surprises.
- **References:** See [modules/lib/GeometryPart.ts](modules/lib/GeometryPart.ts) local frame computation and [test/unit/lib/GeometryPart.test.js](test/unit/lib/GeometryPart.test.js) tests for local/world coordinate correctness.

## Spatial System — buffers / conflation (Step 3)

- **Buffers are quantized "coverage boxes", not exact geometry** — A mathematically exact buffer is the Minkowski sum of a geometry with a disk. We don't need exactness, we need speed. Turf/JTS don't compute Minkowski either (they offset-curve + node + polygonize; same family as `PIXI.buildLine` / `lineToPoly`). For conflation we cover the geometry in boxes (a quantization). Coverage boxes double as the RBush query boxes.
- **`geomCoverageBoxes` is for conflation, not rope labels** — Rope labels need a *uniform arc-length sampler* (`geomLineSegments`) so that `scaleX = lWidth / ((numBoxes-1)*boxsize)` holds. `geomCoverageBoxes` subdivides each segment independently and produces denser, non-uniform spacing, which breaks `scaleX` and squishes text. The two helpers serve different purposes despite both "sampling along a line".
- **Coverage representation is per geometry type** — Point → one box of half-size `r`; LineString → boxes sampled every ~`r` along the line (partial matching falls out for free, per-box); Polygon → grown extent box (box-filling a 2D region is wasteful; phase-2 uses real polygon overlap instead). Don't force everything into box-fills.
- **Radius is a recompute parameter, not baked into `setData`** — `setData()` computes the radius-independent core projection; a separate `computeCoverage(r)` produces coverage for a given radius and is re-called when the user tweaks the conflation distance (e.g. 3 m → 2.5 m).
- **Two-phase querying with a caller-supplied predicate** — RBush indexes bboxes only, so queries are bbox-prefilter then precise-refine. `SpatialSystem` owns the generic mechanics (`getItemsAtBox(es)`, refine) but takes the predicate from the caller; "match" semantics live in a `Conflation` module. Phase-2 predicates already exist in `@rapid-sdk/math` (`geomPointInPolygon`, `geomPolygon{Contains,Intersects}Polygon`, `geomLineIntersection`, `vecProject`/`vecLength`), so we almost certainly never need `jsts`. New helpers can start in `modules/geo` and migrate to the SDK later (we control `rapid-sdk`).
- **Lazy `GeometryPart` derived products (Step 3a)** — `update()` keeps only the cheap core eager (projected coords, extent, origin, outer); `hull`/`centroid`/`poi`/`area`/`winding`/`surround`/`flat` are lazy memoized getters computed on first access. This shrinks the memory/compute footprint for large datasets (Overture-scale) where most features are never rendered or conflated. Because `centroid`/`poi` derive from `hull` (stabilization trick), they share the same laziness. `clone()` re-derives from `orig` (cheap now) rather than deep-copying computed arrays, which also avoids the lazy-getter-vs-`structuredClone` interaction.

## actionMove: frame-of-reference in `replaceMovedVertex`

`replaceMovedVertex` does two tests when deciding whether to insert a shape-preserving vertex on an unmoved way:

1. **Angle test** — "Is the unmoved way nearly straight (≈180°) at this junction?" → uses `nodeOriginalLocal(prev/next)` (pre-move positions). Rationale: when a moved way connects to the unmoved way at _more than one_ shared endpoint (e.g. a U-shaped driveway), the "neighbouring" node on the unmoved way may itself be one of those shared endpoints — which has already shifted by the delta. Using its post-move position distorts the angle reading and can push a straight junction outside the ±5° window, triggering a bogus insertion. Original (pre-move) positions always reflect the unmoved way's actual geometry.

2. **Path-length comparison** — "Which insertion order produces the shorter path?" → uses `nodeLocal(prev/next)` (current positions). Rationale: this is about the way's resulting geometry after insertion, so it should reason about where nodes are now.

`nodeOriginalLocal(node)` returns `_cache.startLocal[node.id] ?? nodeLocal(node)` — for unmoved nodes the two are identical.

## World-coordinate refactor for actions

`actionMove` (and all the geometry-manipulation actions: rotate, reflect, scale, orthogonalize, circularize, straighten-nodes) now do all computation in **world coordinates with a local origin** for floating-point stability. The pattern:
- Pick an origin (e.g. centroid of selected nodes in world space) and store it in `_cache.origin`.
- Store each node's pre-move world position as `startLocal = worldPos - origin`.
- Do all geometry math in local world space (small numbers, FP-stable).
- At the end: `node.move(projWorldToWgs84(localPos + origin))`.

Call sites pass a **world-space delta** (a `Vec2` difference of two `projWgs84ToWorld()` results), not a screen/viewport delta. This removes the `viewport` parameter that was previously required.

- **`NsiTreeProperties` removed from imports** — NSI v7 exports this type but we use `NsiTreesJSON['trees']` directly for the `trees` cache property, making the standalone type import unused.
- **`tags.wikipedia` qids lookup was dead code** — NSI used to cache both `wikidata QID → canonical QID` and `wikipedia URL → wikidata QID` in the replacements data. When we upgraded to NSI v7, which dropped wikipedia tracking, we removed the wp-caching loop in `_loadNsiDataAsync`. This made `this._nsi.qids?.get(tags.wikipedia)` in `upgradeTags` always return `undefined`. Removed the dead branch; `delete newTags.wikipedia` further down remains valid (strips bare `wikipedia=*` when a wikidata match is found).
- **Local `NsiItem` extends upstream `NsiItem`** — NSI v7's `NsiItem` type doesn't include runtime-populated fields `tkv` (tree/key/value path) and `mainTag` (e.g. `brand:wikidata`). We extend it locally to type those fields without casting everywhere.

## StyleSystem / StyleSelector

- **`weight` replaces auto-computed `specificity`** — The old specificity scoring (geometry +50, each tag matcher +10) couldn't express "building always overrides amenity" because both had 1 tag condition = same score. Adding more tag matchers to artificially increase specificity was fragile. `weight` gives the data author explicit control over cascade order, consistent with how presets use `matchScore`.
- **Default weight is 1** — Existing selectors with no `weight` all get weight=1, meaning equal-weight selectors preserve insertion order (stable sort). This keeps current behavior for the vast majority of selectors that don't need explicit ordering.
- **Sort ascending, iterate forward** — `findAll()` returns selectors sorted by weight ascending. `styleMatch()` iterates forward with `deepMerge`, so the last (highest-weight) selector wins. This is simpler than the old pattern of sorting descending then iterating in reverse.

## NetworkSystem

- **`RequestID` as a typed string ID** — Follows the established pattern in `ids.ts` (like `EntityID`, `TileID`). Used throughout `NetworkFetchOptions`, `InflightRequest`, `QueuedFetch`, and all public API methods. Default requestID is `'${METHOD} ${url}'` (e.g. `'GET https://example.com/data'`). Services pass domain-specific IDs like `'keepright-tile-0,0,14'`.
- **Regex `.test()` for `abortMatching` predicates** — All predicates use `/^prefix-/.test(requestID)` instead of `requestID.startsWith('prefix-')`. ~10% faster per jsbench, and consistent across all services. Domain dots escaped (e.g. `/nominatim\.openstreetmap\.org/`).
- **Worker offloading is transparent** — `network.fetch<T>()` automatically routes through `dispatch('fetchAndParse', ...)` when WorkerSystem is available and no custom `fetchFn` is provided. Callers don't know or care whether the fetch ran on main thread or worker. `fetchRaw()` always runs on main thread (returns `Response` object, not serializable).
- **Listener registry for domain-specific worker functions** — `WorkerSystem` has a `registerListener(listenerID, listener)` / `getListener(listenerID)` API. Systems register their `*.worker.ts` listeners at init time. Callers pass `listenerID` + `listenerData` in `NetworkFetchOptions`. If a `listenerID` is provided but not registered, the promise rejects — never silently falls through to generic fetch+parse.
- **Concurrency limiting with FIFO queue** — When `numActive >= maxInflight`, new requests queue. Queued requests are abortable for free (no network request started). Default `maxInflight: 100`.
- **`hasMatching()` checks `_inflight` only, not `_queue` separately** — All requests (both active and queued) are registered in `_inflight` at the bottom of `_trackAndDispatch`. The queue is a *subset* of inflight.
- **Note tile request IDs use `osm-note-tile-` prefix** — Avoids collision with `osm-note-post-create-*` / `osm-note-post-update-*`, so `abortMatching` can simply test `/^osm-note-tile-/`.
- **OsmService request ID prefix conventions** — `osm-data-tile-${tileID}` (map data tiles), `osm-note-tile-${tileID}` (note tiles), `osm-note-post-create-${noteID}`, `osm-note-post-update-${noteID}`, `osm-changeset-create` / `osm-changeset-upload-${id}` / `osm-changeset-close-${id}`.
- **WaybackService metadata cache key is NOT a requestID** — `getMetadataAsync()` has `const key = \`${tile.id}_${releaseDate}\`` which is a local cache lookup key. Only the property passed to `network.fetch()` uses the `requestID` name.

## NetworkSystem — FetchEnvelope and outcome tracking

- **`FetchEnvelope<T>` as the worker-boundary transport type** — Workers can't post `Response` objects, and thrown errors lose `.status` when flattened to string by `worker.postMessage`. `FetchEnvelope` carries the real HTTP status in all cases. All worker listeners return envelopes; the main-thread fetch path produces one too via `fetchEnvelope()` in `util/fetch_response.ts`. The bespoke `OsmFetchResult` is gone — replaced by the generic envelope.
- **AbortError never wrapped in an envelope** — It remains a rejected promise from all paths. This is what allows aborted requests to remain unrecorded (retryable). Never record an abort — the "pan away, pan back reloads the tile" behaviour depends on this invariant.
- **Three public fetch methods for different caller needs** — `fetch<T>()` unwraps the envelope and throws `FetchError` on HTTP error (90% case). `fetchEnvelope<T>()` returns the envelope, letting callers branch on status without try/catch (OsmService auth/rate-limit logic). `fetchRaw()` returns the raw `Response` — always main-thread, always `ok:true` from the envelope's perspective (caller inspects `response.status` itself).
- **`_completed: Map<RequestID, number>` is protected** — NetworkSystem is the single writer. Services use the public API: `isCompleted`, `getStatus`, `markCompleted`, `forget`. `completed.add(id)` was the old pattern that leaked across services; now there's no public write path.
- **Only explicit `requestID` options are recorded** — Auto-computed IDs (`'GET https://...'`) are NOT tracked. `_trackAndDispatch` takes a `trackCompleted: boolean` param; `_getOrDispatch` and `fetchRaw` compute `track = (options?.requestID !== undefined)`. Keeps the map lean and scoped to callers that care about dedup/retry.
- **`STATUS_SKIPPED = -1` for non-HTTP completions** — Tiles that cover a blocked region call `network.markCompleted(requestID)` (status = `STATUS_SKIPPED`). `STATUS_ERROR = 0` is the sentinel for transport failures / worker-flattened errors where no real HTTP status is available.
- **Retry intent is per-service, expressed via `forget()`** — Default is "don't retry" (NetworkSystem auto-records the error status). Do-retry services (Streetside, MapWithAI, OsmService tiles) call `network.forget(requestID)` in their catch handler to un-record the error and allow another attempt on the next `loadTiles()` call.
- **`FetchError` extended to construct from envelope fields** — `new FetchError(Response | FetchErrorInit)`. `FetchErrorInit` carries `{ status, statusText, message?, body? }`. Allows HTTP error details to be reconstructed on the main thread from an error envelope that crossed the worker boundary.

## 3-System Split: SchedulerSystem / WorkerSystem / NetworkSystem

- **WorkerSystem owns "where to run"** — Worker pool (lazy spawn, round-robin, workerURL config, maxWorkers, terminateWorkers) + listener registry (registerListener, unregisterListener, getListener). Extracted from SchedulerSystem (pool) and NetworkSystem (listener registry) to avoid a 1000+ line monolith and give worker management a clear home.
- **SchedulerSystem owns "when to run"** — Game loop (rAF), priority queues (urgent/normal/idle), timers (debounce/throttle/setTimeout/setInterval), frame callbacks, backpressure. No worker knowledge.
- **NetworkSystem owns network I/O** — Fetch lifecycle, inflight tracking, dedup, abort, concurrency limiting, timeout. Dispatches to WorkerSystem when available (`worker` is an optional dependency). Falls back to main-thread listener via `worker.getListener()`.
- **`workerURL` auto-detected in WorkerSystem constructor** — `Context.scriptURL` (captured from `document.currentScript.src` at bundle eval time) is used to derive the worker URL (same directory, matching `.min.` status). Detection happens at construction time (during `prepareAsync`'s system construction loop), so host apps can override or set `null` at any time before workers are first spawned.

## Request Interceptor API

- **Interceptors run on the main thread before dispatch** — They produce a serializable `RequestInit` that can be sent to a web worker. Auth headers are added on the main thread (where the token is available), then the modified init crosses the worker boundary as plain data.
- **Registration order matters** — Interceptors run in registration order, each receiving the output of the previous.
- **OsmService `_authInterceptor`** — Uses `oauth.getAccessToken()` from osm-auth v3.2.0. Adds `Authorization: Bearer <token>` to any request targeting `this._apiroot`.
- **Interceptors replace `fetchFn` for auth** — OsmService no longer passes `fetchFn: this._oauth.fetch`. `fetchFn` remains in the API as an escape hatch.
- **Write operations stay `mainThread: true`** — Changeset create/upload/close and note post operations are infrequent and don't benefit from worker offloading.

## Worker Architecture Vision

- **Deferred result resolution via `resultPriority`** — `WorkerSystem.dispatch()` accepts an optional `{ resultPriority: 'urgent' | 'normal' | 'idle' }`. When set, the promise returned by `dispatch()` is resolved through `SchedulerSystem.schedule()` instead of immediately in the worker's `onmessage` handler. Prevents heavy `.then()` chains from blowing frame budgets. OsmService's `loadFromAPI` uses `resultPriority: 'normal'`.
- **Named operation registry** — Workers support multiple named listeners. Each `*.worker.ts` companion file exports a `ListenerRegistry`. Can't send closures across `postMessage`.
- **All worker listeners return `FetchEnvelope<T>`** — This is the protocol. A listener that throws on HTTP error would have its error flattened to a string by `worker.postMessage`. The envelope is how status survives the boundary.

## Relative URL Resolution in Workers

- **Workers resolve relative URLs against their own script path** — A worker at `js/rapid-worker.js` resolves `data/foo.json` as `js/data/foo.json`, not from the page root.
- **Fix in `NetworkSystem._dispatchFetch`** — When `useWorker` is true, relative URLs are resolved to absolute via `new URL(url, globalThis.location?.href)` before being sent. `_resolveURL` is a private helper.

## Worker Companion Convention (`*.worker.ts`)

- **Co-located companion files** — Worker-side listeners live in `Foo.worker.ts` next to the main-thread `Foo.ts`. Each exports individual named listeners plus a `listeners: ListenerRegistry`.
- **Dual registration** — The same listener functions are registered in two places: (1) the worker imports them via `index.worker.ts` barrel → `worker.ts`, and (2) the service imports them and calls `worker.registerListener()` at init time. Each execution context gets its own module-scope state.
- **Folder-level `index.worker.ts` barrels** — Each module folder with worker companions has an `index.worker.ts` that re-exports them alongside the main-thread `index.ts` barrel.
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

- **`TreeStore` owns all nested-tree logic** — `modules/lib/TreeStore.ts` is the single home for path access + flat-key (de)serialization; `modules/util/keypath.ts` was folded in and deleted. `SettingsSystem` (persistence: `rapid.settings.*` namespace + migrations) and `LocalizationSystem` (`_store`, keyed `[locale][resource][…]`) both build on it. Nested internal repr chosen because reads are hot and writes rare.
- **`peek` vs `get`** — `TreeStore.peek` returns a copy-free live reference for hot read paths (l10n `t()`); `get` returns a deep copy of composites for safe external use. Strings are returned as-is by both (immutable, no clone).
- **`<TX_DOT>` normalized at load, not resolve** — Transifex can't use dots in translation keys, so data files use a `<TX_DOT>` sentinel. `LocalizationSystem` rewrites those keys to literal dots once when loading each resource; producers (e.g. `ImagerySource`) percent-encode dots as `%2E` (`encodeURIComponent` leaves `.` alone). The resolver stays ignorant of both encodings.

## Rulesets & Variables

- **Separate `osm_rulesets.json5`** — Not inside `rapid_schema.json5`. Load order: id_tagging_schema → osm_rulesets → rapid_schema.
- **Lookup tables stay as Records** — `areaKeys`/`pointTags`/`vertexTags` are O(1) Record lookups on SchemaScope. Rulesets would be 50-150x slower on these hot paths.
- **`lifecycle` ruleset as config container** — The Set of prefixes is derived from its key patterns, not used for `match()` directly. `lifecycle_prefixes` variable is the canonical source.
- **`match()` and excludes subtlety** — `match({k: v})` only sees the key/value pairs you pass. When excludes reference different keys than includes, pass the full tag object.
- **Actions access schema via `graph.context.systems.schema`** — `Graph.context` is always set. This is fine and explicit.

## MVT Protobuf Parsing on Worker

- **`network:fetchAndParseMVT` as a standard listener** — Generic enough for any MVT tile source. Accepts `{ url, init, tileXYZ }`, fetches URL via `fetchAndParse` (reusing the existing generic listener internally), decodes with `VectorTile`/`Protobuf`, converts each feature to GeoJSON, returns `MVTFeatureResult[]` with `layerID`, `origID`, and `feature`. The caller decides what to do with each layer.
- **Both services converge** — VectorTileService (standard MVT path) and MapillaryService both use the same listener. Layer-specific logic (caching images vs. creating GeoJSONData with merge queues) stays on the main thread where it needs `Context`.
- **VectorTileService split: `_parseTileBuffer` vs `_processVTResults`** — PMTiles path still decodes on the main thread via `_parseTileBuffer` (which builds `MVTFeatureResult[]` from a raw buffer), then delegates to `_processVTResults`. Standard MVT path receives pre-parsed `MVTFeatureResult[]` directly from the worker. Both paths share `_processVTResults` for property stringification, prophash computation, multi→single splitting, GeoJSONData creation, caching, and merge queue logic.
- **No buffer-accepting variant (yet)** — The listener only accepts a URL, not a pre-fetched `ArrayBuffer`. The PMTiles path would need this (PMTiles owns its own fetch, then hands us a buffer to decode). Deferred until we think through PMTiles lifecycle on the worker.

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

## Pixi Labels and Atlas Textures

- **Measure labels during render, rasterize after render** — `PixiLayerLabels` uses `PIXI.CanvasTextMetrics.measureText()` for placement math inside `render()`, then queues texture creation through `SchedulerSystem.schedule()` so `renderer.generateTexture()` runs in the scheduler drain phase after all frame callbacks complete. This fixes Pixi v8 renderer re-entry corruption while preserving the existing Pixi.Text rasterizer for now.
- **Labels are managed features, placement data is not** — `PixiLayerLabels` owns RBush placement and stores `LabelProps` placeholders. `PixiFeatureLabel` is created lazily only for visible placeholders and owns the actual `Sprite` / `BitmapText` / `MeshRope` display object. Off-screen culling destroys display objects without losing placement records.
- **Atlas items store uploadable sources, not just ImageData** — `AtlasAllocator` accepts `ImageData`, `HTMLCanvasElement`, `HTMLImageElement`, and `ImageBitmap`. WebGL uploads use the 7-arg `texSubImage2D` DOM-source overload, WebGPU uses `copyExternalImageToTexture`, and the canvas renderer blits the same source into its backing canvas. This avoids the previous `drawImage` → `getImageData` readback for images, bitmaps, and canvases.
- **Tile-only edge replication** — The atlas still reserves a 1px ring around every texture frame, but only tile imagery needs that ring filled with edge-replicated pixels to prevent seams under bilinear sampling. `PixiTextures._fromEdgePaddedCanvas()` builds a `(w+2) x (h+2)` source for tile atlas entries with two `drawImage` passes. Symbol/text/icon entries upload at the inner frame position and leave the reserved ring transparent.

## Canvas Renderer Atlas Support

- **Canvas renderer bypasses the upload pipeline** — Pixi's canvas renderer has no `_uploads` map. It reads `TextureSource.resource` directly via `canvasUtils.getCanvasSource()` at draw time. If `resource` is falsy, it returns `null` and nothing draws.
- **Canvas-backed `AtlasSource` as the fix** — When `useCanvas: true`, `AtlasSource` creates an `HTMLCanvasElement` matching the slab size and sets it as `this.resource`. The canvas renderer's `getCanvasSource()` returns this directly — zero copies, zero conversions (not PMA, no resize needed).
- **Blit direct sources at allocation time, not upload time** — Because there's no upload hook for canvas, `_blitItemToCanvas()` is called in `AtlasAllocator.allocate()` right after the item is added. It uses `putImageData()` for `ImageData` and `drawImage()` for canvas/image/bitmap sources, with the same padded-vs-inner offset used by GL/GPU.
- **No JS padded-pixel buffer** — The old `_getItemPixels()` loop is gone. Edge replication happens only when `PixiTextures` builds a padded tile canvas; other atlas entries upload directly and leave their reserved ring transparent.
- **Canvas overhead only when needed** — The `useCanvas` option is only set to `true` when `RendererType.CANVAS` is detected. GL/GPU paths don't create backing canvases, avoiding the extra ~16MB per 2048×2048 slab.
- **`(this as any).resource = canvas`** — Type mismatch: `AtlasSource extends TextureSource<BufferSourceOptions>` where the generic expects a TypedArray resource, but the canvas renderer needs an `HTMLCanvasElement`. The `as any` cast is intentional — the canvas renderer inspects `resource` dynamically, not via generic type constraints.
- **No clear-on-free** — Freed atlas regions aren't cleared on the backing canvas, matching the GL/GPU behavior (they overwrite freed space with `texSubImage2D` / `copyExternalImageToTexture` when it is reallocated).

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.
