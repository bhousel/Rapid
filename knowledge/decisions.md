# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## Testing: happy-dom for components, Playwright for the real app (Nov 2026)

- **Component tests stay on Bun + happy-dom (`test/dom`), not in a real browser.** They need a DOM, not
  a browser, and run 200 tests in about 2 s. Runners that put them in a real browser (Vitest browser mode,
  Web Test Runner) mean a new toolchain and slower tests, to fix a few happy-dom gaps. Rejected: keeping
  the mocha page (`test/index.html`), which had drifted to 18 of 38 files and wasn't run.
- **E2E tests use Playwright Test directly** against the dev build, because what they catch only exists
  in a real browser: WebGL, workers, the CSP. The MapLibre 6 worker bug passed all 4,149 unit and DOM tests.
- **E2E network: record and replay with a HAR, not hand-written fixtures.** Real responses, refreshed with
  one command (`E2E_RECORD=1`). The CDN stays live: its assets are many MB and are what users load anyway.
  Unknown hosts are blocked, so a test can never reach a live service by accident.

## CDN versions come from `package.json` (Nov 2026)

- **The files Rapid loads from the CDN are pinned to the versions in `package.json`**, through
  `utilCDNPath()` in `modules/util/dependencies.ts`. Hand-written pins had drifted from what was installed
  and tested (MapLibre 5.15 at runtime, 5.24 installed). `@latest` was rejected: a new major release
  would reach users before anyone tested it.
- **The exact version is the range's lower bound** (`^6.18.0` → `6.18.0`). `bun update` rewrites the lower
  bound to the installed version, so they stay equal as long as upgrades go through `bun update`.
- **Importing `package.json` puts its `dependencies` in the bundle** (`devDependencies` get tree-shaken
  out). A small cost, accepted for one source of truth.

## The scene (Nov 2026)

The structure and the reasoning are in `design/scene.md`; these are the choices someone might undo.
- **Interactivity is switched per spatial ID at the container level, not per feature or in the
  behaviors.** Pixi skips a whole subtree with `eventMode: 'none'`, so the OSM line under a Rapid line
  is hit directly and no behavior or mode changes. A per-feature flag would run per frame in every
  layer; a fall-through hit test in the behaviors would re-test on every pointermove and still show
  the hover halo on the wrong thing.
- **The mode declares it (`interactiveSpatialIDs`), beside `enableBehaviors`.** The alternative, each
  of 18 layers knowing which modes it's interactive in, spreads mode knowledge everywhere.
- **Points sort by latitude only within their spatial ID.** A Rapid pin north of an OSM pin now draws
  over it. Accepted: "external data above OSM" is the rule for every geometry, and the alternative is
  the shared container we're replacing. Dense point datasets (NAD addresses) will show it.
- **No reordering while drawing.** With the datasets non-interactive the OSM line is reachable anyway;
  lifting OSM visually is a preference for a layer-order UI later (`zIndex` per container makes it cheap).

## Graph versions and derived data (graph-geometry rollout, Nov 2026)

Details and measurements are in `design/graph-geometry.md`; these are the choices someone might undo by accident.
- **Each graph keeps its own shapes; only the base graph writes shapes onto base objects.** Shapes on
  objects that every graph shares made staging's drag change stable's geometry (validation finding 1).
- **The renderer rebinds by object identity, not version numbers.** A changed entity is a new object and
  a changed shape is a new `Geometry`, so identity already says what a `graph.version()` would. Numbers
  would be one more thing to keep right through savepoints, rebases and restores.
- **Data is never changed in place.** Services and editors store `update()`'d copies. `v` stays as a
  stamp `update()` gives each copy, because `key` (`${id}v${v}`) feeds d3 joins and `FilterSystem`;
  `touch()` and `AbstractPixiFeature.v` are gone.
