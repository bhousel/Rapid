# Pixi

Pixi.js rendering layer for the map. This module handles all WebGL-based rendering of map features, imagery, and UI elements.

## Overview

Rapid uses Pixi.js for hardware-accelerated 2D rendering. The rendering is organized into layers, each responsible for drawing a specific type of content.

## Key Files

### Core

| File | Description |
|------|-------------|
| `PixiScene.js` | Main scene container that manages all layers |
| `PixiEvents.js` | Event handling for Pixi display objects |
| `PixiTextures.js` | Texture atlas management and sprite generation |
| `helpers.js` | Shared rendering helper functions |

### Base Classes

| File | Description |
|------|-------------|
| `AbstractPixiLayer.js` | Base class for all rendering layers |
| `AbstractPixiFeature.js` | Base class for all renderable features |

### Feature Types

| File | Description |
|------|-------------|
| `PixiFeatureLine.js` | Renders line features (roads, paths, etc.) |
| `PixiFeaturePoint.js` | Renders point features (POIs, nodes, etc.) |
| `PixiFeaturePolygon.js` | Renders polygon features (buildings, areas, etc.) |
| `PixiGeometryPart.js` | Renders individual geometry parts |

### Layers

| File | Description |
|------|-------------|
| `PixiLayerBackgroundTiles.js` | Background imagery tiles |
| `PixiLayerOsm.js` | OpenStreetMap data |
| `PixiLayerOsmNotes.js` | OSM notes |
| `PixiLayerRapid.js` | Rapid AI suggestions |
| `PixiLayerRapidOverlay.js` | Rapid overlay features |
| `PixiLayerLabels.js` | Text labels |
| `PixiLayerMapUI.js` | Map UI elements (cursors, selection, etc.) |
| `PixiLayerCustomData.js` | User-imported custom data |
| `PixiLayerMapillaryPhotos.js` | Mapillary photo markers |
| `PixiLayerMapillaryDetections.js` | Mapillary object detections |
| `PixiLayerMapillarySigns.js` | Mapillary traffic signs |
| `PixiLayerKartaPhotos.js` | KartaView photo markers |
| `PixiLayerStreetsidePhotos.js` | Bing Streetside photo markers |
| `PixiLayerKeepRight.js` | KeepRight QA issues |
| `PixiLayerOsmose.js` | Osmose QA issues |
| `PixiLayerMapRoulette.js` | MapRoulette challenges |
| `PixiLayerGeoScribble.js` | GeoScribble annotations |
| `PixiLayerEditBlocks.js` | Edit blocking overlays |
| `PixiLayerDebug.js` | Debug visualization |

### lib/

Helper libraries for Pixi rendering:

| File | Description |
|------|-------------|
| `DashLine.js` | Dashed line rendering |
| `AtlasAllocator.js` | Texture atlas allocation |
| `GuilloteneAllocator.js` | Guillotine bin-packing algorithm |

## Layer System

Layers are stacked by z-index and each manages its own set of features:

```javascript
// Layers track features by ID
layer.features.get(featureID);

// Features can have data bound to them
layer.bindData(featureID, dataID);

// And classes for styling
layer.setClass(dataID, 'selected');
```
