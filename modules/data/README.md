# Data

Data classes represent map data elements in Rapid. This includes OSM entities (nodes, ways, relations) and other data types like GeoJSON features and markers.

## Overview

All data classes extend `AbstractData` and are designed to be **immutable**. When you need to modify a data element, you call `update()` which returns a new instance with the changes applied.

## Key Files

| File | Description |
|------|-------------|
| `AbstractData.ts` | Base class for all data elements |
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
- `id` (or `dataID`) - Unique identifier (e.g., `n123` for node 123)
- `type` - What kind of element (e.g. `node`, `way`, `relation`)
- `v` - Internal version for change detection
- `geoms` - `Geometry` wrapper with original (WGS84) and projected (world) coordinates
- `props` - Properties object (tags, members, etc.)

## Immutability Pattern

```typescript
// Data elements are immutable - update() returns a new instance
const updatedNode = node.update({ tags: { ...node.tags, name: 'New Name' } });
```
