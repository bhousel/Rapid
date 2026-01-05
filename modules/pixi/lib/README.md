# Pixi Lib

Low-level Pixi.js helper libraries for rendering.

## Overview

These are utility classes that extend Pixi.js functionality for Rapid's specific rendering needs.

## Key Files

| File | Description |
|------|-------------|
| `DashLine.js` | Renders dashed and dotted lines in WebGL |
| `AtlasAllocator.js` | Manages texture atlas allocation |
| `GuilloteneAllocator.js` | Guillotine bin-packing algorithm for atlas regions |

## DashLine

Custom line rendering that supports dashed patterns. Pixi.js doesn't natively support dashed lines, so this implements them using geometry.

## Atlas Allocation

Texture atlases combine many small textures into one large texture to reduce draw calls. The allocators manage packing sprites efficiently:

- `GuilloteneAllocator` - Implements the guillotine algorithm for dividing atlas space
- `AtlasAllocator` - Higher-level wrapper that manages the atlas lifecycle