- **After a rebase, stable and staging catch up at once; other graphs when they become current.** No
  per-read "update on first use" check. Safe because rebase and validators are synchronous, and the only
  graph held across awaits (the uploader's remote graph) reads entities only.
- **The OSM spatial indexes live in `EditSystem`, not the lineage or `SpatialSystem`.** `SpatialSystem`
  stays data-agnostic, and only the editor's lineage should build indexes (since step 8 every rebase of
  it goes through `EditSystem`). If another lineage ever needs versions and searches, pull the
  base-plus-local-index logic into a helper its owner creates. (Bryan tried graphs in spatial caches in
  Aug 2025 and backed it out.)
- **"Local index", not "overlay".** In Rapid an overlay is an imagery layer. "Local" matches
  `graph.isLocal()`: what a graph says differently from the base.
- **No lineages for GeoJSON and markers.** A base-only lineage would hold what the spatial cache already
  holds. Add one when some data needs versions.
- **Step 7 (memos in records) deferred.** After 150 edits only 5–7% of graph-dependent memo reads skip
  memoization (about 0.2 ms a drag frame), but dropping those memos entirely costs about 4 ms a drag
  frame, because `PixiLayerOsm` classifies every node every frame. Backlog: classify only when dirty.

## OSM parsers keep no "seen" state; `EditSystem.merge` skips entities it already has

The parsers used to remember every ID they parsed and leave it out of later results (`skipSeen`). That
saved real work back when responses were XML, but it broke when a request was cancelled (`loadTiles` aborts
tiles no longer in view) or timed out after the worker had parsed the response: the main thread dropped
the result while the worker kept the IDs, so those features never loaded until a reload. Now the parsers
return everything, and `merge` skips entities already in the base graph before building them or adding
them to the spatial caches (where the extra time went). Benchmarked on 6×6 overlapping tiles of the Tokyo
data: about the same total as `skipSeen` (~170 ms), against ~228 ms for parsing everything without the
merge change. With nothing skipped, the separate `seenIDs` set in parser results was redundant, so it's
gone too: `merge` emits the IDs of everything it was given, because features already loaded may need
to re-render when new ones arrive (see the note in `EditSystem.merge`). The skip is for `merge`
only: `updateBase` (a forced rebase) still replaces what's there.

## Folder-specific agent rules live in nested `AGENTS.md`, not `.github/instructions/`

`.github/instructions/*.instructions.md` with `applyTo:` globs only work in Copilot. Claude Code never loaded
them, and `pixi.instructions.md` wasn't linked from anywhere. Folder READMEs aren't a good home either:
no agent loads a README automatically, so rules there only get read if the agent happens to open it. Nested
`AGENTS.md` is the cross-tool convention (Claude Code, Codex, Cursor, the Copilot coding agent). Claude Code
was confirmed (Oct 2026) to load `modules/<dir>/AGENTS.md` as soon as it reads a file in that folder.
In VS Code Copilot Chat, nested `AGENTS.md` sits behind an experimental setting (`chat.useNestedAgentsMdFiles`).
The two files were moved with `git mv` (history preserved) and their `applyTo` frontmatter was dropped.

## `DatabaseSystem` owns the generic file API (but not the `sessions` domain logic)

`DatabaseSystem` has a generic file API (`putFileAsync` / `getFileAsync` / `listFilesAsync` /
`deleteFileAsync`, Blobs stored natively), although `sessions` is owned by `EditSystem`. The asymmetry is
deliberate: sessions encode domain knowledge (backups, entities, history), while a file is just a Blob
with a name. Bryan's mental model: *`DatabaseSystem` is the persistent store for anything more
complicated than localStorage.* What a file means (which dataset, when to reload it) belongs to its
consumer, on top of these primitives.

## Operations are classes named `ThingOperation` (not factory functions like actions)

Operations sit beside modes and behaviors (each one already makes a `KeyOperationBehavior`), and the
callable-with-expandos idiom scaled badly for their ~10 props and derived state. So they're
`AbstractOperation` classes, named like `ThingMode` and `ThingSystem`, and called with `run()`. The base
is **not** an `EventEmitter` (operations are one-shot and emit nothing), and it's one superset class with
optional hooks rather than per-op interfaces, because the menu uses them through one array.
`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs` stays (a per-click instance can't remember
the previous cycle); moving it onto a system is in `backlog.md`.

