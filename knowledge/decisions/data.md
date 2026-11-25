# Decisions: Data

OSM data, graphs, spatial indexes, actions, services' data, settings and the url. Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## Graph versions and derived data (graph-geometry rollout, Nov 2026)

Details and measurements are in `design/graph-geometry.md`; these are the choices someone might undo by accident.
- **Each graph keeps its own shapes; only the base graph writes shapes onto base objects.** Shapes on
  objects that every graph shares made staging's drag change stable's geometry (validation finding 1).
- **The renderer rebinds by object identity, not version numbers.** A changed entity is a new object and
  a changed shape is a new `Geometry`, so identity already says what a `graph.version()` would. Numbers
  would be one more thing to keep right through savepoints, rebases and restores.
- **Data is never changed in place.** Services and editors store `update()`'d copies. `v` stays as a
  stamp `update()` gives each copy, because `key` (`${id}v${v}`) feeds d3 joins (and fed `FilterSystem`'s cache until Nov 19);
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

## Spatial System — buffers / conflation (Step 3)

- **Buffers are quantized "coverage boxes", not exact geometry** — A mathematically exact buffer is the Minkowski sum of a geometry with a disk. We don't need exactness, we need speed. Turf/JTS don't compute Minkowski either (they offset-curve + node + polygonize; same family as `PIXI.buildLine` / `lineToPoly`). For conflation we cover the geometry in boxes (a quantization). Coverage boxes double as the RBush query boxes.
- **`geomCoverageBoxes` is for conflation, not rope labels** — see `lessons/runtime.md`.
- **Coverage representation is per geometry type** — Point → one box of half-size `r`; LineString → boxes sampled every ~`r` along the line (partial matching falls out for free, per-box); Polygon → grown extent box (box-filling a 2D region is wasteful; phase-2 uses real polygon overlap instead). Don't force everything into box-fills.
- **Radius is a recompute parameter, not baked into `setData`** — `setData()` computes the radius-independent core projection; a separate `computeCoverage(r)` produces coverage for a given radius and is re-called when the user tweaks the conflation distance (e.g. 3 m → 2.5 m).
- **Two-phase querying with a caller-supplied predicate** — RBush indexes bboxes only, so queries prefilter by box and refine with a predicate the caller gives; "match" semantics live in a `Conflation` module, not in `SpatialSystem`. The precise tests already exist in `@rapid-sdk/math` (point in polygon, polygon overlap, line intersection), so no `jsts`. New helpers start in `modules/geo` and can move to the SDK.
- **Lazy `GeometryPart` derived products (Step 3a)** — `update()` keeps only the cheap core eager (projected coords, extent, origin, outer); `hull`/`centroid`/`poi`/`area`/`winding`/`surround`/`flat` are computed on first access, as getters on classes with a field per product since Nov 19 (a closure per product cost 2.3 KB a part). Most features of a large dataset are never rendered or conflated.

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

## Rulesets & Variables

- **Separate `osm_rulesets.json5`** — Not inside `rapid_schema.json5`. Load order: id_tagging_schema → osm_rulesets → rapid_schema.
- **Lookup tables stay as Records** — `areaKeys`/`pointTags`/`vertexTags` are O(1) Record lookups on SchemaScope. Rulesets would be 50-150x slower on these hot paths.
- **`lifecycle` ruleset as config container** — The Set of prefixes is derived from its key patterns, not used for `match()` directly. `lifecycle_prefixes` variable is the canonical source.
- **`match()` and excludes subtlety** — `match({k: v})` only sees the key/value pairs you pass. When excludes reference different keys than includes, pass the full tag object.
- **Actions access schema via `graph.context.systems.schema`** — `Graph.context` is always set. This is fine and explicit.

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
