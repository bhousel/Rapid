# Operations

Operations are user-invokable commands that modify map data. They appear in the edit menu (right-click context menu) and can be triggered via keyboard shortcuts.

## Overview

Operations wrap one or more actions and provide:
- Availability checks (can this operation be performed on the selection?)
- Keyboard shortcut bindings
- User-facing labels and tooltips
- Undo annotations

## Key Files

| File | Description |
|------|-------------|
| `circularize.js` | Make a way more circular |
| `continue.js` | Continue drawing a line from its endpoint |
| `copy.js` | Copy selected features to clipboard |
| `cycle_highway_tag.js` | Cycle through highway tag values |
| `delete.js` | Delete selected features |
| `disconnect.js` | Disconnect a node from connected ways |
| `downgrade.js` | Remove tags from a feature |
| `extract.js` | Extract a point from a way |
| `merge.js` | Merge selected features together |
| `move.js` | Move selected features |
| `orthogonalize.js` | Square the corners of a building |
| `paste.js` | Paste features from clipboard |
| `reflect.js` | Reflect features across an axis |
| `reverse.js` | Reverse the direction of a way |
| `rotate.js` | Rotate selected features |
| `split.js` | Split a way at a node |
| `straighten.js` | Straighten a way or line of nodes |

## Operation Interface

Each operation is a function that returns an object with:

```javascript
const operation = operationDelete(context, selectedIDs);

operation.available();    // Can this operation be performed?
operation.disabled();     // Why is it disabled? (returns reason string or false)
operation();              // Perform the operation
operation.id;             // Operation identifier
operation.keys;           // Keyboard shortcuts
operation.title;          // Display title
operation.annotation();   // Undo annotation text
```

## Usage

Operations are typically added to a mode's `operations` array and displayed in the edit menu:

```javascript
this.operations = [
  operationCopy(context, selectedIDs),
  operationPaste(context),
  operationDelete(context, selectedIDs),
  // ...
];
```
