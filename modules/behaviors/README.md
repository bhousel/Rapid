# Behaviors

Behaviors are groups of event handlers that can be enabled and disabled depending on what the user is doing. They handle user input like mouse clicks, keyboard presses, and drag operations.

## Overview

All behaviors extend `AbstractBehavior` and are event emitters. Behaviors are typically enabled/disabled by modes when the user enters or exits different editing states.

Behaviors use a registry pattern: `index.ts` holds a `behaviors.available` Map of behavior IDs to constructors, and at init time `Context` instantiates each one into `context.behaviors` (typed by the `Behaviors` interface in `types.ts`). `KeyOperationBehavior` is not in the registry because it needs extra constructor arguments - it is created per-operation instead.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel exports + the `behaviors.available` registry |
| `types.ts` | `Behaviors` instance container and `BehaviorConstructor` types |
| `AbstractBehavior.ts` | Base class for all behaviors with enable/disable lifecycle |
| `DragBehavior.ts` | Converts pointer events into drag start/move/end events |
| `DrawBehavior.ts` | Handles drawing new features (placing nodes) |
| `HoverBehavior.ts` | Tracks what features are under the cursor |
| `KeyOperationBehavior.ts` | Binds an operation's keyboard shortcuts |
| `LassoBehavior.ts` | Handles lasso selection of multiple features |
| `MapInteractionBehavior.ts` | Core map interactions (pan, zoom, rotate) |
| `MapNudgeBehavior.ts` | Nudges map view when cursor is near edges |
| `PasteBehavior.ts` | Handles paste operations from clipboard |
| `SelectBehavior.ts` | Handles selection of features |

## Lifecycle

```typescript
// Behaviors are enabled when needed
behavior.enable();

// And disabled when no longer needed
behavior.disable();

// Modes usually enable a set of behaviors at once, disabling all others
context.enableBehaviors(['hover', 'draw', 'mapInteraction']);
```

## Events

Behaviors emit events that modes and other components can listen to:

```typescript
context.behaviors.draw!.on('click', (eventData) => {
  // Handle click event
});
```
