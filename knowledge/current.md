# Current Work

## `main`
`conflation-system` merged into `main` (PR #7, Nov 16), for testers, before the multiselection design
(`backlog.md`). The version is 3.0.0-pre.4 (Nov 18, `package.json` and `Context.ts`); no tag yet.
Follow-ups from the release check are in `backlog.md`.

## Active: dependency upgrades (from the Nov 18 checkup)
Landed on Nov 18 (see `completed.md`): the first batch, CDN pins from `package.json`, maplibre-gl 6, and
the e2e tests. Careful with `cloc`: its real versions end in `-cloc`, so `bun update` "upgrades"
`2.12.0-cloc` to a 2022 `2.11.0`.

Still to do, in about this order:
- **CI:** `build` and `e2e` run on pushes and PRs to `main`. `deploy` and `pages` are disabled by hand in
  the Actions UI; `deploy.yml` still has Bun 1.3.6, a plain `bun install`, and Facebook's AWS role and S3
  bucket. Left as is on purpose (Bryan, Nov 18): it won't work, and that's fine for now.
- **Bryan's own packages, all ESM-only now:** country-coder 6, location-conflation 4, osm-community-index 7
  (needs location-conflation 4), node-diff3 4 (`===` comparison, stricter `MergeRegion` type in
  `merge_remote_changes.ts`), osm-auth 4 (plan in `backlog.md`; also `err.responseText` in `UploaderSystem.ts`
  becomes dead, since the body is `err.message` now). Wait for `bunfig.toml`'s 3-day window (osm-auth 4.0.0 is from
  Nov 17), or add osm-auth, node-diff3 and osm-community-index to `minimumReleaseAgeExcludes`.
- **id-tagging-schema 7.3 + name-suggestion-index 8, together** (NSI 8 needs schema 7; we already call
  `buildIDPresets()`). NSI 9 (ESM-only, its own `Preset` types) is in NSI's changelog but not on npm yet.
  **Not with pinhead 16:** schema 7.3 uses 4 icons pinhead 16 renamed (`bagel_seeded`,
  `person_running_after_person`, `person_squatting_and_person_reaching_up`,
  `person_wearing_martial_arts_belt_front_kicking`), and `build_data.ts` drops missing icons silently.
