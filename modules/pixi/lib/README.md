# Pixi Lib

Low-level Pixi.js helper libraries for rendering.

## Overview

These are utility classes that extend Pixi.js functionality for Rapid's specific rendering needs.

## Key Files

| File | Description |
|------|-------------|
| `LineMesh.ts` | A Pixi `Mesh` that draws a line from its stroke mesh (`geomStrokeMesh()` in `modules/geo/`): a new width moves the vertices it has. The lasso, and the lines and outlines of layers that don't batch theirs |
| `BatchMesh.ts` | The base of the batches: a Pixi `Mesh` with a shader of its own that draws many things in one draw call, each a run of vertices in its buffers. Keeps the buffers: a thing that changes in place, hiding, order, an origin that follows the view |
| `LineBatchMesh.ts` | A `BatchMesh` of lines: the shader works out the widths and the dashes, and draws the markers along a line (oneway arrows), so a zoom changes nothing in it. It also draws the glow around a hovered line, which breathes, and lines whose dashes march (a selection's halo), from a clock that every batch shares. The OSM layer has two for each level (its casings, and its strokes with their markers) and one for the outlines of areas, each with a small batch for its glows; the map UI layer has one for every halo |
| `FillBatchMesh.ts` | A `BatchMesh` of fills: each area's triangles, with its color and pattern. The shader lays the patterns out from one atlas texture. The OSM layer has one for every area's fill |
| `PointBatchMesh.ts` | A `BatchMesh` of points: each a few rectangles of the symbol atlas (viewfields, marker, icon), a number of pixels from where the point is on screen. The shader keeps them that size and upright, so neither a zoom nor a rotation changes anything in it. A picture can pulse with the batches' clock: the glow behind a hovered point. The OSM layer has one for its points, vertices and pins, and a small one under it for their glows |
| `BatchShaders.ts` | The shaders that a scene's batches draw with, one per kind (`LineBatchShader`, `FillBatchShader`, `PointBatchShader`, each in its batch's file). Every batch of a kind shares its shader, so the view, the clock and the textures are told to it once. `PixiScene` owns them (`scene.batchShaders`) |
| `LayerBatches.ts` | Makes and keeps a layer's batches: at most one of each kind in each container, with a small batch for glows beside it. Places them, keeps their coordinates fine enough for the view (`followView()`), and destroys the ones that empty. Every layer has one (`layer.batches`), and those that draw data draw in it (`AbstractPixiLayer._drawInBatches()`) |
| `AtlasAllocator.ts` | Manages texture atlas allocation, plus `AtlasTextureSource` (the texture source behind each atlas page) and its GPU upload handlers |
| `GuillotineAllocator.ts` | Guillotine bin-packing algorithm for atlas regions |
| `AvoidGrid.ts` | A grid over label space that counts what covers each cell: what labels must avoid, and the labels placed (no Pixi in it; `LabelSpace` owns one) |
| `LabelSpace.ts` | What the labels layer needs from the rest of the scene: the space labels are placed in (`update()`, `worldToLabel()`), the avoid grid, and word of what changed (`featureChanged()`, `avoidHit()`, `avoidFreed()`). `PixiScene` owns one (`scene.labelSpace`) |
| `LineHitArea.ts` | The hit area of a line or a polygon's ring: a point within a distance of it (`geomStrokeContains()`), with no shape to build. Gives its edge for a halo |
| `FramePacer.ts` | Decides how long a frame that does a pass waits after the last one (no Pixi in it; `GraphicsSystem` asks it on each tick) |
| `AnimationPacer.ts` | Decides when the scene is drawn again only because something in it moves by itself (a glow, a halo's dashes): 20 times a second at most, less on a machine that doesn't keep up, and not for long after the last change (no Pixi in it either) |
| `RenderStats.ts` | Reads Pixi's instruction lists for frame stats (the one place that reads those internals), counts WebGL calls, and times the GPU |

## LineMesh

A line feature's casing and stroke are each a `LineMesh`, unless its layer gave it a `LineBatchMesh`. The triangles come from `geomStrokeMesh()`, which builds them once for any width, so a zoom only works out where the vertices are (`setStroke()`), in the array the mesh has. Dashes are a texture that repeats along the line (`PixiTextures.getDashTexture()`). It's always batched. See "The line builder" in [`design/graphics-system.md`](../../../design/graphics-system.md).

The lasso is drawn with `drawRings()` in [`../helpers.ts`](../helpers.ts): a `LineMesh` for each ring, dashed. (`DashLine.ts`, which drew dashes on a `Graphics`, is gone. Halos are in a `LineBatchMesh` now: see below.)

## LineBatchMesh

The OSM layer draws its lines in batches: for each level, one for every casing and one for every stroke, so that every casing is under every stroke (`LayerBatches.lineBatch()`). A line's casing and its stroke are each an item in their batch, a run of vertices copied from the stroke mesh, in the order of the line's road class and ID. Each vertex has the point on the line, how far it is from that point for a half width of 1, and how the line is drawn (width in pixels, color, opacity, dashes). The shader puts the vertex where the width at the current zoom says, and makes the dashes from the distance along the line. `LineBatchShader.setView()` gives every batch the view's four numbers; a zoom changes nothing else.

- `add()` returns the item; `setStroke()`, `setStyle()`, `setOrder()`, `setVisible()` and `remove()` take it.
- A line that changed with as many vertices as before is written where it was (a dragged vertex). Otherwise it goes at the end, and the batch packs itself when half of it is unused.
- A hidden line keeps its vertices and its triangles, with an opacity of 0 that the shader draws nothing for. The index buffer is built again only when a line joins or leaves the batch, or changes its order.
- The vertices are 32-bit floats relative to the batch's `position`. `moveOrigin()` moves that place and keeps the lines where they are; `followView()` calls it when the view has gone far from it, and the batches' owner calls that on every frame.
- What changed is sent to the GPU once, when Pixi is about to render the batch (`onRender`).
- The shader is in GLSL and in WGSL, in the file. A batch can draw dashes of two or four whole numbers of pixels up to 255 (`canDraw()`); a line with another pattern gets `LineMesh`es.
- The markers along a line (oneway arrows, arrows with two heads, the triangles on the right of a line with sides) are items too: `addMarkers()` copies the line's stroke mesh as a strip of the width the markers need, with the side of the line each vertex is on. The fragment shader draws a marker every so many pixels along the strip (`LINE_MARKERS`), from the distance along the line and the distance to its side, so there are no sprites and nothing to do at a zoom. `setMarkerStyle()` changes their kind or color; `setMarkers()` puts them on another line.
- The glow around a hovered or highlighted line is an item as well: `addGlow()` copies a stroke mesh with round ends and corners as a strip 12 pixels wider than the line on each side (`LINE_GLOW`), and writes into each vertex where it is from the nearest point of the line. The fragment shader fades the glow with that distance, from the line's edge outward, and draws nothing over the line. `setGlowStyle()` changes its color; `setGlow()` puts it around another line.
- A line whose style says `marches` is as wide as it says at every zoom (and in wireframe), and its dashes move along it: a selection's halo (`drawHalo()` in [`../helpers.ts`](../helpers.ts), two lines for each ring, in the map UI layer's batch).
- `LineBatchShader.setTime()` gives every batch the clock's two numbers: how bright a glow is, and how far the dashes have marched. `PixiScene.animate()` calls it before each frame is drawn. Nothing in a batch changes for it.
- A batch can have a small batch for its lines' glows (`glows`), which its owner draws after it: a glow that joins or leaves a batch has the batch's index buffer built again, and in a batch of a town's roads that's 9 ms for every hover. It's destroyed with the batch.
- The WGSL is compiled by no test. `test/dom/pixi/shaders.test.js` checks that it declares nothing by a name WGSL reserves (`from` did); look at the map with `renderer=webgpu` after changing a shader.