## UI fields: inheritance over composition

Each concrete field (`UiFieldCheck`, `UiFieldCombo`, …) **`extends UiField`** rather than being an
"internal" object composed by a `UiField` wrapper. The composition was an ES5-era holdover (no real
class inheritance back then). Inheritance removes the wrapper/internal split, the `_internal`/
`_createField()` machinery, the `UiFieldInternal` interface, and the event re-wiring — a field now
emits `change` on itself.

- **Construct fields via `createUiField(context, presetField, …)`** (in `fields/index.ts`), never
  `new UiField(...)`. `UiField` can't be constructed generically anymore — the concrete subclass is
  chosen by `presetField.type`. The factory lives in the registry module so that `UiField` itself does
  NOT import `uiFields` (that would be a load-time circular import, since fields `extends UiField`).
- **Name collisions were the real friction, not the mechanics.** The base wrapper API and the field
  render API shared names, so the field-side ones were renamed: `render`→`renderContent` (base
  `render()` draws the field chrome, then calls `renderContent()` for the input body — mirrors
  `AbstractUiSection`), `tags(t)`→`syncTags(t)` (base keeps the fluent `tags(val?)` getter/setter),
  and the field's `entityIDs(ids)` setter was dropped (the base owns the `entityIDs` array).
  `UiFieldAccess`/`UiFieldCycleway` had an `options(key)` choice-list method that collided with the
  base `options` config object → renamed `_fieldOptions(key)`.
- **`supportsMultiselection` is read off the instance** via `(this.constructor as typeof UiField)`,
  not a registry lookup — another reason `UiField` needs no `uiFields` import.

## UI events: EventEmitter over d3_dispatch/utilRebind

UI classes that emit events extend `EventEmitter` from `tseep/lib/ee-safe`, like systems, modes,
behaviors and `Context`: one event API everywhere, without the d3-dispatch + `utilRebind` boilerplate
(both retired). One wrinkle: `UiCombobox`'s consumers re-register `accept`/`cancel` on every render and
relied on d3-dispatch replacing the listener, so its constructor wraps `on` to remove the old one first
(tseep's `on` is a class field, so it can't be overridden as a method).

## UI primitives are classes when they're owned over time

An earlier pass kept `tooltip`, `modal`, `confirm`, `combobox` and `disclosure` as factory functions
("one-shot builders"). The real test is ownership and lifecycle: ~20 components held a
`public Tooltip: any` and reconfigured it every render. So they're classes now (attach with
`sel.call(tooltip.attach)`). `icon` stays a stateless function.

## Modal stack is owned by `UiSystem`

Each `UiModal` owns its own `.shaded` backdrop; `UiSystem` keeps the stack, and one document handler
sends Esc/Backspace to the top modal only. That's what lets modals nest (the Rapid catalog over the
dataset modal) without the old hacks that patched the parent's `close` and rebuilt its keybindings. On a
system because it's runtime state, and a CLI build without `ui` has no modals.

## HTML sanitizing and the CSP (Jul 2026)

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

## World coordinates and their numerics

- **SDK-native z16 world coordinates are the one world space** (`@rapid-sdk/math`, `WORLD_ZOOM = 16`,
  `0..16,777,216`); the temporary `worldScaled` bridge is gone.
- **Safe for affine transforms, not for shoelace-style metrics.** d3-polygon's centroid and area
  cross-multiply ~1e7 coordinates; the cancellation put a centroid far outside its hull. So
  `GeometryPart` keeps `.local` coordinates (relative to the extent center) and computes hull, centroid,
  area and the rest there. Hull and orientation tests are combinatorial, so they're fine either way.

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

## `NsiService` and NSI v7

- **No wikipedia replacements.** NSI v7 stopped tracking `wikipedia` in `replacements.json`, so that
  lookup is gone; `upgradeTags` still drops a bare `wikipedia=*` when a wikidata match is found.
- **Local `NsiItem` extends NSI's** with the fields Rapid fills in at runtime (`tkv`, `mainTag`).