- **pixi.js 8.23 (branch `pixi-8.23`, Nov 18).** Bumped; the only change needed was turning off Pixi's
  accessibility layer, which 8.22+ turns on when Tab is pressed (then walks the scene every frame). Checked
  glow and imagery filters across renderer resizes (the 8.21/8.22 regression).
  **`DashLineShader` measured (Nov 18, downtown Seattle z17.5, 2,921 features, 814 dashed footways, M4):**
  swapping those strokes for `SmoothGraphics` + `DashLineShader` took draw calls per frame from 771 to
  2,368 and the DRAW pass's CPU time from 0.8 to 3.0 ms, with no visible difference at that zoom (MSAA on).
  It also supports only one dash and one gap (our boundaries and barriers use four values) and advises
  against round caps. Fine for halos (few), not for styled dashes; `DashLine.ts` stays.
  **The real draw-call cost is the partial area fills:** each is masked with a stencil, so 177 masked fills
  made 707 of the 771 draw calls (64 without masks). GPU time was ~9 ms a frame in all three cases.
  **Next: [`design/graphics-system.md`](../design/graphics-system.md)** (Nov 18), the measurements and the
  plan: frame stats first, a set of difficult places to measure on, then our own line builder for
  partial-fill bands, hit areas and dashes. Steps 1 (frame stats), 2 (`bun run measure` over
  difficult places), 3 (GPU time: mostly fixed costs, see section 6), 4 (the rendering info card,
  ⌘⇧F) and 5 (the `RenderFrame` passed to the layers, which report their work on it) done. Also:
  the imagery filter no longer runs at its default settings, the scene's containers are render
  groups, each at an anchor near the view, with OSM polygons split by map tile (`design/scene.md`
  section 3), and the OSM layer has a CULL pass (Nov 19, `graphics-system.md` section 8):
  it has features ready for the view plus 256 px, and skips its work on frames
  where only the view moved inside that. A pan frame at Staten Island went from about 50 ms to 3.
  `FilterSystem` got quick fixes and a design doc (Nov 19, [`design/filter-system.md`](../design/filter-system.md)):
  its step of the OSM pass is a third of what it was (Staten Island's pass 55 → 32 ms). Its rethink
  (level of detail) is for after this branch.
  **Frame pacing replaced the 250 ms throttle** (Nov 19, `graphics-system.md` section 9):
  a frame that only moves the view is drawn on the next tick, and a frame with a
  pass to do waits twice what the last one cost (at most 250 ms), with held frames moving the view
  meanwhile. A drag at Staten Island draws 29 frames a second (one per pointer event) where it
  drew 4, and loading takes the same time.
  **A deadline on the frame** (Nov 19, section 10): a zoom no longer
  works out every feature's style again (`feature.needsStyle`, `scene.dirtyTransform()`), and
  features are drawn again over several frames when one frame has no time for them
  (`updateFeature()`, `continueWaiting()`); labels wait for them. A zoom's frame went from 147 +
  30 ms to 17 + 10 in Seattle, and from 334 + 47 to 64 + 18 at Staten Island.
  **Baselines** (Nov 19): `bun run compare` measures any editor from outside,
  and `graphics-system.md` section 11 has this branch against `main`, Rapid 2.5.7 and iD 2.42 at
  Seattle, Staten Island and Užice. A pinch at Staten Island: 50 frames a second on the branch,
  18 on `main`, 8 in iD. Nine of the twelve places aren't measured (the OSM API's rate limit).
  **The rate limit bar is back** (Nov 19): a 429 from the OSM API shows the
  red status bar with its countdown again, and the view loads by itself when the time is up
  (`OsmService.setRateLimit()`, `_rateLimitEnded()`). It had been cleared by its own status check
  since Sept 2025.
  **Making features waits too** (Nov 19): `PixiLayerOsm._waitToMake()`, and
  the budget is bigger (24 ms) when the view is still and the scheduler idle. The longest frame of
  a load at Staten Island went from 753 ms to about 145.
  **Užice's budget** (Nov 19, section 10 "What a frame costs when little is
  done in it"): everything is drawn 15 s after the page opens there, where it was 24 (`main`:
  10). The extra time was 27 passes that made nothing (each icon's texture asked for a redraw of
  everything; now `scene.texturesLoaded()`), a budget that never grew (it waited for an idle
  scheduler, whose queues the frames' own `draw` listeners kept full; now it goes by the view,
  and `SchedulerSystem` gives normal tasks 4 ms of every tick), and bookkeeping that grew with
  the waiting work. What's left is in `backlog.md`.
  **OSM lines and points are split by map tile** (Nov 19, `scene.md` section
  3), each tile's container with its own render group, as polygons were: lines by level, road
  class and tile (the order between classes is kept), points by tile (from north to south between
  rows; side by side, the eastern tile is on top). In Užice a changed line or a new point costs 8
  ms of DRAW where it cost 35, and the first pan there draws 20 to 31 frames a second where it
  drew 18. A frame that only moves the view costs 1 to 2 ms more, everywhere. Tiles are ordered
  by row and column now, and lines of one class by ID, so the picture is the same on every load
  (two loads used to differ in up to 34,000 pixels).
  **Measure dense places from a tape** (`--tape file.tape.json` on `bun run measure` and
  `bun run compare`, `scripts/tape.ts`): the OSM API answered 429 again after five loads of Užice
  in an hour and a half. A tape of Užice (119 MB, not in the repo) has to be recorded once on each
  machine.
  **Goal now: get `pixi-8.23` merged**, keeping to Pixi and `GraphicsSystem` work (Bryan, Nov 19).
  **A hover without a pass** (Nov 19, `graphics-system.md` section 12): every
  hover asked for a redraw of everything, and a pass in Užice takes 207 ms. Now
  `scene.setClass()` tells the layers which data changed class, the OSM layer draws that data
  again on a frame where it keeps the rest (`_renderChanged()`), and the caller asks for a frame
  (`gfx.requestFrame()`). Also found: Pixi's `globalMove` and `wheel` events were never off (the
  option was passed as `events`, Pixi reads `eventFeatures`), so every pointer move walked the
  scene (50 ms in Užice). Moving the pointer across Užice for 4 seconds took 37 s, and takes 5.
  **An edit and a change of mode without a pass** (Nov 19, same section):
  `MapSystem` passes what an edit affects to `scene.dataChanged('osm', …)`, `Context.enter()`
  asks for a frame, and `FilterSystem.forceVisible()` and `PhotoSystem` tell the scene what
  they change. Dragging a vertex in Užice for one second took 14 s (61 passes) and takes 1.5.
  Checked against a full pass after 110 edits, 64 changes of mode and 74 hovers: nothing shown
  differs.
  **A tile that arrives and a cull box that moves, without a pass** (Nov 19, same section): `MapSystem` passes what a `merge` lists to `scene.dataArrived('osm', …)`, and
  the OSM layer draws it in batches while its frames have time. When the view leaves the cull
  box, the layer hides what the new box doesn't reach and asks the spatial index for the strips
  it moved over (`_moveBox()`). `FramePacer` lets a pass for arriving data wait up to a second,
  and the photo, QA and vector tile services name their layer. The first pan in Užice had 8 to
  11 passes of 205 to 250 ms and has none (36 to 39 frames a second, was 28 to 34); the frame
  where the box moves costs 29 ms of APP there, was 195. Checked against a full pass after the
  load and eight pans: nothing shown differs.
  **The vertices that aren't drawn are left out of the pass** (Nov 19, same section): `OsmNode.vertexKind()` says in one memoized answer whether a node is tagged, where
  ways end or intersect, or only shapes its way. The pass drops the last kind before the filter
  sees them and adds the ones related to the selection afterwards; arrivals skip them too. The
  pass went from 181 to 134 ms in Užice, and the frame of a zoom from 262 to 210. Eleven
  situations checked against the build before: the same features and the same filter counts.
  **A zoom without a pass** (Nov 19, same section): the OSM layer keeps its
  cull box through `dirtyTransform()`, follows the box on the frame of a zoom or rotation, and
  runs what stays through `render…()` again over the next frames. When the view crosses a whole
  zoom level it moves every feature to its new tile container at once (`_placeAgain()`). The
  frame of a zoom in Užice went from 210 to 230 ms of APP to 66 to 83, and the longest animation
  frame of a jump from 200 to 50 to 67. Everything is drawn again 0.1 to 0.3 s later.
  **Crossing a whole zoom level, a tile at a time** (Nov 19, same section):
  the features move to the new zoom's tile containers a whole old tile at a time, over the
  frames after the zoom (`_findOldTiles()`, `_retile()`, `_setTile()`). The frame that crosses a
  level costs 80 to 140 ms where it cost 250 to 420. Following the box skips the lookups for
  features that are still in it (10 ms of a zoom frame, was 30). Traced: the frames of 250 to
  710 ms that are left during zooms are major garbage collections, half a second each.
  **Garbage** (Nov 19, `graphics-system.md` section 13): a major collection
  is 400 to 650 ms of marking on the main thread, and a page can't schedule it, only make less
  garbage and keep less alive. Pixi kept everything a polygon had drawn in the last minute
  (strokes removed but not destroyed, mask geometries replaced), and polygons kept geometry
  they didn't show: the heap went from 2.27 GB to 3 after some zooms, and stays at 2.35 now.
  `BufferHitArea` works out a line's hit buffer only when the pointer is near (19% of what a
  zoom allocated). Sixteen zooms: 3 major collections where there were 6.
  **A smaller heap** (Nov 19, same section): a node's `Geometry` is built
  when it's asked for (one node in five has one after a load), `GeometryPart`'s lazy products
  are getters on classes (a way's part is 1.5 KB, was 3.1), and a polygon feature makes its Pixi
  objects for the level of detail it's at. Užice after a load: 1.72 GB, was 2.26. A major
  collection is 340 to 400 ms now, every 15 s of zooming. Points make their icon sprite and
  lines their casing only when there's one to draw, and features share the default style until
  they get their own (1.69 GB).
  **⌘Z and ⌘⇧Z work from an empty text field** (Nov 19; Bryan's decision,
  `keyboard-system.md`): the sidebar's search fields take the focus by themselves, and a key
  in a field wasn't a shortcut, and the feature list's search field had no way to undo from it. (`draw.test.js` failing one run
  in three turned out to be the test pressing ⌘Z in a browser where undo is ⌃Z: see `backlog.md`.)
  **Baselines measured again** (Nov 20, `graphics-system.md` section 11, from tapes): in Užice the branch pans into unloaded data at 38 to 44 frames a second
  (`main` 12, Rapid 2.5.7 18), a pinch takes 2 s (`main` 32 s), and everything is drawn 12.5 s
  after the page opens (`main` 11.2). A tape answers any editor now (`scripts/tape.ts`).
  Also Nov 20: after a pan the spatial index says what the cull box left behind;
  moving over nodes doesn't build their geometry; labels wait for what arrived.
  Bryan's calls on the list (Nov 20): 5, 7, 9, 18, 22 to the backlog (all there now, with the
  things found on the way); 13 (other layers keep their features) and 11 (styles) worth doing;
  20, 21, 23 not now.
  **`pixi-8.23` is merged** (PR #10, Nov 20). On branch `label-avoids`: labels
  avoid each point again, not each tile of points (`gatherAvoids()`; broken since the points
  were split by tile), with a DOM test and an e2e test.
  Next: what's left of the garbage (Pixi's line builder with round joins is a quarter of it;
  `syncShader`), the 1.7 GB alive (a copy of the style per feature; ways' coordinates as
  arrays of pairs), labels placed in one
  frame (50 ms, half of it `getBounds()` for every point), following the box by the spatial
  index, what's left of the pass for a filter or a
  change of style (71 ms of looking at each feature), the other layers, merging a tile (80 to 134 ms on the main thread, the
  longest stall of a pan), and the heap (2.1 GB live in Užice: the rare long frames come with a
  major garbage collection).
  Fixes found along the way are in `backlog.md` ("Pixi rendering follow-ups").
