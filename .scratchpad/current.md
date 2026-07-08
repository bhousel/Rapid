# Current Work

## Settings System design (2026-07-07)

- Added design doc: [.github/design/settings-system.md](../.github/design/settings-system.md)
- Captures goals, typed/versioned settings envelope, adapter architecture (local + OSM), migration mapping from legacy keys, and phased rollout plan.
- Motivation: upcoming custom background/custom data work needs scalable persistence beyond ad-hoc localStorage keys.

## Settings System implementation scaffold (2026-07-07)

Design: [.github/design/settings-system.md](../.github/design/settings-system.md)

**Phase 0 + 1 done.** Domain-agnostic implementation:
- `modules/lib/TreeStore.ts` — the single home for nested-tree logic: path access
  (`get`/`peek`/`set`/`has`/`unset`), flat-key (de)serialization (`toFlat`/`fromFlat`),
  and the folded-in key-path primitives (public static `TreeStore.parsePath`; get/set/has/
  delete are module-private). `KeyPathPart` type exported here. Own tests
  (`test/unit/lib/TreeStore.test.js`). (`modules/util/keypath.ts` was folded in and deleted.)
- `modules/core/SettingsSystem.ts` — holds a `TreeStore` (`_store`) and only adds the
  settings-specific `rapid.settings.*` namespace, engine metadata, and legacy migrations.
  Public API: `get/set/unset/has/getAll/toJSON/fromJSON/saveAsync` + sync stubs. Emits
  `settingschange`. `resetAsync` is a no-op (settings are durable). Requires `storage`;
  key-per-setting persistence.
- `modules/core/LocalizationSystem.ts` — `_strings` is now a `TreeStore` keyed
  `[locale][scope][...stringID]`; hot reads use `peek` (copy-free).
- `StorageSystem` gained a `keys()` enumeration method (used by SettingsSystem + tested).
- Registered as system id `settings` in index.ts/types.ts/headless.js.
- **Values are plain strings** (localStorage/OSM-prefs contract); callers coerce on read.
- Legacy `SettingsCodec.ts` / `SettingsMigrations.ts` were folded in and deleted.
- **`<TX_DOT>` retired** — dotted keys (imagery IDs like `basemap.at`) now percent-encode
  dots as `%2E` at the producer (`ImagerySource`), and `LocalizationSystem` normalizes any
  legacy `<TX_DOT>` data-file keys to literal dots at load time. The resolver keeps no fallback.

**Key design decision (user-driven):** domain settings interfaces (`ImagerySettings`, etc.)
do NOT live in SettingsSystem — they belong to the systems that own them. The engine stores a
generic `SettingsTree` and never learns what it holds. Only migrations carry legacy-key domain
knowledge (a one-time, version-scoped concern).

Tests: `test/unit/lib/TreeStore.test.js` (path access, copy semantics, `toFlat`/`fromFlat`
round-trips, `merge`, `parsePath`) + `test/unit/core/SettingsSystem.test.js` (49 cases incl. type
fidelity, array compaction, legacy import, reserved-namespace guard, persistence, toJSON/fromJSON)
+ `keys()` tests in StorageSystem.test.js. Full unit suite green (3260 pass) + browser (121 pass),
tsc + eslint clean.

**Next (Phase 2):** migrate first callsites — custom background flow, ImagerySystem, SchemaSystem
`preset_recents` — defining each domain's settings interface in its owning system.


## Spatial System — Step 3 (conflation: coverage/buffers + two-phase querying)

Design: [.github/design/spatial-system.md](../.github/design/spatial-system.md) — see Decision 5 and Sequencing Step 3a–3d.

**Goal of Step 3:** let Rapid take arbitrary third-party data (POIs/sidewalks/buildings) and
determine how much already exists in OSM (conflation). Buffers are quantized "coverage boxes"
(fast, not mathematically exact), per geometry type. The buffer doubles as the RBush query.

### Sub-steps
- **3a — Lazy `GeometryPart`** ✅ done (`328a4c388`). Derived products are lazy memoized getters;
  `clone()` re-derives from `orig`.
- **3b — Coverage helper** ✅ done. `geomCoverageBoxes(coords, radius, step?)` in
  [modules/geo/geom.ts](../modules/geo/geom.ts) — unit-agnostic; point → one box, polyline →
  boxes every `step` along each segment (each carries heading angle), shared vertices not
  double-covered. 13 new unit tests in `test/unit/geo/geom.test.js`.
  `GeometryPart.computeCoverage(r)` still TODO (deferred to when a conflation consumer needs it).
  **Note**: `geomCoverageBoxes` was briefly used in `PixiLayerLabels.placeRopeLabel` (commit
  `f9f34ffdc`) but was reverted — rope labels need a *uniform sampler* (equal arc-length spacing),
  not a coverage sampler (per-segment subdivision). Use `geomLineSegments(coords, boxsize)` for
  rope placement; reserve `geomCoverageBoxes` for conflation.
