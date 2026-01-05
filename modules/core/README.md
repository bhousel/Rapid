# Core

Core contains the fundamental systems that power Rapid. These are singleton components owned by the `Context` that manage different aspects of the application.

## Overview

All systems extend `AbstractSystem` and follow a standard lifecycle:
1. `constructor()` - Called once, systems should not interact with each other yet
2. `initAsync()` - Called after all systems are constructed, set up dependencies
3. `startAsync()` - Called after initialization, start doing work
4. `resetAsync()` - Called to reset state (e.g., after completing an edit session)
5. `pause()` / `resume()` - Temporarily pause/resume system activity

## Key Files

| File | Description |
|------|-------------|
| `AbstractSystem.js` | Base class for all systems with lifecycle management |
| `AssetSystem.js` | Manages loading and caching of assets (images, data files) |
| `EditSystem.js` | Manages edit history, undo/redo, and staging changes |
| `FilterSystem.js` | Controls visibility filtering of map features |
| `GraphicsSystem.js` | Manages Pixi.js rendering pipeline |
| `ImagerySystem.js` | Manages background imagery layers |
| `LocalizationSystem.js` | Handles internationalization (i18n) and translations |
| `LocationSystem.js` | Geocoding and location services |
| `Map3dSystem.js` | Manages the 3D map view (MapLibre) |
| `MapSystem.js` | Core map state (zoom, pan, projection) |
| `PhotoSystem.js` | Manages street-level photo integration |
| `RapidSystem.js` | Manages Rapid AI features and datasets |
| `SchemaSystem.js` | Loads and provides access to presets and fields |
| `SpatialSystem.js` | Spatial indexing for fast geographic queries |
| `StorageSystem.js` | Persistent storage (localStorage wrapper) |
| `StyleSystem.js` | Manages feature styling and colors |
| `UiSystem.js` | Manages the user interface components |
| `UploaderSystem.js` | Handles uploading changes to OSM |
| `UrlHashSystem.js` | Manages URL hash state (bookmarkable URLs) |
| `ValidationSystem.js` | Runs validation checks on map data |
| `types.ts` | TypeScript type definitions for core systems |

## Accessing Systems

Systems are accessed through the application context:

```javascript
const editor = context.systems.editor;
const l10n = context.systems.l10n;
const gfx = context.systems.gfx;
```
