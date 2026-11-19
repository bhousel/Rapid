# GraphicsSystem: making a frame, and measuring it

How `GraphicsSystem` turns the map into a frame, what we know about what a frame costs, and the
explorations planned to make frames cheaper. Rendering performance is where Rapid has the most room to
improve, and until now we've had no way to see it except spot checks in Spector.

> **Status:** In progress (Nov 2026). Steps 1 to 4 of the plan are done (frame stats, a script that
> measures a set of difficult places, where the GPU time goes, and a rendering info card); sections 4
> and 5 aren't built. The first
> measurements in section 2 were taken by hand on the `pixi-8.23` branch (Pixi 8.23.0), and frame stats
> reproduce them. The plan is in section 7.

Related docs: [`scene.md`](scene.md) (the display tree, draw order, what the pointer can reach),
[`scheduler-system.md`](scheduler-system.md) (the frame loop and its budget),
[`profiling.md`](profiling.md) (memory and leaks), [`style-system.md`](style-system.md).

## Words used here

- **APP pass:** Rapid's half of a frame. Layers decide which features are in view, rebuild the ones that
  are dirty, and cull the rest (`GraphicsSystem._app()` → `PixiScene.render()` → each layer's `render()`
  and `cull()`).
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
per frame. A tick does at most one of the two passes, so a redraw takes two frames:

1. Between redraws, `_tform()` follows the map's transform with a CSS transform on the `supersurface`,
   so panning and zooming look smooth without redrawing.
2. **APP**, when a redraw is pending and its delay has run out (`THROTTLE`, 250 ms after the last draw,
   unless `immediateRedraw()` asked for one now). If the zoom changed, or the map moved more than
   100,000 px, every feature is marked dirty (`scene.dirtyScene()`) and its geometry is rebuilt;
   otherwise only the `origin` container moves. Then `scene.render(frame, viewport)`.
3. **DRAW**, on the next tick: resize the renderer if needed, `pixi.render()`, drop the CSS transform,
   emit `draw`, and count the frame.

Both passes already leave performance marks (`app-N`, `draw-N`). The minimap renders the same stage a
second time into its own canvas (`UiMinimap`), which is why the renderer has `multiView` on.

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
  as in this profile. The rest is `renderPolygons()`, `renderVertices()` and `entitiesInBox()`. See
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
  the transform part. The instruction list is still rebuilt. Worth doing properly, with a render
  group for each scene group or layer, so a change in one doesn't rebuild the others; not done yet.
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

Since Rapid can't plan the frame ahead, the frame itself is the unit we gather stats on. Today an
integer `frame` is passed from `_app()` through `PixiScene.render()` into every layer's `render()` and
`cull()` (about 20 layers). The idea is to pass an object instead: the frame number plus whatever the frame
gathers as it's made, compared against the frame budget (`scheduler.targetFrameTime`, 16.7 ms by
default). This is the same idea as SGI Performer's `pfFrameStats`, which `backlog.md` already cites.

Sketch, not settled (it can grow as needed):

```ts
interface RenderFrame {
  frame: number;                       // what layers use today for `retainFeature()` and `cull()`
  app: {
    ms: number;
    layers: Map<LayerID, { renderMs: number; cullMs: number; counts: Record<string, number> }>;
  };
  draw?: {                             // filled in after `pixi.render()`
    ms: number;
    instructions: Record<string, number>;   // by renderPipeId
    batches: number;
    unbatched: { label: string; reason: 'size' | 'shader' | 'batchMode'; floats: number }[];
    drawCalls?: number;                // debug builds only (see below)
    gpuMs?: number;                    // arrives a few frames later, when the timer query resolves
  };
}
```

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

- Whether layers report counts through the object (needs the signature change) or the scene works them
  out from the features it already tracks (no signature change). The timing needs neither: the scene
  can time each layer's `render()` and `cull()` itself.

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
5. **Pass a `RenderFrame` through `render()` and `cull()`**, so layers can report their own counts.
6. **The line builder,** as plain geometry with unit tests (a band never leaves its area, never
   overlaps itself, holes, slivers, short segments). Then, one at a time and measured: partial-fill
   bands instead of masks; hit areas, halos and label boxes instead of `lineToPoly`; dashes as one
   stroke per line.
7. **Casings and strokes in grouped batches** with Pixi's `RenderLayer` ([`scene.md`](scene.md) section 3,
   [`profiling.md`](profiling.md)), measured after the masks are gone, since the masks break batches
   today anyway.
