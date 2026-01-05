# Data

Data classes represent map data elements in Rapid. This includes OSM entities (nodes, ways, relations) and other data types like GeoJSON features and markers.

## Overview

All data classes extend `AbstractData` and are designed to be **immutable**. When you need to modify a data element, you call `update()` which returns a new instance with the changes applied.

## Key Files

| File | Description |
|------|-------------|
| `AbstractData.ts` | Base class for all data elements |
| `GeoJSON.ts` | Wrapper for GeoJSON features |
| `Marker.ts` | Map markers (pins, notes, etc.) |
| `OsmChangeset.ts` | Represents an OSM changeset |
| `OsmEntity.ts` | Base class for OSM entities |
| `OsmNode.ts` | OSM node (point feature) |
| `OsmRelation.ts` | OSM relation (grouping of entities) |
| `OsmWay.ts` | OSM way (linear or area feature) |
| `types.ts` | TypeScript type definitions |

### parsers/

| File | Description |
|------|-------------|
| `OsmJSONParser.ts` | Parses OSM JSON API responses |
| `OsmXMLParser.ts` | Parses OSM XML API responses |
| `types.ts` | Parser type definitions |

## Data Properties

Each data element has:
- `id` - Unique identifier (e.g., `n123` for node 123)
- `type` - What kind of element (`node`, `way`, `relation`)
- `v` - Internal version for change detection
- `geoms` - Geometry wrapper with original and projected coordinates
- `props` - Properties object (tags, members, etc.)

## Immutability Pattern

```javascript
// Data elements are immutable - update() returns a new instance
const updatedNode = node.update({ tags: { ...node.tags, name: 'New Name' } });
```
