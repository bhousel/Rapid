# Actions

Actions are functions that transform a `Graph` from one state to another. They are the fundamental building blocks for making changes to map data in Rapid.

## Overview

Each action takes a `Graph`, applies the requested changes, and returns the modified `Graph`. Graphs are transactional, so actions should call `graph.commit()` at the end to finalize their changes. Actions are designed to be composable - several can be performed in sequence as a single edit.

Actions are typically invoked through the `EditSystem`, which performs them against a copy of the graph in its work-in-progress `Edit` and records committed edits in the history, enabling undo/redo.

The `Action` type (in `types.ts`) is a function `(graph, t?) => Graph` with two optional extras:
- `transitionable` - the action supports eased transitions via the `t` parameter (0..1)
- `disabled(graph)` - returns a reason string if the action can't be performed, or `false`

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export file |
| `types.ts` | The shared `Action` interface |
| `add_entity.ts` | Add a new entity (node, way, or relation) to the graph |
| `add_member.ts` | Add a member to a relation, choosing a sensible position for way members |
| `add_midpoint.ts` | Add a node at the midpoint of a way segment |
| `add_vertex.ts` | Add a node to a way at a given index |
| `change_member.ts` | Replace a relation member at a given index |
| `change_preset.ts` | Change the preset (feature type) of an entity |
| `change_tags.ts` | Replace the tags on an entity |
| `circularize.ts` | Make a way more circular |
| `connect.ts` | Connect ways by merging nodes into a single surviving node |
| `copy_entities.ts` | Copy entities from one graph to another (used by copy/paste) |
| `delete_*.ts` | Various deletion actions for nodes, ways, relations, members, and multiple entities |
| `discard_tags.ts` | Remove discardable tags from modified or created entities |
| `disconnect.ts` | Disconnect ways at a shared node |
| `extract.ts` | Extract a point (POI) from a node, way, or relation |
| `join.ts` | Join ways at their shared end nodes |
| `merge*.ts` | Merge points onto a way/area, merge nodes, merge polygons into a multipolygon, or merge remote changes with local edits |
| `move*.ts` | Move entities, nodes, or relation members |
| `noop.ts` | No-operation action that returns the graph unchanged |
| `orthogonalize.ts` | Square the corners of a way |
| `rapid_accept_feature.ts` | Accept a Rapid (AI or external dataset) feature into the map |
| `reflect.ts` | Reflect entities across their short or long axis |
| `restrict_turn.ts` / `unrestrict_turn.ts` | Add or remove turn restrictions |
| `reverse.ts` | Reverse the direction of a way (or direction-dependent node tags) |
| `revert.ts` | Revert an entity to its original state |
| `rotate.ts` | Rotate entities around a pivot point |
| `scale.ts` | Scale entities larger or smaller |
| `split.ts` | Split a way at a node |
| `straighten_nodes.ts` / `straighten_way.ts` | Straighten nodes or ways |
| `sync_crossing_tags.ts` | Keep crossing tags in sync between crossing ways and crossing nodes |
| `upgrade_tags.ts` | Upgrade deprecated tags to current values |

## Usage Pattern

```typescript
import { actionChangeTags } from './actions/index.ts';

// Actions return a function that transforms the graph
const action = actionChangeTags(entityID, newTags);
graph = action(graph);

// More commonly, the EditSystem performs the action and commits the edit
editor.perform(action);
editor.commit({ stringID: 'operations.change_tags.annotation', selectedIDs: [entityID] });
```
