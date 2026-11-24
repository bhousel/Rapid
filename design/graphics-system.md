# GraphicsSystem: how the map is drawn

How `GraphicsSystem` and the Pixi scene under it draw the map: what owns what, how a frame is made
and paced, how layers keep the work of a frame small, how features are drawn in batches with
shaders of our own, and the decisions behind it.

> **Status:** Built (Nov 2026), merged with PRs #10, #11 and #12. Pixi 8.23 is the GPU runtime: it
> owns the WebGL and WebGPU state, textures, render groups and the draw calls. The frame loop, the
> cull box, pacing, the frame's deadline, label placement, the batches and their shaders, the hit
> test and the line builder are ours. What's left is under "Where it's heading", below, and in
> `knowledge/backlog.md`, "Pixi rendering follow-ups".
>
> This doc says how it works now. How it got here (the measurements, what was tried and dropped,
> the order it was built in) is in [`graphics-system-log.md`](graphics-system-log.md). When a
> change makes this doc wrong, fix it here, and put what you measured in the log.

Related docs: [`scene.md`](scene.md) (the display tree, draw order, render groups, what the pointer
can reach), [`scheduler-system.md`](scheduler-system.md) (the game loop, its ticks and their
budget), [`filter-system.md`](filter-system.md) (hidden features, and a level of detail),
[`style-system.md`](style-system.md), [`profiling.md`](profiling.md) (memory and leaks). The rules
for code in `modules/pixi/` are in [`modules/pixi/AGENTS.md`](../modules/pixi/AGENTS.md).

## Words used here

These are the words for the frame loop everywhere: in this doc, in the code and in the other docs.
A frame is made in **phases** (APP, then DRAW); a **pass** is a walk over a layer's data, and an
APP phase may have one or not.

```
tick (a requestAnimationFrame callback): SchedulerSystem._onTick
 ├ GraphicsSystem._tick
 │  ├ a DRAW left over from the last tick? → DRAW phase, and nothing else
 │  ├ _updateTransform()
 │  ├ a frame wanted? → APP phase: _app(mayPass)        ← starts a frame (a RenderFrame)
 │  │    ├ may a pass happen? (FramePacer's gap) → new cull box; the frame's deadline
 │  │    ├ scene.render(): each layer's render() (a pass, or kept), then cull()
 │  │    │    (the labels layer places labels from its queue until the deadline)
 │  │    ├ time left → features put off outside the view
 │  │    └ APP took under 8 ms? → DRAW phase in this tick too
 │  ├ no frame drawn? → the CSS transform follows the view
 │  └ nothing pending, something moves by itself, AnimationPacer due → an animation draw
 └ the scheduler's tasks (a share of every tick)

pointer event (outside the loop) → PixiEvents → scene.hitTest() → a layer's hitTest()
```

**The loop**
- **Tick:** one `requestAnimationFrame` callback. `SchedulerSystem` runs the loop
  (`addTickCallback()`), and `GraphicsSystem._tick()` decides what this tick does: an APP phase, a
  DRAW phase, both, an animation draw, or nothing.
- **Frame:** everything needed to draw the map once: an APP phase and the DRAW phase that shows
  it (`RenderFrame`, numbered, kept in `gfx.renderFrames`). Rapid keeps one frame in flight, and
  its work may be spread over more than one tick.
- **APP phase:** Rapid's half of a frame (`GraphicsSystem._app()` → `PixiScene.render()` → each
  layer's `render()` and `cull()`). It places the stage, picks the cull box and the deadline, and
  brings the scene up to date.
- **DRAW phase:** Pixi's half (`GraphicsSystem._draw()` → `pixi.render()`). Pixi walks the render
  groups, builds the instruction lists of those that changed, uploads what changed in our
  batches, and issues the draw calls. Then the `draw` event.
- **Animation draw:** the scene drawn again as the last frame left it, because something in it
  moves by itself (a hover's glow, a selection's dashes). A DRAW with no APP: not a frame, not in
  `renderFrames`, no `draw` event (`_drawAnimation()`, `AnimationPacer`, `gfx.animationDraws`).

**In the APP phase**
- **Pass (of a layer):** a layer's walk over its data: gather what's in the cull box, update its
  features and mark them seen, then `cull()` hides the ones it didn't see. It's the expensive
  part, and an APP phase may have none.
- **Pass frame:** a frame in which layers had a pass to do: a redraw was requested, or the view
  needed a new cull box. A frame that only moves the view isn't one. (The OSM layer follows a
  cull box that moves, or a new zoom, without a pass: "The pass, and what asks for it".)
- **Gap:** how long a pass frame waits after the one before it. It grows with what that one cost
  (`FramePacer`, "Frame pacing").
- **Held frame:** a frame made while a pass frame waits for its gap. It moves the view, and every
  layer that can keeps its features.
- **Cull box:** the part of the world a frame wants features ready for: the view, and padding
  around it. While the view moves inside it, a layer needs no pass ("The cull box").
- **Cull:** a layer hiding the features its pass didn't see, and destroying the ones it hasn't
  seen for a while (`cull()`).
- **Kept:** a layer kept its features in a frame when it skipped its pass, because only the view
  had moved, inside the cull box it already had everything for. The OSM layer also keeps them
  when it's told which data changed, or follows the cull box when that moves.
