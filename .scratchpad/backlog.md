# Backlog / Future Ideas

Items planned but not yet started.

## DashLine performance
- Restore the texture-based DashLine path (currently disabled — `useTexture: false`). Pixi v8 broke the original `textureSpace: 'global'` matrix handling. Drawing per-segment via `lineTo` is far slower than a single stroke with a tiling dash texture.
- Once textures work again, store dash-pattern textures in an atlas (one slot per `dash.toString() + width + scale` cache key). Avoids per-line texture swaps and reduces draw-call count for dashed renders (halos, lasso, casing dashes).
- Also fix the existing `_getTexture` cache key, which only keys on `dash.toString()` — it should include width and scale (or be regenerated alongside the atlas migration).

## Line marker placement (oneway arrows, sided markers)
- Today `getLineSegments` regenerates marker positions per-frame in the feature's update path, with an arbitrary 100-marker cap (`Rapid#544`) to keep long lines from spawning thousands of sprites.
- Better approach (mirrors the label system): compute marker placement once in stable world coordinates, store as a list of `{worldCoord, angle}` records on the feature, and emit sprites only for the subset whose world position intersects the viewport. The cap goes away naturally — a 100km road only emits sprites for the ~few-dozen markers actually on screen.
- Spacing should be expressed in world units derived from a target screen-px spacing at a reference zoom, so density stays visually consistent.
- Sprite lifecycle would mirror PixiLayerLabels' RBush+renderObjects pattern: reuse sprites, destroy when scrolled offscreen, repopulate when scrolled back in.

## Deferred styling work
- Move PixiLayerRapid's hardcoded styles into the style asset file (colors are currently dynamic from `dataset.color`)
- Have PixiLayerRapid call `styleMatch()` with a dataset/scope ID
- Per-dataset schema querying (different presets for Rapid vs OSM data)

## Performer-inspired statistics display
- HUD overlay showing frame timing (APP/DRAW split), scene complexity, draw calls, texture usage, queue depth
- Data sources: `scheduler.metrics`, GraphicsSystem performance marks (already in place, commented out), Pixi renderer stats, `scheduler.numPending`
- Inspiration: SGI Performer's `pfStats`/`pfFrameStats` system (Chapter 23 of Performer Programmer's Guide)

## Validator class lifecycle
- Convert validators from factory functions to proper classes
- Subscribe to `schemachange` events, refresh cached prerequisites on change
- Current state: time-of-use lookups for rulesets/variables (done); full class lifecycle (future)

## Worker offloading — remaining opportunities
- **PMTiles fetch+parse on worker** — PMTiles library owns its own HTTP Range requests via `Source.getBytes()`. Moving the `PMTiles` instance to the worker requires thinking through lifecycle (header caching, archive identity). Could write a custom `Source` adapter that delegates to `network.fetchRaw()` with Range headers. VectorTileService PMTiles path currently decodes protobuf on the main thread.
- Esri, MapWithAI, KartaView, Streetside — remaining services with complex post-processing or graph integration
- Use `resultPriority: 'normal'` on any fetch that triggers `editor.merge()`
- Evaluate chunked `EditSystem.merge()` for large tiles (single-tile budget overruns)

## d3-transition / d3-timer migration
- 49 `.transition()` call sites in UI code spin up a competing rAF loop via d3-timer
- Goal: replace with `scheduler.tween(workID, fn, { duration, easing })` or CSS transitions
- `d3-timer`: 1 direct import in `flash.js` — trivial to replace today
- `d3-transition`: large surface area, best done alongside the UI TypeScript conversion

## Deferred test cleanup
- Replace non-assertive smoke tests like `assert.isTrue(true)` / bare rejection catches with stronger state or error assertions where practical
