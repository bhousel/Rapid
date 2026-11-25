# Decisions: Rendering

How the map is drawn: the scene, batches, shaders, world coordinates, frame pacing, styles and textures. Non-obvious choices where "why did we do it this way?" isn't captured in the code.

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
  `design/scene.md` section 5, not a performance change.
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
  moved over** (`_gatherExtents()`, sections 17 and 18 of the log), gather where data arrived
  (below), and do their whole pass for anything else: a class on their own data (a hovered photo),
  a zoom. The OSM
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

## StyleSystem / StyleSelector

- **`weight` replaces auto-computed `specificity`** — The old specificity scoring (geometry +50, each tag matcher +10) couldn't express "building always overrides amenity" because both had 1 tag condition = same score. Adding more tag matchers to artificially increase specificity was fragile. `weight` gives the data author explicit control over cascade order, consistent with how presets use `matchScore`.
- **Default weight is 1** — Existing selectors with no `weight` all get weight=1, meaning equal-weight selectors preserve insertion order (stable sort). This keeps current behavior for the vast majority of selectors that don't need explicit ordering.
- **Sort ascending, iterate forward** — `findAll()` returns selectors sorted by weight ascending. `styleMatch()` iterates forward with `deepMerge`, so the last (highest-weight) selector wins. This is simpler than the old pattern of sorting descending then iterating in reverse.

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.