- **Deadline:** the time in a frame's APP phase after which work that can wait is put off to a
  later frame: making features, drawing them again after a zoom, placing labels ("A deadline on
  the frame").
- **Waiting:** a feature is waiting when it's dirty and its layer put off drawing it again. It's
  shown as it was last drawn, or not at all if it's new. A frame that leaves work waiting is
  **unfinished**, and another frame follows.
- **Chunk:** a few entities taken at a time when a layer makes or draws features that waited or
  arrived (`MAKE_CHUNK`, `ARRIVED_CHUNK`), with a look at the deadline between chunks.
- **Draw (a feature):** a feature is drawn (again) when its `update()` runs in the APP phase. A
  feature **draws itself** when it has Pixi objects of its own in the scene, not only items in
  batches (`drawsInContainer()`).
- **Label placement:** the labels layer's part of the APP phase. It places labels from a queue,
  those in view first, until the deadline, and not while the zoom or rotation is changing
  ("Label placement").
- **Label space:** the screen minus an offset that moves with every pan, so a pan changes nothing
  in it: what labels are placed in, and what the avoid grid covers. `scene.labelSpace` works it
  out at the start of each APP phase, and carries what features tell the labels layer (what
  changed, what was drawn over a label or left a place).

**Asking for a frame**
- **Redraw request:** a call to `deferredRedraw()` or `immediateRedraw()`. It says that something
  the map draws has changed, so layers need a pass: it asks for APP work, not only a DRAW. Moving
  the view isn't one.
- **`requestFrame()`:** asks for a frame without saying anything changed, after the layers were
  told some other way. The scene calls it when a class changes, when it's told of data that
  changed or arrived (`dataChanged()`, `dataArrived()`), and when textures arrive, so callers of
  those don't.

**Outside the frame**
- **Hit test:** finding what's under the pointer. It runs on each pointer event, not in a frame:
  `PixiEvents` asks `PixiScene.hitTest()`, which asks the layers that find their own features
  through a spatial index (`setHitTester()`), and Pixi's walk for the rest.

**Pixi's words**
- **Render group:** a container that keeps its own instruction list, which Pixi builds again only
  when something in it changed.
- **Instruction:** one entry in a render group's instruction list. Each names the pipe that runs
  it: `batch`, `graphics` (a `Graphics` drawn on its own), `mesh`, `stencilMask`, `filter`.
- **Draw call:** one `drawElements`/`drawArrays` (WebGL), or `draw`/`drawIndexed` (WebGPU).
- **Pixi's batch:** consecutive drawables that Pixi merges into one draw call, copying their
  vertices into a buffer of its own. It ends when the next drawable can't join it (a different
  blend mode, too many textures, a mask, a filter, or something that isn't batchable). Always
  say "Pixi's" for this one.

**Our words**
- **Batch:** one of our `BatchMesh`es (`LineBatchMesh`, `FillBatchMesh`, `PointBatchMesh`): a Pixi
  `Mesh` with a shader of our own, holding many features' vertices, kept from frame to frame and
  drawn in one draw call. A feature is an **item** in it, a run of its vertices. Not part of
  Pixi's batches. A layer keeps its batches in a `LayerBatches` (`layer.batches`), and
  every batch of a kind draws with its scene's shader for that kind (`scene.batchShaders`), which
  the scene tells the view and the clock.
- **`LineMesh`:** one line drawn from its stroke mesh, for what isn't in a batch (the lasso, and
  a line whose dashes a batch can't draw).
- **Stroke mesh:** the triangles that draw a line at any width, built once
  (`geomStrokeMesh()`; "The line builder").
- **Render:** a method name on both sides (a layer's `render()` is APP work, `pixi.render()` is
  DRAW), so it's not the name of a phase.
- **Partial fill:** the default area style. Only a band 32 px wide inside the outline is filled
  (`PARTIALFILLWIDTH` in `PixiFeaturePolygon`); the `map.areaFill` setting can make it full.

## What a frame costs now

The last measurements, Nov 20 to 23 (the log's sections 11 and 12, and section 15, steps 6, 9
and 10), from the tapes of three of the difficult places ("Measuring"). Boundaries hidden, labels
on.

| | Seattle z17.5 | Staten Island z16.5 | Užice z16 |
|---|---|---|---|
| Features on the map (the view and the cull box's padding) | 7,747 | 22,173 | 84,606 |
| Draw calls | 20 | 13 | 22 |
| Render groups | 40 | 36 | 40 |
| DRAW, nothing changed / a pan / the cull box moves | 0.3 / 0.6 / 0.9 ms | 0.2 / 0.5 / 0.8 ms | 0.3 / 0.5 / 0.8 ms |
| GPU (timer query) | 4.2 ms | 6.0 to 6.4 ms | 19 to 22 ms |
| The OSM layer's pass, nothing changed (Nov 20) | 9.5 ms | 24.5 ms | 134 ms |
| A hover on a road, APP + DRAW | | | 1.3 + 0.8 ms |
| A hit test for one pointer event | 0.02 ms | | 0.07 ms |

With the other layers on too (Bellevue at z17.5, Nov 24: 13,000 Mapillary photos, 6,400
detections, a buildings dataset and the QA layers), a frame that only moves the view is about 22
ms of APP (their passes) and 1.5 ms of DRAW, in 28 draw calls (the log's section 16).

Where the time goes:

- **The GPU's time is mostly fixed costs** (the log's section 6): clearing and resolving a 4×
  MSAA canvas at ratio 2, and `multiView`'s copy of every frame onto the visible canvas (1.5 to
  2 ms, there for the minimap). What Rapid draws is a few ms of it, more only in Užice.
- **A pass is what's expensive,** and the OSM layer rarely does one now: not for a pan, a zoom,
  a hover, an edit, a change of mode or data that arrives. The other layers still do theirs on
  every frame.
- **Garbage collection** was the longest stall after the pass was gone (the log's section 13).
  Batches took most of the garbage away: sixteen zooms in Užice allocate 2.9 GB, where they
  allocated 18.1 GB, and the heap after a load there is 1.37 GB, where it was 2.27.
- **Draw calls** cost next to nothing on the M4, and they're counted as a result anyway: many
  users have weaker hardware (Bryan, Nov 23).

## What owns what

- **`GraphicsSystem`** (`modules/core/`): the Pixi `Application` and its options (`_initPixi()`,
  with reasons), the tick (`_tick()`), the map's transform and the `origin` container that maps
  world coordinates to the screen, frames (`RenderFrame`, the last 120 in `gfx.renderFrames`),
  redraw requests, the pacers (`FramePacer` as `gfx.pacer`, and `AnimationPacer`), and frame
  stats. Pixi's own tickers are stopped: the system ticker gets a turn once a second, for Pixi's
  scheduler that frees unused GPU resources.
- **`PixiScene`**: the layers, and the display tree under `origin` ([`scene.md`](scene.md)); the
  cull box; classes (hover, select, highlight, …); the label space (`scene.labelSpace`); the
  shaders every batch draws with (`scene.batchShaders`); the hit test (`scene.hitTest()`); and the
  clock (`scene.animate()`).
- **Layers** (`AbstractPixiLayer`): each owns its features, and its `render()` and `cull()` are
  its pass. Every layer that draws data draws it in batches (`layer.batches`) and finds its own
  features under the pointer. The OSM layer is the one that keeps its features and takes changes
  without a pass.
- **Features** (`AbstractPixiFeature`, with `PixiFeatureLine`, `PixiFeaturePolygon`,
  `PixiFeaturePoint` and `PixiFeatureLabel`): one for each thing drawn. A feature holds its data,
  its style and its classes, and draws itself into items in batches, or into Pixi objects of its
  own.
- **`modules/pixi/lib/`**: the batches (`BatchMesh` and its kinds), `BatchShaders`,
  `LayerBatches`, `LabelSpace` and `AvoidGrid`, the pacers, `LineMesh`, `LineHitArea`, and
  `RenderStats` (the one place that reads Pixi's internals). [`lib/README.md`](../modules/pixi/lib/README.md)
  has a line for each.
- **`PixiTextures`**: the atlases. Icons, markers and glows are in the symbol atlas, area patterns
  in an atlas of their own, imagery tiles and label text in theirs.
- **`modules/geo/`**: the line builder (`stroke.ts`) and the partial-fill band (`band.ts`), plain
  geometry with no Pixi in it.
- **`SchedulerSystem`** runs the loop and gives its own tasks a share of every tick.

## How a frame is made

`SchedulerSystem` owns the `requestAnimationFrame` loop and calls `GraphicsSystem._tick(deltaMS)`
once per tick. A tick does this:

1. **DRAW**, if an APP phase from the tick before is waiting for it, and nothing else.
2. Otherwise `_updateTransform()` moves an eased transform along and takes up a change of the
   map's size.
3. **APP**, if a frame is wanted: the view moved, a redraw was requested, a frame was asked for
   (`requestFrame()`), or the last frame left work waiting. `_passAllowed()` asks the
   `FramePacer` whether this frame may do a pass ("Frame pacing").
   - If it may: when the zoom or the rotation changed, or the map moved more than 100,000 px,
     every feature is marked to be drawn again (`scene.dirtyTransform()`); otherwise only the
     `origin` container moves. The frame takes the redraw requests made since the last one, and
     its cull box ("The cull box").
   - If it may not, the frame is **held**: it only moves the view. The redraw requests stay where
     they are and the cull box stays the same. If moving the view isn't enough (the zoom or the
     rotation changed, or the view didn't move), no frame is made on this tick.

   Then `scene.render(frame, viewport)`. The frame has a deadline: work that can wait is put off
   once it has passed, and if any was, another frame follows on the next tick ("A deadline on
   the frame").
4. **DRAW in the same tick**, if the tick has used less than 8 ms so far (`DRAW_SAME_TICK_MS`), as
   it has after a frame that only moved the view. Otherwise DRAW waits for the next tick. DRAW
   resizes the renderer if needed, calls `pixi.render()`, drops the CSS transform, emits `move` if
   the map is somewhere new on screen (the edit menu follows it) and `draw`, and counts the frame.
5. On a tick that drew nothing, `_followTransform()` follows the map's transform with a CSS
   transform on the `supersurface`, so a zoom still looks smooth while its frame waits.
6. **An animation draw**, on a tick with no frame to make or draw, when something shown moves by
   itself and `AnimationPacer` says one is due ("Animation draws").

Both phases leave performance measures (`app-N`, `draw-N`) in a DevTools recording. The minimap
renders the same stage a second time into its own canvas (`UiMinimap`), which is why the renderer
has `multiView` on.

**What makes Rapid unlike a game:** we don't know what we're drawing until the APP phase has run.
The user can put the map anywhere in the world, at any zoom, with any layers on. A street grid in
Seattle, a parking lot with 5,000 individually mapped stalls, a wetland traced with thousands of
nodes, and an undersea cable crossing an ocean are all normal OpenStreetMap. So:

- **Costs are measured per frame,** as the frame is made, not designed per level ahead of time.
  That's why the frame is the unit that stats are gathered on ("Frame stats").
- **A change is judged on a set of difficult places,** not one ("Measuring"). An approach that
  works well in one place can fall over in another.
- **Work that can wait does.** A frame has a deadline, and what doesn't fit is drawn over the
  frames after it, the view first.

The stages are SGI Performer's (APP, CULL, DRAW), and so are frame stats (`pfFrameStats`). The
part of Performer that isn't built is its load management: lowering the level of detail when a
frame runs over. That's the filter in [`filter-system.md`](filter-system.md) section 6.

## Asking for a frame

A frame is wanted for one of four reasons, and it carries which:

- **The view moved** (a change of the transform). That alone is never a redraw request: layers
  that can keep their features do.
- **A redraw request:** something a layer draws changed, and the layer needs its pass.
  `frame.contentChanged` is a request for the whole scene, `frame.changedLayerIDs` the layers
  named, and a layer asks `frame.changedFor(layerID)`. `frame.requestedFor(layerID)` is true only
  for a request, not for a zoom (which also makes `changedFor()` true), so a layer can tell "the
  data changed" from "the view did".
- **`requestFrame()`:** the layers were told what changed some other way (below).
- **Work left waiting** by the last frame (`frame.unfinished`).

**`immediateRedraw()` is for something the user did:** the pass doesn't wait for its gap, and the
frame is **urgent** (`frame.urgent`): what the user changed is drawn whatever the deadline.
**`deferredRedraw()` is for data that arrived:** it waits at least 250 ms, so arrivals batch up.

**A request names its layer when only one layer's drawing changed.** A request without one makes
every layer do its pass, and the OSM layer's is 134 ms in Užice. So the imagery names
`'background'`, the lasso and the geolocation dot `'map-ui'`, a dataset `'rapid'`, a photo or QA
service the layer that draws its data, and the filters `'osm'`. Turning layers on or off redraws
only the layers that were turned on or off (`scene.enableLayers()` and the others, which always
emit `layerchange`). The requests left without a layer are for changes that reach every layer:
the styles, the locale, the schema, the area fill, the color scheme, debug flags, a resume or a
reset, another OSM connection or user, and icons that were registered (`UiDefs`).

**What asks for a frame instead of a pass.** The scene asks for one itself when a class changes
(`setClass()`, `unsetClass()`, `clearClass()`), when it's told of an edit or of data that arrived
(`dataChanged()`, `dataArrived()`), and when textures arrive (`texturesLoaded()`). A change of mode
asks for one (`Context.enter()`): what a mode changes on the map reaches the layers as classes,
edits, or `AbstractPixiLayer.modeChanged()`. Turning frame stats on and the colorblind filter ask
for one too: nothing in the scene changed.

**Every change to what a layer draws has to reach it**, because a layer that keeps its features
won't look. Marking features dirty (`dirtyScene()`, `dirtyLayers()`, `dirtyData()`) makes their
layer do its next pass, but doesn't ask for a frame. Every path that changes what the OSM layer
draws was traced once (the log's section 8, "Redraw requests, checked"), and the e2e tests check
work done without a pass against a pass ("Checked against a pass", below).

## The cull box

A layer doesn't need to decide what's in view on every frame.

- **The cull box** (`PixiScene.updateCullBox()`, on the frame as `frame.cullBox`) is the view in
  world coordinates, with 256 px of padding on each side (`CULL_PADDING`). It's kept, as the same
  object, for as long as the view stays inside it at the same zoom; when the view leaves it, a new
  one is made around the view. A layer gathers its data by the box, so everything in it is made
  and shown, also the part outside the view. (Keeping the box until the view leaves it does what
  a grid would, with less padding, and a view that moves back and forth across a grid line would
  need a new box each time.)
- **A layer keeps its features** when nothing changed for it and the frame's cull box is the one
  it already did a pass for: `AbstractPixiLayer.keepFeatures(frame)`. Its `render()` returns, and
  `cull()` leaves the features alone too. The OSM layer still asks for the view's tiles first
  (`context.loadTiles()`), so data keeps loading as the view moves.
- **Marking features dirty makes their layer do its next pass** (`dirtyLayer()`,
  `dirtyFeatures()`, `dirtyData()`, and the scene's versions), whatever the frame is for. So does
  a `render()` that returned before asking (the layer is off, or zoomed out too far).
- **Passes are counted, not frames.** `cull()` destroys a feature that 20 passes haven't seen
  (`KEEP_UNSEEN_PASSES`). The OSM layer, which seldom does a pass, counts the moves of its cull box
  instead: a feature hidden for 20 moves is destroyed (`KEEP_HIDDEN_MOVES`, `_forgetHidden()`).
  Panning back within that finds it still made.
- **Layers that don't keep their features** do their pass on every frame: the imagery tiles and
  the labels follow the view itself, and the data layers (Rapid, photos, QA) haven't been changed
  yet. That's cheap where it was measured (the Rapid layer 0.1 to 0.6 ms), but it's paid on
  every tick while the view moves.

A pan frame that only moves the view costs 1 to 1.5 ms of APP and under 1 ms of DRAW, where every
frame was a pass of 6 to 66 ms before the cull box (the log's sections 8, 9 and 15).

## Frame pacing

The frame rate floats with what's going on: 60, 30 or 20 frames a second when the work allows.
Rapid isn't a game and needn't hold 60 (at 10 it's usable and visibly laggy), and it keeps
leaving time for input and the scheduler's background work (Bryan, Nov 19).

A frame that has no pass to do is drawn on the next tick, APP and DRAW together. A pass frame waits
its turn, and how long depends on why it's wanted:

| Why the pass is wanted | It waits |
|---|---|
| `immediateRedraw()`: the user did something | Not at all |
| `immediateRedraw(layerID)`: one layer has something to show now (a label texture) | That layer is drawn on the next tick. Anything else that's waiting keeps waiting. |
| The view needs it: it left the cull box, or the zoom or rotation changed | The gap: twice what the last pass frame cost (APP and DRAW together), at most 250 ms |
| `deferredRedraw()`: data arrived | Twice what the last pass frame cost, at least 250 ms (so that arrivals batch up) and at most 1 s |

So passes take at most a third of the time, and data that arrives is drawn at most four times a
second. (Since the OSM layer follows the cull box and takes arrivals without a pass, the
second-to-last row is for the other layers.)

**While a pass frame waits, the view doesn't have to:** a held frame is drawn on every tick that
the view moved. It tells the layers that nothing changed and gives them the cull box they had, so
the OSM layer keeps its features (`keepFeatures()` says yes in a held frame even for features
marked dirty since). A held frame can't follow a change of zoom or rotation, because features are
styled for their zoom. Then no frame is made, and the CSS transform carries the view.

`FramePacer` (`modules/pixi/lib/`) holds the rule, with no clock of its own: `GraphicsSystem` tells
it when a pass begins and what it cost, and asks how long the next must wait. A frame records
whether it was held (`frame.held`).

What follows from it:

- **Frames on every tick keep the processor fast.** An idle thread is slowed down within 50 ms,
  and a pass after a pause of 250 ms costs twice what it does straight after another (the log's
  section 9). A drag's pointer events keep the page busy; a measuring script's pans don't, which
  is why `bun run measure` runs its frames back to back.
- **`draw` is emitted for every frame,** up to 60 times a second. A listener to it should
  throttle itself (`scheduler.throttle()`).
- **A layer's `render()` can run 60 times a second.** What a layer does before `keepFeatures()`,
  and everything in a layer that doesn't call it, is paid on every tick of a pan.

## A deadline on the frame

A pass frame was one block of work, however long. Now the work that can wait does.

**Drawing a feature again isn't styling it again.** A zoom makes every feature dirty, but a
feature's style doesn't depend on the zoom, and matching it to the tags costs several times what
drawing does. So:

- **`feature.dirty`:** it has to be drawn again.
- **`feature.needsStyle`:** the layer should work out its style and label again from its data.
  True for a new feature, when its data is bound again, and when the layer or the scene marks it
  dirty (`dirtyLayer()`, `dirtyScene()`, `dirtyData()`: the styles, the language, the filters or
  the data changed). Not after a zoom or a rotation (`scene.dirtyTransform()`), and not for a
  class.

**The budget.** `GraphicsSystem` gives each frame a deadline, and layers ask `frame.hasTime()`:

- **6 ms** of APP (`APP_BUDGET_MS`) while the view is moving.
- **24 ms** (`STILL_BUDGET_MS`) once the view has been still for 150 ms (`STILL_AFTER_MS`). The
  frames then come at about 30 a second until the work is done.
- **At least half of what recent frames cost anyway,** up to 50 ms (`MAX_APP_BUDGET_MS`). Where a
  frame is expensive whatever changed in it, small steps cost more than they save.

The DRAW phase's share counts against it. Drawing a feature takes little time in APP, because the
GPU work is done in DRAW, so each feature drawn adds what it's expected to cost there
(`frame.drawDebt`: 4 µs for one drawn again, 10 µs for a new or changed one;
`DRAW_MS_PER_REDRAW`, `DRAW_MS_PER_NEW`).

**What waits:**

- **Making a feature** (about 35 µs). Where the OSM layer's loops find an entity with no feature,
  they ask `_waitToMake()`. Outside the view it waits until the view's are made and a frame has
  time to spare; in view it's made while the frame has time; in an urgent frame it's made at once
  only if the user needs it now (they just drew it, or it's a vertex of what they selected). The
  layer remembers what waited, and makes it on later frames, 64 at a time (`MAKE_CHUNK`), in view
  first.
- **Drawing a feature again.** A layer calls `this.updateFeature(feature, frame, viewport)`, not
  `feature.update(viewport)`. A dirty feature in view is drawn while the frame has time; after
  that it waits, and is shown as it was (after a zoom, scaled). A dirty feature outside the view
  always waits. In an urgent frame, a feature in view that changed itself (its data, a class) is
  drawn whatever the time; one that only the zoom made dirty (`onlyTransformDirty`) still waits.
- **Going on with it.** On a frame where a layer keeps its features, it calls
  `continueWaiting()`, which draws what waited in view, at least 32 a frame
  (`MIN_WAITING_PER_FRAME`). After every layer has rendered, the scene calls it again for what's
  outside the view, with whatever time is left.
- **Placing labels** ("Label placement").

**Another frame.** If any layer has work waiting after a frame (`frame.unfinished`), the next tick
makes another, pass or no pass. These frames aren't paced: they're cheap by construction.
`gfx.pending` is true until nothing is left, and scripts and tests wait for that.

Only the OSM layer checks `needsStyle`, draws with `updateFeature()` and puts off making features.
The other layers check `dirty`, which works as before.

## The pass, and what asks for it

A pass of the OSM layer walks everything in its cull box. Its steps are timed on the frame
(`steps`, "Frame stats"): `gather` (the spatial index), `vertexkinds`, `filter` (hidden features),
`classify` (sorting by geometry), `polygons`, `lines`, `points`, `related`, `vertices`,
`midpoints`. In Užice it's 134 ms with nothing to do: 71 of finding each of 84,606 shown features
and finding nothing to do, 30 of vertices that aren't drawn, 30 of asking each entity for its
geometry twice and sorting.

So the OSM layer does its pass only when it has to, and does the rest of its work without one.
Each of these runs what changed through the same `render…()` functions as a pass does, leaves out
what a pass wouldn't have gathered (hidden, or outside the cull box), and hides the features those
functions didn't want anymore, as `cull()` would have.

### A class change

`PixiScene.setClass()` and `unsetClass()` tell the layers which data changed class
(`AbstractPixiLayer.classChanged()`), and ask for a frame. On that frame the OSM layer runs the
changed data, and whatever was or is now related to it, through `_renderChanged()`. The vertices
that were only drawn because their way was hovered are destroyed. A hover in Užice is about
1.3 ms of APP this way; it was a pass of 175 ms.

### An edit

`MapSystem` hears `stagingchange` with everything the edit affects (`Difference.complete()`: what
changed, the nodes of changed ways, the members of changed relations, and all their parents), and
passes it to `scene.dataChanged('osm', …)`. The OSM layer marks those features dirty and runs them
through `_renderChanged()`, which also makes what's new and hides what's gone. Beyond 5,000
entities (`MAX_CHANGED`: a big undo, a paste) it does its pass, which is cheaper then.

The order inside `_renderChanged()` matters: the shapes of what changed first, then what's related
to the selection, then the vertices. The links between a way and its nodes are made when the way
is drawn, and "related" goes by them.

### A change of mode

`Context.enter()` asks for a frame. The scene tells the layers that the mode changed
(`modeChanged()`), and the OSM layer draws its midpoints again, or takes them away: they're shown in
select mode only. The entities that select mode keeps visible though a filter hides them reach the
scene through `FilterSystem.forceVisible()`.

### Data that arrives

`EditSystem` lists everything on a tile with its `merge` event (also what was there already, and
what the new data reshaped). `MapSystem` passes that to `scene.dataArrived('osm', …)`. The OSM
layer remembers the IDs, and on each frame sorts and draws them 1,000 at a time while the frame has
time (`_renderArrived()`, `ARRIVED_CHUNK`). New entities go through `_waitToMake()` like any
others.

### A cull box that moves

When the view leaves the box and nothing else changed, the new box overlaps the old one, and
what's in both stays as it is (`_moveBox()`). What the box left behind is hidden, by the entity's
whole shape; what it moved over is asked of the spatial index (up to four strips) and remembered
as having arrived, what's in view first.

### A zoom without a pass

A zoom or a rotation changes how every feature is drawn, not which features there are.

- **The OSM layer keeps its cull box through `dirtyTransform()`** (other ways of marking features
  dirty forget it, so they still mean a pass). On the frame of the zoom it follows the box to its
  new size, as for a pan.
- **What stays is remembered as having arrived,** and goes through the `render…()` functions again
  a chunk at a time, in view first, on that frame and the next ones. What's related is worked out
  again on that frame: which vertices and midpoints are shown depends on the zoom.
- **Crossing a whole zoom level moves every feature to another tile's container**, a whole old
  tile at a time (`_retile()`, at least `MIN_RETILE` a frame): the old container is emptied in one
  go and removed, and the new ones are rebuilt once or a few times. Meanwhile a feature that's
  drawn again stays in its old tile (`_setTile()`). The features bigger than a tile at either zoom
  move at once (`_placeLarge()`). Most features are in batches now and their containers hold
  nothing, but the tiles still order what draws itself ([`scene.md`](scene.md) section 3).

A zoom gets a real frame every 110 to 250 ms, and the CSS transform scales the last one in between.

### The vertices that aren't drawn

In Užice 223,044 of the 296,274 entities in the cull box are vertices, and 33,324 of them are
drawn.

- **`OsmNode.vertexKind(graph)`** says what a node is to its ways, in one memoized answer:
  `'tagged'`, `'structural'` (untagged, but its ways end or intersect there), `'shape'` (it only
  gives its way its shape), or `null` for a point. Tagged and structural vertices are drawn from
  effective zoom 16 (`MIN_VERTEX_ZOOM`); a shape vertex only while it's related to what's
  selected, hovered or being drawn.
- **The pass leaves the shape vertices out** right after the spatial index returns them (the
  `vertexkinds` step), and the structural ones below zoom 16. The tagged ones stay, because
  `FilterSystem.filterScene()` counts the ones it hides for the footer.
- **The related vertices are added back** once the pass knows what's related
  (`_addRelatedVertices()`), and arrivals pass the idle ones by (`_isIdleVertex()`, looking at up
  to `ARRIVED_LOOK` for each chunk).
- **The effective zoom grows with the latitude,** so a view that only moves north or south can
  cross 16. The layer notices on a kept frame (`_checkVertexZoom()`).

### What still asks for a pass

- **Anything that marks the whole layer dirty:** a filter, the styles, the language, the schema.
- **A redraw request without a layer** ("Asking for a frame").

**What isn't kept up to date without a pass:** the count of hidden features in the footer comes from
the pass (`FilterSystem.filterScene()`), so after an edit it's the last pass's count.

### Checked against a pass

Work done without a pass has to leave the scene as a pass would. After it, `gfx.immediateRedraw()`
should change nothing that's shown: no feature's visibility, container, order, classes, position or
bound data. `osmSceneState()` in `test/e2e/fixtures.js` describes what's shown, and the e2e tests
compare it before and after a hover, a drag, each click of drawing a line, and a zoom. The log's
section 12 has the larger checks made in Užice when this was built.

## Label placement

Labels are placed around what's drawn, so what's drawn has to be there first (Bryan, Nov 20).
Placement is arithmetic and lookups, with no drawing. Showing the labels that are in view is a
separate, cheap step. Labels' textures are made by the scheduler between frames: rendering a
texture inside `render()` corrupts the render in progress.

- **Avoid:** a place where no label may go, because something is drawn there that a label would
  cover: a pin, a vertex.
- **Placement:** working out where a feature's label goes (`placeTextLabel()`,
  `placeRopeLabel()`).

**Label space** (`LabelSpace`, owned by the scene as `scene.labelSpace`) is the screen minus an
offset that changes by exactly the pan on each frame, so a feature has the same label coordinates
however the map is panned, and what's been placed and marked stays valid until the zoom or the
rotation changes. The scene works it out at the start of each APP phase (`labelSpace.update()`,
with the transform from world coordinates: it has to be this frame's), and starts a new one when
the zoom or rotation changes (`reset()`, from `dirtyTransform()`). The offset is picked near the
view, so the rope labels' vertex math keeps its precision in 32-bit floats. The labels' group undoes
the stage's rotation, so label space is the unrotated screen.

**The avoid grid** (`AvoidGrid`, `labelSpace.avoidGrid`) is label space cut into cells of 2 px
(`AVOID_CELL_PX`), kept in blocks of 64 by 64 made when first written to, so the map can be panned
any distance. Each cell counts what covers it.

- **A point marks itself as it's drawn,** at the end of `update()` (`updateAvoid()`), from where
  it's drawn (`labelBox()`, from arithmetic, viewfields included), and remembers its cells so it
  can unmark them when it moves, is hidden or is destroyed. Nothing gathers avoids from
  containers. Its layer decides whether it's an avoid (`feature.labelAvoid`): OSM, Rapid and
  custom data points are; photo and QA markers aren't.
- **Only handles are avoids among the vertices:** those of what's selected or being drawn
  (`RelatedIDs.handleIDs`), and the vertices that are always drawn. The vertices of a way that's
  only hovered aren't, so a hover moves no label.
- **Placed labels mark a second count** in the same cells. A point drawn over a label sees it
  there (nearly always zero), says so (`labelSpace.avoidHit()`), and the labels layer places that
  label again somewhere else.
- **Labels are compared with each other by their boxes,** in the spatial index, which holds only
  labels (a few hundred). Cells would keep two labels further apart than they need to be.
- **A point's own cells are set aside while its label is placed:** its label goes right next to
  it.

**What gets placed.** A feature tells label space when it's drawn again, shown, hidden, given
another label or destroyed (`labelSpace.featureChanged()`), and the labels layer looks at those
features only (`takeChangedFeatures()`). After a zoom or a reset it looks at every feature once. A
class doesn't mark a label out of date: a hover or a selection changes a label's color, not its
place. A feature that found no room is kept with the box where its label would have gone, and
tried again when something there is freed (`labelSpace.avoidFreed()`: an avoid hidden, moved or
destroyed, or a label taken away; past 64 freed boxes in a frame, one box around them all).

**Placement takes the queue in parts** (`_placeQueued()`): the features in view first, and of those
the points, then the lines, then the polygons, while `frame.hasTime()`, after a minimum of 25. What's
left waits, and the layer reports it, so another frame follows.

- **The gate:** nothing in view is placed while features in view are waiting to be drawn or made
  (`frame.waitingInView`), only the user's own change.
- **No labels while the zoom or rotation is changing:** placement waits until both have stayed the
  same for 150 ms (`SETTLE_MS`), urgent frames too. Labels placed between two steps of a pinch only
  flashed.
- **An urgent frame places what changed in it,** not the whole queue.
- **A layer that shows no labels forgets what it placed,** once, and throws label space's notes
  away. (Otherwise they piled up as work waiting, and frames never stopped.)

**Decided (Bryan, Nov 20):**
- **Which points are avoids:** everything in the `points` group (OSM, the Rapid datasets, custom
  data) and the selected vertices. Photo and QA markers aren't.
- **A point's viewfields are part of its avoid.** A label for a railway shouldn't cover the
  viewfields of the signals along it.
- **A label stays where it is unless something is drawn on top of it.** A label that moved for a
  selection stays where it went when the selection ends: moving back would be a second jump.

Labels come in over a few frames after a zoom (four to seven of 2 to 8 ms in Užice), about 0.4 s
after it ends. They aren't placed the same on every load: placement goes in the order features
are drawn, which depends on when frames had time.

## Batches

What made the renderer slow wasn't the frame or the GPU. It was one JavaScript object and one Pixi
object for every feature: a `Container` is 0.7 KB before it draws anything, Pixi built every line
and fill again at every zoom, and its DRAW phase walked every object. So the layers draw their
features into a few batches with shaders of our own, and a feature that a batch draws has no Pixi
object in the scene. The design behind it is two tiers (the log's section 15):

- **The static tier** is what nobody is touching, which is nearly everything: items in batches.
- **The editing tier** is what's hovered, selected, drawn or dragged, a handful: today that's the
  vertices and midpoints drawn above everything, and features that draw something a batch can't.
  Hovers and selections are in batches too ("Hovers, selections and animation draws"), and a
  dragged line is written again in its batches each frame, which costs little.

### What a batch is

`BatchMesh` (`modules/pixi/lib/BatchMesh.ts`) is a Pixi `Mesh` with persistent buffers. Its kinds
say what a vertex holds, and write it.

- **A feature is an item:** a run of vertices in the batch's buffers, and of indices in its index
  buffer. Items are drawn in the order of their `order` (for OSM, the feature's `zIndex`).
- **A changed item is written where it was** if it has as many vertices as before, and only that
  part of the buffer is sent to the GPU. Otherwise it goes at the end. When the buffers are full,
  the batch packs itself in place if what's in use fits in three quarters of them, and otherwise
  takes buffers half as large again; it takes smaller ones when less than a third is in use. (A
  batch whose items come and go at every zoom kept growing under a looser rule.)
- **A hidden item stays where it is, with an opacity of 0,** which each shader must draw nothing
  for: a byte per vertex. The index buffer is built again only when an item joins or leaves.
- **A batch's place in the world follows the view.** Its vertices are 32-bit floats relative to
  that place. When the view is so far from it that a float could be off by 1/32 of a pixel at the
  view's zoom (`PRECISION`), the place moves to the view's center and the vertices shift
  (`followView()`).
- **A batch counts the features it was given to** (`users`), and isn't removed while one is still
  waiting to be drawn in it.

**One shader for each kind,** shared by every batch of that kind (`LineBatchShader`,
`FillBatchShader`, `PointBatchShader`, in `scene.batchShaders`). The scene sets their uniforms: the
view before each frame (`setBatchViews()`), the clock before each draw (`animate()`), and the
textures when the atlases change (`PixiTextures`). **A zoom or a rotation writes nothing to any
batch**: widths, sizes and turns are worked out in the vertex shader. Each shader is written twice,
in GLSL and in WGSL, and WebGL 2, WebGL 1 and WebGPU all draw it.

**A layer keeps its batches in a `LayerBatches`** (`layer.batches`): at most one of each kind in
each container, made when a feature first needs it, with a small batch beside it for the glows of
hovered things. It places them by `zIndex` under the containers of features that draw themselves,
keeps their places near the view (the scene has each layer's follow the view before it renders),
and destroys the ones that empty (`cull()`).

**A layer that draws data says `useBatches`,** and draws each dirty feature with
`_drawInBatches(feature, container, viewport)` where it called `feature.update(viewport)`, giving
the container it would have put the feature in. The feature takes that container's batches
(`placeInBatches()`, which each kind of feature knows its own of), is drawn, and goes in the
container only if it draws something itself. Lines, polygons and points in one container are
drawn in the order of their batches there (casings and fills, then strokes and outlines, with
points among them), so a layer gives each kind a child container of its own when it wants them in
another order: the photo layers draw their sequences in one and their markers in another, above.
The OSM layer places its features itself, in its levels and tiles, with the same
`placeInBatches()`.

### Lines

**Two batches for each level** (`way.layer()`): every casing, then every stroke. Roads join without
a casing between them (Bryan, Nov 23: it looks better, and stays). In each batch the lines are in
the order of their road class and then their way's ID. Seattle's 2,021 lines and Užice's 21,370
are 16 batches each.

- **A vertex is 56 bytes:** the point on the line, how far the vertex is from it for a half width
  of 1 (and a second place for an inside corner, with the half width it's for), the distance along
  the line, and how the line is drawn: width in pixels, color, opacity, dashes. The vertices come
  from the line's stroke mesh ("The line builder").
- **The shader does the sum** `point + offset × half width`, from what the view says: what a pixel
  is in world units, how much narrower lines are below zoom 17, that casings aren't drawn below 16,
  wireframe.
- **Dashes are made in the fragment shader** from the distance along the line, so one draw call
  serves any mix of patterns. A vertex has room for two dashes and two gaps of up to 255 whole
  pixels, which every pattern in Rapid's styles fits; a line with another draws itself.
- **The markers along a line** (oneway arrows, arrows with two heads, the triangles on the right of
  a line with sides) are a strip in the strokes' batch (`addMarkers()`): a copy of the stroke mesh
  as wide as the markers need, after every stroke of the level. The fragment shader draws each
  shape from the distance along the line and to its side (`LINE_MARKERS` has the spacing). They're
  left out below zoom 16. A way tagged `oneway=-1` (or `conveying=backward`,
  `flow_direction=backward`) has its marker turned around in its style (`lineMarker.scale`), and
  the shader and the sprites follow it. Midpoints always point the way the line is drawn (Bryan,
  Nov 23).

### Areas

**Two batches:** every fill in a `FillBatchMesh`, then every outline in a `LineBatchMesh`, in the
order of the areas' size, the largest first. So every outline is over every fill, as in iD (Bryan,
Nov 23: fine).

- **A fill's vertex is 16 bytes** (where it is, its color and opacity, its pattern), and its
  triangles are worked out once for any zoom (`triangulate()` in `helpers.ts`, with `earcut`).
- **A partial fill's band is triangles in the same batch** ("The line builder"). Most areas have no
  middle and are filled whole; the band of one that has a middle is worked out again when the zoom
  changes its width in world units. Nothing else in the batch is touched by a zoom.
- **Patterns come from one texture,** an atlas of the 27 patterns that `PixiTextures` draws, each
  in a cell with a border of the texels that wrap around to it. The shader lays the tiles out 32
  pixels on screen at every zoom, upright however the map is turned, anchored to the batch, so the
  patterns of neighboring areas line up.
- **An area under 20 pixels is its fill alone** (`SMALL_SIZE`), with no outline: an outline is 3
  triangles a corner, and the small areas' outlines were a third of Staten Island's triangles.
  In wireframe the outline is all there is, and a hover gives it back. Under 4 pixels an area is
  hidden. (Bryan, Nov 23: "I'd prefer to draw something imperfect than draw nothing that the user
  can see and risk them thinking there is nothing mapped there.")
- **A hovered or highlighted area's fill is tinted** halfway to the glow's color and twice as
  opaque, in its batch, and its outlines glow ("Hovers, selections and animation draws").

### Points

**One batch** (`PointBatchMesh`) for the points, the vertices and the pins of areas, from north to
south (a pin overlaps the pins above it), with the points that have viewfields over the others,
and the photo that's selected or highlighted over them all. (A photo layer's markers are a batch
of their own, as are a QA layer's.)

- **A point is a few pictures:** its viewfields, its marker, its icon, in that order. A picture is
  four vertices of 32 bytes: where the point is in the world, where the corner is in pixels from
  the point, where it is in the texture, the tint and opacity, and two flags. The shader keeps the
  pictures their size and upright; a viewfield points somewhere on the ground, and turns with the
  map.
- **What a point is drawn with is worked out in one place,** `PixiFeaturePoint._layout()`, for
  the batch and for sprites alike. A layer can't move a sprite after the point is drawn (a batch
  has none): where an icon goes in a pin's head is in `_layout()`, for each kind of pin. Below zoom 16 points aren't drawn; up to 17, and in wireframe,
  they're smaller, pins are circles, and there are no viewfields. Crossing 17 writes every point
  again, once.
- **One texture:** every marker, icon, viewfield and glow is in the symbol atlas. An icon that
  hasn't loaded is left out, and the point is written again when it arrives
  (`scene.texturesLoaded()`). A picture from any other texture makes its point draw itself.
- **Labels, the avoid grid and the hit test ask the point where it's drawn** (`labelBox()`, its
  hit area in pixels), from arithmetic.

### What draws itself

A feature that its batches draw isn't in the scene: its `Container` has no parent, and holds its
position and its order only. A feature that draws something itself (`drawsInContainer()`) goes in
its container (for OSM, its tile's):

- **The vertices and midpoints of what's hovered or selected,** above everything in the map UI
  layer's `selected` container, where Pixi's hit test finds them first.
- **Markers that the shader has no shape for,** and pictures from another texture (none of Rapid's
  styles has either).
- **A line whose dashes a batch can't draw** (more than two dashes and two gaps, or longer than 255
  pixels): it draws itself with `LineMesh`es.
- **The layers that don't draw data in batches:** the labels, the imagery, the map UI's lasso, the
  debug layer, and the edit blocks (which draw into a group, never interactive, and seldom have
  anything to draw).

Where a feature is drawn among the others is asked of the feature (`sceneContainer`, `sceneOrder`,
`featureOrder()` in `helpers.ts`): for a line, its strokes' batch and its order there.

## Finding the feature under the pointer

The hit test isn't part of the frame: `PixiEvents` asks `scene.hitTest()` for the feature under the
pointer on each pointer event, before the behaviors hear of it, and puts the answer on the event.

- **The OSM layer finds its own features** (`PixiLayerOsm.hitTest()`, registered with
  `scene.setHitTester()`), and Pixi's walk skips its containers. It asks the spatial index for the
  entities in a box around the pointer (`editor.entitiesInBox()`), as large as the furthest any
  feature can be hit from its geometry (each feature says how far when it draws, `hitReach`), and
  asks those features. 0.07 ms in Užice, where Pixi's walk over the whole scene was 8.
- **Each feature answers by its own rules,** with nothing of Pixi's in them: a line by its distance
  from the pointer (`LineHitArea`), an area by that distance from its rings or by being in its fill
  (the band's polygons for a partial fill), a point by its hit area in pixels. The one drawn on top
  wins (`drawOrder()`), also against what Pixi found in the other layers.
- **The other layers that draw in batches find theirs too** (`AbstractPixiLayer.hitTest()`): a
  layer keeps an index of where the features it drew are (`_featureIndex`, an R-tree written when
  a feature's box changes, not for a hover or a restyle), and asks the ones near the pointer.
  Each answers only for the spatial IDs the mode lets the pointer reach (`scene.isInteractive()`),
  and the scene asks each layer once. 0.04 ms for a pointer event with 21,000 photo and QA
  markers on, where Pixi's walk was 1.8.
- **Of two drawn at the same order in one batch,** the one it was given later is drawn on top,
  and is what's hit (`BatchMesh.drawIndex()`): photos taken at one place have the same order.
- **Pixi's `globalMove` and `wheel` events are off** (`eventFeatures`), and so is its events ticker.
  With `globalMove` on, every pointer move visited every interactive object in the scene.
- **The hover is as of the last pointer event.** Nothing is tested again when the scene changes
  under a pointer that's still (Bryan, Nov 23: new data popping in under the pointer needn't be
  hovered).

The e2e tests check that the index finds what asking every feature does, at every point of a grid.
Pixi's walk is left for what draws itself in a layer that doesn't find its own: the selected
vertices and midpoints in the map UI layer.

## Hovers, selections and animation draws

A hover has to show (Bryan, Nov 23: "My biggest concern today is just that a user won't see what
they are hovering on"). Glows and halos are drawn by the batches' shaders, and move.

- **A line's glow is a strip along it** (`LineBatchMesh.addGlow()`): its stroke mesh with round ends
  and corners, 12 pixels wider on each side (`LINE_GLOW`). The fragment shader fades it from the
  line's edge outward, from the distance to the line that each vertex carries, and draws nothing
  over the line itself.
- **An area's glow is the same strip around each ring,** and its fill is tinted. **A point's glow
  is a picture,** a disc that fades out behind its marker, twice its size and at least 30 pixels.
- **Glows are in small batches of their own** (`glows`, beside each batch they're for). In the
  batch of what it's around, a hover rebuilt that batch's index buffer: 11 ms of DRAW in Užice.
- **A halo is two lines along each ring, in one batch for all halos** in the map UI layer
  (`haloBatchAt()`, `drawHalo()`): a dark line 4 pixels wide, and yellow dashes 2 pixels wide that
  march over it. A halo's rings are the feature's outline at the distance a click reaches.
- **The clock:** two uniforms that every batch shares (`setTime()`): how bright a glow is (it
  breathes, down to 55% and back in 1.6 seconds) and how far the dashes have marched (20 pixels a
  second). `scene.animate(now)` sets them before each draw, and the opacity of sprites that pulse
  (`addPulsing()`). Nothing in a batch is written for it.

So nothing of the OSM layer is in the scene for a hover or a selection, apart from the vertices and
midpoints drawn above everything.

### Animation draws

While something is hovered, highlighted or selected (`scene.animated`), `GraphicsSystem` draws the
scene again as it is, with the clock further on (`_drawAnimation()`): a DRAW with no APP, no frame
in the stats, and no `draw` event. `AnimationPacer` says when:

- **About 20 a second** (`ANIMATION_MS`), and none while frames are drawn that often anyway.
- **A third of the ticks at most:** after an animation draw the next waits 2.5 times as long as the
  browser took to come back, up to half a second. Where the GPU can't keep up, the animation slows
  down instead of taking all of its time.
- **It rests** after 30 seconds in which nothing else was drawn, with one last frame that leaves
  the glows at their brightest.
- **Not at all with `prefers-reduced-motion`:** the glow and the halo are there, and still.

An animation draw costs a whole DRAW, because Pixi draws the whole scene: 13.6 ms of the M4's GPU
in Užice, so a selection there keeps it busy a quarter of the time.

## The line builder

Plain geometry in `modules/geo/`, with no Pixi in it, unit-tested against the definition (not
against Pixi) over seeded random lines, as `graph_model.test.js` does for `Graph`.

**A stroke mesh that doesn't know its width** (`geomStrokeMesh(coords, options)` in `stroke.ts`):
each vertex is a point on the line, a direction to push it out along, its distance along the line
(and how much further along it is, so dashes run straight along each edge), and its side. Seven
numbers. The position is `point + direction × half the width`, so one mesh serves every zoom and
every width, and a feature builds it only when its line, cap or join changes (its `GeometryPart`
is another object then).

- Butt, square and round caps; bevel, miter and round joins; open lines and rings (a line that ends
  where it starts is built as a ring).
- **A round join or cap is 10 slices for a half circle** (Bryan, Nov 22: more only if they look
  jagged). Pixi's builder made 20 to 46 vertices a node and made them again at every zoom; the mesh
  has 6 or 7, once.
- **A corner that turns less than about 16° is a miter on both sides,** whatever join was asked
  for. Traced curves are mostly such corners.
- **The inside of a sharper corner depends on the width:** while the line is narrow enough the two
  segments end where their inside edges cross, and past that each keeps its square end and they
  overlap, as Pixi's do. Three vertices have a second place, and the half width from which to use
  it, so a shader makes the same choice.

**An outline at a distance** (`geomStrokeOutline()`): one ring around an open line, one outside and
one inside a closed one. A halo is drawn from it, and so is the path of a label inside an area (12
pixels in). It has no cleanup: where a segment is shorter than the corner needs, or a curve tighter
than the distance, it loops or crosses itself.

**A hit by distance** (`geomStrokeContains()`, behind `LineHitArea`): whether a point is within a
distance of a line is a sum over its segments, with no polygon to build. A zoom changes one number.

**The partial-fill band** (`geomAreaBand(rings, width)` in `band.ts`) is the area without its
middle, where the middle is the area shrunk by the width, with Clipper2 (`clipper2-ts`, 18 KB
gzipped) doing the offsetting and its cleanup. The area is the outer ring minus its holes,
whichever way the rings go around. Its inside edge is round around corners that point into the
area. It's `null` when there's no middle, which is most areas, and a polygon's `inradius`
(`GeometryPart`: how far its pole of inaccessibility is from its edge) says so before Clipper is
asked. The band replaced a stencil mask for each partial fill, which were three quarters of
Seattle's draw calls.

- **Decided (Bryan, Nov 22 and 23):** Clipper2 and not code of our own, since the cleanup is a sweep
  over all the edges, which is what Clipper is. `clipper2-wasm` is twice as fast, but not at the
  cost of relaxing the CSP (`'wasm-unsafe-eval'`) now.

**`LineMesh`** draws one stroke mesh at a width, for the lines that aren't in a batch: the lasso, and
a line whose dashes a batch can't draw. `setStroke()` works out a new width in the array it has; dashes are a
texture that repeats along the line (`PixiTextures.getDashTexture()`). It's always batched by Pixi
(a fixed `batchMode`: a mesh that crosses 100 vertices in `'auto'` mode can crash Pixi,
pixijs#12437).

## Memory

Garbage is what brings the long collections, and what's alive is what makes them long (the log's
section 13). The rules that came out of it are in `modules/pixi/AGENTS.md`; the design behind them:

- **A feature makes its Pixi objects when they're first shown,** and destroys what it replaces:
  Pixi keeps what it built for an object until the object is destroyed. A feature in a batch has
  none but its container.
- **A node's `Geometry` is built when it's first asked for** ([`graph-geometry.md`](graph-geometry.md)),
  and a `GeometryPart`'s products are getters: code that visits every node asks for its location.
- **Nothing per feature in a loop over every feature,** and nothing that only a hover or a
  selection needs is worked out for everything.

What's alive after a load in Užice (1.37 GB): the OSM data, the features (a `Container` each, and a
copy of its style), the batches' buffers, and the rest of Rapid.

## Frame stats

`GraphicsSystem` owns frame stats, and keeps the last 120 frames (`gfx.renderFrames`,
`gfx.lastRenderFrame`). Code that wants them asks it; layers don't keep their own (Bryan, Nov 18).
A `RenderFrame` (`modules/pixi/RenderFrame.ts`) is passed from `_app()` through `PixiScene.render()`
into every layer's `render()`, `cull()` and `retainFeature()`. It's the frame's instructions
(`cullBox`, `deadline`, `urgent`, `held`, why it was made) and what was gathered as it was made:

- **Per layer** (`layers`): whether it was on and kept its features, `render()` and `cull()` times,
  features and visible, and what it did to its features: `created`, `destroyed`, `updated`,
  `shown`, `hidden`, `waiting`. A layer and its features count into a `work` record as they go,
  and the scene moves it onto the frame (`takeWork()`). A layer that wants to say where its time
  went calls `_endStep(name, since)` after each step (`steps`); only the OSM layer does.
- **From DRAW** (`draw`): its time, render groups and how many were rebuilt, Pixi's instructions by
  pipe, triangles, and the `Graphics` it drew outside a batch and why. With detailed stats on
  (`gfx.enableDetailedStats(true)`): WebGL calls (draws, programs, texture binds, buffer uploads)
  and GPU time from a timer query, which arrives a few frames later. WebGL 2 only.

**Pixi's internals are read in one place** (`lib/RenderStats.ts`): the instruction lists and the GPU
contexts aren't public API and can change in any Pixi release. `test/e2e/rendering.test.js` fails
when their shape changes.

**The rendering card** (`UiRenderingCard`, ⌘⇧F, or "Show Rendering Panel" in the Map Data pane)
shows them live: a chart of the last 120 frames (DRAW stacked on APP, a line at the budget), the
phases against the budget, the GPU time with detailed stats, features shown, the slowest layers,
Pixi's instructions, and the scheduler's queue.

**No e2e budget tests yet** (Bryan, Nov 18): a budget would lock in today's numbers.

## Measuring

How to measure frames, memory and garbage without fooling yourself is in
[`knowledge/lessons/measuring.md`](../knowledge/lessons/measuring.md). The tools:

- **`bun run measure`** (`scripts/measure.ts`) visits the difficult places in the debug Chrome and
  prints each one's frame stats: redraw (nothing changed), pan (most frames only move the view, one
  in three moves the cull box), glide (the view moves on every tick: frames a second and long
  ticks), and restyle (every feature marked as a zoom does). `--fresh` reloads before each place,
  `--out` saves everything as JSON, `--setup` runs a snippet in the page before each place (to set
  what's shown, or to compare two ways of drawing in one build).
- **`bun run compare <label> <url> <place>`** (`scripts/compare.ts`) measures any editor from
  outside, with real input events in a new tab: this build, another version of Rapid, or iD. The
  log's section 11 has the comparison with `main`, Rapid 2.5 and iD.
- **Tapes:** `--tape file.tape.json` on either keeps the OSM API's answers in that file the first
  time, and answers from it after that, each tile after the time it really took
  (`scripts/tape.ts`). Two builds then see the same data arrive at the same pace, and the API isn't
  asked again. A tape of Užice is 119 MB; `*.tape.json` is gitignored.

**The difficult places** (`scripts/places.ts` holds the list; keep this table in step with it). OSM
changes, so a place can stop being difficult.

| Place | `map=` | What it stresses |
|---|---|---|
| Downtown Seattle | `17.50/47.61040/-122.33450` | paths, dashes, buildings (the baseline) |
| Nuevo León, Mexico | `17.00/21.14900/-101.66980` | address points |
| Miami-Dade, Florida | `19.00/25.53485/-80.37714` | lots of detail, fences |
| Užice, Serbia | `16.00/43.8535/19.8433` | so much detail |
| Bochum Hauptbahnhof, Germany | `18.00/51.47836/7.22315` | very dense mapping, light directions |
| Smith Point Beach, New York | `15.95/40.7335/-72.8624` | submarine cables |
| Market Square Plaza, DeKalb | `17.50/41.94892/-88.72369` | every parking space mapped |
| Staten Island Mall | `16.50/40.58201/-74.16480` | every parking space mapped |
| Grant Park, Chicago | `17.86/41.87606/-87.61865` | micromapping |
| Golmud Solar Park, Qinghai | `16.00/36.0677/100.2792` | solar panels, each one an area |
| Factories, Jiangsu, China | `15.00/34.54897/119.58936` | building detail |
| Heybridge, England | `18.00/51.72229/0.67766` | fences |

What's bitten before:

- **Compare builds in one session,** one after the other. The same build measured hours apart
  differs by more than many changes do, and GPU times most of all.
- **Check what's shown.** The debug Chrome keeps its layers and filters from one session to the
  next; a measurement was once taken with landuse hidden, and another with the labels off.
- **Go easy on the OSM API.** After enough loads it answers 429, and the map stays empty. Use a
  tape, and `layer.reset()` to make features again without the network.
- **Look at the picture, not only the numbers.** Compare screenshots with the build before, and for
  something a shader draws, count the pixels it changes (`glowPixels()` in `test/e2e/select.test.js`).
  Twice a hover's glow went missing with every test passing.

## Where it's heading

What's left, biggest first, is in `knowledge/backlog.md`, "Pixi rendering follow-ups". The
direction, from the log's section 15:

- **The other layers keeping their features** (`keepFeatures()`). They draw in batches now, but
  still do their pass on every frame: with photos and detections on in Bellevue, that's 15 ms of
  Mapillary's and 4 to 8 of the detections' on every frame of a pan (the log's section 16).
- **A feature without a display object.** A feature in a batch needs a position and an order, not a
  `Container` (0.7 KB each); `AbstractPixiFeature` assumes one.
- **Animation draws that don't draw the whole scene:** what's still drawn to a texture once, and an
  animation draw that texture and what moves over it. Then the rate could be 60. It wants numbers
  from weak hardware first.
- **A level of detail decided by the filter** ([`filter-system.md`](filter-system.md) section 6):
  Performer's load management.
- **Frame budgets set by the display's refresh,** and measured on other machines: 6 and 24 ms are
  first guesses from one M4 at 120 Hz.
- **Building in a worker** was skipped (Bryan, Nov 23: probably unnecessary): building a stroke
  mesh or a fill's triangles is a small part of making a feature now. A profile of a load would
  have to ask for it.

**Not part of it:** a rewrite in Rust (the problem was garbage, not JavaScript's speed, and typed
arrays fix it in either language; WebAssembly is for single hot routines when a profile asks),
WebGPU (the cost was building geometry, not drawing it), and MapLibre as the renderer: every editor
built on a tiled GeoJSON source rebuilds whole features through a worker on each change (the log's
section 15, "What the other map renderers do").

**Open questions:**

- **A selected way's own label.** Bryan wants a selected way to keep a label, but its vertices and
  midpoints are avoids, and a short segment has no room between them.
- **Label order between frames:** across chunks, a line's label can be placed before a point's.
- **Seattle places a tenth fewer labels than with boxes,** and 1 px cells only get half of that
  back.
- **Labels on long lines walk the whole line** (five transatlantic cables at Smith Point); clip a
  line to the view before `placeRopeLabel()`.
- **A halo that doesn't cross itself,** from Clipper (12 to 18 ms for a relation of 2,400 nodes,
  on every frame of a drag). Then `geomStrokeOutline()` would have no caller.
- **A band that doesn't depend on the zoom,** from an area's straight skeleton: built once, cut at
  any width by a shader.
- **Translucent strokes overlap themselves** at most corners at z16, as Pixi's did. Tunnels are
  drawn at 0.5; the data layers' lines weren't looked at.
- **A smaller vertex:** a casing and its stroke could share their triangles (a third less memory),
  and a vertex at a corner repeats the corner's point.
- **The animation runs while what's selected is off screen** (`animated` looks at classes), and
  its constants (30 seconds, 20 a second, 1.6 seconds a breath, 12 pixels) are first guesses.
- **Color still does most of a hover's work.** Movement helps a colorblind user find it; a glow's
  yellow on a yellow road is still weak.
- **Snapping by distance:** choosing the nearest line, or a vertex before a line, is a redesign of
  hover and snapping ([`scene.md`](scene.md) section 4).
- **`syncShader` for each batch:** Pixi's `unsafe-eval` polyfill, which our CSP needs, sets every
  uniform again for each mesh with a shader of its own, and makes garbage doing it.
