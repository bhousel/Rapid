# Pixi Lib

Low-level Pixi.js helper libraries for rendering.

## Overview

These are utility classes that extend Pixi.js functionality for Rapid's specific rendering needs.

## Key Files

| File | Description |
|------|-------------|
| `LineMesh.ts` | A Pixi `Mesh` that draws a line from its stroke mesh (`geomStrokeMesh()` in `modules/geo/`): a new width moves the vertices it has. The outlines of areas, halos, the lasso, and the lines of layers that don't batch theirs |
| `VertexBatch.ts` | The base of the batches: a Pixi `Mesh` with a shader of its own that draws many things in one draw call, each a run of vertices in its buffers. Keeps the buffers: a thing that changes in place, hiding, order, an origin that follows the view |
| `LineBatch.ts` | A `VertexBatch` of lines: the shader works out the widths and the dashes, so a zoom changes nothing in it. The OSM layer has two for each level (its casings, and its strokes), and one for the outlines of areas |
| `FillBatch.ts` | A `VertexBatch` of fills: each area's triangles, with its color and pattern. The shader lays the patterns out from one atlas texture. The OSM layer has one for every area's fill |
| `PointBatch.ts` | A `VertexBatch` of points: each a few rectangles of the symbol atlas (viewfields, marker, icon), a number of pixels from where the point is on screen. The shader keeps them that size and upright, so neither a zoom nor a rotation changes anything in it. The OSM layer has one for its points, vertices and pins |
| `AtlasAllocator.ts` | Manages texture atlas allocation, plus the `AtlasSource` texture source and its GPU upload handlers |
| `GuilloteneAllocator.ts` | Guillotine bin-packing algorithm for atlas regions |
| `AvoidGrid.ts` | A grid over label space that counts what covers each cell: what labels must avoid, and the labels placed (no Pixi in it; `PixiScene` owns one) |
| `LineHitArea.ts` | The hit area of a line or a polygon's ring: a point within a distance of it (`geomStrokeContains()`), with no shape to build. Gives its edge for a halo |
| `FramePacer.ts` | Decides how long a frame that does a pass waits after the last one (no Pixi in it; `GraphicsSystem` asks it on each tick) |
| `RenderStats.ts` | Reads Pixi's instruction lists for frame stats (the one place that reads those internals), counts WebGL calls, and times the GPU |

## LineMesh

A line feature's casing and stroke are each a `LineMesh`, unless its layer gave it a `LineBatch`. The triangles come from `geomStrokeMesh()`, which builds them once for any width, so a zoom only works out where the vertices are (`setStroke()`), in the array the mesh has. Dashes are a texture that repeats along the line (`PixiTextures.getDashTexture()`). It's always batched. See [`design/graphics-system.md`](../../../design/graphics-system.md) section 15.

Halos and the lasso are drawn with `drawHalo()` and `drawRings()` in [`../helpers.ts`](../helpers.ts): a `LineMesh` for each ring, dashed. (`DashLine.ts`, which drew dashes on a `Graphics`, is gone.)

## LineBatch

The OSM layer draws its lines in batches: for each level, one for every casing and one for every stroke, so that every casing is under every stroke (`PixiLayerOsm._lineBatch()`). A line's casing and its stroke are each an item in their batch, a run of vertices copied from the stroke mesh, in the order of the line's road class and ID. Each vertex has the point on the line, how far it is from that point for a half width of 1, and how the line is drawn (width in pixels, color, opacity, dashes). The shader puts the vertex where the width at the current zoom says, and makes the dashes from the distance along the line. `LineBatch.setView()` gives every batch the view's four numbers; a zoom changes nothing else.

- `add()` returns the item; `setStroke()`, `setStyle()`, `setOrder()`, `setVisible()` and `remove()` take it.
- A line that changed with as many vertices as before is written where it was (a dragged vertex). Otherwise it goes at the end, and the batch packs itself when half of it is unused.
- A hidden line keeps its vertices and its triangles, with an opacity of 0 that the shader draws nothing for. The index buffer is built again only when a line joins or leaves the batch, or changes its order.
- The vertices are 32-bit floats relative to the batch's `position`. `moveOrigin()` moves that place and keeps the lines where they are; the layer calls it when the view has gone far from it.
- What changed is sent to the GPU once, when Pixi is about to render the batch (`onRender`).
- The shader is in GLSL and in WGSL, in the file. A batch can draw dashes of two or four whole numbers of pixels up to 255 (`canDraw()`); a line with another pattern gets `LineMesh`es.

## FillBatch

The fills of the OSM layer's areas are one `FillBatch`. A fill is the corners of its triangles (`triangulate()` in [`../helpers.ts`](../helpers.ts)), with its color, opacity and pattern number in each. A partial fill's band is the same thing with other triangles. Patterns are cells of one atlas texture that `PixiTextures` draws (`FillBatch.setPatterns()`); the shader tiles them at 32 pixels on screen, upright, from the view's numbers (`FillBatch.setView()`).

## PointBatch

The OSM layer's points, vertices and the pins of its areas are one `PointBatch`, from north to south (`PixiLayerOsm._pointBatch()`). A point is an item of four vertices for each of its pictures: where the point is (the same in all of them), where the corner is in pixels from it, and where the corner is in the texture, with the picture's color and opacity. The shader works out where the point is on screen and adds the pixels, along the screen's axes, or along the map's for a picture that turns with the map (a viewfield).

- `add()` and `set()` take a list of pictures (`PointBatchQuad`: what a sprite would be told) and how many of them to use. `PixiFeaturePoint._layout()` fills one list for every point, so drawing a point makes no objects.
- Every picture has to be in the one texture that the batches draw from (`PointBatch.setTexture()`, `canDraw()`): the symbol atlas's first. A point with any other draws itself, with sprites.
- A hidden point has a 0 in a byte of its own in each vertex (the pictures have their own opacities).

## LineHitArea

A feature's `hitArea` only has to answer `contains(x, y)`. For a line that's whether the point is within a few pixels of it: a sum over the line's segments, looked at only when the point is inside the line's box. A zoom changes the distance and nothing else, so a feature keeps its hit area and calls `set()`. `outline()` gives the rings at that distance (`geomStrokeOutline()`), which is where a select halo is drawn.

## Atlas Allocation

Texture atlases combine many small textures into one large texture to reduce draw calls. The allocators manage packing sprites efficiently:

- `GuilloteneAllocator` - Implements the guillotine algorithm for dividing atlas space
- `AtlasAllocator` - Higher-level wrapper that manages the atlas lifecycle (used by `PixiTextures`)
- `AtlasSource` / `registerAtlasUploader()` - A texture source backed by the atlas, with WebGL and WebGPU upload handlers that must be registered with the renderer