- **3c — Query plumbing** ✅ done. `SpatialSystem.getItemsAtBoxes(spatialID, boxes)`
  (phase-1 bbox prefilter over many boxes, deduped by `boxID`) + `refineItems(candidates, predicate)`
  (phase-2 precise refine with a caller-supplied predicate — SpatialSystem stays domain-agnostic).
  Follow-up simplification: SpatialSystem storage is now **flat** (one RBush per `spatialID`, no nested
  cache/index map), and the legacy `(spatialID, indexID, ...)` API overloads are removed.
  Callers now use flat IDs directly (e.g. `editor_staging-segments`) with
  `replaceItems`/`removeItems`/`getItemsAtBox`/`getItemsAtBoxes` flat signatures only.
  SpatialSystem unit tests were migrated and still pass.
- **3d** — `Conflation` module (graduates the `PixiLayerDebug` POC); owns match semantics.

### Notes / gotchas
- `geomCoverageBoxes` is unit-agnostic (radius/step in the same planar units as coords). Labels
  pass pixel sizes; conflation will pass world units (meters→world conversion done by the caller).
- Label box sampling changed slightly: `geomCoverageBoxes` includes segment endpoints/vertices and
  samples uniformly, vs. `getLineSegments`' offset-accumulating, endpoint-skipping behavior. All
  unit + browser tests still pass; placement is visually equivalent/cleaner.
- Phase-2 predicates already exist in `@rapid-sdk/math` (`geomPointInPolygon`,
  `geomPolygonIntersectsPolygon`, `geomPolygonContainsPolygon`, `geomLineIntersection`,
  `vecProject`/`vecLength`). We control `rapid-sdk`, so new helpers can start in `modules/geo`.
- No code serializes `geoms` across the worker boundary, and nothing spreads/`structuredClone`s a
  part's `world`/`local` — so lazy getters + re-derive `clone()` are safe.

## Session work (2026-06-18) — uncommitted

All in working tree; 3170 unit tests pass; `check:ts` + `check:lint` clean.

### RBush → SpatialSystem consolidation
Removed all remaining `new RBush` usages outside `SpatialSystem` itself:
- **`PixiLayerLabels`** — `_labelRBush`, `_debugRBush`, `_boxes` Map → two `SpatialSystem` caches
  (`SPATIAL_LABELS = 'labels'`, `SPATIAL_DEBUG = 'labels-debug'`). Items use `LabelItem extends
  SpatialItem` with `contents: LabelContents` (type/featureID/labelID/objectID/tint). Kept
  `_featureBoxes` (feature→box secondary index; SpatialSystem doesn't provide this).
- **`NominatimService`** — `_nominatimCache` RBush → `SpatialSystem` cache `'nominatim'` (WGS84
  coords). `spatial` added to `requiredDependencies`.
- **`ValidationCache`** — `recheckRBush` + `recheckBoxes` → `SpatialSystem` cache `validation-${which}`.
  Threaded `context` into constructor (`new ValidationCache(context, which)`). Public `spatialID`
  getter. Updated all 5 construction sites in `ValidationSystem` + tests.
- **`VectorTileService`** — per-source×zoom `boxes` Map + `rbush` → `SpatialSystem` caches
  `vt-${source.id}-z${zoom}`. `reset()` → `spatial.clearMatching(id => id.startsWith('vt-'))`.
  `spatial` added to `requiredDependencies`.

### PixiLayerLabels rope-label squish bug
- **Root cause**: commit `f9f34ffdc` switched rope box sampling from `geomLineSegments` (uniform
  arc-length sampler) to `geomCoverageBoxes` (per-segment subdivider). Coverage boxes space
  closer than `boxsize` so `scaleX = lWidth / ((numBoxes-1)*boxsize)` was wrong → labels squished.
- **Fix**: reverted rope walker back to `geomLineSegments(coords, boxsize)` with the original
  count-based chain math. `geomCoverageBoxes` stays for its conflation purpose only.

### VectorTileService GeometryCollection guard
- `_toSingleFeatures` typed `geometry` as `GeoJSON.Geometry` (union including `GeometryCollection`,
  which has no `coordinates`). Added early-return guard for `geometry.type === 'GeometryCollection'`.