## StyleSystem / StyleSelector

- **`weight` replaces auto-computed `specificity`** — The old specificity scoring (geometry +50, each tag matcher +10) couldn't express "building always overrides amenity" because both had 1 tag condition = same score. Adding more tag matchers to artificially increase specificity was fragile. `weight` gives the data author explicit control over cascade order, consistent with how presets use `matchScore`.
- **Default weight is 1** — Existing selectors with no `weight` all get weight=1, meaning equal-weight selectors preserve insertion order (stable sort). This keeps current behavior for the vast majority of selectors that don't need explicit ordering.
- **Sort ascending, iterate forward** — `findAll()` returns selectors sorted by weight ascending. `styleMatch()` iterates forward with `deepMerge`, so the last (highest-weight) selector wins. This is simpler than the old pattern of sorting descending then iterating in reverse.

## Network and workers

How it works is in `design/network-system.md` and `design/scheduler-system.md`; these are the rules
someone might break by accident.
- **Three systems:** `SchedulerSystem` decides when to run (frame loop, queues, timers, backpressure),
  `WorkerSystem` where (the pool and the listener registry), `NetworkSystem` handles fetches. The split
  kept one system from passing 1,000 lines.
- **Never record an abort.** An `AbortError` is always a rejection, never an envelope, so an aborted
  request stays retryable: "pan away, pan back reloads the tile" depends on it.
- **Every worker listener returns a `FetchEnvelope<T>`.** A thrown error loses its `.status` crossing
  `postMessage`; the envelope is how the status survives.
- **Only explicit `requestID`s are recorded** in `_completed`, and only `NetworkSystem` writes it. Retry
  is a service's choice: `network.forget(id)` in its catch handler (OSM tiles, Streetside, MapWithAI).
- **An unregistered `listenerID` rejects**; it never falls back to the generic fetch and parse.
- **Auth goes through request interceptors**, on the main thread, so the token never needs to reach a
  worker and the request crosses as plain data. Writes (changesets, notes) stay `mainThread: true`.
- **Workers resolve relative URLs against their own script**, so `NetworkSystem` makes them absolute
  before dispatching.
- **`resultPriority`** resolves a worker's result through the scheduler, so heavy `.then()` chains don't
  blow a frame budget (OSM tile loads use `'normal'`).

## Worker Companion Convention (`*.worker.ts`)

- **`Foo.worker.ts` sits next to `Foo.ts`** and exports its listeners plus a `listeners: ListenerRegistry`;
  each folder's `index.worker.ts` re-exports them. The same functions are registered twice: in the worker
  (through the barrels) and by the service with `worker.registerListener()`, for when there's no worker.
- **Worker-safe by construction:** a `.worker.ts` imports only parsers and utilities, never `Context`,
  systems or the DOM. Results must survive structured clone (return a `ParserResult`, not a `Document`).
- **`Listener` and `ListenerRegistry` are global types** (`global.d.ts`), because they cross bundle
  boundaries.
- **Workers live across `resetAsync`.** Terminating them would race with reset messages and re-parse the
  script; a system that needs worker state cleared sends its own message. Module-level objects in a
  companion file (the OSM parsers) must keep no state between calls.

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

## Vector tiles: MVT on a worker, PMTiles not

- **`network:fetchAndParseMVT` is shared** by `VectorTileService` and `MapillaryService`: the worker
  fetches and decodes, and returns GeoJSON per layer; what to do with each layer stays on the main thread,
  where `Context` is.
- **PMTiles does its own fetching** (HTTP Range requests from the library), so it bypasses
  `NetworkSystem` and still decodes on the main thread; `VTSource.inflightPMTiles` tracks its requests.
  A PMTiles `Source` that calls `network.fetchRaw()`, and a listener that takes a buffer, would unify
  them. Low priority.

## Dual-Props Pattern

Used when a class resolves references (`var()`, locale strings) in its props:
- `props` = raw/immutable (never mutated after construction)
- `_resolved` / `_resolvedValue` = lazy resolved copy
- Getter returns `resolved ?? raw` (zero overhead when no vars)
- `reset()` = null out the resolved copy
- Applied to: `Style`, `PropMatcher`. NOT needed for `Preset`/`Field` (localization cached in `_strings` Map).

