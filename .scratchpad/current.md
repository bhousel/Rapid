# Current Work

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
  double-covered. Refactored `PixiLayerLabels.placeRopeLabel` to consume it (dropped the
  `getLineSegments` + manual box-math nested loop). 13 new unit tests in `test/unit/geo/geom.test.js`.
  `GeometryPart.computeCoverage(r)` still TODO (deferred to when a conflation consumer needs it).
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

## NetworkSystem / SpatialSystem cleanup (uncommitted, in working tree)

A large set of uncommitted changes fixing bugs discovered during the SpatialSystem/NetworkSystem
refactor and improving tile-load tracking.  All 3170 unit tests + 121 browser tests pass.

Key items ready to commit:
- **SpatialSystem bugs fixed**: `replaceItems` now populates `cache.items` Map; `replaceData` uses `d.id`/`d`; `hasItemAtLoc()` added; `clearMatching` iterates `.keys()`.
- **EditSystem `_reset`** clears `editor_*` pattern (includes segment caches); stale `osm-staging` reference in `address.js` fixed.
- **NetworkSystem `_completed: Map<RequestID, number>`** replaces `Set`. `STATUS_SKIPPED=-1`, `STATUS_ERROR=0` sentinels. API: `isCompleted`, `getStatus`, `markCompleted`, `forget`. Only explicit `requestID` options recorded.
- **`FetchEnvelope<T>`** universal worker-boundary transport replaces bespoke `OsmFetchResult`. All listeners return envelopes. `fetchEnvelope()` public method on NetworkSystem.
- **`FetchError` extended** to accept `FetchErrorInit` (reconstructable from envelope fields).
- **Services**: don't-retry services shed manual `completed.add`; do-retry use `network.forget()`; blocked-region use `markCompleted()`. OsmService `loadNotes` zoom bug fixed. Note-tile retry fixed.
- **All service + core tests updated** for new patterns (3170 pass).

