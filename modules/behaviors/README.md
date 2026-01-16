# Behaviors

Behaviors are bundles of event handlers that can be enabled and disabled depending on what the user is doing. They handle user input like mouse clicks, keyboard presses, and drag operations.

## Overview

All behaviors extend `AbstractBehavior` and are event emitters. Behaviors are typically enabled/disabled by modes when the user enters or exits different editing states.

## Key Files

| File | Description |
|------|-------------|
| `AbstractBehavior.ts` | Base class for all behaviors with enable/disable lifecycle |
| `DragBehavior.ts` | Handles drag operations on the map |
| `DrawBehavior.ts` | Handles drawing new features (placing nodes) |
| `HoverBehavior.ts` | Tracks what features are under the cursor |
| `KeyOperationBehavior.ts` | Maps keyboard shortcuts to operations |
| `LassoBehavior.ts` | Handles lasso selection of multiple features |
| `MapInteractionBehavior.ts` | Core map interactions (pan, zoom, etc.) |
| `MapNudgeBehavior.ts` | Nudges map view when cursor is near edges |
| `PasteBehavior.ts` | Handles paste operations from clipboard |
| `SelectBehavior.ts` | Handles selection of features |

## Lifecycle

```typescript
// Behaviors are enabled when needed
behavior.enable();

// And disabled when no longer needed
behavior.disable();
```

## Events

Behaviors emit events that modes and other components can listen to:

```typescript
behavior.on('click', (eventData) => {
  // Handle click event
});
```
