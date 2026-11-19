# The scene: how features are stacked, and what the pointer can reach

**Status:** In progress (Nov 2026). Sections 1 and 2 (containers per spatial ID, interactivity by
mode) are done (Nov 11), and so is section 3 (render groups, Nov 18). Section 4 is ideas with nothing
built.

`PixiScene` owns the Pixi display tree under `GraphicsSystem.origin`. Every layer
(`AbstractPixiLayer`) adds its features to that tree, and two things depend on *where* it adds them:

- **Draw order.** Pixi draws the tree depth-first, sorting siblings by `zIndex` where a container has
  `sortableChildren`. Polygons must draw under lines, lines by level (bridges over tunnels), points over
  all of that, external data over OSM, and the things that float (labels, the selection's vertices, UI)
  over everything.
- **Hit-testing.** Pixi tests the tree top-down and stops at the first container with
  `eventMode: 'static'`. A container with `eventMode: 'none'` is skipped along with its whole subtree.
  Whatever draws on top takes the pointer, which is right for selecting and wrong for drawing: a muted
  "already mapped" Rapid line lies exactly on the OSM sidewalk it matched, so a line started on that
  sidewalk ended up as a loose node (pre.4 release check, Nov 2026). Photo markers and QA items over
  OSM ways do the same.

## 1. Containers per spatial ID

The tree, with the groups `PixiScene.reset()` creates in `zIndex` order and the containers the layers
put under them. (Each container shown here except `origin` and the features is really a pair, a
render group with the container in it: see section 3.)

```
origin
├ background            tiles (PixiLayerBackgroundTiles), not interactive
├ debug-under
├ basemap
│  ├ osm                 zIndex 0
│  │  ├ polygons         sorted by area, biggest first (zIndex = -area)
│  │  └ lines
│  │     └ <level>       one per `way.layer()`, zIndex = level; lines sorted by `getzIndex(tags)`
│  ├ <spatialID>         one per Rapid dataset / custom data cache / GeoScribble, zIndex 1, 2, … in
│  │  ├ polygons         the order they first draw (so external data is above OSM, and a dataset's
│  │  └ lines            polygons are above OSM lines, as before)
│  └ …
├ points
│  ├ osm                 OSM points, interesting vertices and the virtual POI pins, sorted by latitude
│  └ <spatialID>         as above
├ debug-over
├ streetview
│  └ <spatialID>         one per photo layer (`mapillary`, `kartaview`, `streetside`)
├ qa
│  └ <spatialID>         one per QA layer (`osm-notes`, `keepright`, `osmose`, `maproulette`,
│                        `mapillary-detections`, `mapillary-signs`)
├ labels                 screen-space, not interactive
├ blocks                 edit blocks, straight in the group: always interactive (they catch the pointer
│                        on purpose, and show `not-allowed`)
└ ui                     PixiLayerMapUI: lasso, geolocation, and `selected` (the vertices and midpoints
                         of the selected/hovered ways, so the user can grab them above everything)
```

The rule: **a layer never adds a feature straight into a group.** It asks the scene for the container
of a spatial ID in that group (`scene.getSpatialContainer(groupID, spatialID)`, through the layer's
`_spatialContainer()` which remembers what it asked for), and puts its features there or in
sub-containers it makes under it (`polygons`, `lines/<level>`). The spatial ID is the one the layer's
data carries (`design/data-ids.md`): `osm`, a Rapid dataset's `spatialID`, a custom cache's
`custom-<hash>`; for the QA and photo layers it's the layer ID, which `drawsData()` already treats as
the spatial ID of their data. Exceptions, which don't hold data the pointer should ever be kept from:
`blocks` (always interactive), the debug groups and `labels` (never interactive), and `ui`.

Before this, `basemap` had `osm-areas`, `osm-lines` and `rapid-<ds>-areas`/`-lines` (so this was half
built), but `points` was flat (OSM, Rapid and custom points as siblings), `PixiLayerCustomData` and
`PixiLayerGeoScribble` added into `basemap` directly, and the QA and photo layers added into their
groups directly. Rapid drew above OSM only because `PixiLayerOsm.reset()` added its containers before
any dataset rendered; now the `zIndex` says so.

The scene keeps a registry of the spatial containers (`spatialID → containers`, one per group). A layer
releases its containers in `reset()` (the base class does it for every spatial ID the layer asked for),
and makes them again when it next renders.

**Decisions**

- **Points sort by latitude only within their spatial ID.** `PixiFeaturePoint` sets `zIndex` from
  latitude so a pin to the south overlaps one to the north. That was global while all points shared
  one container; now every Rapid point draws above every OSM point whatever its latitude, so at the
  boundary a Rapid pin north of an OSM pin draws over it. Dense point datasets (NAD addresses) will
  show this. We take it: "external data above OSM" is the rule for lines and polygons too, and the
  alternative (one shared container, interactivity by feature) is what we're replacing. Decided with
  Bryan, Nov 2026.
- **Labels avoid the points of every spatial ID.** `PixiLayerLabels` used to walk the `points` group's
  children as features; it now walks each spatial container's children.
- **`polygons`, not `areas`.** The container names follow the geometry vocabulary.

## 2. Interactivity by mode

A mode says which spatial IDs the pointer may reach: `AbstractMode.interactiveSpatialIDs`, a
`Set<SpatialID>` or `null` for everything. Drawing and dragging are OSM-only operations, so
`DrawLineMode`, `DrawAreaMode`, `AddPointMode` and `DragNodeMode` say `['osm']`. Browse and select
keep everything (clicking a Rapid line while an OSM way is selected must still select it), and so do
the modes that don't hit-test at all. This sits beside `context.enableBehaviors([...])`: the mode
declares what it wants, and the scene applies it.

`PixiScene` listens for `modechange` and sets every registered spatial container to `eventMode:
'passive'` (its children can be hit) or `'none'` (the subtree is skipped). A container made while a
mode is active gets the current answer when it's made. The whole subtree being skipped means an OSM
line under a Rapid line, a photo marker or a note is hit directly, with no change to the behaviors:
`AbstractBehavior._getEventData` still walks up from the hit container to its feature, and
`DrawLineMode._click` / `DragNodeMode` find that feature's entity in the graph. It also means no hover
halo on a Rapid line while drawing, and a cheaper hit test in those modes.

Not changed: the `'drawing'` class still turns off the drawing way's own hit area (Rapid#648), and
`DragBehavior` still turns off the dragged node's.

## 3. Render groups

Pixi keeps one list of drawing instructions per *render group*, and until Nov 18 the whole scene was
one group. Any change to what's drawn (a feature scrolls into view, a hover adds a halo) made Pixi
collect every object again, and moving `origin` gave every object a new transform. On a pan frame
that cost about 2 µs per visible feature (`design/graphics-system.md`, section 2).

Now every structural container is its own render group: the groups under `origin`, each spatial
container, and the containers a layer makes under one with `_childContainer()` (`polygons`, `lines`,
each line level). Features aren't. A change rebuilds the instructions of the group it happened in,
and a pan moves each group with one matrix.

**World coordinates don't fit in a render group, so each one sits at an anchor.** Pixi stores a
group's vertices as 32-bit floats relative to the group. Our features are positioned in z16 world
coordinates (up to 16.7 million), where a 32-bit float is exact to 0.25 or 1 world unit: 4 to 16
screen pixels at z20. (Tried first with a plain `isRenderGroup` on `origin`: circles came out as
ovals in Bochum at z18.) Without render groups this didn't matter, because Pixi multiplied the big
numbers together as 64-bit floats and only stored the small screen coordinates.

So `PixiScene.worldContainer(parent, label, zIndex)` makes a pair:

```
<label>     render group, positioned at +anchor
└ <label>   plain container, positioned at -anchor   ← what the caller gets, and puts features in
```

The anchor is a whole world coordinate near the view. What's in the inner container is still
positioned in world coordinates, like under `origin`, but Pixi works out its distance from the render
group in 64-bit floats, and that distance is small. A pair can go inside another pair: plus and
minus the same anchor cancel. `GraphicsSystem._app()` moves the anchor (`scene.setAnchor()`) when the
zoom changes or the view is more than 100,000 pixels from it, which keeps positions exact to about a
hundredth of a pixel. Features and layers don't know any of this.

Rules:

- **Make structural containers with `scene.worldContainer()`** (layers: `_spatialContainer()` and
  `_childContainer()`). Never set `isRenderGroup` on a container whose children are in world
  coordinates.
- **The container you get back is the inner one.** Its `zIndex` and its place in the tree belong to
  its parent, the render group, and its position belongs to the scene. To list the containers under
  one, use `scene.worldContainersIn(parent)`; `parent.children` are the render groups.
- **`labels` is a plain render group.** The labels layer positions and scales that group itself, to
  draw in screen coordinates, which are small.
- **`origin` is not a render group**, for the reason above.

What it changed (M4, `bun run measure --fresh`, DRAW pass in ms):

| | Seattle | Bochum | Staten Island | Golmud |
|---|---|---|---|---|
| Pan frame, before | 6.8 | 5.4 | 22.8 | 27.8 |
| Pan frame, after | 5.1 | 4.2 | 12.3 | 15.5 |

A frame that puts the hover class on one line at Staten Island went from 13 ms of DRAW to 1 ms (the
line's level has a few dozen lines). On one polygon it went from 13 to 8: the `polygons` container
there holds 11,763 parking spaces and other areas, and all of them are collected again. Redraw and
restyle frames cost the same as before, and there are a few more draw calls (775 against 768 in
Seattle), one batch break per group.

What's left, in order of what it would save:

- **A pan still rebuilds the big groups, because culling changes some feature's `visible` on every
  frame.** At Staten Island even a 2 px pan flips 30 to 50 features, and the rebuild costs the same
  11 ms whether 1 feature changed or 1,800. A pan frame where nothing flips costs 0.8 ms. So decide
  visibility against a box that is padded and snapped to a grid, so that most pan frames change
  nothing. That draws more features per frame, so it needs the APP pass's cost per feature to come
  down first (`graphics-system.md`, section 2).
- **Smaller groups for polygons.** By size class keeps the draw order exactly (they're sorted by
  area), but 11,000 parking spaces are all one size. By tile needs a rule for polygons that overlap
  across tiles.
- **Halos and other things that come and go could live in the `ui` group**, so that hovering never
  touches a big group.

## 4. Later

- **Reordering spatial IDs.** With an explicit `zIndex` per spatial container, lifting OSM above the
  datasets while drawing, or a layer-order UI, is a `zIndex` write. We don't reorder while drawing by
  default: with the datasets non-interactive, the OSM line under a muted already-mapped line is
  reachable anyway, and that muted line staying visible is the point of the setting. Reordering is a
  visual preference, which is where a layer-order UI would belong.
- **Batching casings and strokes.** Each `PixiFeatureLine` renders its casing then its stroke, so a
  dense view draws casing, stroke, casing, stroke, one pair per line. Pixi's `RenderLayer` (8.6+) can
  render all casings of a level then all strokes while they stay children of the feature container
  (hit-testing unchanged). See `design/profiling.md`.
- **Hit-testing by geometry** (the spatial index instead of Pixi) would make snapping independent of
  stroke width and z-order altogether, and would make "don't snap to the segment next to the active
  node" (commented out in `HoverBehavior`/`DrawBehavior`) easy. A redesign of hover and snapping;
  noted as the direction, not planned.
