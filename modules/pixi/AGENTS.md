# Pixi Module Guidelines

Guidelines for working with the `modules/pixi/` folder.
(For an overview of what's in this folder, see [`README.md`](README.md).)

## Pixi's reference skill, and where Rapid differs

Pixi ships an agent skill with the version we have installed: `node_modules/pixi.js/skills/pixijs/SKILL.md`.
Before you write or change Pixi API code, read `SKILL.md` and the topic files it routes you to (e.g.
`references/scene-graphics.md`). It knows the v8 API, its silent pitfalls and its performance traps
better than memory does, and it matches the installed version.

The skill is written for a typical Pixi app. Rapid departs from that on purpose in a few places. Where the
skill and Rapid disagree, follow Rapid, and don't "fix" these:
- **No Pixi ticker.** `GraphicsSystem` destroys the `Application` ticker and stops Pixi's shared and
  system tickers (it gives the system ticker a turn once a second, for Pixi's own scheduler, and
  removes Pixi's events ticker); `SchedulerSystem` runs the frame
  loop, and Rapid renders only when something changed. Don't add `app.ticker` callbacks or call
  `app.render()` from a layer or feature: mark it dirty and let the next frame draw it.
  (One thing draws without a change: while something is hovered or selected, `GraphicsSystem`
  draws the scene again as it is, for what the shaders move. See "What moves by itself" below.)
- **Nothing renders inside `render()`.** `renderer.generateTexture()` calls `renderer.render()`, which
  corrupts a render already in progress, so texture work is queued through the scheduler (see
  `PixiLayerLabels`).
- **Textures come from `PixiTextures`**, which packs icons, symbols and tiles into its own atlas. Don't
  use `Texture.from()` or `Assets.load()` for them (only area patterns use an `Assets` bundle).
- **Features draw in z16 world coordinates**, under the `origin` container (which scales them), positioned at
  their extent's center. Line widths and dash lengths are in world units (`localScale`), and points
  counter-scale to stay screen-sized (a batch's shader does that for what's in it). The skill's screen-pixel examples need converting. See
  "Pixi World-Coord Rendering" in [`knowledge/decisions.md`](../../knowledge/decisions.md).
- **A line's casing and stroke, and an area's outlines, are drawn from stroke meshes**
  (`geomStrokeMesh()` in `modules/geo/stroke.ts`, built once for any width), not by `Graphics`.
  Build a stroke mesh only when the line, its cap or its join changes (the feature's
  `GeometryPart` is a different object then). Don't go back to `graphics.stroke()` for them:
  Pixi built every line's vertices again at every zoom, 5 GB of the 13 that sixteen zooms in
  Užice allocated. See "The line builder" in `design/graphics-system.md`.
  - **The OSM layer's lines are in batches** (`lib/LineBatchMesh.ts`, a `Mesh` with our own shader):
    two for each level, one for every casing and one for every stroke, drawn in that order.
    The layer gives each line feature its two (`feature.casingBatch` and `feature.batch`, from
    `layer.batches.lineBatch()`), and the feature's casing and stroke are items in them: it has no mesh of
    its own. The shader works out widths, the narrowing below zoom 17, the casing's absence
    below 16, wireframe and dashes from five numbers the layer sets on every frame
    (`LineBatchShader.setView()`), so **a zoom must change nothing in a batch**: keep whatever depends
    on the zoom out of the vertices. Don't split the batches (by road class, by tile) without
    counting the draw calls: fewer is the point, and the order of the classes is in the batch.
  - **The markers along a line are in the strokes' batch too** (`feature.arrowItem`,
    `feature.sidedItem`): oneway arrows, and the triangles on the right of a line with sides.
    They're a strip along the line (`LineBatchMesh.addMarkers()`), over every stroke of the level,
    and the fragment shader draws the shapes in it from the distance along the line and to
    its side. So the shapes are in the shaders (GLSL and WGSL, in `LineBatchMesh.ts`), with their
    spacing and the strip's width in `LINE_MARKERS`; the sprites that a line draws when it
    draws itself (`PixiTextures`' `oneway`, `twoway` and `sided`) have to look the same.
    A new kind of marker needs both. `test/e2e/rendering.test.js` compares the two by
    their pixels: run it after touching either.
  - **The OSM layer's areas are in batches too:** every fill in a `FillBatchMesh`
    (`lib/FillBatchMesh.ts`), then every outline in a `LineBatchMesh`, in the order of their size
    (`feature.fillBatch` and `feature.strokeBatch`, from `layer.batches.fillBatch()` and `outlineBatch()`). A fill's triangles
    are worked out once (`triangulate()` in `helpers.ts`); a partial fill's band is triangles
    in the same batch, worked out again when the zoom changes its width. Patterns come from
    the atlas that `PixiTextures` builds (`getPatternNumber()`), and the shader lays them out.
    There's no `lowRes` sprite, `fill` or `strokes` for an area that batches draw.
    **An area under 20 pixels is its fill alone,** with no outline in the batch (an outline is
    3 triangles a corner; `SMALL_SIZE`), except in wireframe mode, where the outline is all
    there is. Draw something imperfect before drawing nothing (Bryan): don't add a level of
    detail that leaves a mapped thing invisible.
  - **The OSM layer's points are in one batch** (`lib/PointBatchMesh.ts`): points, vertices and the
    pins of areas, from north to south, the ones with viewfields over the others. The layer
    gives each its batch and its place with `_placePoint()`. A point is a few pictures (its
    viewfields, its marker, its icon), each a rectangle of the symbol atlas, a number of pixels
    from where the point is on screen: the shader keeps them that size and upright, so **a
    zoom or a rotation must change nothing in the batch** either. (Below zoom 17 points are
    drawn smaller and pins as circles: crossing that writes every point again, once.)
    - **A point that a batch draws has no sprites:** `marker`, `icon` and `viewfields` are
      `null`. What it draws is `feature.item`. To turn a marker, set `feature.markerRotation`
      before `update()` (the midpoints do); don't reach into `feature.marker`.
    - **What a point is drawn with is worked out in one place,** `PixiFeaturePoint._layout()`,
      for the batch and for sprites alike. A new picture, size or anchor goes there.
    - **Where a point is on screen is `feature.labelBox()`,** from arithmetic. Labels and the
      avoid grid use it.
    - **A batch draws from one texture,** the symbol atlas's first (`PointBatchShader.setTexture()`,
      from `PixiTextures.reset()`). A point with a picture from anywhere else draws itself with
      sprites, and finds that out as it's drawn: `PixiLayerOsm._drawFeature()` gives it its
      place in the scene then.
    - **Vertices and midpoints that are drawn above everything** (the map UI's `selected`
      container) have no batch and draw themselves, where Pixi's hit test finds them.
  - **A line, an area or a point that its batches draw isn't in the scene.** Its container has
    no parent, so don't reach for `feature.container.parent`, `getBounds()`, `toGlobal()` or
    `worldTransform` on one: use its geometry, its container's `position` (the feature's place
    in the world) and `gfx.origin` (the world's place on screen). Where a feature is drawn among
    the others is `feature.sceneContainer` and `sceneOrder` (`featureOrder()` in `helpers.ts`).
  - **A feature is in the scene only when it draws something itself**
    (`drawsInContainer()`): markers that a batch has no shape for, a picture from another
    texture, a vertex that's drawn above everything. A hover or a selection isn't a reason:
    their glow and halo are in batches too (below). Anything new that a feature draws in its
    own container has to be said there, or it's drawn nowhere.
  - **A hover's glow is in a batch of glows** (`LineBatchMesh.glows`, `PointBatchMesh.glows`): a strip
    around a line or around each ring of an area (`feature.glowItem`, `glowItems`), and a
    picture behind a point (`glowItem`, or the `glow` sprite of a point that draws itself). An
    area's fill is tinted meanwhile. **A hover has to show:** if a change takes away what a
    user sees under the pointer, put something in its place. Put what comes and goes with the
    pointer in a small batch of its own, not in the batch of what it's around: a batch that
    gets or loses a thing builds its index buffer again, which was 11 ms a hover in Užice.
  - **A selection's halo is lines in the map UI layer's batch** (`feature.haloItems`, from
    `_drawHalo()` and `drawHalo()` in `helpers.ts`; `PixiLayerMapUI.haloBatchAt()`): two for
    each ring, a dark one and yellow dashes that march over it. There's no `feature.halo`
    container. A halo's rings are the outline of its feature at the distance a click reaches
    (`geomStrokeOutline()`), given in the feature's container's coordinates.
  - **What the batches share is `BatchMesh`** (`lib/BatchMesh.ts`): the buffers, a thing
    that changes in place, hiding by an opacity of 0 (which each shader must draw nothing
    for), the order, the origin that follows the view. A new kind of batch says what a vertex
    holds, and writes it.
  - **Everything else is a `LineMesh`** (`lib/LineMesh.ts`): the lasso, and a line whose dashes
    a batch can't draw. Call `setStroke()` for a new width: it
    moves the vertices it has. Dashes are `PixiTextures.getDashTexture()`, color and opacity
    are the mesh's `tint` and `alpha`.
  - **A line feature may have no `stroke` or `casing` mesh** (`null` while a batch draws it).
    To know what's drawn, read `strokeItem`, `casingItem`, `arrowItem`, `sidedItem` and `glowItem`.
- **Every layer that draws data draws it in batches,** not only OSM: the Rapid datasets, custom
  data, the photo, detection and QA layers, GeoScribble.
  - **Set `this.useBatches = true` in the constructor, and draw with
    `this.updateFeature(feature, frame, viewport, container)`** where you'd call
    `feature.update(viewport)`, with the container you'd have put the feature in. When it's drawn
    (now, or in a later frame if it's outside the view or past the deadline), it takes that
    container's batches (`feature.placeInBatches()`), and goes in the container only if it draws
    something itself (`drawsInContainer()`). Don't set `feature.parentContainer` yourself.
  - **Lines, polygons and points in one container are drawn in their batches' order there**
    (see `LayerBatches`). If they share a spatial container, give each kind a child container
    (`_childContainer(parent, 'lines', 0)`, `'points', 1`) in the order you want them drawn.
  - **Such a layer finds its own features under the pointer** (`AbstractPixiLayer.hitTest()`),
    from an index of where it drew them in batches: a feature drawn any other way isn't found.
  - **Don't change a feature's sprites after it's drawn** (`feature.icon.position.set(…)`): a
    feature in a batch has none. Say it in the style, or in `PixiFeaturePoint._layout()`.
  - After converting a layer, compare it with sprites in one build: `layer.useBatches = false`
    and `layer.reset()`, then the same with `true`, for the map's pixels and for what
    `scene.hitTest()` finds on a grid of points.
- **The lasso is `LineMesh`es too,** drawn with `drawRings()` (`helpers.ts`) into a container
  that keeps its meshes from one call to the next. There's
  no `DashLine` anymore, and nothing of ours calls Pixi's `buildLine`. Don't use Pixi's
  `DashLineShader`: it needs `SmoothGraphics`, and a context with it is never batched.
- **What moves by itself is moved by a shader, from the clock.** A glow breathes and a halo's
  dashes march because of two uniforms that every batch shares (`LineBatchShader.setTime()`,
  `PointBatchShader.setTime()`), which `PixiScene.animate()` sets before a frame is drawn. Rules:
  - **Don't write to a batch, or draw a feature again, to animate something.** Give the
    shader what it needs in the vertices once, and a uniform for the moment.
  - **`PixiScene.animated` says whether frames should keep coming** (something has the
    hover, highlight or select class). `GraphicsSystem` then draws the scene again when its
    `AnimationPacer` says so: 20 times a second, less when the browser is slow to come back,
    not after 30 seconds without a change, never with `prefers-reduced-motion`. Something new
    that moves has to make `animated` true while it's shown, and has to look right standing
    still (reduced motion, the rest).
  - **An animation draw is a whole DRAW** (13 ms of GPU in Užice on an M4), with no APP and
    no `draw` event. Don't raise the rate, or animate something that's always on screen,
    without measuring what that does where the GPU is weak.
  - **A sprite that should pulse with the glows** is registered with `scene.addPulsing()`,
    and taken back with `removePulsing()` before it's destroyed.
- **A shader is written twice,** in GLSL and in WGSL, and only the GLSL is drawn with by a
  test. After changing one, look at the map with `renderer=webgpu` in the url. WGSL reserves
  names that GLSL doesn't (`from`, `filter`, `target`, `type`, `mod`, `self`, `set`...):
  `test/dom/pixi/shaders.test.js` checks for those.
- **A line's hit area is a distance, not a shape** (`lib/LineHitArea.ts`): a point hits when it's
  within a few pixels of the line. A feature keeps the one it has and calls `set()` when the line
  or the zoom changes. Don't build a polygon around a line to hit-test it.
- **Render groups go through `PixiScene.worldContainer()`.** The skill says to put a panning world in
  `new Container({ isRenderGroup: true })`. Ours is in z16 world coordinates, which are too big for the
  32-bit floats a render group keeps its vertices in: shapes come out distorted, more so when zoomed
  in and further east. Make containers for features with the layer's `_spatialContainer()` and
  `_childContainer()`; each gets a render group at an anchor near the view. Never set `isRenderGroup`
  on a container whose children are in world coordinates. See "Render groups" in
  [`design/scene.md`](../../design/scene.md).
- **Pointer events go through `PixiEvents` and Rapid's behaviors.** Pixi's `globalMove` and `wheel`
  events are off (`eventFeatures` in `GraphicsSystem._initPixi()`), and the mode decides which
  subtrees can be hit (`interactiveSpatialIDs`, see [`design/scene.md`](../../design/scene.md)).
  Don't add pointer listeners to features, and don't listen for `globalpointermove`: with
  `globalMove` on, every pointer move visits every interactive object in the scene.
- **The feature under the pointer is `scene.hitTest()`'s answer, not `e.target`.** Pixi's hit
  test doesn't look at the features of layers that draw in batches: the OSM layer finds them
  through the editor's spatial index (`PixiLayerOsm.hitTest()`, 0.07 ms for a pointer event in
  Užice where Pixi's walk took 8), and the others through an index of their own
  (`AbstractPixiLayer.hitTest()`). Each checks `scene.isInteractive()` for the spatial IDs it finds. `PixiEvents` puts the scene's answer on each pointer event (`_feature`), and
  `AbstractBehavior._getEventData()` reads it. Rules that follow:
  - A point is hit in its `hitArea`, a shape in pixels around where the point is on screen
    (`PixiFeaturePoint.hitTest()`; one that draws itself is asked as Pixi would,
    `containerHit()` in `helpers.ts`). `eventMode: 'none'` and `allowInteraction = false` still
    take a feature out. A line is hit by its distance from the pointer, and an area by that
    distance from its rings or by being in its fill, in world coordinates
    (`PixiFeatureLine.hitTest()`, `PixiFeaturePolygon.hitTest()`).
  - **A feature that can be hit outside the box of its geometry sets `hitReach`**, in pixels,
    when it draws (a pin above its point, a line beside itself). The layer asks the index that
    far around the pointer, so a feature with too small a reach isn't found at its edges.
  - A feature's data has to be in the index under its own ID (`_dataHasFeature`). What isn't
    (the midpoints) goes in a container that Pixi tests, such as the map UI's `selected`.
  - After changing any of this, run the comparison in `test/e2e/select.test.js`: the index
    must find what asking every feature does, at every point, and a point in the batch must
    be hit where Pixi hits it drawn with sprites.
- **Look at what a change does to a hovered, a selected and a dragged feature,** in a
  screenshot. Moving lines into batches took the glow off every hovered line, and every test
  passed: the tests looked at classes, and the glow was a filter on a container that had nothing
  left in it. It happened again when the glow moved into the batch: the item was there,
  visible, and the shader faded it to nothing. So the e2e tests count the pixels a glow
  changes (`glowPixels()` in `test/e2e/select.test.js`): **for something a shader draws,
  test the pixels,** not only the state that asks for it.
- **`scene.setClass()`, `unsetClass()` and `clearClass()` ask for a frame themselves:** don't
  follow them with a redraw request. The scene tells the layers which data changed class, and
  the OSM layer draws that data's features again without its pass
  (`PixiLayerOsm._renderChanged()`): a hover in Užice costs 3 ms of APP that way, and 175 with
  `immediateRedraw()`.
- **For an edit, `scene.dataChanged('osm', ids)`,** with everything the edit affects
  (`Difference.complete()`). It asks for a frame. `MapSystem` does this for `stagingchange`. The
  layer draws those entities again without its pass; `scene.dirtyData()` still means "do the pass".
- **For data that arrived, `scene.dataArrived('osm', ids)`,** which asks for a frame too.
  `MapSystem` does this for `merge`. The layer sorts and draws it when its frames have time.
  A service whose data another layer draws names that layer: `gfx.deferredRedraw('mapillary')`.
- **Destroy the Pixi objects you replace.** `removeChildren()` and assigning a new
  `mesh.geometry` leave the old ones alive: Pixi keeps what it built for them until they're
  destroyed, or until its own collector finds them unused a minute later. After a zoom that
  was 550 MB. (`for (const child of parent.removeChildren()) child.destroy();`, and
  `geometry.destroy(true)`: a `Mesh` doesn't destroy its geometry either.)
- **Make a feature's Pixi objects when they're first shown.** A feature that exists isn't
  always drawn (too small at this zoom, no icon), and every `Container`, `Sprite` or `Graphics`
  is about 0.7 KB before it draws anything. `PixiFeaturePolygon` makes its sprite or its shapes
  in `update()`, for the level of detail it's at, and destroys what the level doesn't show.
  A point's `marker` and `icon` and a line's `casing` are `null` while there's none to draw
  (or a batch draws them): a layer that touches them does so after `update()`, with `?.`.
- **In a loop over every feature, don't make an object per feature.** Iterate
  `map.values()`, not `for (const [id, feature] of map)`. Don't work out a shape that only a
  hover or a selection needs (a halo's outline is built in `updateHalo()`, for what's selected).
  Garbage is what brings the half-second collections
  (`design/graphics-system-log.md` section 13).
- **A point that labels should keep clear of gets `feature.labelAvoid = true` from its layer**
  (OSM, Rapid and custom data points do; photo and QA markers don't). It then marks where it's
  drawn in `scene.labelSpace.avoidGrid` at the end of its `update()` (`updateAvoid()`), and unmarks when
  it's hidden or destroyed. Nothing gathers avoids from containers anymore. A new kind of
  feature that labels should avoid overrides `updateAvoid()` and calls `_setAvoid()` with its
  box in label space (`scene.labelSpace.worldToLabel()`).
  Vertices and midpoints that are only drawn because their way is hovered aren't avoids
  (`related.handleIDs` in `PixiLayerOsm`): a hover must leave every label where it is.
- **A feature's `update()` ends with `this.scene.labelSpace.featureChanged(this)`.** That's how the labels
  layer knows which features to look at; it doesn't walk the scene. Setting `visible` or
  `label`, and `destroy()`, say so themselves. A class (`setClass()`) doesn't mark the label
  out of date, so don't make a hover or a selection set `dirty = true` on a feature.
- **Put an OSM feature in its tile's container with `_setTile()`** (a point with
  `_placePoint()`), not by setting `parentContainer`. After the view crosses a whole zoom level, features move to the new zoom's
  tiles a whole old tile at a time (`_retile()`), and a feature moved on its own in between
  makes Pixi rebuild both tiles.
- **The OSM layer's pass doesn't see every vertex.** It leaves out the ones that only shape
  their way (`OsmNode.vertexKind()`), and adds the ones related to what's selected or hovered
  afterwards (`_addRelatedVertices()`). Something new that should draw such a vertex has to say
  so there, and in `_isIdleVertex()` for the ones that arrive.
- **The OSM layer rarely does its whole pass now**, so don't count on one to pick something up.
  It does one when it's marked dirty (`dirtyLayer()`, `dirtyData()`: a filter, the styles) or
  when a redraw is asked for without a layer. A view that leaves the cull box isn't one, and
  neither is a zoom or a rotation: the layer follows the box (`_moveBox()`), and after a zoom
  it runs its features through `render…()` again over the next frames. So what a `render…()`
  function decides from the zoom is picked up there, a batch at a time, not all in one frame.
- **A change of mode asks for a frame, not a redraw** (`Context.enter()`). If a mode changes
  what the map shows, it has to reach the layers: through a class, an edit, a redraw request of
  its own, or (for something a layer draws in one mode only, like the OSM layer's midpoints)
  `AbstractPixiLayer.modeChanged()`.
- **Check work done without a pass against a pass.** After it, `gfx.immediateRedraw()` should
  change nothing that's shown: `osmSceneState()` in `test/e2e/fixtures.js` describes what's
  shown, for comparing before and after.
- **A `Mesh` whose geometry you replace needs a fixed `geometry.batchMode`** (`'batch'` or
  `'no-batch'`). In `'auto'` mode Pixi batches a mesh up to 100 vertices, and a mesh that crosses
  that line in a frame where its render group is rebuilt crashes Pixi on a later frame (Rapid#1636,
  pixijs#12437).
  Every `LineMesh` is always batched. (The masks that partial fills had were where this was found.)
- **A partial fill is geometry, not a mask.** `PixiFeaturePolygon` fills the band along the inside
  of the edge (`geomAreaBand()` in `modules/geo/band.ts`, which uses Clipper2), with the same
  `Graphics` that fills a whole polygon, and a click hits what's filled. Don't give a fill a
  `mask`: a stencil mask is four instructions and a break in the batch for every area, and they
  were three quarters of Seattle's draw calls. A polygon with no middle that far from its edge
  is filled whole; its `GeometryPart`'s `inradius` says so before Clipper is asked
  (`_bandFor()`, which also keeps the band while the polygon and the zoom are the same).
- **One `cut()` for all the holes of a fill.** Add every hole's `poly()`, then cut once. Pixi's
  `cut()` looks back two instructions: a second one also cuts the fill before, which matters as
  soon as a `Graphics` has two fills (a band in several pieces).
- **Pixi's accessibility layer is off** (`activateOnTab: false`): Tab moves between the UI's fields.
- **The `Application` options live in `GraphicsSystem._initPixi()`**, with reasons (`multiView` for the
  minimap, `autoStart: false`, the renderer choice from the url).

## Frames, passes and redraw requests

How a frame is made, the cull box, frame pacing and the frame's deadline are in
[`design/graphics-system.md`](../../design/graphics-system.md), and the measurements behind them
in [`design/graphics-system-log.md`](../../design/graphics-system-log.md). The words for all of it (tick, frame, APP and DRAW phase, pass, held frame, animation draw, batch,
chunk, …) are defined in its "Words used here": use them that way. The rules that come out of it:

- **A layer's `render()` and `cull()` take the `RenderFrame`**, and so does `retainFeature()`. Pass it
  on to the layer's own `render…()` helpers.
- **A redraw request means something changed. Name the layer if only one did.**
  `gfx.deferredRedraw()` and `gfx.immediateRedraw()` make every layer do its whole pass on the next
  frame. When what changed is drawn by one layer only (a tile of imagery arrived, a label texture
  was made, a dataset's data loaded), pass that layer's ID: `gfx.deferredRedraw(this.id)`. Then
  layers like OSM can keep their features as they are. Turning a layer on or off asks for a
  redraw of that layer alone (`scene.enableLayers()` and the others). The requests left without
  a layer are for changes that reach every layer: the styles, the locale, the schema, the area
  fill, the color scheme, debug flags, a reset, another OSM connection or user. Nothing on the
  map changed (a filter on a container, frame stats turned on)? Ask for a frame:
  `gfx.requestFrame()`.
- **Every change to what a layer draws needs a redraw request.** Moving the view doesn't make one,
  and the OSM layer skips its pass on frames that come only from a move. Marking features dirty
  (`dirtyScene()`, `dirtyLayers()`, `dirtyData()`) makes their layer do its next pass, but doesn't
  ask for a frame. (Changing a class, `dataChanged()` and `dataArrived()` do ask for one: above.)
- **A layer that can skip its pass gathers by `frame.cullBox`, not by the view.** The box is the
  view and padding around it. Call `this.keepFeatures(frame)` in `render()`, after anything that
  must happen on every frame (asking the service for the view's tiles), and return if it says
  `true`. Every layer that draws data does (OSM, Rapid, custom data, photos, detections, QA,
  GeoScribble). Don't use it in a layer whose features depend on the view itself (the labels, the
  imagery tiles).
  - **Ask `this._gatherExtents(frame, viewport)` what to gather,** after asking the service for
    the view's tiles, and return if it gives none. It gives the cull box for a pass, and only the
    strips the box moved over when the view left it; gather in each with
    `this._gatherIn(extents, extent => service.getData(…, extent))`. A service's getter takes the
    extent to look in (passed to `spatial.getVisibleItems(spatialID, extent)`).
  - **What the box left behind is culled later** (`cullLater()`), when a frame has time: so a
    feature outside the box may still be visible for a frame or two. It goes by what a pass
    would gather: if a layer draws data because of other data (the Rapid layer, the ends of its
    roads), it says so in `_gatheredInBox()`.
  - **Whatever changes what such a layer draws must ask for a redraw naming it,** or mark its
    features dirty: data arriving, a filter (`PhotoSystem._filtersChanged()`), an issue that
    changed (the QA services' `replaceItem()`), a Rapid feature accepted (`RapidSystem`). A class
    on the layer's own data makes it do its pass by itself (`classChanged()`). Nothing else looks.
- **Count work in passes, not frames.** `cull()` destroys a feature after 20 passes without seeing
  it, and a layer that kept its features did no pass.
- **Work out a feature's style when `feature.needsStyle` says so, not when it's `dirty`.** A zoom
  makes every feature dirty (it has to be drawn again), but what it is hasn't changed, and matching
  a style to tags costs several times what drawing does. Keep under `if (feature.dirty)` only what
  depends on the zoom or the rotation.
  ```ts
  if (feature.needsStyle) {
    feature.style = styles.styleMatch(entity.tags, geometry, 'osm');
    feature.label = l10n.displayName(entity.tags);
  }
  this.updateFeature(feature, frame, viewport);   // draws it now, or in a later frame
  this.retainFeature(feature, frame);
  ```
- **For a new zoom or rotation, `scene.dirtyTransform()`. For anything else, `scene.dirtyScene()`**
  (or `dirtyLayers()`, `dirtyData()`): those say the features themselves may have changed, and
  set `needsStyle`.
- **In a layer that keeps its features, draw with `this.updateFeature(feature, frame, viewport)`,**
  not `feature.update(viewport)`, and call `this.continueWaiting(frame, viewport)` on the frames
  where `keepFeatures()` says yes. A feature may then be drawn a few frames late, so
  don't read anything off a feature that's still `dirty` (its bounds, its hit area).
- **A feature may not exist yet for data the layer has seen.** The OSM layer puts off making
  features that aren't needed at once (`_waitToMake()`), and makes them over the next frames.
  Code that looks a feature up right after data arrives should wait for `gfx.pending` to be
  `false`, or handle it not being there.
- **Go easy on the OSM API when measuring.** `bun run measure --fresh` and every reload of the
  debug Chrome ask it for 20 to 36 map tiles. After enough of them it answers 429 (five loads of
  Užice in an hour and a half did it), and the map stays empty until the time it gives is up. To
  make features again without the network, use `layer.reset()`. To load a place again and again,
  record it once: `--tape places.tape.json` on `bun run measure` and `bun run compare`
  (`scripts/tape.ts`).
- **A redraw request without a layer is a pass in every layer.** In a dense place that's 200 ms
  of the OSM layer walking everything it has, to find the little that changed. Don't make one
  for each item of something that arrives in hundreds (each icon, each tile of another layer):
  name the layer, or go on with waiting work (below).
- **When a texture arrives, call `scene.texturesLoaded()`, not `deferredRedraw()`.** A feature
  drawn without its icon stays dirty (`PixiFeaturePoint.updateStyle`), and a layer that draws
  with `updateFeature()` remembers it. `texturesLoaded()` has those drawn again over the next
  frames, and asks for a frame (`gfx.requestFrame()`), not for a pass.
- **A layer's `render()` can run 60 times a second.** While the view moves, a frame is drawn on
  every tick. Whatever a layer does before `keepFeatures()`, and everything in a layer that doesn't
  call it, is paid on each one. The same goes for listeners to `gfx`'s `draw` event: throttle them
  (`scheduler.throttle()`).
- **`immediateRedraw()` is for something the user did.** It skips the wait that spaces out
  expensive frames. With a layer's ID, only that layer is drawn at once (in a held frame, if a pass
  is waiting). For data that arrived, use `deferredRedraw()`.
- **Don't change the frame loop's timing without measuring it.** `bun run measure` reports frames
  a second and long ticks while the view moves on every tick (`glide`), and section 9 of
  `design/graphics-system-log.md` has a real drag and a load to compare with. `FramePacer` holds the rule and has unit
  tests; `test/e2e/rendering.test.js` checks it in a browser.

## Working with Services

All services are now TypeScript. Access them via `context.services` with proper types:
- Use optional chaining since services may not be instantiated: `const mapillary = context.services.mapillary;`
- Or use non-null assertion if you know the service exists: `const osm = context.services.osm!;`
- Import the service type if needed: `import type { MapillaryService } from '../services/MapillaryService.ts';`

All core systems ARE now TypeScript - use non-null assertion:
- `const photos = context.systems.photos!;`
- `const editor = context.systems.editor!;`

Use `!` for systems that definitely exist when the code runs. Only use `?.` for truly optional dependencies.

## Viewport Type

Import `Viewport` from `@rapid-sdk/math`, not from `pixi-viewport`:
```typescript
import type { Viewport } from '@rapid-sdk/math';
```

## Style Objects

### Getting Styles from StyleSystem

For OSM features (polygons, lines, vertices, points), always get the base style from `StyleSystem.styleMatch()`:

```typescript
const styles = context.systems.styles!;
const style = styles.styleMatch(entity.tags, geometry) as MatchedStyle;

// Then apply any necessary overrides
if (node.hasInterestingTags()) {
  style.marker.image = 'taggedCircle';
}
feature.style = style;
```

**Why:** `styleMatch()` returns a fully resolved style with:
- Defaults filled in from `styleDefaults`
- Fallback cascading (base.color → marker.color, etc.)
- Selector-based style matching (highway=primary → road_primary style)
- Structure overrides (bridge, tunnel, surface)
- Lifecycle overrides (abandoned, proposed, etc.)

**Don't** construct hardcoded style objects when `styleMatch()` could be used:
```typescript
// BAD - bypasses styleMatch(), ignores custom styles
const markerStyle: Partial<MatchedStyle> = {
  icon: { image: iconName, color: 0x111111, opacity: 1, size: 11 },
  marker: { image: 'smallCircle', color: 0xffffff, opacity: 1 }
};
```

### Constant Styles for Non-OSM Features

For non-OSM layers (photos, QA issues, debug overlays), define constant style objects. All style properties are **optional** — use type assertions:

```typescript
import type { MatchedStyle } from '../core/StyleSystem.ts';

const LINESTYLE = {
  casing: { alpha: 0 },
  stroke: { alpha: 0.7, width: 4, color: 0x0fffc4 }
} as Partial<MatchedStyle>;

const MARKERSTYLE = {
  marker: { image: 'mediumCircle', color: 0x0fffc4, opacity: 0.8 }
} as Partial<MatchedStyle>;
```

Style type interfaces are defined in `modules/lib/Style.ts`:
- `StyleProps` — Full style with all property groups
- `FillStyleProps` — Area fill (color, opacity, width, pattern)
- `LineStyleProps` — Line casing/stroke (color, opacity, width, cap, join, dash)
- `PointStyleProps` — Marker, icon, lineMarker, sidedMarker (color, opacity, image, size, anchor, scale)
- `ViewfieldStyleProps` — Extends PointStyleProps with `angles` array
- `LabelStyleProps` — Label (color, opacity, size)

The resolved style returned by `StyleSystem.styleMatch()` is a `MatchedStyle` (defined in `modules/core/StyleSystem.ts`).

## D3 Selection Types

D3 selection variables follow a naming + typing convention:
- Variables prefixed with `$` are D3 selections — type them as `D3Selection`
- Variables prefixed with `$$` are D3 _enter_ selections — type them as `D3EnterSelection`
- Import from `'d3-selection'`: `import type { D3EnterSelection, D3Selection } from 'd3-selection';`
- For `merge()` calls combining a selection with an enter selection, cast to `D3Selection`:
  ```typescript
  $label = $label.merge($$label) as D3Selection;
  ```
- Avoid using `as any` for D3 selection code — use these types instead

## Type-Only Imports

When importing data classes (`GeoJSONData`, `MarkerData`) only for type annotations, use `import type`:
```typescript
import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { MarkerData } from '../data/MarkerData.ts';
```

## Binding Data to Features

Data is never changed in place: a change is a new object (`d.update(...)`), with a new `Geometry`.
So a layer binds a feature's data and geometry part whenever either is a different object, not only
when it creates the feature. Style that depends only on the layer can stay in the creation block.

```typescript
if (!feature) {
  feature = new PixiFeaturePoint(this, featureID);
  feature.parentContainer = parentContainer;
}

if (feature.data !== d || feature.geometry !== part) {   // changed data is a new object
  feature.geometry = part;
  feature.data = d;
}
```

- Don't compare version numbers (`v`): there is no `feature.v`, and nothing changes a datum's `v` in place.
- OSM ways and relations: take the part from `graph.geometry(entity).parts[i]`, never `entity.geoms`
  (it throws for them). See `PixiLayerOsm` and [`design/graph-geometry.md`](../../design/graph-geometry.md) section 4.
- Setting `feature.data` marks the feature dirty, so it's restyled on the next `update()`. Changes
  that don't make a new object (e.g. a vertex becoming shared) are marked with `scene.dirtyData()`.

## Filtering Data (MarkerData, GeoJSONData, etc.)

When filtering `MarkerData` or `GeoJSONData` data, always access `.props` for filterable data (not `.properties`):

```typescript
filterMarkers(markers: MarkerData[]): MarkerData[] {
  return markers.filter(marker => {
    const props = marker.props;
    // Check types before using values
    const capturedAt = props.captured_at;
    if (typeof capturedAt === 'number' || typeof capturedAt === 'string') {
      const timestamp = new Date(capturedAt).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
    }
    return true;
  });
}
```

Key points:
- Use `marker.props` or `sequence.props` (not `.properties`)
- Extract values into variables and check their types before using
- Cast when needed: `props.captured_by as string`

## D3 Selection Callbacks

D3's `.data()` and other selection methods have complex generic signatures. TypeScript often can't infer the datum type in callbacks. Explicitly annotate callback parameters:
```typescript
.data(blocks, (d: GeoJSONData) => d.id)
.text((d: GeoJSONData) => d.props.text as string)
```

