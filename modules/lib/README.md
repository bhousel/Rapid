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

### Data Structures

| File | Description |
|------|-------------|
| `Difference.ts` | Calculates differences between two graphs |
| `Edit.ts` | Represents an edit operation with undo support |
| `Geometry.ts` | Geometry wrapper for data elements |
| `GeometryPart.ts` | Individual parts of multi-part geometries |
| `Graph.ts` | Immutable graph structure holding all entities |
| `Tree.ts` | R-tree spatial index for fast lookups |

### Imagery & Datasets

| File | Description |
|------|-------------|
| `ImagerySource.ts` | Background imagery source configuration |
| `RapidDataset.ts` | Rapid AI dataset configuration |

### Validation

| File | Description |
|------|-------------|
| `ValidationFix.ts` | A fix that can be applied to resolve a validation issue |
| `ValidationIssue.ts` | A validation problem detected in the map data |

### Tag Utilities

| File | Description |
|------|-------------|
| `tags.ts` | Tag-related constants and utilities (area keys, lifecycle prefixes, etc.) |
| `tag_classes.ts` | Generate CSS classes from tags (legacy - not used anymore) |

### Other Utilities

| File | Description |
|------|-------------|
| `intersection.ts` | Intersection analysis for roads |
| `lanes.ts` | Lane tagging utilities |
| `multipolygon.ts` | Multipolygon relation handling |
| `types.ts` | Shared TypeScript type definitions |

## Graph

The `Graph` class is central to Rapid's data model. It's an immutable structure that holds all entities and their relationships:

```typescript
// Graphs are immutable - modifications return new graphs
const newGraph = graph.replace(entity);
const newerGraph = newGraph.remove(entityId);
```