## Context Lifecycle

- **No backward compat for old `initAsync()`** — It now only inits (doesn't start). Simple consumers use `context.run()`. v3 breaking change.
- **`prepareAsync()` → `initAsync()` → `startAsync()`** — Each phase chains the previous. All idempotent. `run()` is a convenience that chains everything.

## Pixi Labels and Atlas Textures

- **Measure labels during render, rasterize after render** — `PixiLayerLabels` uses `PIXI.CanvasTextMetrics.measureText()` for placement math inside `render()`, then queues texture creation through `SchedulerSystem.schedule()` so `renderer.generateTexture()` runs in the scheduler drain phase after all frame callbacks complete. This fixes Pixi v8 renderer re-entry corruption while preserving the existing Pixi.Text rasterizer for now.
- **Labels are managed features, placement data is not** — `PixiLayerLabels` owns RBush placement and stores `LabelProps` placeholders. `PixiFeatureLabel` is created lazily only for visible placeholders and owns the actual `Sprite` / `BitmapText` / `MeshRope` display object. Off-screen culling destroys display objects without losing placement records.
- **Atlas items store uploadable sources, not just ImageData** — `AtlasAllocator` accepts `ImageData`, `HTMLCanvasElement`, `HTMLImageElement`, and `ImageBitmap`. WebGL uploads use the 7-arg `texSubImage2D` DOM-source overload, WebGPU uses `copyExternalImageToTexture`, and the canvas renderer blits the same source into its backing canvas. This avoids the previous `drawImage` → `getImageData` readback for images, bitmaps, and canvases.
- **Tile-only edge replication** — The atlas still reserves a 1px ring around every texture frame, but only tile imagery needs that ring filled with edge-replicated pixels to prevent seams under bilinear sampling. `PixiTextures._fromEdgePaddedCanvas()` builds a `(w+2) x (h+2)` source for tile atlas entries with two `drawImage` passes. Symbol/text/icon entries upload at the inner frame position and leave the reserved ring transparent.

## Canvas Renderer Atlas Support

- **Pixi's canvas renderer has no upload pipeline**: it draws `TextureSource.resource` directly. So with
  `useCanvas: true` (only when `RendererType.CANVAS` is detected, saving ~16 MB per slab otherwise),
  `AtlasSource` keeps a backing canvas as its `resource`, and `AtlasAllocator.allocate()` blits each item
  into it. The `(this as any).resource = canvas` cast is intentional: the generic expects a typed array.
- **Freed regions aren't cleared**, as on GL/GPU: they're overwritten when reallocated.

## The url holds overrides, not state (Nov 2026)

Rule and details in `design/settings-system.md`; these are the choices someone might undo by accident.
- **The url is for starting Rapid a certain way, not where the user's state lives.** Most of it is
  invisible, and `map=` comes first because it's the part people see. Only where you are and what's
  selected (`map`, `id`, `photo`, `detection`) is written as you go.
- **An override is dropped once the state no longer matches it, not rewritten.** Then it's in effect
  exactly while it's in the url (no `_urlOverride` flag), and a reload before any change opens the link
  again. Taking one out of the url leaves things as they are.
- **Changes are saved one at a time (deltas).** Saving the whole state would save the link's other
  choices as the user's.
- **Some state is for the session only:** photo filters, MapRoulette challenges, the 3D map, the imagery
  offset. They were only ever kept by the url (a legacy choice few people relied on). An offset belongs
  to one source in one area, so bringing it back elsewhere would misalign the imagery.
- **The user's last imagery wins over 'best', but only where it can be seen.** Saved overlays are also
  only turned on where they can be seen, or they'd be credited in changesets elsewhere.
- **`UrlHashSystem` still loses url changes made before it resumes.** Keeping them would let startup's
  `map=`/`id=` writes overwrite a link's own. Read startup values from `initialHashParams` instead.
- **`_isApplyingUrl` tells a link's change from the user's, and only `_hashChanged` sets it.** Whether
  a param is in the url can't tell them apart: it's still there at the moment the user changes the
  state, which is exactly when it has to be dropped. Startup doesn't need the flag (`_started` or
  `_settled` already stops saving then).
