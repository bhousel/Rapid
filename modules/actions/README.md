# Actions

Actions are pure functions that transform a `Graph` from one state to another. They are the fundamental building blocks for making changes to map data in Rapid.

## Overview

Each action takes a `Graph` and returns a new `Graph` with the requested changes applied. Actions are designed to be composable and reversible, enabling undo/redo functionality.

Actions are typically invoked through the EditSystem, which wraps them in `Edit` objects for history tracking.

## Key Files

| File | Description |
|------|-------------|
| `add_entity.ts` | Add a new entity (node, way, or relation) to the graph |
| `add_member.ts` | Add a member to a relation |
| `add_midpoint.ts` | Add a node at the midpoint of a way segment |
| `add_vertex.ts` | Add a vertex to an existing way |
| `change_member.ts` | Modify a relation member's role or position |
| `change_preset.ts` | Change the preset (feature type) of an entity |
| `change_tags.ts` | Modify tags on an entity |
| `circularize.ts` | Make a way more circular |
| `connect.ts` | Connect nodes together |
| `copy_entities.ts` | Copy entities for paste operations |
| `delete_*.ts` | Various deletion actions for nodes, ways, relations, and members |
| `discard_tags.ts` | Remove uninteresting tags from entities |
| `disconnect.ts` | Disconnect a node from connected ways |
| `extract.ts` | Extract a point from a way |
| `join.ts` | Join multiple ways into one |
| `merge*.ts` | Various merge operations for nodes, ways, and polygons |
| `move*.ts` | Move entities, nodes, or relation members |
| `noop.ts` | No-operation action (useful for annotations without changes) |
| `orthogonalize.ts` | Square the corners of a way |
| `rapid_accept_feature.ts` | Accept an AI-suggested feature into the map |
| `reflect.ts` | Reflect entities across an axis |
| `restrict_turn.ts` / `unrestrict_turn.ts` | Add or remove turn restrictions |
| `reverse.ts` | Reverse the direction of a way |
| `revert.ts` | Revert an entity to its original state |
| `rotate.ts` | Rotate entities around a pivot point |
| `scale.ts` | Scale entities larger or smaller |
| `split.ts` | Split a way at a node |
| `straighten_nodes.ts` / `straighten_way.ts` | Straighten nodes or ways |
| `sync_crossing_tags.ts` | Synchronize crossing tags between related features |
| `upgrade_tags.ts` | Upgrade deprecated tags to current values |

## Usage Pattern

```typescript
import { actionChangeTags } from './actions/index.ts';

// Actions return a function that transforms the graph
const action = actionChangeTags(entityID, newTags);
const newGraph = action(oldGraph);
```
