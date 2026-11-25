# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## Testing: happy-dom for components, Playwright for the real app (Nov 2026)

- **Component tests stay on Bun + happy-dom (`test/dom`), not in a real browser.** They need a DOM, not
  a browser, and run 200 tests in about 2 s. Runners that put them in a real browser (Vitest browser mode,
  Web Test Runner) mean a new toolchain and slower tests, to fix a few happy-dom gaps. Rejected: keeping
  the mocha page (`test/index.html`), which had drifted to 18 of 38 files and wasn't run.
- **E2E tests use Playwright Test directly** against the dev build, because what they catch only exists
  in a real browser: WebGL, workers, the CSP. The MapLibre 6 worker bug passed all 4,149 unit and DOM tests.
- **E2E network: record and replay with a HAR, not hand-written fixtures.** Real responses, refreshed with
  one command (`E2E_RECORD=1`). The CDN stays live: its assets are many MB and are what users load anyway.
  Unknown hosts are blocked, so a test can never reach a live service by accident.

## CDN versions come from `package.json` (Nov 2026)

- **The files Rapid loads from the CDN are pinned to the versions in `package.json`**, through
  `utilCDNPath()` in `modules/util/dependencies.ts`. Hand-written pins had drifted from what was installed
  and tested (MapLibre 5.15 at runtime, 5.24 installed). `@latest` was rejected: a new major release
  would reach users before anyone tested it.
- **The exact version is the range's lower bound** (`^6.18.0` → `6.18.0`). `bun update` rewrites the lower
  bound to the installed version, so they stay equal as long as upgrades go through `bun update`.
- **Importing `package.json` puts its `dependencies` in the bundle** (`devDependencies` get tree-shaken
  out). A small cost, accepted for one source of truth.

## The scene (Nov 2026)

The structure and the reasoning are in `design/scene.md`; these are the choices someone might undo.
- **Interactivity is switched per spatial ID at the container level, not per feature or in the
  behaviors.** Pixi skips a whole subtree with `eventMode: 'none'`, so the OSM line under a Rapid line
  is hit directly and no behavior or mode changes. A per-feature flag would run per frame in every
  layer; a fall-through hit test in the behaviors would re-test on every pointermove and still show
  the hover halo on the wrong thing.
- **The mode declares it (`interactiveSpatialIDs`), beside `enableBehaviors`.** The alternative, each
  of 18 layers knowing which modes it's interactive in, spreads mode knowledge everywhere.
- **Points sort by latitude only within their spatial ID.** A Rapid pin north of an OSM pin now draws
  over it. Accepted: "external data above OSM" is the rule for every geometry, and the alternative is
  the shared container we're replacing. Dense point datasets (NAD addresses) will show it.
- **No reordering while drawing.** With the datasets non-interactive the OSM line is reachable anyway;
  lifting OSM visually is a preference for a layer-order UI later (`zIndex` per container makes it cheap).

