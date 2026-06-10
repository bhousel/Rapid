# Spatial System Design

This document describes the design for consolidating all of Rapid's spatial indexing under `SpatialSystem`, removing the legacy `Tree` class, and generalizing the spatial cache so it can store and answer questions about arbitrary kinds of pre-computed geographic data.

## Problem

Rapid has grown a lot over the years. `Tree` was originally the spatial index **only for OSM data**. As Rapid added many other non-OSM sources of map data (Rapid/MapWithAI features, Microsoft buildings, Mapillary and other photo services, custom data layers, etc.), each of those services grew its own ad-hoc spatial index, usually a bare `RBush` scattered around the service code.

We consolidated those under `SpatialSystem` (`modules/core/SpatialSystem.ts`), which now owns the task of maintaining spatial caches for the rest of the codebase. Today `Tree` (`modules/lib/Tree.ts`) is only used for OSM data, the single remaining instance is owned by `EditSystem`, and internally it already defers to `SpatialSystem` for most of what it does. The OSM-aware bookkeeping that still lives in `Tree` is the last thing standing between us and deleting it.

Current pain points:
- **`Tree` still owns OSM-specific sync logic** — it tracks "which graph is current" and diffs the current graph against the previously-indexed graph to figure out what to add/update/remove. This duplicates the `Difference` that `EditSystem` already computes in `_emitChanges()`, so we diff the same edits twice.
- **Lazy sync against arbitrary graphs is expensive and subtly wrong** — `Tree.intersects()` / `waySegments()` call `_setCurrentGraph(graph)` with whatever graph the caller passes. The validators pass the graph they happen to be validating, which means a single validation pass can thrash the index back and forth between graphs. The current validator code even carries comments worrying that it may be indexing against the wrong graph.
- **`waySegments` is gone** — `Tree` used to index individual way segments (for fast "where do these lines cross" tests in the `crossing_ways` and `almost_junction` validators). That code is currently commented out and returns `[]`, so those validators are degraded.
- **`SpatialCache` is too rigid** — it hardcodes exactly two indexes (`tiles` + `tileRBush`, `data` + `dataRBush`) and a parallel set of duplicated methods for each (`addData`/`addTiles`, `getData`/`getTile`, `hasDataAtBox`/`hasTileAtBox`, …). Every new kind of indexed thing (segments, buffers, …) would mean another hardcoded index and another copy of the whole method family.
- **`SpatialCache.graph` is stored but unused** — a leftover that hints at OSM-specific state leaking into the generic cache.

## Goals

1. **`SpatialSystem` is the single source of truth for all loaded and cached geo data**, to the extent possible. It knows where data has been fetched, what overlaps what, and spatially indexes whatever we need to answer those questions efficiently.
2. **Delete `Tree`.** Move the OSM-specific "current graph" sync into `EditSystem`, driven off the `Difference` it already computes.
3. **Generalize the spatial cache** so a cache can hold an open-ended set of named indexes (data, tiles, segments, buffers, …) without duplicating the method surface for each.
4. **Keep `SpatialSystem` domain-agnostic.** It is a spatial-index-and-query engine. It must not learn what a "segment" or "buffer" or "OSM entity" *means* — that knowledge stays with the calling code (`EditSystem`, `GeometryPart`, the data classes).
5. **Support richer, pre-computed geometry.** `GeometryPart` should compute derived geometry (e.g. buffers around shapes) at `setData` time so the data is ready to index the moment `spatial.addData`/`replaceData` is called.
6. **Enable cross-layer conflation and open-ended spatial queries** — the kinds of questions the validators ask, plus the proof-of-concept in `PixiLayerDebug` (does this Microsoft building overlap an existing OSM building?).

## Non-Goals (for now)

- A general-purpose geo-database query language. We are generalizing *storage and indexing*, not building an arbitrary query engine.
- Precise-geometry indexing beyond bounding boxes. `RBush` indexes bboxes; precise containment/overlap remains a two-phase concern (see "Buffers and precise queries").
- Removing the `osm` cache's relationship to OSM topology. Topology stays in `EditSystem`/`Graph`; `SpatialSystem` only indexes positions.

## Key Decisions

### 1. OSM sync moves into `EditSystem` (point 1 & 4)

The "which graph is current / diff-and-sync" logic in `Tree` is genuinely OSM-specific and should **not** migrate into `SpatialSystem` — that would couple the generic spatial engine to OSM topology.

