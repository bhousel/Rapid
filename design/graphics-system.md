# GraphicsSystem: making a frame, and measuring it

How `GraphicsSystem` turns the map into a frame, what we know about what a frame costs, and the
explorations planned to make frames cheaper. Rendering performance is where Rapid has the most room to
improve, and until now we've had no way to see it except spot checks in Spector.

> **Status:** In progress (Nov 2026). Steps 1 to 5 of the plan are done (frame stats, a script that
> measures a set of difficult places, where the GPU time goes, a rendering info card, and the
> `RenderFrame` passed to the layers), and so are the CULL pass for the OSM layer (section 8) and
> frame pacing (section 9). A deadline on the frame is started (section 10), and section 11
> compares the branch with `main`, Rapid 2.5 and iD; sections 4 and 5
> aren't built. The first
> measurements in section 2 were taken by hand on the `pixi-8.23` branch (Pixi 8.23.0), and frame stats
> reproduce them. The plan is in section 7.

Related docs: [`scene.md`](scene.md) (the display tree, draw order, what the pointer can reach),
[`scheduler-system.md`](scheduler-system.md) (the frame loop and its budget),
[`profiling.md`](profiling.md) (memory and leaks), [`style-system.md`](style-system.md).

## Words used here

- **APP pass:** Rapid's half of a frame. Layers decide which features are in view, rebuild the ones that
  are dirty, and cull the rest (`GraphicsSystem._app()` → `PixiScene.render()` → each layer's `render()`
  and `cull()`).
- **Pass (of a layer):** one layer's work in an APP pass: gather its data, update its features and mark
  them seen, hide the ones it didn't see.
- **Redraw request:** a call to `deferredRedraw()` or `immediateRedraw()`. It says that something the
  map draws has changed. Moving the view isn't one.
- **Cull box:** the part of the world a frame wants features ready for: the view, and padding around it.
- **Kept:** a layer kept its features in a frame when it skipped its pass, because only the view had
  moved, inside the cull box it already had everything for (section 8).
- **Pass frame:** a frame in which layers had a pass to do: a redraw was requested, or the view needed
  a new cull box. A frame that only moves the view isn't one.
- **Gap:** how long a pass frame waits after the one before it. It grows with what that one cost
  (section 9).
- **Held frame:** a frame drawn while a pass frame waits for its gap. It moves the view, and every
  layer that can keeps its features.
- **Deadline:** the time in a frame's APP pass after which work that can wait is put off to the
  next frame (section 10).
- **Waiting:** a feature is waiting when it's dirty and its layer put off drawing it again. It's
  shown as it was last drawn, or not at all if it's new.
- **DRAW pass:** Pixi's half. `pixi.render()` walks the display tree, builds its instruction list, and
  issues the GPU calls (`GraphicsSystem._draw()`).
- **Instruction:** one entry in a Pixi render group's instruction list. Each names the pipe that runs it:
  `batch`, `graphics` (a `Graphics` drawn on its own), `mesh`, `stencilMask`, `filter`.
- **Draw call:** one `drawElements`/`drawArrays` (WebGL), or `draw`/`drawIndexed` (WebGPU).
- **Batch:** consecutive drawables that Pixi merges into one draw call. A batch ends when the next
  drawable can't join it (different blend mode, too many textures, a mask, a filter, or something that
  isn't batchable).
- **Partial fill:** the default area style. Only a band 32 px wide inside the outline is filled
  (`PARTIALFILLWIDTH` in `PixiFeaturePolygon`); the `map.areaFill` setting can make it full.

## 1. How a frame is made today

`SchedulerSystem` owns the `requestAnimationFrame` loop and calls `GraphicsSystem._tick(deltaMS)` once
per animation frame. A tick does this:

1. **DRAW**, if an APP pass from the tick before is waiting for it, and nothing else.
2. Otherwise `_updateTransform()` moves an eased transform along and takes up a change of the map's
   size.
3. **APP**, if a frame is wanted: the view moved, or a redraw was requested. `_passAllowed()` asks the
   `FramePacer` whether this frame may do a pass (section 9).
   - If it may: when the zoom changed, or the map moved more than 100,000 px, every feature is
     marked to be drawn again (`scene.dirtyTransform()`); otherwise only the `origin` container
     moves. The frame takes the redraw requests made since the last one, and its cull box
     (section 8).
   - If it may not, the frame is **held**: it only moves the view. The redraw requests stay where
     they are and the cull box stays the same. If moving the view isn't enough (the zoom or the
     rotation changed, or the view didn't move), no frame is made on this tick.

   Then `scene.render(frame, viewport)`. The frame has a deadline: work that can wait is put off
   once it has passed, and if any was, another frame follows on the next tick (section 10).
4. **DRAW in the same tick**, if the tick has used less than 8 ms so far (`DRAW_SAME_TICK_MS`), as
   it has after a frame that only moved the view. Otherwise DRAW waits for the next tick. DRAW
   resizes the renderer if needed, calls `pixi.render()`, drops the CSS transform, emits `move` if
   the map is somewhere new on screen (the edit menu follows it) and `draw`, and counts the frame.
5. On a tick that drew nothing, `_followTransform()` follows the map's transform with a CSS
   transform on the `supersurface`, so a zoom still looks smooth while its pass waits.

Both passes leave performance measures (`app-N`, `draw-N`) in a DevTools recording. The minimap renders
the same stage a second time into its own canvas (`UiMinimap`), which is why the renderer has
`multiView` on.

Until Nov 19 a tick did one pass or the other, and an APP pass waited 250 ms after the last DRAW
(`THROTTLE`) unless `immediateRedraw()` asked for one now, with the CSS transform carrying the view in
between. The measurements in sections 2 to 8 were taken that way, except where they say otherwise.

**What makes Rapid unlike a game:** we don't know what we're drawing until the APP pass has run. The
user can put the map anywhere in the world, at any zoom, with any layers on. A street grid in Seattle,
a parking lot with 5,000 individually mapped stalls, a wetland traced with thousands of nodes, and an
undersea cable crossing an ocean are all normal OpenStreetMap. So:

- Costs have to be **measured per frame**, as the frame is made, not designed per level ahead of time.
- An approach that works well in one place can fall over in another. A rendering change needs to be
  judged on a set of difficult places (section 7, step 2), not one.

## 2. What we know (Nov 18 measurements)

Downtown Seattle at `map=17.50/47.61040/-122.33450`: 2,921 OSM features, 814 of them two-value
dashed lines (footways and other paths). M4 Mac, Chrome, WebGL 2, high quality (MSAA, device pixel
ratio 2). Draw calls are counted by wrapping the GL context's draw functions, GPU time comes from
`EXT_disjoint_timer_query_webgl2`, and the instruction breakdown comes from Pixi's instruction list.

| | Draw calls | DRAW CPU | GPU |
|---|---|---|---|
| As drawn today | 771 | 0.8 ms | 9.2 ms |
| Dashed paths swapped to Pixi's `DashLineShader` | 2,368 | 3.0 ms | 9.1 ms |
| Partial-fill masks removed (experiment only) | 64 | | 8.3 ms |

Restyling everything (as after a zoom change) took 85 ms of APP and 15.6 ms of DRAW.

What that says:

- **The partial-fill masks cause most of the draw calls.** Each partially filled area is masked by a
  stencil: 177 masked fills became 708 `stencilMask` instructions and 707 of the 771 draw calls. Each
  mask breaks the batch around it, and needs its own calls to write and clear the stencil.
- **`DashLineShader` is the wrong tool for styled dashes.** A `Graphics` with a custom shader is never
  batched, it works only with `SmoothGraphics`, it supports one dash and one gap (our boundaries and
  barriers use four values), and it advises against round caps. It looked identical at this zoom.
- **Draw calls aren't where the GPU time goes.** It was about 9 ms in all three cases. See section 6.
- **36 `Graphics` were drawn on their own** (the `graphics` pipe), all casings and strokes of long ways.
  Pixi batches a `Graphics` only when its geometry has fewer than 400 floats, i.e. 200 vertices
  (`AbstractGraphicsContextSystem`), and a custom shader or `context.batchMode` overrides that. A `Mesh`
  batches with up to 100 vertices (`Mesh.mjs`).
- The instruction list in that view: 687 `batch`, 708 `stencilMask`, 46 `mesh`, 36 `graphics`, 2 `filter`
  (the hover glow).
- **Round caps and joins are probably far more detailed than they need to be when zoomed out.** Most
  line styles use round caps and joins (the style defaults do). Pixi's `buildLine` divides a round cap
  or join into `15 × angle × √radius / π + 1` slices, with the radius in the `Graphics`' own units. Rapid
  draws in z16 world units, so a line that stays 5 px wide on screen has a radius of 2.5 at z16, 10 at
  z14 and 40 at z12: a cap gets about 25, 48 and 95 slices, where a handful would look the same on
  screen. (Zoomed in, the radius drops below 1 and a cap gets a few slices, which is about right.) Not
  measured yet; frame stats should count vertices per layer to confirm it.

### Across the difficult places (Nov 18)

