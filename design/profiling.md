# Performance and memory profiling

**Status:** Proposed (Nov 2026). Nothing here is built yet; this doc collects what we want to measure,
how, and what we already suspect, so the work can start without re-deriving it.

## Why

We don't have numbers for what a normal Rapid session costs, so when something looks wrong we can't
tell. The prompt for this doc: after a long driven session in the debug Chrome (12 days of uptime, a
Canary build, DevTools open, Playwright intercepting every request), the renderer process sat at about
6 GB and 600% CPU while Rapid's main-thread JS heap was about 100 MB. The small heap says a leak of
ordinary objects (entities, graphs, Pixi features) wasn't it, and the browser is the likely culprit, but
two kinds of Rapid memory don't show up in that 100 MB:

- GPU resources (Pixi textures, geometry buffers). A feature destroyed without its `Graphics` being
  destroyed leaks here, not in the JS heap.
- `rapid-worker.js` has its own heap in the same renderer process. `performance.memory` on the main
  thread doesn't see it.

The expectation to check: after `context.resetAsync()`, everything about the editing session and the
cached map data is freed. Some things rightly survive a reset (files loaded by `AssetSystem`, the
texture atlas in `PixiTextures`), and we should list them so growth there isn't mistaken for a leak.

## What to measure

Per snapshot:

- Main-thread JS heap, DOM node count, event listener count (`Performance.getMetrics` over CDP).
  Listeners are the classic Rapid leak: a system that calls `on()` in `reset()` without `off()`.
- Instance counts by constructor from a heap snapshot (`HeapProfiler.takeHeapSnapshot`): `OsmNode`,
  `OsmWay`, `OsmRelation`, `Graph`, `Edit`, the `PixiFeature*` classes, `PIXI.Graphics`, `PIXI.Container`,
  `PIXI.Texture`, tile records, `GeoJSONData`, `MarkerData`.
- Pixi-side: `renderer.texture.managedTextures.length`, and the counts of children under each scene group.
- The worker's heap, by attaching to its target over CDP and taking the same metrics.
- GPU process memory from Chrome's task manager (no JS API for it).

Per frame (a separate concern, same tooling): draw calls and state changes per frame from Spector or
the Pixi renderer's stats, for the batching work below.

## How

A script beside `scripts/cdp.ts` (working name `scripts/profile.ts`) that drives the real app:

1. Fresh Chrome (`bun run start:chrome`), load Rapid, force GC (`HeapProfiler.collectGarbage`),
   take the baseline.
2. Cycle 5–10 times: pan a dense area until its tiles have loaded, make ~50 edits through the UI or
   `editor.perform`, `context.resetAsync()`, GC, snapshot.
3. Anything whose count rises monotonically across resets is a leak. Report the deltas by constructor.
4. A second run with no resets, panning a city at a fixed zoom, to learn what steady state is at a given
   density. That's the number to put in this doc as "typical".

The release-check scripts from Nov 2026 (scratch, not in the repo) already attach with Playwright and
read `rapidContext`; the profile script is the same shape with snapshots instead of scenarios.

## Suspects to check first

Reading, not measurement, so treat these as the first places to look, not findings:

- Systems and layers that subscribe in `reset()` or `init` and never unsubscribe.
- `PixiLayer*.reset()` paths that `removeChild` without `destroy({ children: true })`; a `Graphics`
  that's removed but not destroyed keeps its GPU geometry.
- Caches in services (`OsmService`, `MapWithAIService`, `VectorTileService`) that `resetAsync()` is
  supposed to clear, and anything the worker keeps per request.
- Label textures: `PixiLayerLabels` rasterizes text into the atlas; check that labels scrolled away
  release their atlas slots.
- `EditSystem` history: graphs share structure, so a retained old `Graph` is cheap, but a retained
  `Edit` with a captured selection or viewport can hold more than it looks.

## Rendering: draw calls

Spector shows alternating casing, stroke, casing, stroke draw calls for lines, one pair per feature,
instead of all casings then all strokes. Each `PixiFeatureLine` owns a container with a casing
`Graphics` and a stroke `Graphics`, and they render in scene order, so Pixi can only batch consecutive
drawables with the same material. Grouping by material would cut draw calls a lot in a dense view.

Pixi 8.6+ has `RenderLayer`, which renders an object in a different order than its position in the
scene graph while keeping its parent for transforms and hit-testing. That fits: the casing and stroke
stay children of the feature container (so `AbstractBehavior._getEventData` still walks up to the
feature), but a per-level `casings` layer and `strokes` layer render them grouped. Measure the draw
call count before and after on the same view. Related backlog items: direct mesh generation for
polygons and lines, and the scene reorganization by `spatialID` (see `.scratchpad/backlog.md`).

## Out of scope for now

Conflation ships first on the `conflation-system` branch. This doc is here so the ideas aren't lost;
nothing in it blocks pre.4.