`EditSystem` is the right home:
- It already owns the only `Tree`, the graph chain, and the history.
- It **already computes the `Difference`** in `_emitChanges()`. Driving spatial updates off that same Difference removes the double-diff that `Tree._setCurrentGraph()` performs today.
- The OSM-specific helpers `Tree` needs (`_includeParents` walking `parentWays`/`parentRels`, segment generation, the rebase/visible/deleted bookkeeping) all naturally belong next to the graph.

The unused `SpatialCache.graph` field is **removed**. `EditSystem` is the source of truth for OSM topology; duplicating ownership invites drift. The only reason `Tree.intersects` does `graph.entity(hit.boxID)` instead of returning `hit.contents` is to fetch the current-version entity rather than a possibly-stale cached one — if sync keeps `contents` fresh (replacing the cached entity object whenever its geometry changes, which it must do anyway), callers can just use `contents`.

### 2. Multiple named OSM caches instead of one mutable "current graph" (point 1, refined)

Rather than a single OSM index that lazily re-syncs to whatever graph a caller passes, `EditSystem` maintains **separate, explicitly-named caches** in `SpatialSystem`:

- `osm-base` — the unedited downloaded data (the base graph).
- `osm-staging` — the work-in-progress edit. Useful for live feedback while the user is drawing.
- `osm-stable` — the latest committed edit. The data validators should base their findings on.

Because `SpatialSystem` is decoupled from everything else, there is no reason we can't have it both ways. Each cache reflects exactly one graph and is kept in sync by `EditSystem` as that graph changes — no per-query graph thrashing.

**Convention:** unless a caller has a specific reason otherwise, the OSM spatial cache reflects **staging**. Validators should explicitly target **stable**.

This dissolves a class of subtle bugs in the old validator code, where correctness depended either on luck (the caller happening to pass the right graph) or on `Tree._setCurrentGraph` doing a *ton* of work to shuffle the index around as `intersects()` was called with many different graphs in a single pass.

**Update timing — the critical invariant:** It is `EditSystem`'s job to rematerialize/update the relevant cache **immediately before** it emits the corresponding event, so that any listener can rely on the associated spatial cache being current when it handles the event:
- before `merge` → update `osm-base` (new downloaded data streams in)
- before `stablechange` → update `osm-stable` (only changes when the user commits an edit)
- before `stagingchange` → update `osm-staging` (only changes as the user performs work-in-progress edits)

All three caches are maintained. Note the differing update cadences: `osm-base` updates continuously as data streams in, while `osm-stable` and `osm-staging` only update when the user actually edits. This is expected to perform better than the current state, where `Tree` reshuffles its internal index based on whatever graph it is asked about at query time.

### 3. Generalize `SpatialCache` to named indexes (point 2 & 3)

Loosen the rigid cache so it holds an open-ended map of named indexes, each pairing a box map with an `RBush`. This also resolves the tension where we've duplicated the entire method family for `data` vs `tiles` and don't want to duplicate it again for every new attachment.

Sketch (final names/shape TBD in implementation):

```ts
interface SpatialIndex {
  id: string;                          // 'data', 'tiles', 'segments', 'buffers'
  boxes: Map<BoxID, SpatialBox>;
  rbush: RBush<SpatialBox>;
}

interface SpatialCache {
  id: SpatialID;
  indexes: Map<string, SpatialIndex>;  // replaces tiles/data + tileRBush/dataRBush
}
```

`SpatialBox.contents` becomes generic (`unknown` / a type param) plus a `kind` discriminator so callers can tell what they got back. The existing `addData`/`addTiles`/`getVisibleData`/etc. become thin wrappers over a generic index API (`index('data')`, `index('tiles')`), so this is a **non-breaking refactor first** — public behavior is unchanged, the internals just stop being hardcoded.

**Hard rule:** `SpatialSystem` / `SpatialIndex` must not have specialized knowledge of the things they store. A segment, a buffer, an OSM entity, a photo — all are just "something with a bbox and some `contents`" to the index. The meaning lives in the calling code.

### 4. Way segments (point 2)

`waySegments` returns segment boxes, and a segment is not an `AbstractData`. With named indexes this becomes a **`segments` index inside the OSM cache** (not a separate `spatialID`), because segments share the OSM data's lifecycle — when a way's geometry changes, its segments must be regenerated in the same sync pass that updates the way.