`bun run measure --fresh` (`scripts/measure.ts`, plan step 2) on the same M4 and Chrome, window
1593×1067 at ratio 2, with the points, indoor, landuse and boundaries features hidden (the debug
profile's settings). Medians of 9 frames, in ms. This run is from after the imagery filter fix
(section 6), which took 1 to 2 ms off the GPU times. Three kinds of frame:

- **Redraw:** nothing changed, the scene is drawn again.
- **Pan:** the view moved 100 px since the last frame, over an area it has shown before. So it
  measures moving the view, not making new features or loading data.
- **Restyle:** every feature is restyled, as after a zoom change.

Draws are WebGL draw calls, masks are `stencilMask` instructions, unbatched are `Graphics` drawn on
their own (all three from the redraw frames).

| Place | Visible | APP | DRAW | GPU | Pan APP | Pan DRAW | Restyle APP | Restyle DRAW | Draws | Masks | Unbatched |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seattle | 3,014 | 11.0 | 0.8 | 6.0 | 9.0 | 6.8 | 79 | 16.5 | 768 | 708 | 36 |
| Nuevo León | 1,076 | 6.3 | 0.6 | 3.7 | 5.7 | 3.9 | 30 | 8.4 | 113 | 8 | 68 |
| Miami-Dade | 2,596 | 8.0 | 0.5 | 3.6 | 6.7 | 4.2 | 51 | 8.4 | 77 | 12 | 43 |
| Užice | 61,124 | 194 | 3.0 | 18.0 | 218 | 109 | 1,538 | 197 | 2,059 | 168 | 1,213 |
| Bochum | 2,505 | 9.2 | 0.6 | 4.9 | 8.4 | 5.4 | 74 | 15.8 | 318 | 292 | 21 |
| Smith Point | 784 | 2.9 | 0.5 | 3.3 | 3.7 | 2.3 | 394 | 9.0 | 132 | 20 | 74 |
| DeKalb | 3,785 | 9.8 | 0.3 | 3.1 | 10.6 | 5.7 | 66 | 6.9 | 127 | 80 | 31 |
| Staten Island | 15,983 | 49.1 | 0.9 | 5.0 | 43.5 | 22.8 | 275 | 32.9 | 516 | 88 | 277 |
| Grant Park | 1,334 | 6.2 | 0.6 | 4.1 | 6.6 | 3.6 | 40 | 11.2 | 234 | 116 | 83 |
| Golmud | 10,304 | 37.1 | 0.3 | 5.6 | 35.5 | 27.8 | 343 | 57.9 | 40 | 4 | 27 |
| Jiangsu | 550 | 4.1 | 0.4 | 3.1 | 3.4 | 1.6 | 14 | 3.5 | 169 | 52 | 67 |
| Heybridge | 951 | 5.0 | 0.2 | 2.8 | 3.8 | 2.3 | 22 | 4.6 | 24 | 4 | 12 |

Numbers move 10–30% from run to run (Seattle's restyle APP was 79 to 123 ms in five runs), so compare
medians from the same session, and look for large differences.

What that says:

- **A frame where nothing changed still costs about 3 µs per visible feature**, almost all of it in
  the OSM layer's `render()`: 11 ms in Seattle, 49 ms at Staten Island, 194 ms in Užice.
  A CPU profile at Staten Island (59 ms in `render()`) puts 33 ms in
  `FilterSystem.filterScene()`, which checks every entity in view against the hidden features on every
  frame. Each entity's matches are cached, but `isHidden()` still runs per entity (copying the matches
  into an array), and each vertex asks all of its parent ways. It runs only when some feature is hidden,
  as in this profile. (Both fixed on Nov 19: section 8, "What the steps cost".) The rest is
  `renderPolygons()`, `renderVertices()` and `entitiesInBox()`. See
  "Renderer: classify a node only when it's dirty" in `backlog.md`.
- **Moving the view makes Pixi rebuild everything it knows about the scene.** A pan frame's APP pass
  costs about what a redraw's does, but its DRAW pass goes from under 1 ms to about 2 µs per visible
  feature: 7 ms in Seattle, 23 at Staten Island, 28 at Golmud, 109 in Užice (where a pan frame takes
  a third of a second in all). A CPU profile in Seattle puts it in Pixi's `_updateRenderGroups()`:
  about 7 ms collecting every renderable into a new instruction list (`_buildInstructions()`), and
  about 4 ms updating every object's transform. The whole scene is one render group, so a feature
  that scrolls into view (culling changes its `visible`) rebuilds the list for all of them, and
  moving `origin` moves every object. Pixi's own advice for a world that pans is to make it a render
  group, so that moving it costs one matrix. Tried from the console
  (`gfx.origin.enableRenderGroup()`): Seattle's pan DRAW went from 9.0 to 6.7 ms in the same session,
  the transform part. The instruction list is still rebuilt. **Done since (Nov 18):** every
  structural container of the scene is a render group now, each at an anchor near the view because
  world coordinates don't fit in a render group's 32-bit floats (that console experiment drew
  distorted shapes, which the timings didn't show). Pan DRAW went from 6.8 to 5.1 ms in Seattle and
  from 22.8 to 12.3 at Staten Island; a hover on one line there went from 13 ms to 1. What was left
  is that culling flipped some feature's `visible` on every pan frame: since Nov 19 the OSM layer
  leaves its features alone while only the view moves (section 8). See
  [`scene.md`](scene.md), section 3.
- **Labels on long lines walk the whole line.** Smith Point's restyle takes 394 ms for 784 features:
  the labels take it, not the shapes. Five transatlantic cables (TAT13, Apollo North, …) have 4 nodes
  each but are 2.4–2.9 million pixels long at that zoom. `placeRopeLabel()` covers each line with boxes
  of about 16 px (`geomLineSegments()`), about 180,000 per cable, tests every box against the labels
  already placed, and places labels all the way across the ocean: 157,000 boxes in the label index
  afterwards, 154,000 of them for those five cables. The cost doubles with each zoom level, so it's 16
  times worse at z20. This is the same blowup that per-dash geometry had (section 5). The fix is to
  clip a line to the view, with a margin, before covering it with boxes; labels are placed once per
  zoom and kept while panning, so clipping needs a rule for placing again after a long pan.
- **A zoom change rebuilds everything, and in dense places that's a stall:** 1.5 s of APP and 197 ms
  of DRAW in Užice, about 300 ms at Staten Island and Golmud (10,000 solar panels, each an area).
- **What drives draw calls depends on the place.** Masks dominate in Seattle (708 of 768) and Bochum
  (292 of 318). In Užice they're 168 of 2,059, and the 1,213 unbatched `Graphics` (ways over 200
  vertices) dominate. Steps 6 and 7 are both needed.
- **About 3 ms of GPU time is fixed** (5 before the imagery filter fix). Heybridge draws 24 calls and
  still takes 2.8 ms; only Užice goes far beyond 6 ms. So the GPU question is mostly about a fixed
  cost per frame, not about what we draw. Section 6 takes it apart.
- **Užice's background work runs for minutes.** Its data loaded within the minute, but the
  scheduler's idle queue still had work after 90 seconds and took several minutes to drain. Probably
  the validator working through everything that loaded (Bryan's guess); not confirmed yet.
- **A reload right after Užice sometimes showed no OSM data at all** (three times), with nothing in
  flight and no rate limit showing a minute later. Not explained. One thing that makes it stick:
  `OsmService.loadTiles()` returns early while the view is unchanged, so tiles that failed aren't
  asked for again until the map moves. `--fresh` downloads every place again from the OSM API (Užice
  is 36 tiles), so don't run it in a loop.
- Without `--fresh`, the scene keeps every feature from the places before (84,000 in the OSM layer at
  Bochum, 2,400 of them visible; culling them took 4.6 ms) and `FilterSystem` kept 434,000 cache
  entries. Rapid never drops data the user has scrolled away from; that's for
  [`profiling.md`](profiling.md).

## 3. Frame stats

A `GraphicsSystem` that knows what each frame contained and what it cost. The two passes see different
things, so stats come from both:

- **During APP**, from Rapid: time spent in each layer's `render()` and `cull()`, and counts that only
  the layers know (features in view, rebuilt because dirty, created, culled, destroyed; labels placed
  and dropped; textures queued).
- **After DRAW**, from Pixi: the instruction list by pipe, batch sizes and texture counts, what ended
  each batch, the `Graphics` that weren't batchable and why (size, shader, `batchMode`), and GPU time.

Since Rapid can't plan the frame ahead, the frame itself is the unit we gather stats on. A
`RenderFrame` (`modules/pixi/RenderFrame.ts`) is passed from `_app()` through `PixiScene.render()`
into every layer's `render()` and `cull()`: the frame number plus whatever the frame gathers as it's
made, compared against the frame budget (`scheduler.targetFrameTime`, 16.7 ms by default). This is
the same idea as SGI Performer's `pfFrameStats`, which `backlog.md` already cites.

What a frame holds now (the class has the details):

```ts
class RenderFrame {
  id: number;
  zoom: number;
  dirtyScene: boolean;                 // every feature was marked dirty (zoom or rotation changed)
  contentChanged: boolean;             // a redraw was requested for the whole scene
  changedLayerIDs: Set<LayerID>;       // …or for these layers only
  cullBox: Extent;                     // what to have features ready for (section 8)
  appMs: number;
  layers: Map<LayerID, {
    enabled: boolean;
    kept: boolean;                     // the layer skipped its pass (section 8)
    renderMs: number; cullMs: number;
    features: number; visible: number;
    created: number; destroyed: number; updated: number; shown: number; hidden: number;
    steps: Record<string, number>;     // ms per step of render(), for layers that time them
  }>;
  draw: {                              // filled in after `pixi.render()`
    ms: number;
    renderGroups: number; rebuiltGroups: number; rebuiltInstructions: number;
    instructions: Record<string, number>;   // by renderPipeId
    batchTextures: Record<number, number>;
    unbatched: { label: string; reason: 'size' | 'shader' | 'batchMode' | 'unknown'; floats: number }[];
    gl?: { draws; programs; textureBinds; bufferUploads };   // with detailed stats on
    gpuMs?: number;                    // arrives a few frames later, when the timer query resolves
  } | null;
}
```

**How layers report (step 5, Nov 19).** A layer has a `work` record that it and its features count
into as they go, and the scene moves it onto the frame after the layer's pass (`takeWork()`):

- `created` and `destroyed` are counted where features join and leave the layer, `updated` where a
  dirty feature is rebuilt, `shown` and `hidden` where a feature's `visible` flips. Every layer gets
  these without changes of its own. `shown` and `hidden` are what makes Pixi rebuild instruction
  lists, and `draw.rebuiltGroups` says how many it rebuilt.
- `steps` is for a layer that wants to say where its time went. It calls `_endStep(name, since)`
  after each step of `render()`. Only the OSM layer does so far: `gather` (the spatial index),
  `filter` (hidden features), `classify` (sorting by geometry), `polygons`, `lines`, `points`,
  `related`, `vertices`, `midpoints`.

**Decisions so far**

- **`GraphicsSystem` owns frame stats** (Bryan, Nov 18). It keeps the last N frames in a ring buffer.
  Code that wants them (a script, an info card) asks it; layers don't keep their own.
- **The frame object is a `RenderFrame`** (Bryan, Nov 18). `SchedulerSystem` already exports a
  `FrameMetrics` (its moving averages of frame time), and the object will carry more than stats.
- **Reading Pixi's internals happens in one place.** The instruction list (`renderGroup.instructionSet`)
  and the GPU contexts (`renderer.graphicsContext.getGpuContext()`) aren't public API and can change in
  any Pixi release, so one module reads them, with a test that fails when their shape changes.
- **No e2e budget tests yet** (Bryan, Nov 18). Today's numbers are far from where we want them, and a
  budget now would lock them in. Frame stats are the part a budget test would use later.

**Cost and reach**

- Timing layers with `performance.now()` and counting instructions after DRAW are cheap enough to leave
  on. Measure that before deciding.
- Counting real draw calls means wrapping the GL context's functions, and GPU time needs a timer query
  around each DRAW. Both are for debug builds, or only while someone is watching the numbers.
- Instruction counts work the same on WebGL and WebGPU. Draw calls and GPU time each need a WebGPU
  version (wrap `GPURenderPassEncoder.draw*`; timestamp queries).
- The minimap's render and the label layer's texture renders aren't the map's frame. Count them apart.

**Open questions**

- ~~Whether layers report counts through the object or the scene works them out.~~ Settled (Nov 19):
  the layer and its features count as they work, and the scene collects the counts (above).

## 4. Partial fills without a stencil mask

**Why it's a mask.** The code came from iD, which drew in SVG and cut the middle out of each area with
a clip path. Pixi used to be unable to hit-test a line, so Rapid builds the inside band as a stroke,
copies its triangles into a `Mesh` (`PIXI.buildContextBatches`), and uses that mesh both as the fill's
mask and as the area's hit target ([meta/Rapid#1636](https://github.com/meta/Rapid/issues/1636#issuecomment-2557848323)).
Pixi 8 can hit-test a stroke now (`Polygon.strokeContains(x, y, width, alignment)`), so that reason is
gone.

**What the mask does for us**, which any replacement has to keep:

1. **The band stays inside the area.** An inside stroke 32 px wide pokes out the far side wherever the
   area is narrower than that. The current small-shape check (`screenW` or `screenH` under 69 px) catches
   areas whose bounding box is small, not a long diagonal sliver or the arm of an L-shaped building.
2. **Each pixel is covered once.** Fills are translucent, so wherever the band overlaps itself it draws
   darker. Pixi's line builder joins most corners cleanly, but not where the stroke is wider than a
   segment is long, and traced outlines (woods, wetlands, coastlines) are mostly short segments.
3. **The band is the hit target**, so clicking inside the band selects the area and clicking the middle
   doesn't.

**Options**

- **A. Draw the band as an inside stroke** with the fill's color and pattern (strokes take textures).
  Simple, and it batches. It fails points 1 and 2.
- **B. Build the band as real geometry:** the area minus an inward offset of its outline (and the
  outward offset of each hole). It's exact on all three points, fills as an ordinary batched shape, and
  hit-tests with a custom `hitArea` (`contains()` on the outer ring minus the inner). The hard part is
  the inset: where the area is narrow or segments are short, the offset outline folds over itself and
  has to be cleaned up (or vanishes, and the whole area is filled). The band is 32 *screen* pixels, so it
  changes with zoom and has to be rebuilt for every visible area on a zoom change, or cached per whole
  zoom level.
- **C. A mix of A and the mask**, choosing per area. Cheap only if a quick test can tell the two cases
  apart, and as point 1 shows, the bounding box can't.

**Direction: B, with our own line builder** (Bryan, Nov 18). An experiment would show where A fails in
Seattle, but not in the next parking lot, so it can't settle the question. `lineToPoly` in
`modules/pixi/helpers.ts` is the naive version of this: it runs Pixi's `buildLine` and walks the
triangles back into an outline, which breaks on round joins and depends on Pixi's internals. It's used
for line hit areas, select halos, area outline hit areas, and the label layer's boxes along lines.

One line builder of our own, producing offset outlines, would replace all of those, give us the
partial-fill band, and later the precise buffers that conflation may want (`backlog.md`, "Conflation /
buffers follow-ups"). Section 5 adds dashes to its list. It also lets us choose how finely to divide
round caps and joins, by screen size instead of world units (section 2).

**Open questions**

- Write the offsetting and its cleanup ourselves, or use a polygon clipping library (Clipper2 has
  JavaScript ports). Even if we write our own, a library makes a good reference to test against.
- Where it lives. It's plain geometry with no Pixi in it, so `modules/geo/` fits, next to the code
  conflation uses.
- Building bands on a zoom change, for every visible area: whether it fits in the APP pass, or needs
  caching per zoom level or a worker. Bryan expects it to fit: Pixi's line builder already does the same
  kind of math in the APP pass for every partial fill, and the result stays in the `Graphics` or `Mesh`
  until the next zoom change. Frame stats will say.

## 5. Dashed lines

**Today.** `lib/DashLine.ts` has two modes. Every caller uses the default, `useTexture: true`: one
small dash texture per pattern (cached in `PixiTextures`), repeated along each segment by a texture
matrix. The other mode (`useTexture: false`) builds geometry for every dash. Nothing uses it now, but
it's the mode that made long lines expensive at high zoom (see [meta/Rapid#544](https://github.com/meta/Rapid/issues/544)):
an undersea cable selected at z20 is millions of dashes.

Texture mode still costs more than it should:

- It strokes **each segment separately**, with its own copy of the matrix, because the pattern has to
  continue from where the last segment left off. So a dashed line is one stroke per segment, and in the
  view above one dashed way's stroke was a `Graphics` with 91 batches. Long dashed lines pass Pixi's
  200-vertex limit and are drawn on their own.
- Separate segments mean **no joins and no caps**. Corners have small gaps or overlaps, and the round
  caps some styles ask for are ignored.

**Direction.** If our line builder (section 4) gives each vertex its distance along the line as a
texture coordinate, a dash texture repeats along the whole line in one stroke, with proper joins. That's
the same shape of geometry as the partial-fill band, so it's one builder with two uses. Patterns of four
values work, and dash lengths stay in screen pixels by scaling the coordinate per zoom.

Then the per-dash mode can go.

## 6. GPU time

6 to 9 ms a frame on an M4 in Seattle, whatever the draw calls, and about 5 ms even where almost
nothing is drawn (section 2, the difficult places). Step 3 of the plan took it apart (Nov 18).

**Most of it is three fixed costs, and what Rapid draws is the small part.** In Seattle, of 6.1 ms:

| Part | GPU ms | What it is |
|---|---|---|
| An empty frame | 2.9 | Clearing and resolving a 2556×2334 canvas with 4× MSAA, and `multiView`'s copy (about 1.5 of it) |
| The imagery filter | 2.1 | The `AdjustmentFilter` on the base imagery, at its default values |
| The imagery itself | 0.1 | |
| All OSM features | 1.0 | 769 of the 771 draw calls. The partial-fill masks are about 0.6 of it |

How it was measured: each row below is a fresh load with one renderer option changed, or one part of
the scene hidden just before rendering. The number is the GPU time of one more render when the GPU is
busy (a burst of 32 renders against a burst of 8, ended by a `readPixels()`), from the timer query.
Wall-clock time for the same bursts agrees within about 1 ms, so the timer query can be trusted. A
single render on an idle GPU (what frame stats show) varies more, and reads up to 3 ms higher where
there's a lot to draw; the GPU probably runs at a lower clock when it has little to do.

| | Heybridge | Seattle | Staten Island | Bochum | Užice |
|---|---|---|---|---|---|
| As drawn today | 5.1 | 6.1 | 6.0 | 5.8 | 12.1 |
| Nothing drawn | 2.9 | 2.9 | 2.8 | 2.8 | 2.8 |
| Imagery only | 5.1 | 5.0 | 5.1 | 5.1 | 4.9 |
| Imagery only, without its filter | 3.1 | 3.0 | 3.0 | | |
| Everything, without the imagery filter | 3.1 | 3.8 | 3.7 | 3.8 | 10.1 |
| Masks removed (fills drawn in full) | 5.2 | 5.5 | 5.5 | 5.4 | 10.8 |
| No MSAA (`antialias: false`) | 1.4 | 2.1 | 1.9 | 2.0 | 4.2 |
| Ratio 1 (`resolution: 1`), with MSAA | 1.4 | 2.1 | 2.0 | | |
| Ratio 1, no MSAA (what `highQuality` off gives) | 0.5 | 0.8 | 0.8 | | |

What that says:

- **The imagery filter cost 2 ms and did nothing. Fixed (Nov 18).**
  `PixiLayerBackgroundTiles.applyFilters()` put an `AdjustmentFilter` on the base imagery on every
  frame, also when brightness, contrast and saturation were all 1, and made a new filter object each
  time. A filter makes Pixi draw the imagery into a full-size texture and then draw that texture
  through the filter's shader (0.6 ms without MSAA). Now a setting at its default gets no filter, and
  the filters are set only when the settings or the base imagery change. In frame stats, Seattle went
  from 7.1 to 6.0 ms and Heybridge from 4.7 to 3.5. The tables above are from before the fix. A user
  who changes a display setting still pays for the pass.
- **MSAA at ratio 2 triples everything.** Turning either one off brings Seattle from 6.1 to 2.1 ms, and
  both off to 0.8. At ratio 2 a pixel is small enough that 4× MSAA may not be worth it; that's a
  decision to make by looking at screenshots, not from these numbers.
- **`multiView` costs about 1.5 to 2 ms a frame.** Pixi renders into a hidden WebGL canvas, and copies
  it onto the visible canvas with a 2D `drawImage()` after every render
  (`GlRenderTargetAdaptor.postrender`); the copy has to resolve the MSAA buffer first. With
  `multiView: false` an empty frame went from 3.2 to 1.6 ms, and Seattle from 7.6 to about 6 (single
  renders; bursts don't work without it). We use it only so the minimap can share the renderer. The
  map could render straight to its own WebGL canvas, with the minimap (small, and seldom redrawn)
  paying for a copy instead.
- **The masks cost 0.4 to 1.3 ms**, more where there are more of them. Removing them is worth more for
  the draw calls and the batching than for the GPU.
- **What we draw matters in Užice only:** 7 ms for 61,000 features in 2,056 draw calls.
- `preserveDrawingBuffer: false` made no difference, and `useBackBuffer: true` made it worse (both
  tried at Heybridge only).
- `gl.finish()` returns at once in Chrome and can't be used to wait for the GPU; `readPixels()` can.

## 7. Plan

Each step is measured with frame stats on the same set of places.

1. **Frame stats, first version. Done (Nov 18).** `_app()` makes a `RenderFrame`
   (`modules/pixi/RenderFrame.ts`); `PixiScene.render()` records each layer's `render()` and `cull()`
   time and feature counts on it; `_draw()` adds the DRAW time and Pixi's instructions
   (`modules/pixi/lib/RenderStats.ts`). `gfx.renderFrames` keeps the last 120 frames, and
   `gfx.lastRenderFrame` is the newest. `gfx.enableDetailedStats(true)` adds WebGL call counts and GPU
   time (WebGL 2 only for now). Layers still receive the frame number; passing the `RenderFrame` itself
   is step 5. `test/e2e/rendering.test.js` checks that Pixi's internals still look as expected.
   What it showed in Seattle:
   - The always-on part costs little: reading the instruction list takes about 0.1 ms per DRAW.
   - **The OSM layer spends about 8 ms of every redraw even when nothing changed** (APP 9.5 ms with no
     dirty features, against 89 ms when everything is restyled). Worth its own look: see "Renderer:
     classify a node only when it's dirty" in `backlog.md`.
2. **A set of difficult places. Done (Nov 18).** Saved views that stress different things (Bryan's
   list, Nov 18). `bun run measure` (`scripts/measure.ts`) visits them in the debug Chrome and prints
   each one's frame stats, so every change below is compared the same way; `--fresh` reloads before each
   place, `--out` saves everything as JSON. It measures three kinds of frame: redraw, pan and restyle.
   The results are in section 2. Kept out of e2e tests for now.
   OSM changes, so a place can stop being difficult (the factories may have been reverted). The script
   holds the list; keep this table in step with it.

   | Place | `map=` | What it stresses |
   |---|---|---|
   | Downtown Seattle | `17.50/47.61040/-122.33450` | paths, dashes, buildings (section 2's baseline) |
   | Nuevo León, Mexico | `17.00/21.14900/-101.66980` | address points |
   | Miami-Dade, Florida | `19.00/25.53485/-80.37714` | lots of detail, fences |
   | Užice, Serbia | `16.00/43.8535/19.8433` | so much detail |
   | Bochum Hauptbahnhof, Germany | `18/51.47836/7.22315` | very dense mapping, light directions |
   | Smith Point Beach, New York | `15.95/40.7335/-72.8624` | submarine cables |
   | Market Square Plaza, DeKalb, Illinois | `17.50/41.94892/-88.72369` | every parking space mapped |
   | Staten Island Mall | `16.50/40.58201/-74.16480` | every parking space mapped |
   | Grant Park, Chicago | `17.86/41.87606/-87.61865` | micromapping |
   | Golmud Solar Park, Qinghai | `16.00/36.0677/100.2792` | solar panels, each one an area |
   | Factories, Jiangsu, China | `15/34.54897/119.58936` | building detail |
   | Heybridge, England | `18.00/51.72229/0.67766` | fences |
3. **GPU time. Done (Nov 18).** The toggles are in section 6: most of the GPU time is fixed (MSAA at
   ratio 2, the imagery filter, `multiView`'s copy), and the features are about 1 ms of it. Three
   changes come out of it: skip the imagery filter at its default values (2 ms; done), render the map
   without `multiView` (1.5 to 2 ms, larger; not done), and decide whether ratio 2 needs MSAA.
   The experiments needed a temporary hook to override Pixi's options at startup; it isn't in the code.
4. **A rendering info card. First version done (Nov 18).** `UiRenderingCard`
   (`modules/ui/cards/`) sits with the measurement and history cards and shows the frame stats live
   while panning. Turn it on with ⌘⇧F, or "Show Rendering Panel" in the Map Data pane. It has:
   - a chart of the last 120 frames, the DRAW pass stacked on the APP pass, with a line at the frame
     budget and red for a pass that went over it;
   - the APP and DRAW times as bars against the budget, averaged over the frames drawn in the last
     second, and the GPU time when detailed stats are on (its button turns them on, and hiding the
     card turns them off again);
   - features shown, the slowest layers, Pixi's instructions by pipe, WebGL calls (with detailed
     stats), and the scheduler's queue, pressure and dropped frames.

   The first thing it showed: **panning costs more than the frames `bun run measure` measures.** In
   Seattle, panning 6 px per animation frame from a script, a frame took 15 to 20 ms of APP and 7 to
   10 ms of DRAW, against 10 and 0.8 for a frame where nothing changed. The script measures pan
   frames now (section 2).

   It redraws at most four times a second. Ideas for later, from Performer's `pfFrameStats`: texture
   and atlas use, vertices per layer (after step 5), marking restyle frames in the chart, and a
   GPU line in the chart.
5. **Pass a `RenderFrame` through `render()` and `cull()`. Done (Nov 19),** together with the CULL
   pass for the OSM layer (section 8), which needs it. Every layer's `render()`, `cull()` and
   `retainFeature()` take the frame. Layers report what they did to their features, the OSM layer
   also where its time went, and the DRAW stats say how many instruction lists Pixi rebuilt
   (section 3). `bun run measure` saves all of it with `--out`, and the rendering card shows which
   layers kept their features and how many render groups were rebuilt.
6. **The line builder,** as plain geometry with unit tests (a band never leaves its area, never
   overlaps itself, holes, slivers, short segments). Then, one at a time and measured: partial-fill
   bands instead of masks; hit areas, halos and label boxes instead of `lineToPoly`; dashes as one
   stroke per line.
7. **Casings and strokes in grouped batches** with Pixi's `RenderLayer` ([`scene.md`](scene.md) section 4,
   [`profiling.md`](profiling.md)), measured after the masks are gone, since the masks break batches
   today anyway.

Done outside the numbered steps: the imagery filter fix (section 6), render groups with OSM
polygons split by tile ([`scene.md`](scene.md) section 3), and the CULL pass for the OSM layer
(section 8, Nov 19).

## 8. A CULL pass

**Built for the OSM layer (Nov 19).** Bryan's point: a layer doesn't need to decide what's visible
on every frame. SGI Performer had CULL as its own stage between APP and DRAW.

Before, every APP pass did everything, for every layer: ask the spatial index what's in the exact
view, visit each of those features (update it if it's dirty, mark it seen), then hide every feature
that wasn't seen. On a pan nothing is dirty, but all of that still ran (about 3 µs per visible
feature), and it changed some feature's `visible` on every frame, which made Pixi rebuild the
instructions of that feature's render group. Every layer but OSM still works that way.

**What a pan frame could cost.** Measured before building it, by turning off the OSM layer's
`render()` and `cull()` from the console and panning 20 px a frame (so nothing new scrolls in, but
nothing is rebuilt either):

| | APP | DRAW |
|---|---|---|
| Seattle, as now | 7.6 | 4.6 |
| Seattle, OSM layer skipped | 1.4 | 1.9 |
| Staten Island, as now | 42.9 | 6.7 |
| Staten Island, OSM layer skipped | 1.9 | 1.5 |

A pan frame of 3 to 4 ms instead of 12 to 50.

### How it works

- **The cull box** (`PixiScene.updateCullBox()`, on the frame as `frame.cullBox`). The view in world
  coordinates, with 256 px of padding on each side (`CULL_PADDING`). It's kept, as the same object,
  for as long as the view stays inside it at the same zoom; when the view leaves it, a new one is
  made around the view. A layer gathers its data by the box, so everything in it is made and shown,
  also the part outside the view.
  The first sketch snapped the box to a grid. Keeping the box until the view leaves it does the
  same job with less: the padding is 256 px, where a grid would hold 256 to 512, and a view that
  moves back and forth across a grid line would do a pass each time.
- **A frame says why it's being drawn.** `GraphicsSystem` has two ways in: a transform change (the
  view moved), and a redraw request, `deferredRedraw()` or `immediateRedraw()` (something changed).
  A request can name the one layer whose content changed (`deferredRedraw('background')`). The
  frame carries it: `contentChanged` (a request for the whole scene, or the whole scene is dirty),
  `changedLayerIDs`, and `changedFor(layerID)` for a layer to ask.
- **A layer keeps its features** when nothing changed for it and the frame's cull box is the one it
  already did a pass for: `AbstractPixiLayer.keepFeatures(frame)`. Its `render()` returns, and
  `cull()` leaves the features alone too. The OSM layer still asks for the view's tiles first
  (`context.loadTiles()`), so data keeps loading as the view moves.
- **Marking features dirty makes their layer do its next pass** (`dirtyLayer()`, `dirtyFeatures()`,
  `dirtyData()`, and the scene's versions, which go through the layers now), whatever the frame is
  for. So does a `render()` that returned before asking (the layer is off, or zoomed out too far).
- **Passes are counted, not frames.** `cull()` destroys a feature that 20 passes haven't seen. A
  frame where the layer kept its features isn't a pass.
- **Layers that don't use it** do their pass on every frame as before: the imagery tiles and the
  labels follow the view itself, and the data layers (Rapid, photos, QA) haven't been changed yet.

### What it does to a frame

`bun run measure --fresh` on the same machine and settings as section 2 (Nov 19), in ms. A pan
frame moves the view 100 px, so about one in three leaves the cull box. "Kept" is the pan frames
where the OSM layer kept its features, "cull" the ones where it did its pass for a new box. "Before"
is section 2's table (Nov 18), where every pan frame did the pass; it's from before the render
groups too, which took up to half off the pan DRAW at the dense places. "Shown" counts the
features in the padding as well.

| Place | Shown, before → now | Pan APP, before → kept | Pan DRAW, before → kept | Cull APP | Cull DRAW | Restyle APP, before → now |
|---|---|---|---|---|---|---|
| Seattle | 3,014 → 5,443 | 9.0 → 2.5 | 6.8 → 3.1 | 26.6 | 9.1 | 79 → 141 |
| Nuevo León | 1,076 → 1,637 | 5.7 → 1.7 | 3.9 → 1.3 | 20.7 | 5.8 | 30 → 42 |
| Miami-Dade | 2,596 → 4,787 | 6.7 → 2.2 | 4.2 → 1.4 | 22.9 | 6.5 | 51 → 97 |
| Užice | 61,124 → 65,798 | 218 → 11.8 | 109 → 5.4 | 224 | 52 | 1,538 → 1,690 |
| Bochum | 2,505 → 3,631 | 8.4 → 2.0 | 5.4 → 2.5 | 23.4 | 6.2 | 74 → 99 |
| Smith Point | 784 → 1,084 | 3.7 → 1.7 | 2.3 → 1.4 | 15.2 | 4.0 | 394 → 386 |
| DeKalb | 3,785 → 5,161 | 10.6 → 1.8 | 5.7 → 1.3 | 26.8 | 2.7 | 66 → 92 |
| Staten Island | 15,983 → 18,539 | 43.5 → 4.3 | 22.8 → 2.8 | 63.4 | 7.9 | 275 → 340 |
| Grant Park | 1,334 → 2,594 | 6.6 → 2.1 | 3.6 → 3.1 | 24.1 | 5.0 | 40 → 74 |
| Golmud | 10,304 → 14,227 | 35.5 → 3.7 | 27.8 → 1.8 | 59.6 | 3.9 | 343 → 462 |
| Heybridge | 951 → 1,320 | 3.8 → 1.3 | 2.3 → 1.6 | 15.3 | 2.8 | 22 → 33 |

(Jiangsu didn't load: the OSM API was rate limiting by then. `bun run measure` waits out a rate
limit now, before it measures.)

- **A pan frame that only moves the view costs 3 to 7 ms in all**, where it cost 6 to 66. In Užice
  it's 17 ms against 327. About 3 render groups are rebuilt in such a frame (the imagery and the
  labels), against 26 to 80 in a frame that does the pass.
- **The cull frames can't be compared with the old pan frames like for like.** The old ones were
  measured back to back; these came 250 ms apart (no redraw is requested for a pan, so each waited
  for the throttle). A pass that follows a 250 ms pause takes about twice as long as the same pass
  straight after another: 21.6 ms against 11 in Seattle with nothing moving at all (`gather` 1.9
  against 0.6, `filter` 12 against 5.9). That's the processor slowing down while the page is idle
  (section 9). It makes the script's numbers too high, not a real drag's: the pointer events of a
  drag keep the page busy.

Checked by screenshot at Seattle, Staten Island and Bochum: after each of 17 pans (some inside the
box, some out of it), the picture is the same, pixel for pixel, as after a full pass at the same
view.

**A real drag** (pointer events from a script, 600 px out and back over 2.5 s at Staten Island,
over an area already loaded): 19 frames, 16 of them kept at 1.4 ms APP and 1.3 ms DRAW, and 3
passes at 60 ms. Over a new area, more of the frames are passes, as OSM tiles arrive.

**What it costs:**

- **A pass covers more.** The box holds 1.2 to 1.8 times the features of the view, so a zoom change
  (which restyles all of them) costs more: Seattle's restyle went from about 80–120 ms to 140, and
  Golmud's from 343 to 460. With 128 px of padding it was 119 and 417, and Staten Island's hardly
  differed (313 against 326): its big features reach into the padding either way.
- **More is drawn outside the view:** 1,295 draw calls in Seattle where the view alone needed 782.
  The DRAW pass went from 0.8 to 1.0 ms, and GPU time didn't change.

### Redraw requests, checked

Skipping a pass is only safe if every change to what the OSM layer draws is followed by a redraw
request. Every path was traced (Nov 19): edits, undo and redo, restore and reset (`stagingchange`
and `merge` in `MapSystem`), OSM data arriving, feature filters, hover and select (`UiSidebar`,
`Context.enter()`), highlights, mode changes, wireframe and fill mode, styles, language, the
schema, and layers being turned on. All of them make a request. What turned up:

- **Imagery tiles and label textures asked for a redraw of everything**, several times a second
  while panning, so no pan frame would have been view-only. They name their layer now, and so do
  the Rapid layer's data (`MapWithAIService`, `EsriService`) and conflation results.
- **Spritesheets made no request when their icons were registered** (`UiDefs`). Points drawn before
  that waited for "the next frame, whatever it's for". Now a request is made.
- **Left alone:** the area fill setting arriving from another tab (settings sync) makes no request
  and marks nothing dirty; that was so before. And the effective zoom depends on latitude, so on a
  north-south pan the line where vertices appear (effective zoom 16) can be crossed inside a cull
  box: they show up to 256 px late.

### What the steps cost

The OSM layer's step times (section 3), medians of redraw frames (nothing changed, back to back),
in ms:

| Place | `render()` | gather | filter | classify | polygons | lines | vertices |
|---|---|---|---|---|---|---|---|
| Seattle | 16.3 | 0.9 | 7.7 | 1.1 | 0.7 | 2.7 | 3.1 |
| Staten Island | 54.8 | 3.1 | 30.0 | 5.0 | 8.2 | 1.7 | 6.4 |
| Golmud | 48.4 | 4.2 | 22.5 | 6.0 | 9.8 | 0 | 6.0 |
| Užice | 211 | 12.8 | 106 | 21.2 | 18.7 | 15.4 | 34.2 |

Hidden-feature filtering was about half of a pass wherever any feature is hidden (boundaries are,
by default). Sorting the entities by geometry (`classify`), the vertices and the spatial index come
next. On a restyle the shapes take over: in Užice 492 ms of polygons, 533 of lines and 429 of
vertices; at Golmud 416 ms of polygons; in Seattle 56 ms of lines and 42 of vertices.

**After the filter's quick fixes** (Nov 19, `design/filter-system.md` section 4: its cache is keyed
by the entity, not by a string built on every call, and it remembers each feature's answer):

| Place | `render()` | gather | filter | classify | polygons | lines | vertices |
|---|---|---|---|---|---|---|---|
| Seattle | 8.2 | 0.6 | 2.2 | 0.7 | 0.5 | 2.0 | 2.5 |
| Staten Island | 32.3 | 2.8 | 9.8 | 4.2 | 7.4 | 1.4 | 5.4 |
| Užice | 144 | 12.4 | 39.4 | 22.1 | 19.8 | 15.6 | 34.3 |

Most of what's left in `filter`, `classify` and `vertices` is the vertices: 65,695 of the 84,641
entities in Staten Island's cull box, of which the layer draws about 3,500.

**Compare builds in one session.** The same build measured hours apart differs by more than some
of these changes: Seattle's redraw frame was 10.8 and 17.5 ms in two runs of one build, and Staten
Island's cull frames 63 ms one night and 100 the next morning. Old build then new, back to back at
Staten Island: the redraw frame's APP pass went from 57.1 to 34.5 ms, a cull frame's from 100 to
72, and a kept frame's didn't change (6.0 and 5.8).

### What's left

- **Frame pacing in place of the 250 ms throttle:** done, section 9.
- **A deadline on the frame, and work that can wait:** section 10. Making features, drawing them
  again and placing labels wait now. The pass itself doesn't.
- **All layers alike.** Only the OSM layer keeps its features today. The others do their pass on
  every frame, which is cheap at the places measured (the Rapid layer 0.1 to 0.6 ms) but is
  different code for the same job, and the deadline above needs every layer to say whether it has
  work.
- **Make the pass cheaper.** The filter's quick fixes are done (above). Next, the vertices: don't
  gather, filter, sort and test each one when few are drawn (`design/filter-system.md` section 4).
- **More requests could name their layer:** the photo and QA services, `VectorTileService`.

## 9. Frame pacing

Built Nov 19. Until then an APP pass waited 250 ms after the last DRAW, whatever it was for. The
number was a rough guess carried over from iD, and it did two jobs: it kept an expensive pass from
running too often, and it left time for input and for background work (tiles, validation). Since
the CULL pass, most frames of a pan are cheap, and the two jobs can be told apart.

Bryan's direction: let the frame rate float with what's going on, so that 60, 30 or 20 frames a
second are reached when the work allows. Rapid isn't a game and needn't hold 60. At 10 it's usable
and visibly laggy. Keep leaving time for the background work.

### The rule

A frame that has no pass to do is drawn on the next tick, APP and DRAW together. A pass frame waits
its turn, and how long depends on why it's wanted:

| Why the pass is wanted | It waits |
|---|---|
| `immediateRedraw()`: the user did something | Not at all |
| `immediateRedraw(layerID)`: one layer has something to show now (a label texture) | That layer is drawn on the next tick. Anything else that's waiting keeps waiting. |
| The view needs it: it left the cull box, or the zoom or rotation changed | The gap: twice what the last pass frame cost (APP and DRAW together), at most 250 ms |
| `deferredRedraw()`: data arrived | The gap, and at least 250 ms after the last pass frame, so that arrivals batch up |

So passes take at most a third of the time, nothing waits longer than it did before, and data
arriving is drawn as often as before.

**While a pass frame waits**, the view doesn't have to: a held frame is drawn on every tick that the
view moved. It tells the layers that nothing changed and gives them the cull box they had, so the
OSM layer keeps its features (`keepFeatures()` says yes in a held frame even for features marked
dirty since). The view shows what the last pass made, in the right place, with the 256 px of
padding to move into. A held frame can't follow a change of zoom or rotation, because features are
styled for their zoom. Then no frame is made, and the CSS transform carries the view as it always
did.

`FramePacer` (`modules/pixi/lib/`) holds the rule. It has no clock of its own: `GraphicsSystem`
tells it when a pass begins and what it cost, and asks how long the next must wait
(`gfx.pacer`). A frame records whether it was held (`RenderFrame.held`), and the rendering card
shows how many frames were drawn in the last second.

### A pass after a pause costs twice as much, because the processor slowed down

The same pass (Staten Island, nothing changing, APP ms), run after a gap of the given length. In
one case the page did nothing during the gap, in the other it kept the main thread busy:

| Gap before the pass | 0 | 17 ms | 50 ms | 100 ms | 250 ms | 1 s |
|---|---|---|---|---|---|---|
| Page idle | 29 | 27 | 35 | 40 | 54 | 57 |
| Main thread busy | | 27 | 27 | 26 | 27 | 27 |

It isn't the JIT, the caches or garbage collection: a busy thread stays fast for a full second.
The processor (an M4) slows an idle thread down within 50 ms, and the spatial query suffers most
(`gather` 2.5 → 10 ms). What follows:

- **Frames on every tick keep it fast.** A pass in the middle of a pan drawn at 60 frames a second
  runs at the fast cost.
- **A drag was never slow this way.** Its pointer events keep the page busy. It was the measuring
  script's pans, with nothing happening between them, that paid double.
- **One action after a pause still pays it** (a hover, a click). Nothing to do about that.
- `bun run measure`'s redraw frames run back to back, so they show the fast cost.

### What it does

Staten Island (z16.5, 18,500 features shown), old build then new in one session (Nov 19).

**A drag with real pointer events**, 600 px out and back, about 30 events a second from the script:

| | Before | After |
|---|---|---|
| Frames drawn | 17 in 4.3 s (4 a second) | 134 in 4.6 s (29 a second, one per pointer event) |
| Between frames (median) | 296 ms | 33 ms |
| View-only frames, APP + DRAW | 1.5 + 1.5 ms | 1.1 + 1.1 ms |
| Pass frames when the view left the cull box | 3 at 42 + 8 ms | 4 at 38 + 8 ms |
| Main thread time in ticks | 0.42 s (10%) | 0.79 s (17%) |
| Animation frames longer than 25 ms / 50 ms | 4 / 3 | 6 / 1 |

**A pan on every animation frame** (from a script, 5 px a frame): 237 frames in 4.1 s, 57 a
second, with 29% of the main thread's time in ticks. At 15 px a frame (900 px a second, into
unloaded territory): 46 a second, with a pass frame every 280 ms or so at 45 + 14 ms, and 20 of 240
animation frames longer than 25 ms.

**Background work isn't held up.** Time until Staten Island had loaded and the scheduler's queues
were empty, one run each:

| | Before | After |
|---|---|---|
| Map still | 31.9 s (7 frames) | 31.9 s (5 frames) |
| Panning on every animation frame meanwhile | 37.9 s (133 frames, 8.8 s of main thread) | 37.4 s (2,163 frames, 13.2 s of main thread) |

Of the 32 s, the main thread works for about 6 (5 on the scheduler's queues, 1 drawing). Sixteen
times the frames made no difference to it, which is why the gap doesn't look at the scheduler's
pressure level. That can be added if a case turns up.

(Corrected later the same day: I first wrote that those 32 s are the network. They aren't. The 20
map tiles have arrived 2.6 s after the page opens, and everything is drawn after 8 s (section 11).
The rest is the scheduler working through its queues at its own pace, about 5 s of work spread
over 25. What that work is wasn't traced; validation is the likely one.)

**`bun run measure` (pan frames, ms), now that they come a tick apart:** Seattle's view-only frames
1.2 APP + 1.3 DRAW and its pass frames 18 + 12; Staten Island 1.4 + 1.3 and 40 + 9; Užice 5.0 +
4.6 and 182 + 54. The script also has a `glide` measurement now: the view moves on every animation
frame along the pan path, and it reports the frames drawn a second, the animation frames longer
than 25 ms, and what a pass frame cost in the middle of it. Seattle: 58 a second, 2 long of 240,
31 ms. Staten Island: 57, 4 and 67 ms.

**Start-up in the e2e tests** (software rendering, five pages at once; medians of 40 runs): OSM
data is on screen 8.2 s after the page opens where it was 8.7, and a Rapid dataset shows 0.2 s
after it's turned on where it took 1.0. The first frame's DRAW pass used to block for 3.3 s there
and now takes 3 ms; the cost shows up later, in the first frame with features (1.4 s where it was
0.7). Why the first one blocked isn't traced. One side effect: the page answers the tests sooner,
while it's still busy starting, so the welcome screen (which fades out over animation frames) took
longer to close after its Escape, and the tests' start-up helper waits longer for it now.

**Checked by screenshot** at Staten Island: after 6 pans, and after an eased zoom in, pan, rotation
and rotation back, the settled picture is the same, pixel for pixel, as after a full pass at the
same view. A held frame after a pan out of the cull box is the same as the full pass over the part
the old box covers.

### What it doesn't fix

- **A pass frame is one block of work.** When the view leaves the cull box at Staten Island, that's
  45 to 80 ms in two ticks, three to five animation frames missed. The first pass after a load is
  790 ms. Pacing decides how often that happens, not how long it takes: a cheaper pass, or a pass
  spread over frames (section 8, "What's left"), does.
- **Užice's pass frame is 240 ms.** With the longest gap after it, that's about two a second, as
  before.
- **Zooming was as it had been:** a restyle of everything, at most every 250 ms in dense places,
  with the CSS transform in between. (Section 10 makes the restyle much cheaper.)
- **Layers without `keepFeatures()` do their pass in a held frame too.** Cheap so far (section 8).
- **`draw` is emitted for every frame, up to 60 times a second** where it was 4. It has about 20
  listeners, and most throttle themselves. Together they took 0.3 ms a frame at Staten Island (cards
  closed), 0.6 with the minimap shown. A new listener should throttle itself.
- **The OSM layer asks for the view's tiles on every frame** (`context.loadTiles()`), which is part
  of the 1 to 2 ms a view-only frame's APP pass takes.

## 10. A deadline on the frame

Started Nov 19. A pass frame was one block of work, however long: 140 to 350 ms for a zoom in
Seattle or at Staten Island, 1.8 s in Užice. Now part of that work can wait for the frames after.

### First, most of a zoom's work wasn't needed at all

Measured before designing anything: where a restyle's 139 ms in the OSM layer go in Seattle
(5,354 features, each marked dirty as a zoom does).

| | ms |
|---|---|
| `styles.styleMatch()`: working out each feature's style from its tags | 65 |
| The `style` setter: merging that style with the defaults | 20 |
| The features' `update()`: drawing them at the new zoom | 30 |
| The rest of the pass | 24 |

A feature's style doesn't depend on the zoom. The layer worked it out again because its loops said
`if (feature.dirty)`, and a zoom makes every feature dirty. Two things are told apart now:

- **`feature.dirty`:** it has to be drawn again.
- **`feature.needsStyle`:** the layer should work out its style and label again from its data.
  True for a new feature, when its data is bound again, and when the layer or the scene marks it
  dirty (`dirtyLayer()`, `dirtyScene()`, `dirtyData()`: the styles, the language, the filters or
  the data changed). Not after a zoom or a rotation, which call `scene.dirtyTransform()`, and not
  for a class like hover or select.

The OSM layer's loops check `needsStyle` before matching a style. That alone took a zoom's APP
pass from 148 to 47 ms in Seattle and from 327 to 102 ms at Staten Island. The other layers still
check `dirty`, which works as before.

### What can wait, and how

`GraphicsSystem` gives each frame a deadline, and layers ask `frame.hasTime()`. The budget:

- **6 ms** (`APP_BUDGET_MS`) while the view is moving.
- **24 ms** (`STILL_BUDGET_MS`) once the view has been still for 150 ms. The frames then come at
  about 30 a second until the work is done. (At first this also needed the scheduler's queues to
  be empty. They never were while the map caught up: see "What a frame costs when little is done
  in it" below.)
- **At least half of what recent frames cost anyway,** up to 50 ms. Where a frame is expensive
  whatever changed in it, small steps cost more than they save.

The DRAW pass's share counts against the budget too. Drawing a feature takes little time in the
APP pass, because Pixi builds the geometry when it renders. So each feature drawn adds what it's
expected to cost there (`frame.drawDebt`: 4 µs for one drawn again after a zoom, 10 µs for a new
or changed one), and `hasTime()` counts it. Without that, one frame drew 7,000 new features in
19 ms of APP pass and then spent 212 ms in DRAW.

- **Making a feature.** After a load there are thousands to make, and making one (its Pixi
  objects, its style) costs about 35 µs. Where the OSM layer's loops find an entity with no
  feature, they ask `_waitToMake()`:
  - **Outside the view,** it waits until the view's are made and a frame has time to spare.
  - **In view,** it's made while the frame has time.
  - In a frame **the user asked for,** it's made whatever the time only if the user needs it at
    once: they just drew it, or it's a vertex of what they selected.

  The layer remembers the entities that waited. On later frames `continueWaiting()` runs them
  through the same `render…()` functions as a pass does, 64 at a time, the ones in view first.
  At least one batch is made on each call.
- **Drawing a feature again.** A layer calls `this.updateFeature(feature, frame, viewport)` where
  it called `feature.update(viewport)`.
  - A dirty feature **in view** is drawn at once while the frame has time. After that it waits,
    and is shown as it was: after a zoom, at the old zoom's line widths, scaled.
  - A dirty feature **outside the view**, in the cull box's padding, always waits.
  - In a frame **the user asked for** (`immediateRedraw()`, `frame.urgent`), a feature in view that
    changed itself (its data, a class like hover) is drawn at once whatever the time. A feature
    that only the zoom made dirty (`feature.onlyTransformDirty`) still waits. So a hover in the
    middle of a zoom draws the hovered feature, not everything.
- **Going on with it.** On a frame where the layer keeps its features, it calls
  `continueWaiting()`, which draws the features in view that waited, at least 32 a frame and as
  many as the deadline allows. After every layer has rendered, the scene calls it again for the
  ones outside the view, with whatever time is left.
- **Placing labels.** The labels wait until no feature in view is waiting to be made or drawn
  (they go by the features' shapes), and one more frame if that frame is out of time. The labels
  that exist are still drawn. In a frame the user asked for, they're placed at once.
- **Another frame.** If any layer has work waiting after a frame (`frame.unfinished`), the next
  tick makes another, pass or no pass. These frames aren't paced: they're cheap by construction.
  (Except where DRAW has a big fixed cost, as in Užice: see "What a frame costs when little is
  done in it".) `gfx.resumeWaiting()` asks for such a frame from outside, when something the
  waiting work needed has arrived (a texture).
  `gfx.pending` is `true` until nothing is left, and scripts and tests wait for that.

### What it does

Old build (frame pacing) then new, Nov 19. A zoom in of one level, eased over 400 ms, and 60 steps
of +0.02 on every animation frame, as a wheel does:

| | Seattle, before | Seattle, after | Staten Island, before | Staten Island, after |
|---|---|---|---|---|
| Eased: frames at a new zoom | 2 at 147 + 30 ms | 5 at 17 + 10 ms | 2 at 334 + 47 ms | 3 at 64 + 18 ms |
| Eased: longest animation frame | 133 ms | 66 ms | 333 ms | 83 ms |
| 60 steps: time they took | 1.33 s | 1.01 s | 2.07 s | 1.22 s |
| 60 steps: longest animation frame | 150 ms | 18 ms | 300 ms | 50 ms |
| 60 steps: animation frames over 50 ms | 3 | 0 | 6 | 1 |

(One run each. The longest animation frame varies from run to run: 33 to 66 ms in Seattle's eased
zoom.)

`bun run measure`'s restyle (every feature marked as a zoom does): the first frame, then how many
frames and how long until every feature was drawn again.

| | Before, one frame | After, first frame | Frames | Done in |
|---|---|---|---|---|
| Seattle | 139 + 22 ms | 25 + 8 ms | 4 | 130 ms |
| Staten Island | 310 + 34 ms | 50 + 3 ms | 8 | 237 ms |
| Užice | 1,600 + 197 ms | 287 + 5 ms | 64 | 2,080 ms |

(Seattle's first frame and frame count vary by run: 21 to 30 ms, 4 frames, 112 to 130 ms.)

**Making features, at Staten Island (18,587 features, map still).** While the page loads, the
longest frame of the map was 753 ms and is now about 145 (the first pass and the first DRAW,
see below). The content passes took 876 ms in two frames, and take about 300 ms in four, with
about 100 frames of 10 ms catching up between and after them. Loading takes the same 32 s. With
every feature destroyed and made again (`layer.reset()`): a first frame of 49 + 2 ms, then 47
frames of about 20 + 2 ms, done in 1.3 s. The longest frame was 360 ms before.

**Checked by screenshot** at Staten Island: after a jump in zoom, a rotation and a rotation back,
the settled picture is the same, pixel for pixel, as after every style is matched again
(`dirtyScene()`), and after each of 6 pans it's the same as after a full pass. After an eased zoom
the features are the same and a label can be in another place: labels placed as features arrive
don't always end up where labels placed all at once do. That was already so after a pan.

### What a frame costs when little is done in it (Užice)

Section 11 found one number where this branch was clearly behind `main`: in Užice (106,762
features at z16) everything was drawn 24 s after the page opened, against 10. Looked into on Nov
19, with every frame of a load logged. The tiles had all arrived 3.9 s into the log; making the
features took another 17.1 s. Where those went:

| | Frames | APP | DRAW | Features made |
|---|---|---|---|---|
| Passes | 27 | 5.6 s | 0.3 s | 1,744 |
| Frames that catch up (kept and held) | 260 | 5.1 s | 3.3 s | 103,635 |

Making a feature costs about 35 µs, so 3.7 s of this was the work itself. The rest was paid per
frame, whatever the frame did, and the frames did little: 273 features each. Five things, none
of which shows at Seattle or Staten Island:

1. **A pass every half second that made nothing.** Each icon is turned into a texture the first
   time a feature asks for it, and when it arrived `PixiTextures` asked for a redraw of
   everything: 267 times during that load. A pass in Užice walks 100,000 entities (190 ms) and,
   in the middle of a load, makes its one batch of 64. Now a texture's arrival asks for a frame,
   not a pass: a feature drawn without its icon stays dirty, the layer remembers it, and
   `scene.texturesLoaded()` has those drawn again (`gfx.resumeWaiting()`).
2. **The budget was 6 to 13 ms, never 24.** The bigger budget needed an idle scheduler. But the
   UI's listeners to `draw` queue a task each on every frame, and the scheduler ran normal tasks
   only in what was left of a 16.7 ms tick, which was nothing: no normal task ran on 214 of the
   258 ticks that had one waiting, and the scale bar's update waited up to 2.4 s. So the queues
   were never empty, because of the frames themselves. Now the budget goes by the view alone,
   and the scheduler gives normal tasks 4 ms of every tick (`design/scheduler-system.md`): their
   longest wait in the same test is 141 ms.
3. **Bookkeeping that grew with what was waiting.** `_makeWaiting()` took the whole set of
   waiting entities and put back what it had no time for: a copy of up to 100,000 IDs, twice a
   frame (1.2 s of the 5.5 s that making took under the profiler). It looked through everything
   outside the view again every 100 ms, though the view hadn't moved, and the scene counted the
   visible features of every layer on every frame (1.1 ms). Now the waiting sets are consumed in
   place, they're sorted again only when the view has moved (`_sortWaiting()`), and a layer keeps
   count of its visible features as they change (`numVisible`).
4. **DRAW has a fixed cost per render group that changed,** and two groups are huge here: all
   49,259 points, and the 18,882 lines of level 0. One frame's DRAW, by what changed in it:

   | Changed in the frame | DRAW |
   |---|---|
   | Nothing | 5 to 7 ms |
   | 100 points drawn again | 5 ms |
   | 100 points made | 38 ms |
   | 100 lines drawn again, or made | 44 ms |
   | 100 polygons made, in tiles all over the view | 17 to 23 ms |
   | 100 features of every kind made | 85 ms |
   | 10,000 made | 135 ms |

   Pixi collects a whole group again when anything in it is added, removed, or has new geometry
   (86% of such a DRAW is `_buildInstructions`). After the fixed cost, a feature costs what the
   budget assumes: 4 to 5 µs. So a frame that makes 64 lines and one that makes 5,000 pay the
   same 44 ms first. **Not fixed:** see below.
5. **The first frame after a zoom** (not part of a load) takes 365 to 400 ms here, and sometimes
   twice that after a pause (section 9). With the profiler on it's 480: the pass's usual 190,
   about 130 more in its loops because every feature is dirty, and 160 in the labels layer,
   which resets every label at once. **Not fixed.**

With 1 to 3 fixed (dev build, the same window, one load each):

| Užice | Before | After |
|---|---|---|
| Load: from the last tile until every feature is made | 17.1 s | 7.4 s |
| Load: passes meanwhile | 27 | 0 |
| Load: features made per frame (median) | 273 | 624 |
| Load: a frame's cost, median / 90th percentile / longest | 25 / 167 / 496 ms | 35 / 60 / 200 ms |
| Load: frames over 100 ms | 33 | 5 |
| Every feature made again (`layer.reset()`) | 11.1 s in 215 frames | 8.6 s in 149 |
| Every feature drawn again (restyle) | 3.4 s in 97 frames | 1.8 to 2.4 s in 29 |

At Staten Island a load's features are all made 2.0 s after the last tile, in 48 frames of 27 ms
(median), with the first pass the longest frame (117 ms).

What's left of Užice's 7.4 s is the work (3.5 s of APP) and item 4 (3.0 s of DRAW, 19 ms a
frame).

**From outside, on a tape.** `bun run compare` on the production bundle, the commit before
these fixes and then with them, two runs each. All four were answered from one recording of the
API's map tiles, each tile after the time it really took (`--tape`, see section 11), so they
loaded the same data at the same pace:

| Užice, `bun run compare` | Before | After |
|---|---|---|
| Drawn after | 24.1, 23.8 s | 14.8, 14.7 s |
| First pan: frames a second | 19.7, 18.6 | 18.0, 18.4 |
| First pan: longest gap | 345, 751 ms | 506, 520 ms |
| First pan: time its events took | 7.2, 7.2 s | 7.3, 7.4 s |
| Pan back: frames a second | 46.9, 47.0 | 43.1, 42.4 |
| Pinch in: frames a second, longest gap | 29.5 / 327, 29.8 / 302 ms | 28.5 / 319, 29.7 / 339 ms |
| Zoom key in: longest gap | 182, 202 ms | 182, 170 ms |

Everything is drawn 9 s sooner, and moving the view is about what it was. The pan back over
loaded data lost 4 frames a second of 47 in both runs; not looked into. Without the tape, two runs of the new build
against the live API had a slower first pan (14 and 16 frames a second, 931 and 656 ms) than
the one run of the old build earlier in the day (19, 377 ms). On the same data that difference
isn't there, so it was the network that day or the luck of one run. It's the reason the tape
exists.

**The first pan itself** (600 px into data that isn't loaded, 8.5 s, dev build on the tape) is
where items 4 and the pass show most. Of 8.6 s of ticks, 8.1 s were frames:

| | Frames | APP | DRAW | Features made |
|---|---|---|---|---|
| Passes (a tile arrived, or the view left the cull box) | 11 | 2.3 s (212 ms each) | 0.7 s | 710 |
| Frames that catch up, kept and held | 55 | 1.2 s | 3.4 s (80 to 95 ms each, when anything was made) | 19,673 |
| Frames that only moved the view | 21 | 0.1 s | 0.1 s | 0 |

Every frame that made a feature paid the 80 to 95 ms of DRAW for the points and lines groups,
and the budget sat at its 50 ms ceiling because of it. One DRAW took 533 ms (1,331 features made
in that frame; not explained, and the longest gap of each `compare` run is probably the same
thing). The scheduler's tasks took 143 ms in all, of which `UiContributors-render` 128 ms in 10
calls.

### What it doesn't do yet

- **Big render groups make every changed frame expensive** (item 4 above): in Užice 38 to 85 ms
  of DRAW for a frame that makes or redraws anything among the points or the lines. That's also
  what a hover, a selection or a drag costs there. Smaller groups would fix it, and they can keep
  the draw order: points by rows of tiles (they're sorted by latitude), lines by level and
  `zIndex`, then by tile. See "What's left" in `design/scene.md`.
- **Labels do their part of a zoom in one frame** (160 ms in Užice, item 5), and place
  everything at once when the last feature is made (128 ms in one frame of a load there).
- **Matching a style copies it twice** (`utilDeepMerge`, in `styleMatch()` and the `style`
  setter): 14% of the APP time of making Užice's features.
- **The pass itself can't wait:** gathering, filtering and sorting the data, and the loop over
  every entity. That's the 50 to 65 ms a frame at a new zoom still takes at Staten Island, and 270
  in Užice. It's also why a pass for a new cull box costs what it did (42 to 59 ms APP and 9 to
  14 DRAW at Staten Island): putting off the new features didn't change it. Most of it is vertices
  (section 8, `design/filter-system.md`).
- **The first pass after a load pays two things once:** `FilterSystem` matching every entity for
  the first time (87 of that pass's 141 ms at Staten Island), and the first DRAW pass that has
  anything in it (76 to 128 ms, whatever it draws).
- **No frame between passes during a zoom.** The CSS transform still carries a zoom between pass
  frames. Now that a feature can be shown at a zoom it wasn't drawn for, a held frame could be
  drawn at a new zoom too, sharp and with the right imagery.
- **Only the OSM layer** checks `needsStyle`, calls `updateFeature()` and puts off making features.
- **The numbers in the budget are first guesses** (6 and 24 ms, 150 ms of stillness, the two
  DRAW costs). They're measured on one machine, an M4.

**A note on measuring:** this work reloaded dense places about forty times in a day, and by the
end the OSM API answered every map request with 429 (too many requests). Rapid then showed an empty
map and didn't ask again until the view moved (fixed since, in `OsmService`). The numbers for making features
above are from before that; the last change to the budget rule was measured in Seattle only.

## 11. Against other versions, and iD

Measured Nov 19, to have a baseline to show what this branch changes. Four editors, at three of
the difficult places:

- **iD 2.42.0**, the release build at `ideditor-release.netlify.app`. It draws with SVG.
- **Rapid 2.5.7**, the last release of the old line, at `rapideditor.org/rapid`.
- **`main`**, Rapid 3.0.0-pre.4 as merged on Nov 16, built locally (Pixi 8.20).
- **This branch** (`pixi-8.23`), the production bundle.

### How

`bun run compare` (`scripts/compare.ts`) measures from outside, because iD and the older Rapids
have no frame stats. It opens the page in a new tab of the debug Chrome (the real GPU, an M4, a
1593×1067 window at 2x), waits until the data has arrived and the map has stopped changing for 5
seconds, then pans and zooms with real input events, and watches the page's animation frames:

- **Pan:** 60 two-finger scroll events, 600 px in all, into an area that isn't loaded yet.
- **Pinch:** 40 trackpad pinch events, 1.2 zoom levels in.
- **Zoom key:** `+` and then `-`, a whole level each, eased.

The events are sent 16 ms apart, and each one waits until the page has taken it, so a page that
can't keep up makes the gesture take longer. (Sending one takes about 35 ms at best, so the best
possible is 2.1 s for the pan and 1.4 s for the pinch.) Only boundaries are hidden, in all four:
the other feature filters don't mean the same in the older editors, where hiding landuse hides most
areas. So more is drawn here than in the other sections' measurements, which hide four groups.

Each number is from one run. They vary: the same pan in Seattle on this branch had a longest frame
of 39, 79 and 115 ms in three runs.

**Record a place once.** With `--tape file.tape.json` (`scripts/tape.ts`, also on `bun run
measure`), the API's answers to map requests are kept in that file the first time, and later
runs are answered from it, each tile after the time it really took. A run from a tape costs the
API nothing, and two builds see the same data arrive at the same pace, which two live runs
don't: in Užice the first pan measured 14 to 19 frames a second live and 18 to 20 from the tape,
for the same builds. A tape of Užice is 119 MB (57 tiles); `*.tape.json` is gitignored. The
tables below were measured live, before the tape existed.

### Results

"Drawn after" is from opening the page until the map stopped changing. "Frames" are the page's
animation frames while the gesture's events were sent, and "longest" the longest gap between two,
until 2.5 s after the gesture. "Redraws" is how often the map's content was drawn again, a
second: between redraws, all four move the last picture with a CSS transform. (Rapid reports its
redraws. For iD it's the animation frames in which the OSM layer's elements changed, which isn't
quite the same thing.)

**Downtown Seattle** (z17.5, 6 map tiles)

| | Drawn after | On the map | Pan: frames, longest, redraws | Pinch: frames, longest, took | Zoom key: longest, in / out |
|---|---|---|---|---|---|
| iD 2.42 | 7.0 s | 17,647 SVG elements | 49 a second, 254 ms, 18 a second | 53 a second, 143 ms, 2.3 s | 70 / 63 ms |
| Rapid 2.5.7 | 6.4 s | 4,117 features | 55, 88 ms, 4 | 50, 186 ms, 1.6 s | 74 / 101 ms |
| `main` | 6.3 s | 4,314 features | 56, 69 ms, 6 | 35, 154 ms, 2.5 s | 71 / 128 ms |
| This branch | 6.9 s | 7,747 features | 58, 79 ms, 38 | 58, 71 ms, 1.6 s | 37 / 37 ms |

**Staten Island Mall** (z16.5, 20 map tiles)

| | Drawn after | On the map | Pan: frames, longest, redraws | Pinch: frames, longest, took | Zoom key: longest, in / out |
|---|---|---|---|---|---|
| iD 2.42 | 7.5 s | 142,118 SVG elements | 9 a second, 1,177 ms, 2 a second (took 30 s) | 8 a second, 1,125 ms, 23 s | 982 / 697 ms |
| Rapid 2.5.7 | 6.9 s | 19,147 features | 45, 148 ms, 3 | 31, 576 ms, 2.7 s | 177 / 229 ms |
| `main` | 6.4 s | 19,297 features | 41, 128 ms, 5 | 18, 396 ms, 4.7 s | 148 / 312 ms |
| This branch | 7.9 s | 22,173 features | 54, 85 ms, 35 | 50, 104 ms, 1.9 s | 58 / 78 ms |

**Užice** (z16, 36 map tiles)

| | Drawn after | On the map | Pan: frames, longest, redraws | Pinch: frames, longest, took | Zoom key: longest, in / out |
|---|---|---|---|---|---|
| iD 2.42 | 24.6 s | 694,801 SVG elements | 0.5 a second, 11.2 s, 0.1 a second (5 of the 60 events in 53 s) | 0.6 a second, 8.1 s (6 of the 40 events in 46 s) | 1.9 / 4.1 s |
| Rapid 2.5.7 | 8.8 s | 64,440 features | 25, 383 ms, 2 (took 5.2 s) | 9, 1,692 ms, 8.6 s | 489 / 870 ms |
| `main` | 9.8 s | 78,708 features | 12, 803 ms, 2 (took 11.4 s) | 3, 2,405 ms, 29.5 s | 1,212 / 1,295 ms |
| This branch | 23.9 s | 84,606 features | 19, 377 ms, 11 (took 6.7 s) | 29, 429 ms, 3.0 s | 205 / 253 ms |

(This branch has more features on the map than `main` because it also makes the ones in the 256 px
around the view. iD loads fewer tiles: 16 at Staten Island and 25 in Užice.)

**The editors don't draw the same thing, so this is a baseline and not a like-for-like test**
(Bryan, Nov 19). iD silently leaves out points and buildings beyond a certain number, so in the
dense places it's drawing less than Rapid does, and is still the slowest. The counts in the "On the
map" column aren't comparable between iD and Rapid either: an SVG element isn't a feature.

### What it says

- **The map's content is redrawn about 7 times as often while panning** at Seattle and Staten
  Island: 35 to 38 times a second where `main` does 5 or 6 and Rapid 2.5 does 3 or 4. The page's
  own frame rate hides this, because all of them slide the old picture along in between. It's the
  difference between the map following the hand and catching up with it four times a second.
- **Zooming is where the branch differs most.** A pinch at Staten Island keeps 50 frames a second
  with nothing over 104 ms, where `main` drops to 18 with a 396 ms stall and takes 4.7 s to get
  through a gesture that takes 1.9. In Užice the same pinch takes 3 s on this branch and 30 s on
  `main`, with a longest stall of 0.4 s against 2.4.
- **`main` is slower than Rapid 2.5 at the dense places.** In Užice it pans at 12 frames a second
  to Rapid 2.5's 25, and its pinch takes 30 s to 2.5's 9. This branch is ahead of both, except
  for Užice's first pan, where Rapid 2.5 keeps 25 frames a second to this branch's 19.
  A possible reason (Bryan's, not measured): Rapid 2.5 didn't precompute geometry in world
  coordinates, as Rapid 3 does. `main` also shows more of the features it has in Užice (78,708
  against 64,440).
- **iD stops being usable somewhere between Seattle and Staten Island.** In Seattle it's close to
  the others. At Staten Island a 2-second pan takes 30 s with stalls over a second, and in Užice
  it got through 5 of the 60 pan events in 53 s, with one frame 11 s long.
- **This branch takes longer until everything is drawn:** 7.9 s against 6.4 at Staten Island, and
  24 s against 10 in Užice. That's the features being made over many frames (section 10): the map
  is usable meanwhile, and it's the trade Bryan chose (what the user sees happening matters more
  than the clock). In Užice it was too long all the same. **Looked into since, and now 15 s**
  (section 10, "What a frame costs when little is done in it"): most of the extra time was
  passes that made nothing and bookkeeping, not the features. The table above still has the
  24 s it was measured with.
- **Užice's first pan (19 frames a second to Rapid 2.5's 25) is render groups and passes.** Every
  frame that makes a feature there pays 80 to 95 ms of DRAW for the two biggest groups, and
  each tile that arrives brings a pass of 210 ms (same section). Not fixed.

### Not measured

- **Nine of the twelve places.** Each place asks the OSM API for 6 to 36 tiles for each editor,
  and the API had answered 429 earlier in the day. `bun run compare <label> <url> <place>` runs
  any of them.
- **Hover, select and edit.** Only moving the view.
- **How it looks.** A page can keep 50 frames a second and still show a stale picture: the redraw
  column says how often, not what the user sees in between.
- **Anything but an M4 with a trackpad's events.**
