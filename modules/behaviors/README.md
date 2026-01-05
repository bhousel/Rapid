# Behaviors

Behaviors are bundles of event handlers that can be enabled and disabled depending on what the user is doing. They handle user input like mouse clicks, keyboard presses, and drag operations.

## Overview

All behaviors extend `AbstractBehavior` and are event emitters. Behaviors are typically enabled/disabled by modes when the user enters or exits different editing states.

## Key Files

| File | Description |
|------|-------------|
| `AbstractBehavior.js` | Base class for all behaviors with enable/disable lifecycle |
| `DragBehavior.js` | Handles drag operations on the map |
| `DrawBehavior.js` | Handles drawing new features (placing nodes) |
| `HoverBehavior.js` | Tracks what features are under the cursor |
| `KeyOperationBehavior.js` | Maps keyboard shortcuts to operations |
| `LassoBehavior.js` | Handles lasso selection of multiple features |
| `MapInteractionBehavior.js` | Core map interactions (pan, zoom, etc.) |
| `MapNudgeBehavior.js` | Nudges map view when cursor is near edges |
| `PasteBehavior.js` | Handles paste operations from clipboard |
| `SelectBehavior.js` | Handles selection of features |

## Lifecycle

```javascript
// Behaviors are enabled when needed
behavior.enable();

// And disabled when no longer needed
behavior.disable();
```

## Events

Behaviors emit events that modes and other components can listen to:

```javascript
behavior.on('click', (eventData) => {
  // Handle click event
});
```