Segment generation (way → `[{ wayID, nodes: [a, b], extent }, …]`) is OSM domain logic and belongs in the OSM sync code / `OsmWay`, not in `SpatialSystem`. `SpatialSystem` just indexes the resulting boxes and answers `getDataAtBox`-style queries against the `segments` index.

Consumers to update: `crossing_ways.ts` and `almost_junction.ts` (currently call `tree.waySegments(...)`), and `close_nodes.ts` / `ValidationSystem.ts` (currently call `editor.tree.intersects(...)`).

### 5. Buffers and precise queries (point 2 & 3)

Computing buffers in `GeometryPart` is the right call — it already derives hull/centroid/poi/surround from the source geometry, so a buffer is just one more derived geometry produced at `setData` time and ready to index when the data is added.

Caveat: `RBush` indexes bounding boxes only, so a buffer/overlap query is inherently **two-phase**:
1. **bbox prefilter** via `RBush` (cheap, what we have today), then
2. **precise refine** — test the candidate geometries for actual polygon containment/overlap.

`SpatialSystem` should own the refine helper (e.g. a `getDataWithin(polygon)` that prefilters then tests), so the precise-geometry knowledge stays in one place rather than every caller re-implementing the second phase.

## Sequencing

- **Step 0 (this doc):** Capture the decisions and goals. ✅ Done.
- **Step 1:** Generalize `SpatialCache` to named indexes + generic `contents`, with back-compat wrappers. Pure refactor, no behavior change, fully testable. ✅ Done.
- **Step 2:** Delete `Tree`. Move diff/sync into `EditSystem` (driven off the `Difference` it already computes), updating each cache immediately before emitting `merge`/`stablechange`/`stagingchange`. Establish the `osm-base`/`osm-staging`/`osm-stable` caches. Add the `segments` index and repoint the validators (`crossing_ways`, `almost_junction`, `close_nodes`, `ValidationSystem`). Lock in "validators read stable, general code reads staging." ✅ Done.
  - **Follow-up:** The `crossing_ways` / `almost_junction` unit test suites (`test/unit/validators/*.test.js`) are still `describe.todo` and use a `Rapid.Tree`-based mock harness. They need converting to a real `EditSystem` (populate via `editor.merge`, query via `editor.waySegments`) and re-enabling. The spatial mechanism they depend on is covered by new `EditSystem` `waySegments` tests in the meantime.
- **Step 3:** Compute buffers in `GeometryPart`, add a `buffers` index, and add the two-phase refine query to `SpatialSystem`.
- **Step 4:** Build cross-layer conflation queries on top.

### Step 2 implementation notes

- `EditSystem` exposes `intersects(extent, graph?)`, `waySegments(extent, graph)`, and `spatialIDForGraph(graph)`. The first two replace the old `Tree.intersects` / `Tree.waySegments`; callers were repointed.
- `spatialIDForGraph` maps a graph to `osm-base` / `osm-stable` / `osm-staging` by identity (defaulting to staging). `intersects`/`waySegments` resolve hits through the *passed* graph, so a slight cache/graph mismatch degrades gracefully (missing entities are filtered out) rather than throwing.
- Segments are stored in the `segments` index in **world coordinates**. `EditSystem._segmentItems` projects each way's node `loc`s to world space; `waySegments` projects the WGS84 query extent to a world box before searching. Per-way segment box ids are tracked in `EditSystem._osmSegmentIDs` so they can be removed even when a way's segment count changes.
- New base data (from `merge` and `fromJSONAsync`) is pushed into **all three** caches via `_mergeIntoCache`, because the shared base cache means a `Difference` between two derived graphs won't surface unedited base entities.

## Boundary Summary

- **`SpatialSystem`** — owns *where* things are and answers spatial questions. Generic bbox indexing (named indexes via `replaceItems`/`removeItems`/`getItemsAtBox`) + two-phase precise refine. No knowledge of OSM, segments, buffers, or photos as concepts.
- **`EditSystem`** — owns OSM topology/history. Translates graph `Difference`s into spatial updates, generates segments, owns the `osm-base`/`osm-stable`/`osm-staging` caches, and exposes the OSM spatial queries.
- **`GeometryPart`** — owns derived geometry (hull, centroid, poi, surround, **buffers**), computed once at `setData` time so data is ready to index.
- **Data classes (`OsmWay`, etc.)** — own domain meaning (what a segment is, what counts as an interesting tag).
