# Backlog / Future Ideas

Items planned but not yet started.

## Editing a multiselection
Designed in `design/multiselection.md` (proposed Oct 2026): a selection pane (the list plus commands)
that slides to a command pane, like `UiInspector`; replace geometry first. It follows the data IDs work,
which made any mix of data selectable. Bryan wants to land the current branch for testers first.

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
The plans and measurements are in [`design/graphics-system.md`](../design/graphics-system.md) (frame
stats, partial fills without stencil masks, our own line builder, dashes, GPU time, the CULL pass,
frame pacing, the frame's deadline, the pass, garbage, labels). Numbers below are Užice at z16 unless
said otherwise. Biggest or most wanted first.

- **Garbage collection is the longest stall left** (section 13). A major collection is 420 to 480 ms of
  the main thread, every 12 s of zooming. Left, by size: (1) Pixi's line builder is a quarter of what a
  zoom allocates, most of it `round` joins and caps (try `bevel`/`butt` for thin lines, a visual call;
  or our own line builder); (2) the 1.7 GB alive: a full copy of the style per feature (51 MB, below),
  a way's coordinates kept three times as arrays of pairs (`Float64Array`s would take a quarter), and
  an `Extent` each on a `Geometry` and its part; (3) Pixi's `syncShader` polyfill allocates on every
  draw call (5%, upstream); (4) a tile label string per feature drawn (4%); (5) whether the scheduler's
  long tail after a load leaves V8 idle time to collect in.
- **A line builder of our own** (sections 4 and 7; Bryan: "I really want this"). Partial-fill bands
  without stencil masks, hit areas, halos, dashes, and a quarter of a zoom's garbage.
- **Features keep a full copy of their style, and matching makes two** (Bryan: "this could be better").
  `styleMatch()` returns a copy, and `feature.style =` merges it with the defaults into another: 14% of
  the APP time of making features. `styleMatch()` once returned the base style by reference and
  rendering changed it by accident; the layers still change what they get (`markerStyle.marker.image =
  'pin'`), so sharing needs frozen styles with overrides built apart, or a cache of the finished style
  per kind of feature.
- **The other layers still do a pass on every frame** (Bryan: worth doing). Only the OSM layer keeps its
  features (`keepFeatures()`), follows the cull box, and takes arrivals and edits without a pass. The
  Rapid layer first: it draws the same kinds of feature with the same classes.
- **What still asks for the OSM layer's pass** (section 12): a filter and the styles. The pass is 134 ms:
  71 of looking at each shown feature and finding nothing to do, 30 of vertices in the spatial index,
  30 of sorting, plus asking each entity for its geometry twice (`FilterSystem.filterScene()`, then to
  sort by kind). Going further means an index that keeps vertices apart from features. Also open from
  `design/filter-system.md` section 4: remember a vertex's answer in the filter, build `entity.key` once.
- **A filter that decides the level of detail** (`design/filter-system.md` section 6; Bryan, Nov 19):
  leave details out at low zooms instead of broad categories that are in or out. Its own project.
- **Following the cull box** is 12 to 24 ms of a zoom frame and 5 to 19 of a pan's, mostly the spatial
  index's answer for the strip the box moved over, every vertex included.
- **Merging a tile of OSM data blocks the main thread** (section 12, "Seen on the way").
  `EditSystem._mergeEntities()` takes 80 to 134 ms for a dense tile, outside any frame or scheduler
  task: the longest gaps of a pan. Not looked into: where the time goes, and whether a tile can merge
  in parts.
- **The first pass and the first DRAW after a load** (section 8): `FilterSystem` matches every entity
  for the first time (87 ms at Staten Island), and the first DRAW pass with anything in it costs 76 to
  128 ms.
- **Every render group costs a few microseconds on every frame** (Bryan: backlog). The split of lines
  and points by tile added 1 to 2 ms to a frame that only moves the view (580 groups). Ideas: no
  container per tile for a class of lines with few members; hide the tiles outside the view so Pixi
  skips them. Watch for: wrong overlaps at tile edges (polygons; pins side by side across a tile edge
  are ordered by tile, 1% of overlapping pairs).
- **The frame budgets are first guesses**, picked once on an M4 at 120 Hz (`APP_BUDGET_MS` 6,
  `STILL_BUDGET_MS` 24, `MIN_NORMAL_MS` 4, batch sizes 64/1,000/4). A load's frames at 24 + 9 ms land
  just past two 120 Hz refreshes and wait for a third. Sweep them with `bun run measure` on another
  machine (Bryan will try other hardware).
- **Budget frames by the display's refresh, and show the misses** (Bryan, Nov 20). The gaps between
  animation frame timestamps give the refresh interval and the missed refreshes. `SchedulerSystem`
  could set a frame's budget so APP plus the expected DRAW ends just before a refresh, and the
  Rendering card could draw a bar per refresh with the misses marked (SGI Performer's statistics).
- **Labels: what's left** (section 14, "Open questions"): a selected way often has no room for its own
  label between its vertices; line labels can land before point labels across batches; Seattle places a
  tenth fewer labels than with boxes, not all of it the 2 px cells. Labels on long lines walk the whole
  line (five transatlantic cables at Smith Point: 350 ms a zoom; clip to the view before
  `placeRopeLabel()`).
- **GPU time is mostly fixed costs** (section 6): render without `multiView` and give the minimap its
  own copy (1.5 to 2 ms); decide whether device pixel ratio 2 needs MSAA (4 ms; compare screenshots).
- **Small things from the CULL pass** (section 8): vertices appear at effective zoom 16, which depends on
  latitude, so a north-south pan across that line shows them up to 256 px late; a held frame during a
  zoom could be drawn at the new zoom in place of the CSS transform.
- **The footer's count of hidden features is stale.** It's counted in the OSM layer's pass, which pans,
  zooms, edits and arrivals no longer do. Count it when `UiFilterStatus` renders
  (`design/filter-system.md` section 4).
- **Imagery tiles of the old zoom stay after a zoom out** until something else draws a frame:
  `PixiLayerBackgroundTiles` drops them on the first `render()` 3 s later. A request 3 s after the last
  new tile would fix it.
- **After a dense place is drawn, the scheduler's queues take another 25 s to empty** (Staten Island:
  drawn after 8 s, `scheduler.numPending` above zero until about 32 s, 5 s of work). Not traced
  (validation is the likely one).
- **Validators mark entities as edited for every graph.** `crossing_ways` and `outdated_tags` run a fix
  on a scratch graph whose commit calls `Graph._markTopologyChanged()` for the whole lineage: after a
  load, 1,438 entities nobody edited have answers that can't be memoized. Cheap today.
- **Dashes differ from one load to the next, and after a big zoom change** (up to 12,000 pixels along
  sidewalks in Seattle), which makes screenshot comparisons noisy. Ruled out (Nov 20): geometry, the
  `DashLine` instructions and texture matrices, the cached textures' pixels, the anchor. Worth fixing
  anyway: `DashLine._getTexture()` caches by dash pattern alone, but height and alpha come from
  whichever feature asked first.
- **OSM tiles that fail to load aren't retried until the map moves** (`OsmService.loadTiles()` returns
  early when the view is unchanged). A 429 is handled (the status bar counts down and the view loads
  when it's over); a 500 or a dropped connection still waits.
- **Profiling pass** ([`design/profiling.md`](../design/profiling.md)): baselines for heap, GPU resources,
  the worker heap and listeners, and a `scripts/profile.ts` that cycles load → edit → `resetAsync()` and
  reports what grows.
- **Scene follow-ups** ([`design/scene.md`](../design/scene.md) section 3): reordering spatial IDs (lift
  OSM while drawing, or a layer-order UI); hit-testing by geometry instead of Pixi, so snapping doesn't
  depend on stroke width and z-order.
- **Text rasterization without `Pixi.Text`**: canvas2D on the main thread first, or an `OffscreenCanvas`
  worker, fed to `PixiTextures.allocate('text', …)`; avoids nested `renderer.generateTexture()` and
  `readPixels`. A worker needs the same fonts (`FontFace` and a transferable `ArrayBuffer`).
- **Tile padding off-thread, if it shows in profiles**: `_fromEdgePaddedCanvas()` does two canvas draws
  per tile on the main thread; a worker `OffscreenCanvas` could build it and transfer an `ImageBitmap`.

## Render relations (at least the selected one)
Rapid doesn't draw relations today: `PixiLayerOsm` skips `'relation'` geometry (a commented-out
branch), and only multipolygons show, as areas. Showing a relation would help mappers a lot, routes
especially, which are hard to check today.
- Start with the selected (or hovered) relation: draw its member ways as one highlighted path, like
  the blue line on a car navigation map, with an animation (moving dashes or chevrons) to show
  direction. Members that aren't ways (stops, platforms) as markers on it.
