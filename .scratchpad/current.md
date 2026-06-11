# Current Work

## Spatial System — Step 3 (conflation: coverage/buffers + two-phase querying)

Design: [.github/design/spatial-system.md](../.github/design/spatial-system.md) — see Decision 5 and Sequencing Step 3a–3d.

**Goal of Step 3:** let Rapid take arbitrary third-party data (POIs/sidewalks/buildings) and
determine how much already exists in OSM (conflation). Buffers are quantized "coverage boxes"
(fast, not mathematically exact), per geometry type. The buffer doubles as the RBush query.

### Sub-steps
- **3a — Lazy `GeometryPart`** ← *in progress*. Move derived products (`hull`, `centroid`,
  `poi`, `area`, `winding`, `surround`, `flat`) behind lazy memoized getters. `update()` keeps
  the cheap core (coords/extent/origin/outer) eager. `clone()` re-derives from `orig` instead of
  deep-copying computed values. No caller changes; callers still read `.world.hull` etc.
- **3b** — `geomCoverageBoxes()` in `modules/geo` + `GeometryPart.computeCoverage(r)` (radius is
  a recompute parameter, not baked into `setData`).
- **3c** — `SpatialSystem.getItemsAtBoxes()` + generic predicate refine; add `buffers` index for
  the reverse query.
- **3d** — `Conflation` module (graduates the `PixiLayerDebug` POC); owns match semantics.

### Notes / gotchas
- Phase-2 predicates already exist in `@rapid-sdk/math` (`geomPointInPolygon`,
  `geomPolygonIntersectsPolygon`, `geomPolygonContainsPolygon`, `geomLineIntersection`,
  `vecProject`/`vecLength`). We control `rapid-sdk`, so new helpers can start in `modules/geo`.
- No code serializes `geoms` across the worker boundary, and nothing spreads/`structuredClone`s a
  part's `world`/`local` — so lazy getters + re-derive `clone()` are safe.

