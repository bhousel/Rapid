# Pixi

Pixi.js rendering layer for the map. This module handles all WebGL-based rendering of map features, imagery, and UI elements.

## Overview

Rapid uses Pixi.js for hardware-accelerated 2D rendering. The rendering is organized into layers, each responsible for drawing a specific type of content.

## Key Files

### Core

| File | Description |
|------|-------------|
| `PixiScene.ts` | Main scene container that manages all layers |
| `PixiEvents.ts` | Event handling for Pixi display objects |
| `PixiTextures.ts` | Texture atlas management and sprite generation |
| `helpers.ts` | Shared rendering helper functions |

### Base Classes

| File | Description |
|------|-------------|
| `AbstractPixiLayer.ts` | Base class for all rendering layers |
| `AbstractPixiFeature.ts` | Base class for all renderable features |

### Feature Types

| File | Description |
|------|-------------|
| `PixiFeatureLine.ts` | Renders line features (roads, paths, etc.) |
| `PixiFeaturePoint.ts` | Renders point features (POIs, nodes, etc.) |
| `PixiFeaturePolygon.ts` | Renders polygon features (buildings, areas, etc.) |
| `PixiGeometryPart.ts` | Renders individual geometry parts |

### Layers

| File | Description |
|------|-------------|
| `PixiLayerBackgroundTiles.ts` | Background imagery tiles |
| `PixiLayerOsm.ts` | OpenStreetMap data |
| `PixiLayerOsmNotes.ts` | OSM notes |
| `PixiLayerRapid.ts` | Rapid AI suggestions |
| `PixiLayerRapidOverlay.ts` | Rapid overlay features |
| `PixiLayerLabels.ts` | Text labels |
| `PixiLayerMapUI.ts` | Map UI elements (cursors, selection, etc.) |
| `PixiLayerCustomData.ts` | User-imported custom data |
| `PixiLayerMapillaryPhotos.ts` | Mapillary photo markers |
| `PixiLayerMapillaryDetections.ts` | Mapillary object detections |
| `PixiLayerMapillarySigns.ts` | Mapillary traffic signs |
| `PixiLayerKartaPhotos.ts` | KartaView photo markers |
| `PixiLayerStreetsidePhotos.ts` | Bing Streetside photo markers |
| `PixiLayerKeepRight.ts` | KeepRight QA issues |
| `PixiLayerOsmose.ts` | Osmose QA issues |
| `PixiLayerMapRoulette.ts` | MapRoulette challenges |
| `PixiLayerGeoScribble.ts` | GeoScribble annotations |
| `PixiLayerEditBlocks.ts` | Edit blocking overlays |
| `PixiLayerDebug.ts` | Debug visualization |

### lib/

Helper libraries for Pixi rendering:

| File | Description |
|------|-------------|
| `DashLine.ts` | Dashed line rendering |
| `AtlasAllocator.ts` | Texture atlas allocation |
| `GuilloteneAllocator.ts` | Guillotine bin-packing algorithm |

## Layer System

Layers are stacked by z-index and each manages its own set of features:

```typescript
// Layers track features by ID
layer.features.get(featureID);

// Features can have data bound to them
layer.bindData(featureID, dataID);

// And classes for styling
layer.setClass(dataID, 'selected');
```