- **Regression from the CDN pins: road fields missing.** At runtime the tagging schema went from 6.6 to
  6.19.2, where `sidewalk`, `cycleway`, `parking/side/parking` and `parking/side/orientation` have type
  `directionalCombo`, which Rapid doesn't support (iD's rename and generalization of the `cycleway` field;
  Rapid's `UiFieldCycleway` is the old one). `SchemaSystem` drops them, with an "Unable to resolve
  referenced fieldID" warning. Also unsupported in 6.19: `date` (5 fields) and `colour` (3). Later.
- **Hold:** cldr 49 (drops 109 locales, e.g. `dv`, `nv`, `pap`, `skr` lose native names in `languages.json`).
- **Left in `bun audit`:** postcss 5 via `postcss-selector-prepend`; picomatch via `esbuild-visualizer`
  (both build-only).
  Dependabot alerts are off for the repo.
- **Old branches (Nov 18):** local branches and worktrees cleared, and ~67 old branches deleted from the
  fork (merged, Dependabot, or identical on facebook/Rapid). Left to look at: `overture_sidebar` (Dec 2024,
  unmerged), `release` (2.5.x) and `upstream` (Jul 2025).
- **`RELEASE.md`** still describes Facebook's release flow (`deploy.yml`, facebook/Rapid links).