- Direction needs ordered members: `osmJoinWays` gives the sequence; `forward`/`backward` roles and
  gaps in the route should show.
- The geometry is already there: per `design/graph-geometry.md` section 3, a relation's geometry
  references its members' parts, so drawing it reuses them instead of building new shapes.
- **Empty relations should be shown, not deleted.** `SelectMode.exit()` deletes a relation the user
  just made if it has no tags and at most one member with no role (from iD 9d029a37, 2019). Bryan
  sees that as a UI problem, not a data one: a mapper may want to make a relation and add members
  later. Show relations that draw nothing (e.g. a legend beside the map, with a label and color
  swatch), keep them, and let validation at save time say what's missing. Then remove the cleanup.
  It's commented out since Nov 2026 (bug hunt 2, item 7): undo and redo re-enter select mode, so it
  committed a deletion in the middle of a history jump. `missing_tag` already flags an empty relation
  as an error with a delete fix; what's missing is a way to see it on the map.

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
- Styles for the matching statuses: "Already mapped" (muted) and "New" (the default external-data look).
  The muted style is commented out in `PixiLayerRapid._lineStyle` for now. See `design/conflation-system.md`.
- Related to the deferred styling work above: move `PixiLayerRapid`'s hardcoded styles into style data, so
  these treatments go through `StyleSystem`.

