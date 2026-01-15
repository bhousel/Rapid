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
| `AbstractSystem.ts` | Base class for all systems with lifecycle management |
| `AssetSystem.ts` | Manages loading and caching of assets (images, data files) |
| `EditSystem.ts` | Manages edit history, undo/redo, and staging changes |
| `FilterSystem.ts` | Controls visibility filtering of map features |
| `GraphicsSystem.ts` | Manages Pixi.js rendering pipeline |
| `ImagerySystem.ts` | Manages background imagery layers |
| `LocalizationSystem.ts` | Handles internationalization (i18n) and translations |
| `LocationSystem.ts` | Geocoding and location services |
| `Map3dSystem.ts` | Manages the 3D map view (MapLibre) |
| `MapSystem.ts` | Core map state (zoom, pan, projection) |
| `PhotoSystem.ts` | Manages street-level photo integration |
| `RapidSystem.ts` | Manages Rapid AI features and datasets |
| `SchemaSystem.ts` | Loads and provides access to presets and fields |
| `SpatialSystem.ts` | Spatial indexing for fast geographic queries |
| `StorageSystem.ts` | Persistent storage (localStorage wrapper) |
| `StyleSystem.ts` | Manages feature styling and colors |
| `UiSystem.ts` | Manages the user interface components |
| `UploaderSystem.ts` | Handles uploading changes to OSM |
| `UrlHashSystem.ts` | Manages URL hash state (bookmarkable URLs) |
| `ValidationSystem.ts` | Runs validation checks on map data |
| `types.ts` | TypeScript type definitions for core systems |

## Accessing Systems

Systems are accessed through the application context:

```typescript
const editor = context.systems.editor;
const l10n = context.systems.l10n;
const gfx = context.systems.gfx;
```
