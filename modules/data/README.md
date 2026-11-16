# Data

Data classes represent map data elements in Rapid. This includes OSM entities (nodes, ways, relations) and other data types like GeoJSON features and markers.

## Overview

All data classes extend `AbstractData` and are designed to be **immutable**. When you need to modify a data element, you call `update()` which returns a new instance with the changes applied.

## Key Files

| File | Description |
|------|-------------|
| `AbstractData.ts` | Base class for all data elements |
| `dataID.ts` | Helpers for data IDs (`${spatialID}:${localID}`): build, split, get the OSM entity ID, and make stable local IDs for GeoJSON features (`featureKey`) |
| `GeoJSONData.ts` | Wrapper for arbitrary GeoJSON data |
| `MarkerData.ts` | Point markers from services (photos, notes, QA issues, etc.; formerly "QAItem") |
| `OsmChangeset.ts` | Represents an OSM changeset |
| `OsmEntity.ts` | Base class for OSM entities |
| `OsmNode.ts` | OSM node (point feature) |
| `OsmRelation.ts` | OSM relation (grouping of entities) |
| `OsmWay.ts` | OSM way (linear or area feature) |
| `index.ts` | Barrel export file (also re-exports `parsers/`) |
| `types.ts` | TypeScript type definitions |

### parsers/

See [`parsers/README.md`](parsers/README.md).

| File | Description |
|------|-------------|
| `OsmJSONParser.ts` | Parses OSM JSON API responses |
| `OsmXMLParser.ts` | Parses OSM XML API responses |
| `types.ts` | Parser type definitions |

## Data Properties

Each data element has:
- `id` - Identifier within its cache (e.g., `n123` for node 123)
- `dataID` - Identifier across all of Rapid, `${spatialID}:${id}` (bare `id` for OSM), where `spatialID` is the ID of the `SpatialSystem` cache that holds it. See [`design/data-ids.md`](../../design/data-ids.md).
- `type` - What kind of element (e.g. `node`, `way`, `relation`)
- `v` - Version stamp, new on every `update()`. It's part of `key` (`${id}v${v}`), which d3 joins and caches use.
- `geoms` - `Geometry` wrapper with original (WGS84) and projected (world) coordinates. A node, GeoJSON feature or marker has its own. A way's or relation's shape depends on the graph, so `geoms` throws for them: read it with `graph.geometry(entity)` (see [`design/graph-geometry.md`](../../design/graph-geometry.md)).
- `props` - Properties object (tags, members, etc.)

## Immutability Pattern

```typescript
// Data elements are immutable - update() returns a new instance
const updatedNode = node.update({ tags: { ...node.tags, name: 'New Name' } });
```

Never change a data element's `props` in place. A service or editor that changes cached data stores the
`update()`'d copy (e.g. `spatial.replaceData(...)`), and the renderers redraw a feature when its data is
a different object.
