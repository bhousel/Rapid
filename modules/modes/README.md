# Modes

Modes represent the current editing task the user is performing. Only one mode can be active at a time.

## Overview

All modes extend `AbstractMode` and manage the editing state for a particular task. Modes control which behaviors are enabled and what operations are available.

## Key Files

| File | Description |
|------|-------------|
| `AbstractMode.js` | Base class for all modes with enter/exit lifecycle |
| `AddNoteMode.js` | Adding a new OSM note |
| `AddPointMode.js` | Adding a new point feature |
| `BrowseMode.js` | Default browsing mode (no selection) |
| `DragNodeMode.js` | Dragging a node to a new position |
| `DragNoteMode.js` | Dragging an OSM note |
| `DrawAreaMode.js` | Drawing a new area (polygon) |
| `DrawLineMode.js` | Drawing a new line (way) |
| `MoveMode.js` | Moving selected features |
| `RotateMode.js` | Rotating selected features |
| `SaveMode.js` | Saving/uploading changes to OSM |
| `SelectMode.js` | Features are selected (base class) |
| `SelectOsmMode.js` | OSM features are selected |

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
