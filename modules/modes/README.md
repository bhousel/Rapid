# Modes

Modes represent the current editing task the user is performing. Only one mode can be active at a time.

## Overview

All modes extend `AbstractMode` and manage the editing state for a particular task. Modes control which behaviors are enabled and what operations are available.

## Key Files

| File | Description |
|------|-------------|
| `AbstractMode.ts` | Base class for all modes with enter/exit lifecycle |
| `AddNoteMode.ts` | Adding a new OSM note |
| `AddPointMode.ts` | Adding a new point feature |
| `BrowseMode.ts` | Default browsing mode (no selection) |
| `DragNodeMode.ts` | Dragging a node to a new position |
| `DragNoteMode.ts` | Dragging an OSM note |
| `DrawAreaMode.ts` | Drawing a new area (polygon) |
| `DrawLineMode.ts` | Drawing a new line (way) |
| `MoveMode.ts` | Moving selected features |
| `RotateMode.ts` | Rotating selected features |
| `SaveMode.ts` | Saving/uploading changes to OSM |
| `SelectMode.ts` | Features are selected (base class) |
| `SelectOsmMode.ts` | OSM features are selected |

## Properties

Each mode has:
- `id` - Unique identifier (e.g., `browse`, `select`)
- `active` - Whether the mode is currently active
- `operations` - Array of operations available in this mode
- `selectedData` - Map of currently selected data elements

## Mode Transitions

The application context manages mode transitions:

```javascript
context.enter('select-osm', { selection: { osm: selectedIds } });
context.enter('browse');
context.mode();   // returns BrowseMode
```
