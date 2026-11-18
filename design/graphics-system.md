# GraphicsSystem: making a frame, and measuring it

How `GraphicsSystem` turns the map into a frame, what we know about what a frame costs, and the
explorations planned to make frames cheaper. Rendering performance is where Rapid has the most room to
improve, and until now we've had no way to see it except spot checks in Spector.

> **Status:** Proposed (Nov 2026). Nothing in sections 3–6 is built yet. The measurements in section 2
> were taken by hand on the `pixi-8.23` branch (Pixi 8.23.0). The plan is in section 7.

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

About 9 ms a frame on an M4, whatever the draw calls. Candidates to rule in or out, one toggle at a time:

- Pixels: the canvas at device pixel ratio 2, times MSAA (`antialias: highQuality`). Compare with
  `highQuality` off.
- Stencil work for the masks (part of the 1 ms difference in the table).
- `preserveDrawingBuffer: true`, which can stop the browser from discarding the buffer after compositing.
- `multiView`: Pixi renders into a hidden WebGL canvas and then copies it onto the visible canvas with
  a 2D `drawImage()` every frame (`GlRenderTargetAdaptor.postrender`). The timer query doesn't see that
  copy, so its cost has to be measured another way (DevTools' GPU track, or Chrome's tracing).
- Overdraw: full-screen imagery under translucent fills, casings and strokes.

## 7. Plan

Each step is measured with frame stats on the same set of places.

1. **Frame stats, first version.** `GraphicsSystem` times each layer's APP work and reads Pixi's
   instruction list after DRAW, keeping a ring buffer; debug builds add draw calls and GPU time.
   Expose it to scripts (`bun run cdp`). Measure its own overhead.
2. **A set of difficult places.** Saved views that stress different things (Bryan's list, Nov 18). A
   script measures them all, so every change below is compared the same way. Kept out of e2e tests for
   now. OSM changes, so a place can stop being difficult (the factories may have been reverted).

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
3. **GPU time.** Run the toggles in section 6 on those places.
4. **A rendering info card** next to the measurement and history cards, showing the frame stats live
   while panning (the "Performer-inspired statistics display" in `backlog.md`).
5. **Pass a `RenderFrame` through `render()` and `cull()`**, so layers can report their own counts.
6. **The line builder,** as plain geometry with unit tests (a band never leaves its area, never
   overlaps itself, holes, slivers, short segments). Then, one at a time and measured: partial-fill
   bands instead of masks; hit areas, halos and label boxes instead of `lineToPoly`; dashes as one
   stroke per line.
7. **Casings and strokes in grouped batches** with Pixi's `RenderLayer` ([`scene.md`](scene.md) section 3,
   [`profiling.md`](profiling.md)), measured after the masks are gone, since the masks break batches
   today anyway.
