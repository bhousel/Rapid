# Lib

This folder contains library classes that are shared components used throughout Rapid.

## Overview

This module contains a mix of data structures, schema classes, and utility functions that support the rest of the application.

## Key Files

### Schema Classes

| File | Description |
|------|-------------|
| `Category.ts` | Preset categories (groupings of presets) |
| `Field.ts` | Form fields for editing entity properties |
| `Preset.ts` | Feature presets (templates for map features) |

### Styling and Rule Classes

| File | Description |
|------|-------------|
| `Style.ts` | Visual style properties for map features (fill, stroke, marker, etc.) |
| `StyleSelector.ts` | Matching rules that determine when styles apply |
| `PropMatcher.ts` | Declarative tag/property matching conditions |
| `Ruleset.ts` | Group of `PropMatcher` rules with include/exclude semantics |
| `Variable.ts` | Named reusable data (e.g. lists of tag values), referenced from rules via `var()` |

### Data Structures

| File | Description |
|------|-------------|
| `Difference.ts` | Calculates differences between two graphs |
| `Edit.ts` | One step in the edit history: its graph, plus props (label, type, selection before and after, extent, sources, etc.) |
| `Geometry.ts` | Geometry wrapper for data elements |
| `GeometryPart.ts` | Individual parts of multi-part geometries |
| `Graph.ts` | Transactional graph structure holding all entities, with a journal of what each graph writes; versions share structure through `PersistentVector`, and each keeps its own shapes of what it changed |
| `PersistentVector.ts` | Immutable array by slot that shares structure between versions (32-way trie with owner tokens) |
| `SessionDifference.ts` | The difference between `base` and `stable` (all of the user's edits), kept up to date as `stable` changes |
| `TreeStore.ts` | Generic nested key/value tree store: path access (`get`/`peek`/`set`/`has`/`unset`) plus flat-key (de)serialization (`toFlat`/`fromFlat`) |

### Imagery & Datasets

| File | Description |
|------|-------------|
| `ImagerySource.ts` | Background imagery source configuration |
| `RapidDataset.ts` | External dataset that can be loaded into Rapid (Esri, MapWithAI, Overture, custom) |
| `RapidDataDictionary.ts` | Mapping from a dataset's source attributes to OSM tags |

### Validation

| File | Description |
|------|-------------|
| `ValidationCache.ts` | Stores validation state for a graph (`base` or `head`) |
| `ValidationFix.ts` | A fix that can be applied to resolve a validation issue |
| `ValidationIssue.ts` | A validation problem detected in the map data |

### Other Utilities

| File | Description |
|------|-------------|
| `intersection.ts` | Intersection analysis for roads |
| `lanes.ts` | Lane tagging utilities |
| `multipolygon.ts` | Multipolygon relation handling |
| `types.ts` | Shared TypeScript type definitions |
| `index.ts` | Barrel export file |

## Graph

The `Graph` class is central to Rapid's data model. It holds all entities and their relationships, with a "base" (unedited) state and a "local" (edited) state.

Graphs are transactional: `replace`/`remove`/`revert` modify the graph in place, then `commit` rebuilds
the shapes of what changed (and of the ways and relations that contain it) in this graph's records:

```typescript
graph
  .replace(entity)
  .remove(otherEntity)
  .commit();
```

Every graph derived from a base graph (its "lineage") shares that base. Things to know:

- **Shapes belong to the graph.** Read a way's or a relation's shape with `graph.geometry(entity)` or
  `graph.extent(entity)`; `entity.geoms` throws for them. A node's shape is its own.
- **Downloaded data goes in with `rebase`** on the base graph. Graphs that keep shapes of their own near
  what arrived catch up with `graph.syncWithBase()` (`EditSystem` does this for stable and staging, and
  for a history graph when it becomes current).
- **Spatial searches** of any graph of the editor's lineage go through `EditSystem.entitiesInBox(box, graph)`
  and `segmentsInBox(box, graph)`.

See [`design/graph-geometry.md`](../../design/graph-geometry.md).