## Active: matching third-party data against OSM (`ConflationSystem`)
Top priority. Design: [`design/conflation-system.md`](../design/conflation-system.md) (Steps 1–6 first
version done; the doc awaits Bryan's final review). Guiding use case: *accept the part of the sidewalk
that is missing, and join it to the part that exists.*
- **Step 6, Conflation Settings UI, still to do:** per-side `props` editing, live counts, live tuning
  (see "Rapid dataset UI: live tuning" in `backlog.md`), and even column widths in the rules table.
- **Known bugs:** six from the second bug hunt (items 6, 8, 9, 23, 24, 25), listed under "Known bugs" in
  the design doc.
- **Open questions** (in the doc): require a data mapping or only warn; default rules that match any
  line; lock `isID` once the user has acted on a dataset (`design/rapid-system.md`).
- Stable IDs and acted ranges haven't been tried in the browser yet.
- A real short stub next to a matching sidewalk now counts as already mapped (side effect of Step 5b).
- More demo feedback expected as people use it; likely requests are in `backlog.md` ("Conflation: what
  JOSM users will ask for").

## Active: what an edit records (`EditSystem`)
Design: [`design/edit-system.md`](../design/edit-system.md). Steps 2–5 done. Next: step 6 (edits that use
external data on OSM features), when Bryan picks it up. PR #5's `EditSystem.dataVersion` fits here
(the "did data change?" question); not landed.
