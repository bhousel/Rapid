# Pixi Lib

Low-level Pixi.js helper libraries for rendering.

## Overview

These are utility classes that extend Pixi.js functionality for Rapid's specific rendering needs.

## Key Files

| File | Description |
|------|-------------|
| `DashLine.ts` | Draws dashed and dotted lines on a Pixi `Graphics` object |
| `AtlasAllocator.ts` | Manages texture atlas allocation, plus the `AtlasSource` texture source and its GPU upload handlers |
| `GuilloteneAllocator.ts` | Guillotine bin-packing algorithm for atlas regions |

## DashLine

Custom line rendering that supports dashed patterns. Pixi.js doesn't natively support dashed lines, so this implements them using geometry. Used by the line, polygon, and point features and by `PixiLayerMapUI`.

## Atlas Allocation

Texture atlases combine many small textures into one large texture to reduce draw calls. The allocators manage packing sprites efficiently:

- `GuilloteneAllocator` - Implements the guillotine algorithm for dividing atlas space
- `AtlasAllocator` - Higher-level wrapper that manages the atlas lifecycle (used by `PixiTextures`)
- `AtlasSource` / `registerAtlasUploader()` - A texture source backed by the atlas, with WebGL and WebGPU upload handlers that must be registered with the renderer
