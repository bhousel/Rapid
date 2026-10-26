# Backlog / Future Ideas

Items planned but not yet started.

## Remappable keyboard shortcuts (KeyboardSystem phases 2 & 3)
Phase 1 (the `KeyboardSystem` conversion + command scaffolding) is done — see
[`design/keyboard-system.md`](../design/keyboard-system.md) and
[facebook/Rapid#1076](https://github.com/facebook/Rapid/issues/1076). Remaining phases:

- **Phase 2 — persistence via SettingsSystem.** Make `settings` an optional dependency of
  `KeyboardSystem`. On start, hydrate a user overrides map (e.g. under a `keyboard.bindings`
  settings path: `{ [commandID]: combo }`) by calling `keyboard.rebind(commandID, combo)`; persist
  back on change. Resolution order is `userOverride ?? default`. Absent `SettingsSystem`
  (CLI/tests), fall back to defaults. Then start migrating existing `keyboard.global.on('⌘Z', …)`
  call sites to pass a `commandID` so their combos become remappable/persistable (incremental).
- **Phase 3 — UI.** Extend `UiShortcuts` (and/or a preferences pane) to capture a new combo,
  detect conflicts, reset-to-default, and call `keyboard.rebind(commandID, combo)`. Reflect changes
  live via the `bindingschange` event `KeyboardSystem` already emits.
- **Possible enhancement:** layout-independent matching via `KeyboardEvent.code` (physical key),
  for non-Latin keyboard layouts — the `event.key`-only matching dropped the old `keyCode`
  physical-key fallback.

## Pixi rendering follow-ups
- **Text rasterization without Pixi.Text**: move text drawing onto an `OffscreenCanvas` worker, or bypass `Pixi.Text` with main-thread canvas2D rasterization first. Main thread can feed the resulting `HTMLCanvasElement`, `ImageBitmap`, or `ImageData` to `PixiTextures.allocate('text', ...)`, avoiding both nested `renderer.generateTexture()` and `readPixels`. Worker font loading needs the same fonts; use `FontFace` API + transferable `ArrayBuffer`.
- **Direct mesh generation for polygons / lines**: replace the `PIXI.GpuGraphicsContext` + `PIXI.buildContextBatches()` round-trip in `PixiFeaturePolygon.ts` with direct `earcut` tessellation, or consider a shared mesh-generator path for polygons and lines. Meshes are batchable, so this could reduce draw calls while avoiding renderer-internal geometry extraction.
- **Tile padding off-thread if measurable**: `_fromEdgePaddedCanvas()` does two canvas draws per tile on the main thread. If profiles show it matters, build the edge-padded tile source on a worker `OffscreenCanvas` and transfer an `ImageBitmap` back; GPU upload still stays with the Pixi renderer unless the renderer itself moves off-thread.

## Line marker placement (oneway arrows, sided markers)
- Today `geomGetPositionsAlongLine` (moved from `pixi/helpers.ts` to `geo/geom.ts`) regenerates marker positions per-frame in the feature's update path, with an arbitrary 100-marker cap (`Rapid#544`, the `isLimited` param) to keep long lines from spawning thousands of sprites.
- Better approach (mirrors the label system): compute marker placement once in stable world coordinates, store as a list of `{worldCoord, angle}` records on the feature, and emit sprites only for the subset whose world position intersects the viewport. The cap (and the `isLimited` param) goes away naturally — a 100km road only emits sprites for the ~few-dozen markers actually on screen.
- Spacing should be expressed in world units derived from a target screen-px spacing at a reference zoom, so density stays visually consistent.
- Sprite lifecycle would mirror PixiLayerLabels' RBush+renderObjects pattern: reuse sprites, destroy when scrolled offscreen, repopulate when scrolled back in.

## Deferred styling work
- Move PixiLayerRapid's hardcoded styles into the style asset file (colors are currently dynamic from `dataset.color`)
- Have PixiLayerRapid call `styleMatch()` with a dataset/scope ID
- Per-dataset schema querying (different presets for Rapid vs OSM data)

## External data styling (usability)
- Today each Rapid dataset is drawn in a **single color** (`dataset.color`), a holdover from the original
  Rapid. External data can be hard to tell apart from OSM features: for example, a yellow dataset looks
  like OSM tertiary roads.
- Make external data obviously "not yet in OSM". Ideas: an animated WebGL shader effect (shimmer,
  sparkle, marching dashes), a distinct casing or halo treatment, or an overlay pattern that no OSM style uses.
- Styles for the matching statuses: "Already mapped" (muted), "Needs review" (highlighted), and "New" (the
  default external-data look). See `design/conflation-system.md`.
- Related to the deferred styling work above: move `PixiLayerRapid`'s hardcoded styles into style data, so
  these treatments go through `StyleSystem`.

## Rapid dataset UI: live tuning instead of nested modals
- `UiRapidDatasetToggle` → `UiRapidDatasetSettings` (→ colorpicker, etc.) is a stack of modals, a holdover from
  earlier designs. The modals cover the map, so a user can't tweak conflation parameters and watch the result
  on the map at the same time.
- Explore: a separate, non-modal panel for conflation tuning (sidebar or docked pane, live counts of
  "Already mapped" / "Needs review" / "New" in view), or rethink the modals-on-modals design overall.

## One "what is this way, really?" answer (`OsmWay.asFeature`)
- An untagged way that belongs to a multipolygon really is that relation (an area, with the relation's
  tags). At least 7 places work this out on their own, each slightly differently: `PixiLayerOsm`
  (styling), `FilterSystem` (filter matches), and the validators `crossing_ways` (`getTaggedEntityForWay`),
  `close_nodes`, `unsquare_way`, `disconnected_way`, `impossible_oneway`.
- `OsmWay.asFeature(graph)` now exists, and `ConflationSystem` uses it. Next, move the others over one at a
  time, watching for their small differences (untagged-only or not, inner roles, more than one parent
  multipolygon).
- Longer term: index generic features (`{ kind, tags, coords }`) rather than OSM ways, so conflation (and
  maybe validation) can work against non-OSM targets. See `design/conflation-system.md`.

## Debugging loop: `bun run start:cdp`
- ✅ `bun run start:chrome` (`scripts/chrome.ts`, using `chrome-launcher`) launches Chrome with remote
  debugging on port 9222 and its own profile in `.chrome-debug/` (gitignored; extensions persist), opened
  to the dev build. Agents attach with Playwright's `connectOverCDP` to take screenshots and query
  `rapidContext` in the developer's own session.
- ✅ `bun run cdp` (`scripts/cdp.ts`) drives that tab: `shot`, `eval`, `reload [setup.js]`, `press`.
  Documented for agents in `AGENTS.md` → Testing → "Testing in a Real Browser".
- Still to do: one command that also starts the server, and maybe a project skill for the `run` skill to find.

## Stable IDs for external data: follow-ups
Done (Oct 22): `${datasetID}:${isID value ?? content hash}:${partIndex}` for features, `${dataID}@${start}-${end}`
for pieces of lines, and acted ranges. See "Feature IDs" in `design/rapid-system.md`. Still to do:
- **Lock the `isID` field** of a dataset with accepted or ignored features in the current edit session
  (proposed in the design doc; otherwise earlier accepts are orphaned under the old IDs).
- **Warn about repeated `isID` values** in the dataset settings (they're numbered, so IDs stay unique,
  but the data probably isn't keyed the way the user thinks).
- **Restore the selection after a restart**, now that the IDs are stable.
- An `isID` row in a data mapping should normally use `ignore`, not `copy`, so the source ID
  isn't copied into OSM tags on accept. The settings UI could warn about `copy` + `isID`.
- Service datasets (Esri, Overture, MapWithAI) bring their own IDs; check that they're stable too.

## Custom datasets backed by a service
People have asked to point Rapid at their own data on a server, not just a file: a `sourceUrl` to an
Esri FeatureServer (`serviceID: 'esri'`, and `EsriService` walks the server's layers and loads tiles), or
to another OSM-like API (`serviceID: 'osm'`, to conflate it against the main OSM API, or an
OpenStreetMap ↔ OpenHistoricalMap bridge).
- The model already allows it: `custom` says who owns the definition (the user can edit or delete
  it), `serviceID` says who loads the data (a service, or Rapid itself from the file). They're independent.
- Done: `_loadDatasetSettings` doesn't call `setupCustomDatasetAsync()` for a custom dataset that has a
  `serviceID`. `setupCustomDatasetAsync()` and `PixiLayerRapid` test `serviceID`, not `custom`.
- Still assumes custom means no service: `_datasetsChanged` skips custom datasets when fetching a data
  dictionary from the service (a custom Esri dataset may want the service's dictionary as a start);
  the services find datasets by `datasetID` in their own catalogs, so they'd need to take a `sourceUrl`;
  `UiRapidAddDataset` only makes file and URL datasets.

## DatabaseSystem: schema upgrades with other tabs open
- `openDB` is called without `blocked` / `blocking` handlers. A schema bump (v2 → v3 added
  `datasets`) can't run while another tab still holds the older version open: the open waits, or
  fails over to the in-memory mock, and the session's data isn't durable.
- Add a `blocking` handler that closes our connection (and tells the user to reload) when a newer
  version wants to upgrade, and a `blocked` handler that tells the user to close their other Rapid tabs.
- Lesson from the dropped `rapid.custom.*` migration: never delete the source data unless the
  destination is durable (`database.isAvailable`).

## Flaky tests
- `EditSystem` › `toBackup returns the structured object that toJSON stringifies`: builds two backups
  and expects them to be identical, so it fails when the clock ticks between the two calls.
- `DatabaseSystem` blob tests fail when that file runs alone (Blob through the in-memory clone),
  but pass in the full suite.

## MapRoulette authentication
- `UiMapRouletteMenu` and `UiMapRouletteEditor` read the user's MapRoulette API key from the
  `maproulette_apikey_v2` OSM user preference. MapRoulette is moving away from storing the key there
  (security incident, October 2026:
  https://community.openstreetmap.org/t/maproulette-security-incident-october-2026/148566).
- Today, without the key, Rapid carries on unauthenticated, which is fine for now. Adopt whatever
  MapRoulette moves to once it's settled. Auth should probably move from the UI into `MapRouletteService`.

## Conflation: what JOSM users will ask for
From reading JOSM's Conflation plugin (see "Prior art" in `design/conflation-system.md`). Roughly in
the order people are likely to ask:
- **What's left, with counts:** a per-status count for the dataset and next/previous through it.
- **Tag merging into already-mapped features** (e.g. `surface` onto an existing sidewalk), with per-key
  policies (fill in missing / overwrite / keep existing), not a dialog per feature.
- **Batch accept** in one undo step.
- **"Why is this already mapped?"**: show the matching OSM way, distance and angle.
- Later: an "OSM only" view, a tag-difference badge on matched features, value normalization for
  `sameKeys`, mutual-best pairing for points and areas.
- `uncertain` / the review queue have no source since the "near" band went away. Decide whether a
  `sameKeys` disagreement (same place and direction, different tags) should become "needs review",
  or remove the status.

## Conflation / buffers follow-ups (beyond Step 3)
- **Internalize / replace `lineToPoly` offset-curve generation** — `lineToPoly` (used for halos) repurposes `PIXI.buildLine`, coupling halo generation to Pixi internals and a fragile triangle-walk. If we ever need *precise* buffer polygons (not just coverage boxes), internalizing the offset-curve math would unify halos + buffers and drop the Pixi coupling. Left alone for now; coverage boxes cover the conflation use case.
- **Precise buffer polygons** — only if a consumer needs the actual buffer polygon rather than coverage boxes + a distance/overlap predicate. Likely unnecessary given the two-phase query.

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
- `d3-transition`: large surface area, best done alongside the UI TypeScript conversion

## Deferred test cleanup
- Replace non-assertive smoke tests like `assert.isTrue(true)` / bare rejection catches with stronger state or error assertions where practical