## Meshes that change get a fixed batch mode (Nov 2026)
Pixi's `'auto'` batch mode batches a `Mesh` up to 100 vertices, and one that crossed that line in a
frame where its tile was rebuilt crashed Pixi (pixijs#12437, Rapid#1636). Chosen: `batchMode = 'batch'`
on the geometry of every mesh whose geometry we replace (found with the masks that partial fills had,
which are gone; every `LineMesh` now), which measured the same as `'auto'`.
Rejected: `'no-batch'` (about 1 ms more DRAW a frame in Seattle, where 261 of 300 masks were batched),
and replacing the mesh when `batched` would change (the old #1636 workaround; more code, and only
keeps `'auto'`'s batching). Revisit when Pixi fixes #12437.

## Partial fills are bands of real geometry, offset by Clipper2 (Nov 2026)
A partial fill fills the part of an area within 32 pixels of its edge. That was a full fill under a
stencil mask (a stroke along the inside of the edge); it's now the band itself, as polygons
(`geomAreaBand()`): the area minus the area shrunk by 32 pixels. Chosen for the shrinking and its
cleanup: `clipper2-ts`, a TypeScript port of Clipper2 (18 KB gzipped, BSL-1.0, pinned to an exact
version: its versions look like prereleases). Measured on every partial fill of three dense views
(`design/graphics-system-log.md` section 15, step 5).
Rejected: `clipper2-wasm` (twice as fast, but 96 KB, an asynchronous start, and it needs
`'wasm-unsafe-eval'` in our CSP), `clipper-lib` (Clipper 1, unmaintained since 2019), `clipper2-js`
(wrong answers on our data), and writing the cleanup ourselves (it's a sweep-line clipper: what
Clipper is). An inside stroke without cleanup (option A in section 4) pokes out of narrow areas and
covers pixels twice.
Most partial fills have no middle at that width and are filled whole, which a polygon's `inradius`
says before Clipper is asked. Bryan asked for the trial, and agreed to `clipper2-ts` (Nov 23). Keep
`clipper2-wasm` in mind for later; he doesn't want to relax the CSP for it now.

## The OSM layer finds its own features under the pointer (Nov 2026)
Pixi's hit test asks every interactive container in the scene on every pointer event: 8 ms in
Užice. Chosen: the layer asks the editor's spatial index which entities are near the pointer, then
each of their features whether it's hit, by Pixi's own rules for one container (`containerHit()`),
and takes the one drawn on top (`drawOrder()`). The scene compares that with Pixi's answer for
everything else (`PixiScene.hitTest()`), and `PixiEvents` puts the feature on the event. So the
feature that's found is the one Pixi found (checked at 86,400 points), in 0.07 ms. (Lines answer
by their distance from the pointer since they left the scene; the rest as before.)
Rejected:
- **A hit test with rules of its own** (the nearest line, vertices before lines): it changes what
  a click selects and what a drawn line snaps to. That's the redesign of hover and snapping in
  `design/scene.md` section 4, not a performance change.
- **A hit area on each tile container,** so Pixi's walk skips the tiles away from the pointer:
  a few lines, but a feature without display objects (the static tier) has nothing for Pixi to walk.
- **Remembering the answer per event on the scene:** Pixi reuses its event objects, so the event
  isn't a key. `PixiEvents` asks once and puts the answer on the event it passes on.
- **A fixed reach around the pointer** (a pin is 28 pixels tall): styles can make markers and
  casings any size. Each feature says how far it can be hit from its geometry (`hitReach`).

## The OSM layer's lines are drawn in batches, with a shader of our own (Nov 2026)
Section 15 of `design/graphics-system-log.md`, step 6, and "Batches" in `design/graphics-system.md`. A `LineBatchMesh` is one `Mesh` whose shader places
each vertex for the line's width in pixels at the current zoom. Choices someone might undo:
- **Two batches for each level: every casing, then every stroke** (Bryan, Nov 23). Where roads
  meet, neither's casing crosses the other's stroke; he judged the few pixels of difference
  unnoticeable or better. In a batch the order is road class, then way ID.
- **No tiles and no road classes among the batches.** The first cut had a batch per level, class
  and zoom 14 tile (83 in Užice); it's 16 now. Bryan: draw calls count whatever the M4's
  timings say, since many users have weaker hardware. The price is a large index buffer built
  again when a line joins or leaves (81 ms of the 5 s that making all of Užice takes), and a
  batch whose place in the world has to follow the view (`moveOrigin()`), since nothing else
  keeps its 32-bit floats small.
- **How a line is drawn is in each of its vertices** (width, least width, color, opacity, dashes:
  16 of a vertex's 56 bytes), so one draw call serves any mix of styles and dashes need no
  texture. A style table in a texture would make vertices smaller; not measured.
- **A line that its batches draw isn't in the scene,** though its feature keeps a `Container`
  (position, `zIndex`, visibility). Taking the container out of `AbstractPixiFeature` is a
  larger change, and being out of the scene is what Pixi's cost came from.
- **The editing tier is a hovered or highlighted line only:** its glow is a filter on its
  container, so it draws itself there meanwhile. A dragged or selected line stays in its
  batches: a drag measured the same either way.
- **Dashes the vertex can't hold** (more than four numbers, fractions, over 255 pixels) fall back
  to `LineMesh`es with a dash texture. None of Rapid's styles has one.

## Every layer that draws data draws in batches (Nov 24, 2026)
Section 16 of `design/graphics-system-log.md`. Choices someone might undo:
- **One way for any layer** (`AbstractPixiLayer.updateFeature()` with a container, and `useBatches`), with each
  kind of feature knowing which batches it takes (`placeInBatches()`), not a copy of the OSM
  layer's placement in each layer. The OSM layer still places its features in its levels and
  tiles itself, with the same `placeInBatches()`.
- **A layer's own hit test is an R-tree of what it drew** (`_featureIndex`), written when a
  feature's box changes. Not the data's spatial caches: the Rapid layer draws data from
  services' graphs and line pieces that aren't in one, and a feature's box is what it's hit by.
- **The edit blocks are left out:** they draw into a group (no spatial container, so no anchor
  near the view for a batch's floats, and no spatial ID to hit-test by), are never interactive,
  and are seldom there.
- **More draw calls, fewer containers:** 25 → 28 in Bellevue with every layer on, since each
  layer has its own batches where Pixi merged sprites across layers. It's what took a pan's
  DRAW from 22.6 to 1.5 ms and Pixi's hit test from 1.8 to 0.006 ms.
- **They keep their features while only the view moves, follow the box by gathering the strips it
  moved over** (`_gatherExtents()`, sections 17 and 18 of the log), and do their whole pass for
  anything else: a class on their own data (a hovered photo), a zoom, data that arrived. The OSM
  layer's ways of doing those without a pass (`_renderChanged()`, `_renderArrived()`) weren't
  copied: the other layers' passes are short.
- **CULL is a stage of its own, run when a frame has time** (Bryan, Nov 24): what a cull box left
  behind is outside the view, so hiding and destroying it waits (`cullLater()`). It goes by what a
  pass would gather (`_gatheredInBox()`), so that a pass after it changes nothing shown. The OSM
  layer still hides what its box left at once, through its index.
- **A service's getter takes an extent** (`getData(…, extent)`), not a box the graphics system
  sets for the frame somewhere the services read: what a layer gathers by is in its own code.
- **`SpatialSystem` says what changed in its caches, and services don't ask the renderer to draw**
  (Bryan, Nov 24; section 19 of the log). Every write is noted and reported once the writing task
  is done (`datachange`), and the scene routes it to the layers that draw from the cache. Rejected:
  an arrival event from each service that its layer listens to (15 services to change, and the
  same thing to forget next time; Mapillary's old `loaded…` events were that, and nothing listened
  anymore); reporting data IDs (the layers gather by extent, not by datum).
- **The OSM layer listens to the editor itself** (`merge`, `stagingchange`), and `FilterSystem`
  clears its own cache; `MapSystem` stopped passing them on.

## Areas are drawn in two batches: fills, then outlines (Nov 2026)
Step 8 of section 15, the first part. Choices someone might undo:
- **Every outline is over every fill** (as iD draws areas). Before, a small area's fill covered
  the outline of the larger one it's in. Not shown to Bryan yet when it was built (Nov 23).
- **Triangles from Pixi's `earcut`** (`PIXI.earcut`, which Pixi exports), not a dependency of our
  own. It keeps `triangulate()` in `modules/pixi/`; if fills are ever built in a worker or
  tested without Pixi, `earcut` becomes a direct dependency (it's in the bundle already).
- **Patterns in one atlas texture, tiled by the shader,** so one draw call draws fills with any
  mix of patterns. A texture array would need WebGL 2; a batch per pattern would lose the
  order between areas. Each cell has a border of the texels that wrap around, for smoothing.
- **No low-resolution sprite for a small area.** A batch draws its real shape at no extra cost
  per object; Užice at zoom 16 has 26% more triangles for it, in 2 draw calls where there were 295.
- **A hovered area draws only its outlines itself,** for the glow. Drawing its fill there too
  would lift it over everything inside the area.
- **Pixi's tickers are off** (Bryan, Nov 23: he wants such things gone from flame charts). The
  events ticker's listener is removed; the system ticker is stopped and gets a turn once a
  second from `GraphicsSystem._tick()`, for Pixi's own scheduler (which frees unused GPU
  resources). If something of ours ever needs `eventMode: 'dynamic'`, the events ticker is what
  made that work.

## Points are drawn in one batch (Nov 2026)
Step 8 of section 15, the rest. Choices someone might undo:
- **One batch for points, vertices and the pins of areas,** from north to south everywhere, the
  ones with viewfields last. The tiles' containers ordered them by row and then by tile, so
  pins that overlapped across a tile's edge could be in either order.
- **The shader sizes the pictures in pixels and keeps them upright,** so a zoom or a rotation
  writes nothing. Below zoom 17 points are smaller and pins are circles: that's in the
  vertices, and crossing 17 writes every point once.
- **A batch draws from one texture: the symbol atlas's first.** It has always been the only one
  (8192 pixels across, or 2048 without `highQuality`). A point with a picture from anywhere
  else draws itself with sprites; several textures in the shader would be the fix if a second
  one ever filled up.
- **What's drawn above everything draws itself:** the vertices and midpoints of what's hovered
  or selected, in the map UI's container, where Pixi's hit test finds them before anything of
  the OSM layer's. A second batch there was the alternative (no sprites made on a hover); the
  sprites are a few dozen for a typical way.
- **A hovered or highlighted point draws itself too,** under its glow, like a line. *(Until
  step 10: its glow is a picture in a batch now.)*
- **A point's sprites are made when it first draws itself,** so `feature.marker` is `null`
  until then. The midpoints used to turn `feature.marker`: they set `markerRotation` now.
- **Labels and the avoid grid ask the point where it's drawn** (`labelBox()`, arithmetic), not
  Pixi (`container.getBounds()`). The two agree to 1e-13 pixels for points drawn with sprites;
  the one difference is that viewfields hidden below zoom 17 no longer count.
- **A photo marker with viewfields that's selected or highlighted is always drawn over the
  others** (`zIndex` 99000). Before, it was only if the class was there when the viewfields'
  sprites were made, and the next redraw undid it.
- **A hovered area's fill changes while it's hovered,** in its batch (`LIT_FILL_OPACITY`, and
  since step 9 `LIT_FILL_TINT`). Bryan (Nov 23): the fill has to change somehow on a hover, or
  users will miss it; he didn't love the old glow over the whole area. The outlines still glow.
- **No hit test when the scene changes under a still pointer** (Bryan, Nov 23: not needed; our
  scene doesn't move, and hovering data that just arrived might surprise the user anyway).

## Line markers are drawn by the lines' shader (Nov 2026)
Step 9 of section 15. Choices someone might undo:
- **A strip in the strokes' batch, not a batch of its own and not the stroke's own pixels.**
  The markers of a line are a second copy of its stroke mesh, 7 pixels wide for arrows and 21
  for sided markers, in the batch that draws the level's strokes, ordered after every stroke.
  That's no draw call more. Drawing them in the stroke's own fragments would need no vertices
  at all, but an arrow is 5 pixels across and a stream's stroke is 3, and a sided marker is
  beside the line.
- **The shapes are formulas in the fragment shader,** in pixels, the same as the textures that
  sprites use (`PixiTextures`). They can't be read off a buffer, so an e2e test compares the
  pixels with the sprites'.
- **No new bytes in a vertex.** A strip's vertices say what they are with a least width of 0,
  and use the four dash bytes for the kind, the spacing, and the side of the line.
- **A marker follows the line around a corner,** where a sprite stuck straight out past it.
  And there's no limit of 100 markers on a segment anymore (it was there for the sprites).
- **Arrows point back along a way tagged `oneway=-1`** (`OsmWay.isOneWayBackward()`,
  `lineMarker.scale: [-1, 1]`). They pointed along the way it was drawn, whatever the tag:
  wrong for those ways. (The midpoints turned around for them too, which was wrong the other
  way: see the next entry.)
- **An area under 20 pixels has no outline in the batch** (Bryan, Nov 23: "at least
  _something_ is drawn, and if a user hovers over it, they will see"; "I'd prefer to draw
  something imperfect than draw nothing that the user can see and risk them thinking there is
  nothing mapped there"). Not in wireframe mode, where the outline is all there is.
- **A hovered area's fill is tinted halfway to the hover's color** (yellow; blue for a
  highlight) and twice as opaque (Bryan, Nov 23: tinted "for now"; what matters today is that
  a user sees what they're hovering). He's seen it since: "looking really good now, I can
  easily tell what's being hovered."

## Hovers and selections are drawn by the shaders, and they move (Nov 2026)
Step 10 of section 15 (Bryan's idea, Nov 23: animated by shader code, so that they don't lean
on color alone, with frames at regular intervals). Choices someone might undo:
- **A midpoint points the way its line is drawn** (Bryan, Nov 23), not the way of travel. The
  arrows show travel. `_gatherMidpoints()` had swapped the nodes for `oneway=-1` since 2022,
  from when the whole line was drawn reversed.
- **A glow is geometry with a distance in it, not a filter.** A strip around the line, faded
  by the fragment shader from the line's edge out, hollow over the line. No blur, no extra
  render target, and the feature stays in its batches.
- **A glow is over everything of its level** (a line's), over every outline (an area's) and
  under every point (a point's). The filter's was at the feature's own place among the
  others. One place for all of them is what a batch of glows gives, and "light on top" reads
  the same everywhere.
- **Glows are in batches of their own,** though that's three more meshes. In the batch of
  what it's around, each hover had that batch's index buffer built again (11 ms in Užice).
- **A halo is two lines,** a dark one under the yellow dashes, so that it shows on any
  background. Its dashes march; a glow breathes. Both are a uniform from the clock.
- **20 animation draws a second, not 60,** because each one draws the whole scene. Enough for
  dashes that move a pixel a frame.
- **The animation gives way:** to a slow machine (it takes a third of the ticks at most, by
  how long the browser takes to come back), to idleness (it rests after 30 seconds without a
  change), and to `prefers-reduced-motion` (it never starts). All three are in
  `AnimationPacer` and `PixiScene.animated`. Bryan didn't ask for them, and kept them when
  he saw the result (Nov 23: "wouldn't change anything about it"). The numbers are guesses.
- **Rejected for now: drawing the still scene to a texture,** and animating over it. It would
  make an animation draw nearly free and allow 60 a second. It's a change to how every frame
  is drawn, and wants numbers from weak hardware first.
- **`GlowFilter` stays for features that draw themselves** in layers without batches. Since Nov 24
  every layer that draws data draws in batches, so that's next to nothing (a line whose dashes a
  batch can't draw).

## Graph versions and derived data (graph-geometry rollout, Nov 2026)

Details and measurements are in `design/graph-geometry.md`; these are the choices someone might undo by accident.
- **Each graph keeps its own shapes; only the base graph writes shapes onto base objects.** Shapes on
  objects that every graph shares made staging's drag change stable's geometry (validation finding 1).
- **The renderer rebinds by object identity, not version numbers.** A changed entity is a new object and
  a changed shape is a new `Geometry`, so identity already says what a `graph.version()` would. Numbers
  would be one more thing to keep right through savepoints, rebases and restores.
- **Data is never changed in place.** Services and editors store `update()`'d copies. `v` stays as a
  stamp `update()` gives each copy, because `key` (`${id}v${v}`) feeds d3 joins (and fed `FilterSystem`'s cache until Nov 19);
  `touch()` and `AbstractPixiFeature.v` are gone.
- **After a rebase, stable and staging catch up at once; other graphs when they become current.** No
  per-read "update on first use" check. Safe because rebase and validators are synchronous, and the only
  graph held across awaits (the uploader's remote graph) reads entities only.
- **The OSM spatial indexes live in `EditSystem`, not the lineage or `SpatialSystem`.** `SpatialSystem`
  stays data-agnostic, and only the editor's lineage should build indexes (since step 8 every rebase of
  it goes through `EditSystem`). If another lineage ever needs versions and searches, pull the
  base-plus-local-index logic into a helper its owner creates. (Bryan tried graphs in spatial caches in
  Aug 2025 and backed it out.)
- **"Local index", not "overlay".** In Rapid an overlay is an imagery layer. "Local" matches
  `graph.isLocal()`: what a graph says differently from the base.
- **No lineages for GeoJSON and markers.** A base-only lineage would hold what the spatial cache already
  holds. Add one when some data needs versions.
- **Step 7 (memos in records) deferred.** After 150 edits only 5–7% of graph-dependent memo reads skip
  memoization (about 0.2 ms a drag frame), but dropping those memos entirely costs about 4 ms a drag
  frame, because `PixiLayerOsm` classifies every node every frame. Backlog: classify only when dirty.

## OSM parsers keep no "seen" state; `EditSystem.merge` skips entities it already has

The parsers used to remember every ID they parsed and leave it out of later results (`skipSeen`). That
saved real work back when responses were XML, but it broke when a request was cancelled (`loadTiles` aborts
tiles no longer in view) or timed out after the worker had parsed the response: the main thread dropped
the result while the worker kept the IDs, so those features never loaded until a reload. Now the parsers
return everything, and `merge` skips entities already in the base graph before building them or adding
them to the spatial caches (where the extra time went). Benchmarked on 6×6 overlapping tiles of the Tokyo
data: about the same total as `skipSeen` (~170 ms), against ~228 ms for parsing everything without the
merge change. With nothing skipped, the separate `seenIDs` set in parser results was redundant, so it's
gone too: `merge` emits the IDs of everything it was given, because features already loaded may need
to re-render when new ones arrive (see the note in `EditSystem.merge`). The skip is for `merge`
only: `updateBase` (a forced rebase) still replaces what's there.

## Folder-specific agent rules live in nested `AGENTS.md`, not `.github/instructions/`

`.github/instructions/*.instructions.md` with `applyTo:` globs only work in Copilot. Claude Code never loaded
them, and `pixi.instructions.md` wasn't linked from anywhere. Folder READMEs aren't a good home either:
no agent loads a README automatically, so rules there only get read if the agent happens to open it. Nested
`AGENTS.md` is the cross-tool convention (Claude Code, Codex, Cursor, the Copilot coding agent). Claude Code
was confirmed (Oct 2026) to load `modules/<dir>/AGENTS.md` as soon as it reads a file in that folder.
In VS Code Copilot Chat, nested `AGENTS.md` sits behind an experimental setting (`chat.useNestedAgentsMdFiles`).
The two files were moved with `git mv` (history preserved) and their `applyTo` frontmatter was dropped.

## `DatabaseSystem` owns the generic file API (but not the `sessions` domain logic)

`DatabaseSystem` has a generic file API (`putFileAsync` / `getFileAsync` / `listFilesAsync` /
`deleteFileAsync`, Blobs stored natively), although `sessions` is owned by `EditSystem`. The asymmetry is
deliberate: sessions encode domain knowledge (backups, entities, history), while a file is just a Blob
with a name. Bryan's mental model: *`DatabaseSystem` is the persistent store for anything more
complicated than localStorage.* What a file means (which dataset, when to reload it) belongs to its
consumer, on top of these primitives.

## Operations are classes named `ThingOperation` (not factory functions like actions)

Operations sit beside modes and behaviors (each one already makes a `KeyOperationBehavior`), and the
callable-with-expandos idiom scaled badly for their ~10 props and derived state. So they're
`AbstractOperation` classes, named like `ThingMode` and `ThingSystem`, and called with `run()`. The base
is **not** an `EventEmitter` (operations are one-shot and emit nothing), and it's one superset class with
optional hooks rather than per-op interfaces, because the menu uses them through one array.
`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs` stays (a per-click instance can't remember
the previous cycle); moving it onto a system is in `backlog.md`.

## UI fields: inheritance over composition

Each concrete field (`UiFieldCheck`, `UiFieldCombo`, …) **`extends UiField`** rather than being an
"internal" object composed by a `UiField` wrapper. The composition was an ES5-era holdover (no real
class inheritance back then). Inheritance removes the wrapper/internal split, the `_internal`/
`_createField()` machinery, the `UiFieldInternal` interface, and the event re-wiring — a field now
emits `change` on itself.

- **Construct fields via `createUiField(context, presetField, …)`** (in `fields/index.ts`), never
  `new UiField(...)`. `UiField` can't be constructed generically anymore — the concrete subclass is
  chosen by `presetField.type`. The factory lives in the registry module so that `UiField` itself does
  NOT import `uiFields` (that would be a load-time circular import, since fields `extends UiField`).
- **Name collisions were the real friction, not the mechanics.** The base wrapper API and the field
  render API shared names, so the field-side ones were renamed: `render`→`renderContent` (base
  `render()` draws the field chrome, then calls `renderContent()` for the input body — mirrors
  `AbstractUiSection`), `tags(t)`→`syncTags(t)` (base keeps the fluent `tags(val?)` getter/setter),
  and the field's `entityIDs(ids)` setter was dropped (the base owns the `entityIDs` array).
  `UiFieldAccess`/`UiFieldCycleway` had an `options(key)` choice-list method that collided with the
  base `options` config object → renamed `_fieldOptions(key)`.
- **`supportsMultiselection` is read off the instance** via `(this.constructor as typeof UiField)`,
  not a registry lookup — another reason `UiField` needs no `uiFields` import.

## UI events: EventEmitter over d3_dispatch/utilRebind

UI classes that emit events extend `EventEmitter` from `tseep/lib/ee-safe`, like systems, modes,
behaviors and `Context`: one event API everywhere, without the d3-dispatch + `utilRebind` boilerplate
(both retired). One wrinkle: `UiCombobox`'s consumers re-register `accept`/`cancel` on every render and
relied on d3-dispatch replacing the listener, so its constructor wraps `on` to remove the old one first
(tseep's `on` is a class field, so it can't be overridden as a method).

## UI primitives are classes when they're owned over time

An earlier pass kept `tooltip`, `modal`, `confirm`, `combobox` and `disclosure` as factory functions
("one-shot builders"). The real test is ownership and lifecycle: ~20 components held a
`public Tooltip: any` and reconfigured it every render. So they're classes now (attach with
`sel.call(tooltip.attach)`). `icon` stays a stateless function.

## Modal stack is owned by `UiSystem`

Each `UiModal` owns its own `.shaded` backdrop; `UiSystem` keeps the stack, and one document handler
sends Esc/Backspace to the top modal only. That's what lets modals nest (the Rapid catalog over the
dataset modal) without the old hacks that patched the parent's `close` and rebuilt its keybindings. On a
system because it's runtime state, and a CLI build without `ui` has no modals.

## HTML sanitizing and the CSP (Jul 2026)

- **Use explicit strict sanitization only at known trust boundaries.** External QA content, notes, remote metadata, Markdown, and reusable HTML widgets pass through Rapid's detached-document allowlist. The sanitizer rejects foreign namespaces and unsafe URL schemes, hardens new-window links, and reparses until serialization is stable. It fails closed to escaped text when DOM parsing is unavailable.
- **Do not install a document-wide Trusted Types default policy.** Rapid's registries and embedding model let extensions own their rendering. A global policy rewrites those extension sinks, and DOMPurify's assumptions did not hold in live Chrome. Keep sanitization local to the core trust boundaries instead.
- **Keep CSP inline scripts hash-based and extension-aware.** `script-src` has no `unsafe-inline`; exact SHA-256 hashes authorize the bootstraps and `strict-dynamic` propagates that trust to registered service scripts. HTTPS styles and fonts remain available to extension assets. The editor documents explicitly opt into `unsafe-eval` because Mapillary JS 4 unconditionally compiles filters with `new Function`; the OAuth callback does not. Core Pixi and event emitters use their no-eval implementations.
- **Refresh CSP hashes after deploy-time rewriting.** The predeploy step regenerates the policy after embedding build data, and `check:csp` catches stale committed policies with the capability options for each document.

## Pixi World-Coord Rendering (render_worldcoord)

- **Scene graph hierarchy**: `stage → origin → groups → features`. `stage` centers [0,0] on the screen for rotation. `origin` maps z16 world coordinates to screen pixels (`origin.scale = 2^(pixiTransform.z - WORLD_ZOOM)`, positioned to match `projWorldToScreen`), and its groups are render groups at an anchor near the view (`design/scene.md` section 3). Until Nov 2026 a separate `world` container did the scaling.
- **Use `pixiTransform`, not `mapTransform`, for `origin`**: the pan offset between them is absorbed by `origin.position`, so small pans don't change `origin.scale`, and `mapTransform` lags a frame during drags.
- **Imagery tiles are in world coordinates too** (`PixiLayerBackgroundTiles` places each sprite at its tile's world extent).
- **Container position = `world.origin` (extent center)** — Each feature's `container.position` is set to the extent center of its geometry in z16 world coordinates. All vertex drawing is then origin-relative. This keeps vertex magnitudes small (~thousands not ~8 million), making float32 drawing safe and d3-polygon numerics stable.
- **Points: counter-scale + counter-rotate** — `origin` scales geometry up with zoom. Point sprites are fixed-size in screen pixels. Fix: set `container.scale = baseScale / worldScale` and `container.rotation = -bearing`. This keeps child sprites screen-sized regardless of zoom/bearing. Halos and hit areas live in the counter-scaled local space, so they work unchanged.
- **Lines + polygons: world-local stroke widths** — Instead of counter-scaling (which would shrink geometry), express stroke widths in world-local units: `localWidth = pixelWidth * 2^(WORLD_ZOOM - zoom)`. At render time `origin`'s scale inverts this back to screen pixels. Dash patterns and buffer widths use the same conversion.
- **Hit areas are in container-local space** — a `container.hitArea`'s coordinates must be in the container's local frame. For world-path features the local frame is world-local (origin-relative): a `LineHitArea` gets the feature's world-local points and a world-local distance. Pixi composes the container transform when doing hit testing, so no extra projection is needed.
- **Halos: `scale` only, no per-caller workaround** — `drawHalo()` takes how many of the container's units a pixel is: lines and polygons pass `localScale`, points `1` (their container is counter-scaled). The halo's width and its dashes are in pixels.
- **`viewZoom` vs `styleZoom` naming convention** — named at the top of each method that needs both: `viewZoom` for scale math, `styleZoom` (latitude-adjusted) only for level-of-detail thresholds and styling (`lessons/pixi.md`).

## Frame pacing (Nov 2026)

- **Frames that only move the view aren't paced; frames with a pass to do are, by their cost.**
  After a pass frame the next waits twice what it cost, at most 250 ms (`FramePacer`,
  "Frame pacing" in `design/graphics-system.md`). A deferred redraw request alone waits at least 250 ms, as
  it did under the fixed throttle, so data that streams in still batches up.
- **Why twice the cost:** passes then take at most a third of the time, and with the 250 ms cap
  nothing waits longer than it did. Not tuned further; change it with measurements.
- **Rejected: tying the gap to the scheduler's pressure level.** Loading Staten Island took the
  same time (37 s while panning, until the scheduler's queues were empty) with 2,163 frames drawn
  as with 133.
  Add it if a case shows background work being held up.
- **Rejected: a held frame during a zoom.** Features are styled for their zoom (stroke widths in
  world units, screen-sized markers), so the old ones can't be drawn at a new zoom. The CSS
  transform still covers that.
- **`immediateRedraw(layerID)` hurries only that layer.** Label textures ask for it several times
  a second during a pan; if that hurried everything, no pass would ever wait its turn.

## A deadline on the frame (Nov 2026)

- **A dirty feature and a feature that needs its style worked out are two things.** `dirty` means
  draw it again; `needsStyle` means match its style and label to its data again. A zoom sets only
  the first (`scene.dirtyTransform()`). See "A deadline on the frame" in `design/graphics-system.md`.
- **What waits is drawing a feature again, by where it is and why it's dirty:** outside the view
  always; in view once the frame is out of time; and in a frame the user asked for, only if
  nothing but the zoom made it dirty. Rejected: no deadline at all in frames the user asked for.
  A hover during a wheel zoom asks for a frame, and it would have drawn everything at once.
- **Labels wait for the features, then at most one frame for time.** They're placed by the
  features' shapes, so placing them first would place them twice.
- **The budget is 6 ms while the view moves or the scheduler has work waiting, 24 ms when
  neither, and at least half of what recent frames cost** (up to 50 ms). Catching up fast matters
  more than 60 frames a second only when nothing else wants the time. And each frame pays a fixed
  cost, so where that's high, small steps take longer in all.
- **What a feature will cost in the DRAW phase counts against the frame's budget** (fixed
  estimates per feature, `RenderFrame.drawDebt`). Rejected: estimating it from recent frames.
  DRAW has a fixed part and a part per feature, one frame doesn't tell them apart, and a wrong
  estimate feeds back into the next frame's budget.
- **Making a feature waits by the same rules as drawing one**, except in a frame the user asked
  for: there, only what the user needs at once is made (something they drew, a vertex of their
  selection). Otherwise a hover during a load would make every feature in view at once.
- **Frames that catch up on waiting work aren't paced** (`FramePacer` doesn't see them). They're
  bounded by the deadline instead.

## World coordinates and their numerics

- **SDK-native z16 world coordinates are the one world space** (`@rapid-sdk/math`, `WORLD_ZOOM = 16`,
  `0..16,777,216`); the temporary `worldScaled` bridge is gone.
- **Safe for affine transforms, not for shoelace-style metrics.** d3-polygon's centroid and area
  cross-multiply ~1e7 coordinates; the cancellation put a centroid far outside its hull. So
  `GeometryPart` keeps `.local` coordinates (relative to the extent center) and computes hull, centroid,
  area and the rest there. Hull and orientation tests are combinatorial, so they're fine either way.

## Spatial System — buffers / conflation (Step 3)

- **Buffers are quantized "coverage boxes", not exact geometry** — A mathematically exact buffer is the Minkowski sum of a geometry with a disk. We don't need exactness, we need speed. Turf/JTS don't compute Minkowski either (they offset-curve + node + polygonize; same family as `PIXI.buildLine` / `lineToPoly`). For conflation we cover the geometry in boxes (a quantization). Coverage boxes double as the RBush query boxes.
- **`geomCoverageBoxes` is for conflation, not rope labels** — see `lessons/runtime.md`.
- **Coverage representation is per geometry type** — Point → one box of half-size `r`; LineString → boxes sampled every ~`r` along the line (partial matching falls out for free, per-box); Polygon → grown extent box (box-filling a 2D region is wasteful; phase-2 uses real polygon overlap instead). Don't force everything into box-fills.
- **Radius is a recompute parameter, not baked into `setData`** — `setData()` computes the radius-independent core projection; a separate `computeCoverage(r)` produces coverage for a given radius and is re-called when the user tweaks the conflation distance (e.g. 3 m → 2.5 m).
- **Two-phase querying with a caller-supplied predicate** — RBush indexes bboxes only, so queries prefilter by box and refine with a predicate the caller gives; "match" semantics live in a `Conflation` module, not in `SpatialSystem`. The precise tests already exist in `@rapid-sdk/math` (point in polygon, polygon overlap, line intersection), so no `jsts`. New helpers start in `modules/geo` and can move to the SDK.
- **Lazy `GeometryPart` derived products (Step 3a)** — `update()` keeps only the cheap core eager (projected coords, extent, origin, outer); `hull`/`centroid`/`poi`/`area`/`winding`/`surround`/`flat` are computed on first access, as getters on classes with a field per product since Nov 19 (a closure per product cost 2.3 KB a part). Most features of a large dataset are never rendered or conflated.

## actionMove: frame-of-reference in `replaceMovedVertex`

`replaceMovedVertex` does two tests when deciding whether to insert a shape-preserving vertex on an unmoved way:

1. **Angle test** — "Is the unmoved way nearly straight (≈180°) at this junction?" → uses `nodeOriginalLocal(prev/next)` (pre-move positions). Rationale: when a moved way connects to the unmoved way at _more than one_ shared endpoint (e.g. a U-shaped driveway), the "neighbouring" node on the unmoved way may itself be one of those shared endpoints — which has already shifted by the delta. Using its post-move position distorts the angle reading and can push a straight junction outside the ±5° window, triggering a bogus insertion. Original (pre-move) positions always reflect the unmoved way's actual geometry.

2. **Path-length comparison** — "Which insertion order produces the shorter path?" → uses `nodeLocal(prev/next)` (current positions). Rationale: this is about the way's resulting geometry after insertion, so it should reason about where nodes are now.

`nodeOriginalLocal(node)` returns `_cache.startLocal[node.id] ?? nodeLocal(node)` — for unmoved nodes the two are identical.

## World-coordinate refactor for actions

`actionMove` (and all the geometry-manipulation actions: rotate, reflect, scale, orthogonalize, circularize, straighten-nodes) now do all computation in **world coordinates with a local origin** for floating-point stability. The pattern:
- Pick an origin (e.g. centroid of selected nodes in world space) and store it in `_cache.origin`.
- Store each node's pre-move world position as `startLocal = worldPos - origin`.
- Do all geometry math in local world space (small numbers, FP-stable).
- At the end: `node.move(projWorldToWgs84(localPos + origin))`.

Call sites pass a **world-space delta** (a `Vec2` difference of two `projWgs84ToWorld()` results), not a screen/viewport delta. This removes the `viewport` parameter that was previously required.

## `NsiService` and NSI v7

- **No wikipedia replacements.** NSI v7 stopped tracking `wikipedia` in `replacements.json`, so that
  lookup is gone; `upgradeTags` still drops a bare `wikipedia=*` when a wikidata match is found.
- **Local `NsiItem` extends NSI's** with the fields Rapid fills in at runtime (`tkv`, `mainTag`).

## StyleSystem / StyleSelector

- **`weight` replaces auto-computed `specificity`** — The old specificity scoring (geometry +50, each tag matcher +10) couldn't express "building always overrides amenity" because both had 1 tag condition = same score. Adding more tag matchers to artificially increase specificity was fragile. `weight` gives the data author explicit control over cascade order, consistent with how presets use `matchScore`.
- **Default weight is 1** — Existing selectors with no `weight` all get weight=1, meaning equal-weight selectors preserve insertion order (stable sort). This keeps current behavior for the vast majority of selectors that don't need explicit ordering.
- **Sort ascending, iterate forward** — `findAll()` returns selectors sorted by weight ascending. `styleMatch()` iterates forward with `deepMerge`, so the last (highest-weight) selector wins. This is simpler than the old pattern of sorting descending then iterating in reverse.

## Network and workers

How it works is in `design/network-system.md` and `design/scheduler-system.md`; these are the rules
someone might break by accident.
- **Three systems:** `SchedulerSystem` decides when to run (frame loop, queues, timers, backpressure),
  `WorkerSystem` where (the pool and the listener registry), `NetworkSystem` handles fetches. The split
  kept one system from passing 1,000 lines.
- **Never record an abort.** An `AbortError` is always a rejection, never an envelope, so an aborted
  request stays retryable: "pan away, pan back reloads the tile" depends on it.
- **Every worker listener returns a `FetchEnvelope<T>`.** A thrown error loses its `.status` crossing
  `postMessage`; the envelope is how the status survives.
- **Only explicit `requestID`s are recorded** in `_completed`, and only `NetworkSystem` writes it. Retry
  is a service's choice: `network.forget(id)` in its catch handler (OSM tiles, Streetside, MapWithAI).
- **An unregistered `listenerID` rejects**; it never falls back to the generic fetch and parse.
- **Auth goes through request interceptors**, on the main thread, so the token never needs to reach a
  worker and the request crosses as plain data. Writes (changesets, notes) stay `mainThread: true`.
- **Workers resolve relative URLs against their own script**, so `NetworkSystem` makes them absolute
  before dispatching.
- **`resultPriority`** resolves a worker's result through the scheduler, so heavy `.then()` chains don't
  blow a frame budget (OSM tile loads use `'normal'`).

## Worker Companion Convention (`*.worker.ts`)

- **`Foo.worker.ts` sits next to `Foo.ts`** and exports its listeners plus a `listeners: ListenerRegistry`;
  each folder's `index.worker.ts` re-exports them. The same functions are registered twice: in the worker
  (through the barrels) and by the service with `worker.registerListener()`, for when there's no worker.
- **Worker-safe by construction:** a `.worker.ts` imports only parsers and utilities, never `Context`,
  systems or the DOM. Results must survive structured clone (return a `ParserResult`, not a `Document`).
- **`Listener` and `ListenerRegistry` are global types** (`global.d.ts`), because they cross bundle
  boundaries.
- **Workers live across `resetAsync`.** Terminating them would race with reset messages and re-parse the
  script; a system that needs worker state cleared sends its own message. Module-level objects in a
  companion file (the OSM parsers) must keep no state between calls.

## Architecture

- **Scoped data, no aggregate caches** — Both StyleSystem and SchemaSystem store data in `_scopes: Map<ScopeID, ScopeData>`. No aggregate maps across scopes. Callers access scope data directly: `schema.getScope('osm')?.fields.get(id)`.
- **`'*'` common scope** — Holds geometry fallback presets and default styles. Created by `resetAll()`. Always available even without loaded data. Production `rapid_style.json5` uses `scope: '*'`.
- **Scoped format only** — `merge()` only accepts `{ scopes: [{ scope: 'osm', ... }] }`. External flat data (id-tagging-schema, NsiService) gets wrapped before merging.

- **`TreeStore` owns all nested-tree logic** — `modules/lib/TreeStore.ts` is the single home for path access + flat-key (de)serialization; `modules/util/keypath.ts` was folded in and deleted. `SettingsSystem` (persistence: `rapid.settings.*` namespace + migrations) and `LocalizationSystem` (`_store`, keyed `[locale][resource][…]`) both build on it. Nested internal repr chosen because reads are hot and writes rare.
- **`peek` vs `get`** — `TreeStore.peek` returns a copy-free live reference for hot read paths (l10n `t()`); `get` returns a deep copy of composites for safe external use. Strings are returned as-is by both (immutable, no clone).
- **`<TX_DOT>` normalized at load, not resolve** — Transifex can't use dots in translation keys, so data files use a `<TX_DOT>` sentinel. `LocalizationSystem` rewrites those keys to literal dots once when loading each resource; producers (e.g. `ImagerySource`) percent-encode dots as `%2E` (`encodeURIComponent` leaves `.` alone). The resolver stays ignorant of both encodings.

## Rulesets & Variables

- **Separate `osm_rulesets.json5`** — Not inside `rapid_schema.json5`. Load order: id_tagging_schema → osm_rulesets → rapid_schema.
- **Lookup tables stay as Records** — `areaKeys`/`pointTags`/`vertexTags` are O(1) Record lookups on SchemaScope. Rulesets would be 50-150x slower on these hot paths.
- **`lifecycle` ruleset as config container** — The Set of prefixes is derived from its key patterns, not used for `match()` directly. `lifecycle_prefixes` variable is the canonical source.
- **`match()` and excludes subtlety** — `match({k: v})` only sees the key/value pairs you pass. When excludes reference different keys than includes, pass the full tag object.
- **Actions access schema via `graph.context.systems.schema`** — `Graph.context` is always set. This is fine and explicit.

## Vector tiles: MVT on a worker, PMTiles not

- **`network:fetchAndParseMVT` is shared** by `VectorTileService` and `MapillaryService`: the worker
  fetches and decodes, and returns GeoJSON per layer; what to do with each layer stays on the main thread,
  where `Context` is.
- **PMTiles does its own fetching** (HTTP Range requests from the library), so it bypasses
  `NetworkSystem` and still decodes on the main thread; `VTSource.inflightPMTiles` tracks its requests.
  A PMTiles `Source` that calls `network.fetchRaw()`, and a listener that takes a buffer, would unify
  them. Low priority.

## Dual-Props Pattern

Used when a class resolves references (`var()`, locale strings) in its props:
- `props` = raw/immutable (never mutated after construction)
- `_resolved` / `_resolvedValue` = lazy resolved copy
- Getter returns `resolved ?? raw` (zero overhead when no vars)
- `reset()` = null out the resolved copy
- Applied to: `Style`, `PropMatcher`. NOT needed for `Preset`/`Field` (localization cached in `_strings` Map).

## Context Lifecycle

- **No backward compat for old `initAsync()`** — It now only inits (doesn't start). Simple consumers use `context.run()`. v3 breaking change.
- **`prepareAsync()` → `initAsync()` → `startAsync()`** — Each phase chains the previous. All idempotent. `run()` is a convenience that chains everything.

## Pixi Labels and Atlas Textures

- **Measure labels during render, rasterize after render** — `PixiLayerLabels` uses `PIXI.CanvasTextMetrics.measureText()` for placement math inside `render()`, then queues texture creation through `SchedulerSystem.schedule()` so `renderer.generateTexture()` runs in the scheduler drain phase after all frame callbacks complete. This fixes Pixi v8 renderer re-entry corruption while preserving the existing Pixi.Text rasterizer for now.
- **Labels are managed features, placement data is not** — `PixiLayerLabels` places labels (their boxes in its spatial cache, avoids in `scene.labelSpace.avoidGrid`, "Label placement" in `graphics-system.md`) and keeps `PixiFeatureLabelProps` placeholders. A `PixiFeatureLabel` is made only for a visible placeholder and owns its `Sprite` / `BitmapText` / `MeshRope`; culling destroys display objects, not placements.
- **Atlas items store uploadable sources, not just ImageData** — `AtlasAllocator` accepts `ImageData`, `HTMLCanvasElement`, `HTMLImageElement`, and `ImageBitmap`. WebGL uploads use the 7-arg `texSubImage2D` DOM-source overload, WebGPU uses `copyExternalImageToTexture`, and the canvas renderer blits the same source into its backing canvas. This avoids the previous `drawImage` → `getImageData` readback for images, bitmaps, and canvases.
- **Tile-only edge replication** — The atlas still reserves a 1px ring around every texture frame, but only tile imagery needs that ring filled with edge-replicated pixels to prevent seams under bilinear sampling. `PixiTextures._fromEdgePaddedCanvas()` builds a `(w+2) x (h+2)` source for tile atlas entries with two `drawImage` passes. Symbol/text/icon entries upload at the inner frame position and leave the reserved ring transparent.

## Canvas Renderer Atlas Support

- **Pixi's canvas renderer has no upload pipeline**: it draws `TextureSource.resource` directly. So with
  `useCanvas: true` (only when `RendererType.CANVAS` is detected, saving ~16 MB per slab otherwise),
  `AtlasTextureSource` keeps a backing canvas as its `resource`, and `AtlasAllocator.allocate()` blits each item
  into it. The `(this as any).resource = canvas` cast is intentional: the generic expects a typed array.
- **Freed regions aren't cleared**, as on GL/GPU: they're overwritten when reallocated.

## The url holds overrides, not state (Nov 2026)

Rule and details in `design/settings-system.md`; these are the choices someone might undo by accident.
- **The url is for starting Rapid a certain way, not where the user's state lives.** Most of it is
  invisible, and `map=` comes first because it's the part people see. Only where you are and what's
  selected (`map`, `id`, `photo`, `detection`) is written as you go.
- **An override is dropped once the state no longer matches it, not rewritten.** Then it's in effect
  exactly while it's in the url (no `_urlOverride` flag), and a reload before any change opens the link
  again. Taking one out of the url leaves things as they are.
- **Changes are saved one at a time (deltas).** Saving the whole state would save the link's other
  choices as the user's.
- **Some state is for the session only:** photo filters, MapRoulette challenges, the 3D map, the imagery
  offset. They were only ever kept by the url (a legacy choice few people relied on). An offset belongs
  to one source in one area, so bringing it back elsewhere would misalign the imagery.
- **The user's last imagery wins over 'best', but only where it can be seen.** Saved overlays are also
  only turned on where they can be seen, or they'd be credited in changesets elsewhere.
- **`UrlHashSystem` still loses url changes made before it resumes.** Keeping them would let startup's
  `map=`/`id=` writes overwrite a link's own. Read startup values from `initialHashParams` instead.
- **`_isApplyingUrl` tells a link's change from the user's, and only `_hashChanged` sets it.** Whether
  a param is in the url can't tell them apart: it's still there at the moment the user changes the
  state, which is exactly when it has to be dropped. Startup doesn't need the flag (`_started` or
  `_settled` already stops saving then).
- **Custom data's `data=` is an override too.** It stays while its data is shown, so a copied link's
  custom `id=` finds it again. Custom data the user loads isn't written, so its `id=` can't be found
  from a link.

## Settings declare how they're kept (Nov 2026)

- **Settings sync across the user's browsers once they sign in, like Chrome or VS Code.** That's Bryan's
  guiding principle for what syncs: preferences follow the user; state, and what depends on this
  browser's data, screen or mouse, stays local.
- **Only what code declares is ever deleted.** Registered (`registerSync`/`registerLocal`) means in use,
  `unregister` means delete, anything else is ignored. Bryan's choice, over deleting what this build
  doesn't recognize, which lost testers' preferences when they switched builds (bug-hunt item 12).
- **Declaring a setting local also deletes its account copy**, so v1's copies of local settings (some
  with access tokens) don't stay in the account forever.
- **One `unregister`, not a local and a sync one.** v1 copied everything to the account, so a retired
  setting may be in both places either way.
- **Overlapping declarations throw.** A path inside one declared another way means one of them is
  wrong, and it would delete or sync the wrong thing.

## Bug hunt 2 choices (Nov 2026)

Fixes where Bryan picked the behavior, which someone might undo by accident.
- **MapRoulette auth is commented out, not fixed.** MapRoulette expired the API keys Rapid read from
  the OSM user preferences, and will offer a proper login later; until then Rapid submits without a
  key. See "MapRoulette authentication" in `backlog.md`.
- **From a successful upload until the reset, nothing can be edited.** Rapid stays in save mode (Escape
  is off), and after `clearBackup` the history isn't work to keep (`hasWork()` is false), so the
  uploaded edits are never backed up as a new session.
- **A `walkthrough=true` start doesn't offer a restore.** The sessions are offered the next time Rapid
  starts normally. These links are for classes of new users.
- **With OSM features selected, the arrow keys move them, even with the photo viewer open.** The photos
  step only when nothing OSM is selected, or the Mapillary viewer has focus.
- **Empty new relations aren't deleted when leaving select mode.** `missing_tag` flags them instead
  (see "Render relations" in `backlog.md`).

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.

## `build_js.ts` forces `format: 'iife'` on every browser bundle

- **Why not Bun's default `esm`?** Our entry points have no exports and only attach globals, so ESM
  output is bare top-level declarations, which a classic `<script>` puts on `window` (d3-selection's
  `dispatchEvent` replaced the native one). esbuild, the old bundler, defaulted to `iife` for browsers.
  Details in `lessons/build.md`.
- **Why not `<script type="module">`?** It would push a workaround onto every embedding app's loader for
  bundles that have no ESM API to preserve. IIFE is the honest format for "load me, I attach a global".
- **Workers are iife as defense-in-depth**: they're module workers already, so nothing leaks into `self`;
  iife guards a future switch to a classic worker and still loads as a module.
- **Real ESM consumers** would be a separate, additive build (`modules/index.js`, which has exports, with a
  `package.json` `"exports"` map), not a reason to unwrap these bundles.
