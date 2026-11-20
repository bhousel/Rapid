# Backlog / Future Ideas

Items planned but not yet started.

## Upgrade to osm-auth 4.0
When osm-auth 4.0.0 is on npm (in progress Nov 2026; see its
[CHANGELOG](https://github.com/osmlab/osm-auth/blob/main/CHANGELOG.md)), `OsmService.ts` needs:
- `new osmAuth({…})`: it's a class now, and calling it as a function (our cast in the constructor)
  throws a `TypeError`.
- Drop `client_secret`. Nothing has read it since PKCE (osm-auth 2.2.0), and it's no longer in the
  options type.
- Drop our own `OsmAuthOptions`/`OsmAuthInstance` interfaces, and use the types osm-auth exports
  (`OSMAuthOptions`, `osmAuth`, `OSMAuthError`).
- In `switchAsync`, replace `utilObjectOmit(this._oauth.options(), ['access_token'])` with a plain
  spread. `options()` no longer returns `access_token` (osm-auth #164), so the omit isn't needed,
  and with osm-auth's types it won't compile (`utilObjectOmit` wants a key of the type).
- Login errors are an `OSMAuthError` now (`err.code`, plus `err.status` for HTTP errors). Our
  callers ignore the details, so nothing else should need to change.

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
- **Profiling pass** (see [`design/profiling.md`](../design/profiling.md)): baseline numbers for heap, GPU resources, the worker heap and listeners; a `scripts/profile.ts` that cycles load → edit → `resetAsync()` and reports what grows. Prompted by a 6 GB debug Chrome renderer with a 100 MB Rapid heap after a long driven session (Nov 2026); probably the browser, not measured yet.
- **Rendering cost** has its own design and plan: [`design/graphics-system.md`](../design/graphics-system.md) (frame stats, partial fills without stencil masks, our own line builder, dashed lines, GPU time, and batching casings and strokes with `RenderLayer`).
- **Labels on long lines walk the whole line** (found with `bun run measure`, Nov 18): five transatlantic cables at Smith Point cost 350 ms per zoom change, about 180,000 label boxes each. Clip a line to the view before `placeRopeLabel()` covers it with boxes. Details in `graphics-system.md` section 2.
- **The OSM pass still looks at every vertex once** (`graphics-system.md` section 12, "The vertices that aren't drawn", Nov 19). It used to run each one through the filter, a map and a test; now it asks each for its kind (`OsmNode.vertexKind()`, memoized) and leaves out the ones that only shape their way, before anything else. The pass went from 181 to 134 ms in Užice and from 37 to 25 at Staten Island. What's left is the spatial index returning them and that one question: about 30 ms in Užice. Getting under that means an index that keeps vertices apart from features, with the layer reaching the ones worth drawing through their ways. Also still open from `design/filter-system.md` section 4: remember a vertex's answer in the filter, count the hidden features apart from the pass, build `entity.key` once.
- **A filter that decides the level of detail** (`design/filter-system.md` section 6; Bryan, Nov 19). Leave details out at low zooms and let them appear at higher ones, instead of broad categories that are in or out. A scene as full as the difficult places is unusable to edit in, however fast it draws. Its own project, after `pixi-8.23` lands; the doc has the open questions.
- **CULL pass: what's left** (`graphics-system.md` section 8, Nov 19). The OSM layer skips its pass when only the view moved inside its cull box. Frame pacing is done (section 9), and a deadline on the frame is started (section 10): redrawing features and placing labels can wait for later frames. Making features waits too now (the longest frame of a load at Staten Island went from 753 ms to about 145). Still to do, in a suggested order: (1) the first pass after a load pays for `FilterSystem` matching every entity for the first time (87 ms at Staten Island), and the first DRAW pass with anything in it costs 76 to 128 ms. (2) A frame between passes during a zoom: features can be shown at a zoom they weren't drawn for now, so a held frame could be drawn at a new zoom, in place of the CSS transform. (3) The pass itself at dense places (50 to 65 ms a frame at a new zoom at Staten Island, 270 in Užice), mostly vertices. (4) All layers alike: only the OSM layer checks `needsStyle` and calls `updateFeature()`; the Rapid layer and the other data layers still do a pass every frame; they'd use `keepFeatures()` the same way. (4) ~~Redraw requests that could name their layer~~ done Nov 19 (the photo and QA services, the notes, `VectorTileService`, `RapidDataset`). (5) Small things: vertices appear at effective zoom 16, which depends on latitude, so a north-south pan across that line shows them up to 256 px late; `FilterSystem`'s hidden-feature counts are of the cull box now, not the view.
- **Imagery tiles of the old zoom stay after a zoom out, until something else draws a frame** (seen Nov 19). `PixiLayerBackgroundTiles` keeps tiles it no longer needs for 3 seconds, so they can stand in for ones still loading, and drops them on the first `render()` after that. If nothing asks for a frame after the last new tile arrives, they stay on screen (the sharper tiles of the old view, in the middle) and keep their place in the atlas. A request 3 seconds after the last one would fix it.
- **After a dense place is drawn, the scheduler's queues take another 25 s to empty** (Nov 19). At Staten Island the 20 map tiles have arrived 2.6 s after the page opens and everything is drawn after 8 s, but `scheduler.numPending` stays above zero until about 32 s, for about 5 s of main-thread work in all. Not traced: what the work is (validation is the likely one), and whether it needs to be spread that thin when the user isn't doing anything.
- **GPU time is mostly fixed costs** (`graphics-system.md` section 6, Nov 18). The imagery filter no longer runs at its default settings (it was 2 of about 6 ms a frame). Still to do: render the map without `multiView` and give the minimap its own copy (1.5 to 2 ms); decide whether device pixel ratio 2 needs MSAA (4 ms; compare screenshots).
- **Render groups: what's left** (`scene.md` section 3, Nov 18). The scene's containers are render groups now, which halved the DRAW pass of a pan at Staten Island and made a hover on a line 1 ms instead of 13. OSM polygons are split by map tile too (watch for wrong overlaps at tile edges). Still to do: lines and points are still one group each, a hover on a level-0 line at Staten Island costs 4 to 6 ms (by tile would misorder crossing roads and overlapping pins; not decided); halos could live in the `ui` group. **Lines and points are split by tile since Nov 19** (lines by level, road class and tile; points by tile). Left from that: every render group costs a few microseconds on every frame, and the split added 1 to 2 ms to a frame that only moves the view, at Seattle as much as in Užice (splitting only the big classes of lines would get most of it back); pins that overlap across the edge between two tiles side by side are ordered by tile, not by latitude (1% of overlapping pairs in Užice; watch for it); a load's frames seem to land just past a display refresh and wait for the next (a 24 ms budget plus 9 ms of DRAW), so "drawn after" didn't get shorter.
- **Dashes differ from one load to the next, and after a big zoom change.** Two loads of one build differ in up to 12,000 pixels of a screenshot, all along dashed lines (sidewalks in Seattle), which makes comparing two builds by screenshot noisy. Seen first as: jump from z21 in Bochum to z17.5 in Seattle without reloading, and Seattle's dashed paths have lighter dashes than after a fresh load. Looked at Nov 20 for an easy fix and didn't find one. Ruled out: the features' geometry, the `DashLine` instructions and their texture matrices (identical between loads), the cached dash textures' pixels, the render groups' anchor, and drawing everything again in place (changes nothing). Not ruled out: something in how Pixi batches or samples the repeating texture. One thing that is order-dependent and worth fixing anyway: `DashLine._getTexture()` caches by dash pattern alone, but the texture's height and alpha come from whichever feature asked first.
- **OSM tiles that fail to load aren't retried until the map moves:** `OsmService.loadTiles()` returns early when the view is unchanged. The case that left the map empty after Užice was the API's rate limit (429), and that one is fixed (Nov 19: the status bar says so and counts down, and the view loads by itself when the time is up). Other failures (a 500, a dropped connection) still wait for the map to move.
- **Užice's heap** was 2.4 GB after one load and is 1.69 GB (Nov 19; `graphics-system.md` section 13 has what's alive and what was done). What's left is in "Garbage collection is the longest stall left" below.
- **What's left of Užice's budget** (`graphics-system.md` section 10, "What a frame costs when little is done in it", Nov 19). Looked into and mostly fixed: everything is drawn 15 s after the page opens, where it was 24. Left, biggest first: (1) ~~the points and lines render groups~~ split by tile since (see "Render groups" above); (2) the pass costs 190 to 250 ms there. A hover, an edit, a change of mode, a tile that arrives and a view that leaves the cull box don't ask for one anymore (`graphics-system.md` section 12; the first pan had 8 to 11 passes and has none). A zoom, a filter and the styles still do. The vertices that aren't drawn are left out of the pass early now (134 ms where it was 181); what's left is 71 ms of looking at each shown feature and finding nothing to do, 30 ms of vertices in the index, and 30 of sorting. A zoom follows the cull box as a pan does since Nov 19 (its frame is 66 to 83 ms of APP, was 210 to 230). The frame that crosses a whole zoom level is 80 to 140 ms since the features move a tile at a time (`_retile()`; it was 250 to 420). Left of that: following the box is 12 to 24 ms of a zoom frame and 5 to 19 of a pan's (after a pan the spatial index says what the box left behind, since Nov 20; what's left is mostly the index's answer for what it moved over, every vertex included); labels are placed in one frame after a zoom (37 to 55 ms, half of it `getBounds()` for every point in `gatherAvoids()`), and are gone until then; everything is drawn again 0.1 to 0.5 s later than with a pass.
- **Garbage collection is the longest stall left** (Nov 19; `graphics-system.md` section 13). A major collection is 420 to 480 ms of the main thread in Užice, every 12 s of zooming (it was 530 to 650 ms, every 9 s). A page can't schedule it. Done: Pixi objects are destroyed where they're replaced, polygons drop the geometry they don't show, hit buffers are worked out when needed. Left, by size: (1) Pixi's line builder is a quarter of what a zoom allocates, most of it `round` joins and caps (try `bevel` and `butt` for lines a few pixels wide: a visual decision; or the line builder of our own); (2) the 1.7 GB alive (it was 2.26; nodes build their `Geometry` when asked, parts lost their closures, polygon features make their Pixi objects per level of detail): every feature keeps a full copy of its style (51 MB; features of one kind could share one, if `styleMatch()` returned the same object for the same answer); a way's part keeps its coordinates three times as arrays of pairs (`Float64Array`s would take a quarter); a `Geometry` and its part each keep their own `Extent`s; (3) Pixi's `syncShader` polyfill allocates on every draw call (5%; upstream); (4) a tile label string per feature drawn (4%); (5) whether the scheduler's long tail after a load leaves V8 idle time to collect in.
- **Merging a tile of OSM data blocks the main thread** (Nov 19; `graphics-system.md` section 12, "Seen on the way"). `EditSystem._mergeEntities()` takes 80 to 134 ms for a dense tile in Užice (10,000 to 15,000 entities), outside any frame and any scheduler task: 0.9 s of a 5 s pan, and its longest gaps now that the passes are gone. Not looked into: what the time is (the graph, the spatial index, the geometry), and whether a tile can be merged in parts.
- **Validators mark entities as edited for every graph** (Nov 19; `graphics-system.md` section 12, "Seen on the way"). `crossing_ways` and `outdated_tags` run a fix on a scratch graph, whose commit calls `Graph._markTopologyChanged()` for the whole lineage. After loading Užice, 1,438 entities nobody edited have answers that can't be memoized (`geometry()`, `vertexKind()`, `isEndpoint()`). Cheap today. Options: a scratch graph outside the lineage's bookkeeping, or not counting a change of tags as a change of topology.
- **The pass asks each entity for its geometry twice and puts each in a `Map`** (list item 5; Bryan, Nov 20: backlog). About 30 ms of the 134 ms pass in Užice: once in `FilterSystem.filterScene()`, once to sort by kind. It matters for a filter or a change of style now; pans, zooms, edits and hovers don't do a pass.
- **Labels are placed in one frame, and are gone from a zoom until then** (list item 7; Bryan, Nov 20: backlog). 37 to 55 ms in Užice after the features in view are drawn; about half is `gatherAvoids()` asking Pixi for the bounds of every point (`getBounds()`), a quarter placing the points' labels. Bryan's condition for any change here: labels are placed around points and vertices, so they must wait until those are drawn, also now that drawing is spread over frames and done without a pass. They do wait (`numWaitingInView`, which counts what arrived and hasn't been looked at since Nov 20). A placement spread over frames would need the same guarantee for each part.
- **Every render group costs a few microseconds on every frame** (list item 9; Bryan, Nov 20: backlog, not sure how to avoid it). The split of lines and points by tile added 1 to 2 ms to a frame that only moves the view (580 groups in Užice). Pixi walks every group to update its transform and replay its instructions, whether or not it's on screen. Ideas, none tried: no container per tile for a class of lines with a handful of members; hide (`visible = false`) the tiles outside the view, so Pixi skips them.
- **Features keep a full copy of their style, and matching makes two** (list item 11; Bryan, Nov 20: "this could be better"). `styleMatch()` returns a copy, and `feature.style =` merges it with the defaults into another: 14% of the APP time of making features, and 51 MB alive in Užice. History (Bryan): `styleMatch()` once returned the base style by reference, and rendering changed it by accident; the copy was the fix. The layers still change what they get (`markerStyle.marker.image = 'pin'`), so sharing needs either frozen styles and layers that build their overrides apart, or a cache of the finished style per kind of feature.
- **The frame budgets are first guesses** (list item 12). `APP_BUDGET_MS` 6 while the view moves, `STILL_BUDGET_MS` 24 once it's still, at least half of the last frames' cost, at most 50; `MIN_NORMAL_MS` 4 for the scheduler's tasks; batches of 64 features to make, 1,000 arrivals, 4 tiles to move. Each was picked once on an M4 at 120 Hz and never swept. A slower machine or a 60 Hz display may want others, and a load's frames at 24 + 9 ms land just past two refreshes of a 120 Hz display (33.3 ms) and wait for the third, where 22 ms would fit in two. Worth a sweep with `bun run measure` on a second machine before tuning.
- **Budget frames by the display's refresh, and show the misses** (Bryan, Nov 20). The page can see the display's timing: the timestamp each animation frame is called with is the refresh it's for, so the gaps between them give the refresh interval (8.3 ms at 120 Hz) and every gap of two or more intervals is a missed refresh. `SchedulerSystem` could measure the interval and set a frame's budget so that APP plus the expected DRAW ends just before a refresh, not just after one (a load's frames are 24 + 9 ms today: four refreshes and a bit, so five). The Rendering card could draw a bar per refresh with the missed ones marked, as SGI Performer's statistics did (Bryan's reference for frame stats). Bryan will try the branch on other hardware for the budget numbers above.
- **The other layers still do a pass on every frame** (list item 13; Bryan, Nov 20: worth doing, those layers will show a lot of data too). Only the OSM layer keeps its features (`keepFeatures()`), follows the cull box, and takes arrivals and edits without a pass. The Rapid layer, the photo layers and the data layers gather and visit everything on every frame, including each one of a pan. They've been light in testing because the test places are dense in OSM data, not in theirs. The Rapid layer first: it draws the same kinds of feature with the same classes.
- **The footer's count of hidden features is stale** (list item 18; Bryan, Nov 20: backlog). It's counted during the OSM layer's pass, and pans, zooms, edits and arrivals no longer do one, so it shows what the last pass saw (after a load in Užice: nothing, until something asks for a pass). Count it apart from the pass, when `UiFilterStatus` renders (`design/filter-system.md` section 4).
- **A line builder of our own** (list item 22; Bryan, Nov 20: backlog, "though I really want this"). `design/graphics-system.md` sections 4 and 7. Since Nov 19 there's another reason: Pixi's line builder is a quarter of what a zoom allocates, most of it round joins and caps, and that garbage is what brings the half-second collections (section 13).
- **The e2e browser isn't a Mac to Rapid, even on one** (found Nov 20, after two wrong guesses about a flaky test). `utilCmd()` turns `⌘Z` into `⌃Z` unless the user agent says Mac, and headless Chromium's doesn't. Playwright's `ControlOrMeta` goes by the machine, so on a Mac it presses a key that isn't bound. `draw.test.js` asks the page which key is bound. Any new test that presses a shortcut has to do the same. Left over: `UiPresetList` has its own undo (either key, while its search field is empty and focused), which `inEmptyFields` on the binding now covers; it could go.
- **Scene follow-ups** (see [`design/scene.md`](../design/scene.md) section 3): reordering spatial IDs (lift OSM while drawing, or a layer-order UI), now that each spatial container has an explicit `zIndex`; and hit-testing by geometry instead of Pixi, which would make snapping independent of stroke width and z-order.
- **Text rasterization without Pixi.Text**: move text drawing onto an `OffscreenCanvas` worker, or bypass `Pixi.Text` with main-thread canvas2D rasterization first. Main thread can feed the resulting `HTMLCanvasElement`, `ImageBitmap`, or `ImageData` to `PixiTextures.allocate('text', ...)`, avoiding both nested `renderer.generateTexture()` and `readPixels`. Worker font loading needs the same fonts; use `FontFace` API + transferable `ArrayBuffer`.
- **Tile padding off-thread if measurable**: `_fromEdgePaddedCanvas()` does two canvas draws per tile on the main thread. If profiles show it matters, build the edge-padded tile source on a worker `OffscreenCanvas` and transfer an `ImageBitmap` back; GPU upload still stays with the Pixi renderer unless the renderer itself moves off-thread.

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

## Renderer: classify a node only when it's dirty
(Nov 19: `OsmNode.vertexKind()` is one memoized answer for the vertex questions now, and passes are
rare: a drag, a hover and a pan don't do one. What's below is about replacing the memos.)
`PixiLayerOsm` asks every visible entity for point, vertex, line or area, and every vertex for
`isEndpoint` and `isIntersection`, on every frame (about 40k answers per drag frame on 13,600
entities in Seattle). It always has: neither `.v` (rebinding) nor `feature.dirty` (restyling) ever
gated it, only memos on the entities made it cheap. A drag frame is about 6 ms with them, about 10
without (graph-geometry step 7). Keeping the answers in the layer for staging, recomputed when
`dirtyData` names the entity, would let the graph memos (and the lineage's set) go. How much it saves
over today's memos isn't measured.

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

## More end-to-end tests
`test/e2e` landed Nov 18 with six tests (`test/e2e/README.md`). Next, each its own PR:
- **Saving**, with the upload stubbed (tests never log in to OSM).
- **The issues panel** showing a validation warning for an edit.
- **Startup with the OSM API unreachable.** Rapid can't start today (see "Startup can't survive a slow
  CDN" below); a test would show it, then confirm the fix.
- **The modal stack and Esc/Backspace routing** (`UiSystem`, `KeyboardSystem` document listeners), which
  happy-dom can't cover: the nested Rapid dataset modals (catalog, add custom data, color picker).
- **The QA and photo layers**, which the pre.4 release check didn't cover either.
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