- **Custom data's `data=` is an override too.** It stays while its data is shown, so a copied link's
  custom `id=` finds it again. Custom data the user loads isn't written, so its `id=` can't be found
  from a link.

## Settings declare how they're kept (Nov 2026)

- **Settings sync across the user's browsers once they sign in, like Chrome or VS Code.** That's Bryan's
  guiding principle for what syncs: preferences follow the user; state, and what depends on this
  browser's data, screen or mouse, stays local.
- **Only what code declares is ever deleted.** Registered (`registerSync`/`registerLocal`) means in use,
  `unregister` means delete, anything else is ignored. Bryan's choice, over deleting what this build
  doesn't recognize, which lost testers' preferences when they switched builds (bug-hunt item 12).
- **Declaring a setting local also deletes its account copy**, so v1's copies of local settings (some
  with access tokens) don't stay in the account forever.
- **One `unregister`, not a local and a sync one.** v1 copied everything to the account, so a retired
  setting may be in both places either way.
- **Overlapping declarations throw.** A path inside one declared another way means one of them is
  wrong, and it would delete or sync the wrong thing.

## Bug hunt 2 choices (Nov 2026)

Fixes where Bryan picked the behavior, which someone might undo by accident.
- **MapRoulette auth is commented out, not fixed.** MapRoulette expired the API keys Rapid read from
  the OSM user preferences, and will offer a proper login later; until then Rapid submits without a
  key. See "MapRoulette authentication" in `backlog.md`.
- **From a successful upload until the reset, nothing can be edited.** Rapid stays in save mode (Escape
  is off), and after `clearBackup` the history isn't work to keep (`hasWork()` is false), so the
  uploaded edits are never backed up as a new session.
- **A `walkthrough=true` start doesn't offer a restore.** The sessions are offered the next time Rapid
  starts normally. These links are for classes of new users.
- **With OSM features selected, the arrow keys move them, even with the photo viewer open.** The photos
  step only when nothing OSM is selected, or the Mapillary viewer has focus.
- **Empty new relations aren't deleted when leaving select mode.** `missing_tag` flags them instead
  (see "Render relations" in `backlog.md`).

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.

## `build_js.ts` forces `format: 'iife'` on every browser bundle

- **Why not rely on Bun's default?** Bun defaults to `format: 'esm'`. Our `main_*.js` / `worker.ts` entry points have no `export`s — they only side-effect-attach globals — so ESM-format output is just unwrapped top-level declarations. Loaded as a classic `<script>`, those names leak onto `window` (clobbered native `window.dispatchEvent` via d3-selection). esbuild (the previous `facebook/Rapid` bundler) defaulted to `iife` for the browser platform, so this is a regression we re-closed by being explicit.
- **Why not just load via `<script type="module">`?** It would fix the symptom (module scope), but pushes a workaround onto every embedding app's loader, leaves the artifact a footgun for classic-`<script>` users, and protects nothing — these bundles have zero exports, so there's no ESM API to preserve. IIFE is the semantically honest format for a "load me, I attach a global" bundle (same shape the old UMD/esbuild build produced).
- **Worker builds are iife as defense-in-depth, not a fix.** `WorkerSystem` spawns the worker as a **module** worker (`{ type: 'module' }`), so top-level names are already module-scoped and can't leak into `self`. iife is harmless here and guards against a future switch to a classic worker. Confirmed the iife worker output has no top-level `import`/`export`, so it still loads as a module worker and stays importable via the cross-origin blob `import` shim in `_resolveWorkerURL`.
- **If we ever want real ESM consumers**, that's a *separate, additive* build output: `format: 'esm'` with `modules/index.js` (which has real exports) as the entrypoint, wired via a `package.json` `"exports"` map — not a reason to unwrap the global-attach bundles.
