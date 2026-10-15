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
| `PixiScene.ts` | Manages the scene's layers and features; renders and culls the scene graph |
| `PixiEvents.ts` | Binds pointer/keyboard/wheel events once and re-dispatches them to other code |
| `PixiTextures.ts` | Texture atlas management and sprite generation |
| `helpers.ts` | Shared rendering helper functions |
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
| `PixiLayerDebug.ts` | Debug visualization (disabled by default) |

### lib/

Helper libraries for Pixi rendering (see [`lib/README.md`](lib/README.md)):

| File | Description |
|------|-------------|
| `DashLine.ts` | Dashed line rendering |
| `AtlasAllocator.ts` | Texture atlas allocation |
| `GuilloteneAllocator.ts` | Guillotine bin-packing algorithm |