## FillBatchMesh

The fills of the OSM layer's areas are one `FillBatchMesh`. A fill is the corners of its triangles (`triangulate()` in [`../helpers.ts`](../helpers.ts)), with its color, opacity and pattern number in each. A partial fill's band is the same thing with other triangles. Patterns are cells of one atlas texture that `PixiTextures` draws (`FillBatchShader.setPatterns()`); the shader tiles them at 32 pixels on screen, upright, from the view's numbers (`FillBatchShader.setView()`).

## PointBatchMesh

The OSM layer's points, vertices and the pins of its areas are one `PointBatchMesh`, from north to south (`LayerBatches.pointBatch()`). A point is an item of four vertices for each of its pictures: where the point is (the same in all of them), where the corner is in pixels from it, and where the corner is in the texture, with the picture's color and opacity. The shader works out where the point is on screen and adds the pixels, along the screen's axes, or along the map's for a picture that turns with the map (a viewfield).

- `add()` and `set()` take a list of pictures (`PointBatchMeshQuad`: what a sprite would be told) and how many of them to use. `PixiFeaturePoint._layout()` fills one list for every point, so drawing a point makes no objects.
- Every picture has to be in the one texture that the batches draw from (`PointBatchShader.setTexture()`, `canDraw()`): the symbol atlas's first. A point with any other draws itself, with sprites.
- A hidden point has a 0 in a byte of its own in each vertex (the pictures have their own opacities).
- A picture that `pulses` is as bright as the batches' clock says (`PointBatchShader.setTime()`): the glow behind a hovered point. Where the batch has a batch for glows (`glows`, drawn under it), the feature puts its glow there (`add()` and `set()` take which picture to start from), and the point itself stays as many pictures as it was.

## LineHitArea

A feature's `hitArea` only has to answer `contains(x, y)`. For a line that's whether the point is within a few pixels of it: a sum over the line's segments, looked at only when the point is inside the line's box. A zoom changes the distance and nothing else, so a feature keeps its hit area and calls `set()`. `outline()` gives the rings at that distance (`geomStrokeOutline()`), which is where a select halo is drawn.

## Atlas Allocation

Texture atlases combine many small textures into one large texture to reduce draw calls. The allocators manage packing sprites efficiently:

- `GuillotineAllocator` - Implements the guillotine algorithm for dividing atlas space
- `AtlasAllocator` - Higher-level wrapper that manages the atlas lifecycle (used by `PixiTextures`)
- `AtlasTextureSource` / `registerAtlasUploader()` - A texture source backed by the atlas, with WebGL and WebGPU upload handlers that must be registered with the renderer
