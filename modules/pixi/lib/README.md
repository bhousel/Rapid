# Pixi Lib

Low-level Pixi.js helper libraries for rendering.

## Overview

These are utility classes that extend Pixi.js functionality for Rapid's specific rendering needs.

## Key Files

| File | Description |
|------|-------------|
| `LineMesh.ts` | A Pixi `Mesh` that draws a line's casing or stroke from its stroke mesh (`geomStrokeMesh()` in `modules/geo/`): a new width moves the vertices it has |
| `DashLine.ts` | Draws dashed and dotted lines on a Pixi `Graphics` object (halos, area outlines, the map UI) |
| `AtlasAllocator.ts` | Manages texture atlas allocation, plus the `AtlasSource` texture source and its GPU upload handlers |
| `GuilloteneAllocator.ts` | Guillotine bin-packing algorithm for atlas regions |
| `AvoidGrid.ts` | A grid over label space that counts what covers each cell: what labels must avoid, and the labels placed (no Pixi in it; `PixiScene` owns one) |
| `BufferHitArea.ts` | The hit area of a line or a polygon's ring: works out its shape only when the pointer is near, or for a halo |
| `FramePacer.ts` | Decides how long a frame that does a pass waits after the last one (no Pixi in it; `GraphicsSystem` asks it on each tick) |
| `RenderStats.ts` | Reads Pixi's instruction lists for frame stats (the one place that reads those internals), counts WebGL calls, and times the GPU |

## LineMesh

A line feature's casing and stroke are each a `LineMesh`. The triangles come from `geomStrokeMesh()`, which builds them once for any width, so a zoom only works out where the vertices are (`setStroke()`), in the array the mesh has. Dashes are a texture that repeats along the line (`PixiTextures.getDashTexture()`). It's always batched. See [`design/graphics-system.md`](../../../design/graphics-system.md) section 15.

## DashLine

Custom line rendering that supports dashed patterns. Pixi.js doesn't natively support dashed lines, so this implements them using geometry. Used for the halos of lines, polygons and points, the outlines of areas, and by `PixiLayerMapUI`. It goes when those are drawn from stroke meshes too.

## Atlas Allocation

Texture atlases combine many small textures into one large texture to reduce draw calls. The allocators manage packing sprites efficiently:

- `GuilloteneAllocator` - Implements the guillotine algorithm for dividing atlas space
- `AtlasAllocator` - Higher-level wrapper that manages the atlas lifecycle (used by `PixiTextures`)
- `AtlasSource` / `registerAtlasUploader()` - A texture source backed by the atlas, with WebGL and WebGPU upload handlers that must be registered with the renderer
