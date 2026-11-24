# Pixi

Pixi.js rendering layer for the map. This module handles rendering of map features, imagery, and UI elements.

> [!NOTE]
> Coding conventions for this folder are in [`AGENTS.md`](AGENTS.md).

## Overview

Rapid uses Pixi.js for hardware-accelerated 2D rendering. The rendering is organized into layers, each responsible for drawing a specific type of content.

## Key Files

### Core

| File | Description |
|------|-------------|
| `PixiScene.ts` | Manages the scene's layers and features; renders and culls the scene graph; finds the feature under the pointer (`hitTest()`) |
| `PixiEvents.ts` | Binds pointer/keyboard/wheel events once and re-dispatches them to other code, with the feature under the pointer on each pointer event |
| `PixiTextures.ts` | Texture atlas management and sprite generation |
| `RenderFrame.ts` | One frame of the map, with the stats gathered while it's made (see `design/graphics-system.md`) |
| `helpers.ts` | Shared rendering helper functions: halos and rings, a hover's color and its filter for features that draw themselves, whether a point hits a container, which of two containers is drawn on top |
| `index.ts` | Barrel export file |

### Base Classes

| File | Description |
|------|-------------|
| `AbstractPixiLayer.ts` | Base class for all rendering layers |
| `AbstractPixiFeature.ts` | Base class for all renderable features |

### Feature Types

| File | Description |
|------|-------------|
| `PixiFeatureLabel.ts` | Renders a single label (created lazily; placement is done by `PixiLayerLabels`) |
| `PixiFeatureLine.ts` | Renders line features (roads, paths, etc.) |
| `PixiFeaturePoint.ts` | Renders point features (POIs, nodes, etc.) |
| `PixiFeaturePolygon.ts` | Renders polygon features (buildings, areas, etc.) |

### Layers

| File | Description |
|------|-------------|
| `PixiLayerBackgroundTiles.ts` | Background and overlay imagery tiles (also used by the minimap) |
| `PixiLayerOsm.ts` | OpenStreetMap data |
| `PixiLayerOsmNotes.ts` | OSM notes |
| `PixiLayerRapid.ts` | Rapid datasets (third-party data and AI-detected suggestions) |
| `PixiLayerLabels.ts` | Text labels (placement and collision avoidance) |
| `PixiLayerMapUI.ts` | Map UI elements (selected/hovered vertices, geolocation, lasso, tile grid, etc.) |
| `PixiLayerCustomData.ts` | User-imported custom data |
| `PixiLayerMapillaryPhotos.ts` | Mapillary photo markers and traces |
| `PixiLayerMapillaryDetections.ts` | Mapillary object detections |
| `PixiLayerMapillarySigns.ts` | Mapillary traffic signs |
| `PixiLayerKartaPhotos.ts` | KartaView photo markers and traces |
| `PixiLayerStreetsidePhotos.ts` | Bing Streetside photo markers and traces |
| `PixiLayerKeepRight.ts` | KeepRight QA issues |
| `PixiLayerOsmose.ts` | Osmose QA issues |
| `PixiLayerMapRoulette.ts` | MapRoulette tasks |
| `PixiLayerGeoScribble.ts` | GeoScribble annotations |
| `PixiLayerEditBlocks.ts` | Blocked regions where editing is not allowed (from `LocationSystem`) |
| `PixiLayerDebug.ts` | Debug visualization (disabled by default). Currently shows conflation coverage boxes and join points |

### lib/

Helper libraries for Pixi rendering (see [`lib/README.md`](lib/README.md)):

| File | Description |
|------|-------------|
| `LineMesh.ts` | Draws one line from a stroke mesh: the lasso, and the lines and outlines of a layer that doesn't batch them |
| `BatchMesh.ts` | The base of the batches: many things in one draw call, each a run of vertices in its buffers |
| `LineBatchMesh.ts` | Draws many lines in one draw call, with a shader that works out their widths: the OSM layer's casings and strokes, the outlines of its areas, the glows of what's hovered, and the halos of what's selected (which move) |
| `FillBatchMesh.ts` | Draws the fills of many areas in one draw call, with their patterns from one atlas texture |
| `PointBatchMesh.ts` | Draws many points in one draw call: their markers, icons and viewfields, from the symbol atlas, at a size on screen, and the glow behind a hovered one |
| `LineHitArea.ts` | The hit area of a line or of a polygon's ring: within a few pixels of it |
| `AtlasAllocator.ts` | Texture atlas allocation |
| `GuillotineAllocator.ts` | Guillotine bin-packing algorithm |
| `RenderStats.ts` | Frame stats from Pixi's instructions, WebGL call counts, GPU timing |