## Rapid dataset UI: live tuning instead of nested modals
- `UiRapidDatasetToggle` → `UiRapidDatasetSettings` (→ colorpicker, etc.) is a stack of modals, a holdover from
  earlier designs. The modals cover the map, so a user can't tweak conflation parameters and watch the result
  on the map at the same time.
- Explore: a separate, non-modal panel for conflation tuning (sidebar or docked pane, live counts of
  "Already mapped" / "New" in view), or rethink the modals-on-modals design overall.

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

## Benchmark suite and plan
Until late October 2026, performance work was manual profiling in Chrome. The graph work
(`design/graph-geometry.md`) showed an agent can measure on its own and find regressions early, but
its harnesses lived in a session's scratch folder and are gone. Make it a suite:
- Scenarios worth keeping: an edit, a MoveMode frame and undo/redo at a large L (200 accepted roads),
  the backup after an edit, a merge over edits, a validator pass over a real tile, a render-like pass.
- Both engines: Bun (JavaScriptCore) directly, and V8 through a Bun bundle of `modules/headless.js`
  run in Node (`bun build --target=node`; Node can't load the TS sources). Chrome over CDP for
  rendering, which needs WebGL: `bun run measure` (Nov 18) does this for frame stats on a set of
  difficult places.
- Count operations where we can (copies per derive, recomputes per merge, O(L) scans per event), and
  keep wall-clock numbers for reports: timing limits in CI are flaky.
- A baseline to compare a branch against, and a plan for which numbers each design doc tracks.
- A drag frame, not only a full APP pass: a full pass is mostly restyling, which hides per-frame costs
  (graph step 7 measured 5.7 vs 9.4 ms per drag frame where the full pass showed no difference).

## Renderer: keep the node answers in the layer, not in graph memos
The OSM layer's pass asks every visible entity for point, vertex, line or area, and vertices for their
kind (`OsmNode.vertexKind()`, memoized on the graph). Passes are rare now (a filter, a style change), so
this matters less than it did. Keeping the answers in the layer, recomputed when `dirtyData` names the
entity, would let the graph memos (and the lineage's set) go. Not measured.

## Debugging loop
`bun run start:chrome` and `bun run cdp` are done (documented in `AGENTS.md`, "Testing in a Real
Browser"). Still to do: one command that also starts the server, and maybe a project skill for the
`run` skill to find.

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

## More end-to-end tests
`test/e2e` landed Nov 18 and has 23 tests now (`test/e2e/README.md`). Next, each its own PR:
- **Saving**, with the upload stubbed (tests never log in to OSM).
- **The issues panel** showing a validation warning for an edit.
- **Startup with the OSM API unreachable.** Rapid can't start today (see "Startup can't survive a slow
  CDN" below); a test would show it, then confirm the fix.
- **The modal stack and Esc/Backspace routing** (`UiSystem`, `KeyboardSystem` document listeners), which
  happy-dom can't cover: the nested Rapid dataset modals (catalog, add custom data, color picker).
- **The QA and photo layers**, which the pre.4 release check didn't cover either.
- **A test that presses a shortcut has to ask the page which key is bound.** Headless Chromium doesn't
  say it's a Mac, so `utilCmd()` binds `⌃Z` where Playwright's `ControlOrMeta` presses `⌘` on a Mac
  (`draw.test.js` does it right). Left over: `UiPresetList`'s own undo handler, which the binding's
  `inEmptyFields` now covers, could go.
- **CI speed, if it starts to matter:** the e2e job builds Rapid again after `build.yml` did (inside its
  95 s test step; not measured apart). Caching Playwright's Chromium would save only 10–15 s, and Playwright advises
  against it.

## Flaky tests
- `EditSystem` › `toBackup returns the structured object that toJSON stringifies`: builds two backups
  and expects them to be identical, so it fails when the clock ticks between the two calls.
- `DatabaseSystem` blob tests fail when that file runs alone (Blob through the in-memory clone),
  but pass in the full suite.

## The upload flow as promises
- The upload is callback code across `OsmService.sendChangeset`, `UploaderSystem._uploadCallback` and
  `SaveMode`, with two 2.5 s waits for postgres replication (iD#1646 iD#2678): the service waits before
  calling back, and the success screen waits before the reset. Hard to follow.
- Bryan's idea (Nov 10 2026): a promise chain the uploader owns, e.g. `osm.sendChangeset(...)` → clear
  the backup right away → wait → what `_uploadCallback` does now. Services shouldn't know about
  `EditSystem`, so the clearing belongs in the uploader, not the service.
- Bug-hunt item 35 closed the gap for now: Rapid stays in save mode until the reset, and
  `clearBackup` stops backups until then.

## MapRoulette authentication
- Rapid read the user's MapRoulette API key from the `maproulette_apikey_v2` OSM user preference.
  After a security incident (October 2026:
  https://community.openstreetmap.org/t/maproulette-security-incident-october-2026)
  MapRoulette stopped storing keys there and expired all the existing keys, so that can't work.
- **All MapRoulette auth is commented out (Nov 10 2026)**, marked "MapRoulette auth is turned off":
  the key fields and fetches in `UiMapRouletteEditor` and `UiMapRouletteMenu` (the menu's
  `_getApiKey` never worked anyway: it called `osm.loadMapRouletteKey`, which doesn't exist), the
  `mapRouletteApiKey` task prop, and the `apiKey` headers in `MapRouletteService.postUpdate`.
  The editor's action buttons still need the user to be logged in to OSM.
- Assumptions for now: MapRoulette works unauthenticated, and will soon give Rapid users a proper way
  to log in. When it does, wire that in (auth should probably move from the UI into
  `MapRouletteService`) and take out the commented-out code.

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
- "Needs review" and the review queue were removed (Oct 26). If they come back, a candidate source is
  a `sameKeys` disagreement (same place and direction, different tags).

## Conflation / buffers follow-ups (beyond Step 3)
- **Replacing `lineToPoly`** with a line builder of our own is now planned for rendering (`design/graphics-system.md` section 4); the same builder could give conflation precise buffers.
- **Precise buffer polygons** — only if a consumer needs the actual buffer polygon rather than coverage boxes + a distance/overlap predicate. Likely unnecessary given the two-phase query.

## Performer-inspired statistics display
- Now frame stats and a rendering info card (`UiRenderingCard`, ⌘⇧F) in [`design/graphics-system.md`](../design/graphics-system.md) (sections 3 and 7). The card shows the scheduler's queue, pressure and dropped frames too.
- Also worth showing: texture usage, vertices per layer.
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

## Smaller follow-ups (moved from `current.md`, Nov 2026)
- **Validator tests:** one `it.skip` is left in `almost_junction.test.js` ("horizontal and tilted road").
  See `design/validation-system.md` for the rest.
- **Stored-files management UI** (`DatabaseSystem` Phase 4 design): list stored files with sizes so users
  can free space when `canStoreAsync()` says no. Only `UiRapidAddDataset` calls `canStoreAsync` today.
- **Custom-data consumer ownership**: move the `DragAndDropSystem` consumer registration out of
  `PixiLayerCustomData` (rendering layer, mild smell) into a proper system.
- **Stretch: images → EXIF → photo markers** (future local-photos consumer, wires into `PhotoSystem`).
- Open questions in `design/database-system.md` (DB name/scoping, graceful-degradation doc).
- **agent-practices:** consider adding the "folder-specific `AGENTS.md`" convention to the shared template.
- **Report upstream to Bun:** the transpiler cache key ignores whether a file was compiled as a test (see `quirks.md`).
- **`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs`.** The one remaining module-level
  mutable global in `operations/`. Consider moving it onto a system per the system-ownership rule.
- **Imagery customizations, like the dataset ones.** The imagery offset is for the session only (Nov 9).
  Some sources always need the same offset, so Bryan could see saving an offset per source in a synced
  setting, the way `RapidSystem` keeps the user's changes to each dataset.
- **Open question:** delete the quarantined `sections/*.jsx` React demo files + `section.ts`/`uiSection`?
- **`design/network-system.md` has its original pre-implementation design appended** after "Implementation
  Status" (a second "Problem", "Goals", "Design", about half the 38 KB), some of it stale (`fetchFn` for
  OAuth, where interceptors are used now). Fold what's still true into the first half and delete the rest.

## From the pre.4 release check (Nov 2026)
Not covered by the check: the QA and photo layers.
- **Startup can't survive a slow CDN.** An asset fetch that hits `NetworkSystem`'s 30 s timeout rejects
  `l10n.initAsync()`, that rejects the rest of startup, and the user gets a blank grey page with no message
  and no retry. Seen when the debug Chrome was worn out; a slow connection would do the same. This used to
  happen with the big NSI files until their fetch was deferred. Known weakness, not fixing now; ideas: retry
  the core asset fetches, show an error with a reload button when `startAsync()` rejects, keep startup going
  without optional assets.
- **Overture IDs aren't stable across loads** (`overture-places:geojson-3159` is numbered as it loads), so
  accept/ignore records and `id=` links to Overture features don't survive a reload. Open question 3 in
  `design/data-ids.md`; the GERS ID is already kept as `props.stableID`, so the local ID could be built
  from it. `API.md` carries a caveat until then.
- **Overture place viewer shows `names:[object Object]`** for nested values (e.g. Brand). Render nested
  objects as their own rows, or JSON.
- **Saved conflation rules still carry `nearDist`/`nearAngle`**, which nothing reads any more. Drop them on
  load (and on save) so old settings stop carrying them around.
