# Operations

Operations are user-invokable commands that modify map data. They appear in the edit menu (right-click context menu) and can be triggered via keyboard shortcuts.

## Overview

Operations wrap one or more actions and provide:
- Availability checks (can this operation be performed on the selection?)
- Keyboard shortcut bindings
- User-facing labels and tooltips
- Undo annotations

Every operation is a class that extends [`AbstractOperation`](AbstractOperation.ts). An operation is
constructed against a specific selection, computes whatever derived state it needs up front, and
exposes that state through its methods.

## Key Files

| File | Description |
|------|-------------|
| `AbstractOperation.ts` | Base class that all operations extend |
| `types.ts` | `OperationConstructor` type |
| `index.ts` | Barrel exports + the `operations.available` registry |
| `CircularizeOperation.ts` | Make a way more circular |
| `ContinueOperation.ts` | Continue drawing a line from its endpoint |
| `CopyOperation.ts` | Copy selected features to clipboard |
| `CycleHighwayTagOperation.ts` | Cycle through highway/crossing presets |
| `DeleteOperation.ts` | Delete selected features |
| `DisconnectOperation.ts` | Disconnect a node from connected ways |
| `DowngradeOperation.ts` | Remove tags from a feature |
| `ExtractOperation.ts` | Extract a point from a way |
| `MergeOperation.ts` | Merge selected features together |
| `MoveOperation.ts` | Move selected features |
| `OrthogonalizeOperation.ts` | Square the corners of a building |
| `PasteOperation.ts` | Paste features from clipboard |
| `ReflectOperation.ts` | Reflect features across an axis — base class + `ReflectShortOperation` / `ReflectLongOperation` subclasses |
| `ReverseOperation.ts` | Reverse the direction of a way |
| `RotateOperation.ts` | Rotate selected features |
| `SplitOperation.ts` | Split a way at a node |
| `StraightenOperation.ts` | Straighten a way or line of nodes |

## Operation Interface

Each operation is constructed with the shared context and the selected entityIDs, then queried and run:

```typescript
const operation = new DeleteOperation(context, selectedIDs);

operation.available();    // Can this operation be performed?
operation.disabled();     // Why is it disabled? (returns reason string or false)
operation.run();          // Perform the operation
operation.id;             // Operation identifier
operation.keys;           // Keyboard shortcuts
operation.title;          // Display title
operation.annotation();   // Undo annotation text
```

Some operations override optional hooks from the base class:
- `relatedEntityIds()` — entityIDs to highlight when hovering the menu item (`ContinueOperation`, `DisconnectOperation`, `SplitOperation`)
- `mouseOnly` — hide from touch/pen menus (`MoveOperation`, `RotateOperation`)
- `availableForKeypress()` / `point()` — pointer-aware details (`CopyOperation`)

`PasteOperation` is a special case: it is constructed with just the context (no `selectedIDs`) and has no
`KeyOperationBehavior` (its shortcut is bound by `PasteBehavior` instead).

## Usage

A mode builds its edit menu by constructing the operations in the registry against its selection:

```typescript
this.operations = [...operations.available.values()]
  .map(Op => new Op(context, selectedIDs))
  .filter(op => op.available());
```

`BrowseMode` uses a fixed operation directly:

```typescript
this.operations = [ new PasteOperation(context) ];
```
