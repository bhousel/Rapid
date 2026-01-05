# Actions

Actions are pure functions that transform a `Graph` from one state to another. They are the fundamental building blocks for making changes to map data in Rapid.

## Overview

Each action takes a `Graph` and returns a new `Graph` with the requested changes applied. Actions are designed to be composable and reversible, enabling undo/redo functionality.

Actions are typically invoked through the EditSystem, which wraps them in `Edit` objects for history tracking.

## Key Files

| File | Description |
|------|-------------|
| `add_entity.js` | Add a new entity (node, way, or relation) to the graph |
| `add_member.js` | Add a member to a relation |
| `add_midpoint.js` | Add a node at the midpoint of a way segment |
| `add_vertex.js` | Add a vertex to an existing way |
| `change_member.js` | Modify a relation member's role or position |
| `change_preset.js` | Change the preset (feature type) of an entity |
| `change_tags.js` | Modify tags on an entity |
| `circularize.js` | Make a way more circular |
| `connect.js` | Connect nodes together |
| `copy_entities.js` | Copy entities for paste operations |
| `delete_*.js` | Various deletion actions for nodes, ways, relations, and members |
| `discard_tags.js` | Remove uninteresting tags from entities |
| `disconnect.js` | Disconnect a node from connected ways |
| `extract.js` | Extract a point from a way |
| `join.js` | Join multiple ways into one |
| `merge*.js` | Various merge operations for nodes, ways, and polygons |
| `move*.js` | Move entities, nodes, or relation members |
| `noop.js` | No-operation action (useful for annotations without changes) |
| `orthogonalize.js` | Square the corners of a way |
| `rapid_accept_feature.js` | Accept an AI-suggested feature into the map |
| `reflect.js` | Reflect entities across an axis |
| `restrict_turn.js` / `unrestrict_turn.js` | Add or remove turn restrictions |
| `reverse.js` | Reverse the direction of a way |
| `revert.js` | Revert an entity to its original state |
| `rotate.js` | Rotate entities around a pivot point |
| `scale.js` | Scale entities larger or smaller |
| `split.js` | Split a way at a node |
| `straighten_nodes.js` / `straighten_way.js` | Straighten nodes or ways |
| `sync_crossing_tags.js` | Synchronize crossing tags between related features |
| `upgrade_tags.js` | Upgrade deprecated tags to current values |

## Usage Pattern

```javascript
import { actionChangeTags } from './actions/index.js';

// Actions return a function that transforms the graph
const action = actionChangeTags(entityID, newTags);
const newGraph = action(oldGraph);
```
