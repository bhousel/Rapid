# Modes

Modes represent the current editing task the user is performing. Only one mode can be active at a time.

## Overview

All modes extend `AbstractMode` and manage the editing state for a particular task. Modes control which behaviors are enabled and what operations are available.

Modes use a registry pattern: `index.ts` holds a `modes.available` Map of mode IDs to constructors, and at init time `Context` instantiates each one into `context.modes` (typed by the `Modes` interface in `types.ts`).

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel exports + the `modes.available` registry |
| `types.ts` | `Modes` instance container and `ModeConstructor` types |
| `AbstractMode.ts` | Base class for all modes with enter/exit lifecycle |
| `AddNoteMode.ts` | Adding a new OSM note |
| `AddPointMode.ts` | Adding a new point feature |
| `BrowseMode.ts` | Default browsing mode (no selection) |
| `DragNodeMode.ts` | Dragging a node to a new position |
| `DragNoteMode.ts` | Dragging an OSM note |
| `DrawAreaMode.ts` | Drawing a new area (polygon) |
| `DrawLineMode.ts` | Drawing a new line (way), or continuing an existing one |
| `MoveMode.ts` | Moving selected features |
| `RotateMode.ts` | Rotating selected features |
| `SaveMode.ts` | Saving/uploading changes to OSM |
| `SelectMode.ts` | Non-OSM features are selected |
| `SelectOsmMode.ts` | OSM features are selected |

## Properties

Each mode has:
- `id` - Unique identifier (e.g., `browse`, `select`)
- `active` - Whether the mode is currently active
- `operations` - Array of operations available in this mode
- `selectedIDs` - The data IDs of the selected data, e.g. `['w1', 'fbRoads:abc']` (what edits record, so undo/redo can restore it; see [`design/data-ids.md`](../../design/data-ids.md))
- `selectedData` - Map of the selected data, each looked up by its data ID (`SpatialSystem.getData`), so it's always the current version

## Mode Transitions

The application context manages mode transitions:

```typescript
context.enter('select-osm', { selection: { osm: selectedIDs } });
context.enter('browse');
context.mode;   // returns BrowseMode
```
