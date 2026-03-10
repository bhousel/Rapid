# Core

Core contains the fundamental systems that power Rapid. These are singleton components owned by the `Context` that manage different aspects of the application.

## Overview

All systems extend `AbstractSystem` and follow a standard lifecycle:
1. `constructor()` - Called once, systems should not interact with each other yet
2. `initAsync()` - Called after all systems are constructed, set up dependencies
3. `startAsync()` - Called after initialization, start doing work
4. `resetAsync()` - Called to reset state (e.g., after completing an edit session)
5. `pause()` / `resume()` - Temporarily pause/resume system activity

## Scoped Architecture

Three major systems — `SchemaSystem`, `StyleSystem`, and `ImagerySystem` — share a
**scoped architecture** that supports customizable, layered data loading:

- Data is organized into **scopes** identified by a `ScopeID` string (e.g. `'osm'`, `'*'`).
- The `'*'` common scope holds fallback items that are always available.
- Each scope has its own Maps of domain objects (e.g. `Preset`, `Style`, `ImagerySource`).
- The `getScope(scopeID)` method auto-creates a scope if it doesn't exist.
- Data is loaded via `merge()`, which accepts scoped input in a common format.

### Variables and `var()` References

**Variables** (`Variable` class) are named value lists stored per scope. They decouple
shared domain strings from the rules that reference them:

```json5
// In osm_rulesets.json5
variables: {
  lifecycle_prefixes: ["abandoned", "construction", "demolished", "disused", "proposed"],
  major_highway_values: ["motorway", "trunk", "primary", "secondary", "tertiary"],
}
```

Variables can be referenced from `PropMatcher` rules and `Style` properties using `var()` syntax:

```json5
{ key: "highway", op: "in", value: "var(major_highway_values)" }
```

Multiple variable references produce a flat union:

```json5
{ key: "highway", op: "in", value: "var(major_highway_values, minor_highway_values)" }
```

When data is merged, variables are processed first (since rulesets and selectors may reference them).
After merging, `_schemaChanged()` / `_styleChanged()` resolves `var()` references in all rulesets/selectors.

### Rulesets (SchemaSystem)

**Rulesets** (`Ruleset` class) are named collections of `PropMatcher` rules with include/exclude
semantics, used for tag classification:

```json5
// In osm_rulesets.json5
rulesets: {
  surface_paved: {
    include: [
      { key: "surface", value: "asphalt" },
      { key: "surface", value: "concrete" },
    ]
  },
  sided_right: {
    include: [
      { key: "natural", op: "in", value: ["cliff", "coastline"] },
    ],
    exclude: [
      { key: "two_sided", value: "yes" }
    ]
  }
}
```

Matching logic: ANY include matches AND NO exclude matches.
Consumers access rulesets via: `schema.getScope('osm')?.rulesets.get('surface_paved')?.match(tags)`

### Style Selectors (StyleSystem)

**StyleSelectors** (`StyleSelector` class) map tag conditions to visual styles:

```json5
// In rapid_style.json5
selectors: {
  "highway-motorway": {
    styleIDs: ["motorway"],
    match: { tags: [{ key: "highway", value: "motorway" }] }
  }
}
```

Matching logic: ALL tag conditions must match (AND semantics). Multiple matching selectors are
collected, sorted by specificity, and their referenced styles are deep-merged.

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
| `SchemaSystem.ts` | Loads and provides access to presets, fields, rulesets, and variables |
| `SpatialSystem.ts` | Spatial indexing for fast geographic queries |
| `StorageSystem.ts` | Persistent storage (localStorage wrapper) |
| `StyleSystem.ts` | Manages feature styling, selectors, and variables |
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
