# The scene: how features are stacked, and what the pointer can reach

**Status:** In progress (Nov 2026). Sections 1 and 2 (containers per spatial ID, interactivity by
mode) are done (Nov 11), and so is section 3 (render groups, Nov 18; OSM lines and points split by
tile, Nov 19). The OSM layer finds its own features under the pointer, and draws its lines in
two batches a level, every casing and then every stroke, its areas in two, every fill and
then every outline, and its points in one; a feature that its batches draw isn't in the scene
(Nov 23). Section 4 is ideas with nothing built.

`PixiScene` owns the Pixi display tree under `GraphicsSystem.origin`. Every layer
(`AbstractPixiLayer`) adds its features to that tree, and two things depend on *where* it adds them:

- **Draw order.** Pixi draws the tree depth-first, sorting siblings by `zIndex` where a container has
  `sortableChildren`. Polygons must draw under lines, lines by level (bridges over tunnels), points over
  all of that, external data over OSM, and the things that float (labels, the selection's vertices, UI)
  over everything.
- **Hit-testing.** Pixi tests the tree top-down and stops at the first container with
  `eventMode: 'static'`. A container with `eventMode: 'none'` is skipped along with its whole subtree.
  (The OSM layer's features are found through the spatial index instead, with the same answer:
  "Who finds the feature under the pointer", below.)
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
│  │  ├ polygons
│  │  │  ├ fills         a `FillBatchMesh`: every polygon's fill, the largest first
│  │  │  ├ outlines      a `LineBatchMesh`: every polygon's outlines, above every fill (a polygon
│  │  │  │               under 20 pixels has none)
│  │  │  ├ glows         a `LineBatchMesh`: the glow around the outlines of a hovered polygon
│  │  │  ├ large         polygons bigger than a tile, below the tiles (section 3)
│  │  │  └ <x,y,zoom>    one per map tile; in each, sorted by area, biggest first (zIndex = -area).
│  │  │                  Only the polygons that draw something themselves are in these (none,
│  │  │                  while the layer draws in batches): the rest aren't in the scene
│  │  └ lines
│  │     └ <level>       one per `way.layer()`, zIndex = level
│  │        ├ casings              a `LineBatchMesh`: every casing of the level's lines, by road class
│  │        ├ strokes              a `LineBatchMesh`: every stroke, above every casing, and then the
│  │        │                      markers along the lines (oneway arrows), above every stroke
│  │        ├ glows                a `LineBatchMesh`: the glow around a hovered line of the level
│  │        ├ <class>/large        lines bigger than a tile, per road class (`getzIndex(tags)`)
│  │        └ <class>/<x,y,zoom>   one per road class and map tile; ordered by class, then by tile.
│  │                               Only the lines that draw themselves are in these (one with
│  │                               dashes or markers that a batch can't draw): the rest aren't
│  │                               in the scene
│  ├ <spatialID>         one per Rapid dataset / custom data cache / GeoScribble, zIndex 1, 2, … in
│  │  ├ polygons         the order they first draw (so external data is above OSM, and a dataset's
│  │  └ lines            polygons are above OSM lines, as before)
│  └ …
├ points
│  ├ osm                 OSM points, interesting vertices and the virtual POI pins
│  │  ├ glows            a `PointBatchMesh`: the glow behind a hovered point, under every point
│  │  ├ points           a `PointBatchMesh`: every one of them, from north to south, the ones with
│  │  │                  viewfields last
│  │  ├ <x,y,zoom>       one per map tile, ordered by row; in each, sorted by latitude. Only the
│  │  │                  points that draw themselves are in these (one with a picture from
│  │  │                  another texture): the rest aren't in the scene
│  │  └ viewfields       the same, for points with viewfields, above the tiles
│  └ <spatialID>         other layers' points, straight in the container
├ debug-over
├ streetview
│  └ <spatialID>         one per photo layer (`mapillary`, `kartaview`, `streetside`)
├ qa
│  └ <spatialID>         one per QA layer (`osm-notes`, `keepright`, `osmose`, `maproulette`,
│                        `mapillary-detections`, `mapillary-signs`)
├ labels                 screen-space, not interactive
├ blocks                 edit blocks, straight in the group: always interactive (they catch the pointer
│                        on purpose, and show `not-allowed`)
└ ui                     PixiLayerMapUI: lasso, geolocation, `halo` (one `LineBatchMesh` for the halos of
                         everything that's selected, in any layer), and `selected` (the vertices and
                         midpoints of the selected/hovered ways, so the user can grab them above
                         everything)
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

### Who finds the feature under the pointer (Nov 23)

Pixi's hit test asks every interactive container in the scene, on every pointer event: 8 ms among
Užice's 107,000 features, whatever is under the pointer. A layer that keeps its data in a spatial
index can ask the few features near the pointer instead, so a layer can take its spatial ID's hit
testing from Pixi:

- **The layer says so:** `scene.setHitTester('osm', layer)`. The scene then gives that spatial
  ID's containers `eventMode: 'none'` whatever the mode, and Pixi's walk skips them.
- **`PixiEvents` asks the scene for the feature on every pointer event** (`scene.hitTest()`), and
  puts it on the event (`_feature`). `AbstractBehavior._getEventData()` reads it from there; the
  behaviors and modes are unchanged.
- **The scene takes whichever is drawn on top:** the feature that Pixi's own target belongs to, or
  the one a layer found (`drawOrder()` in `helpers.ts` compares their places in the tree). A layer
  whose spatial ID the mode keeps from the pointer isn't asked.
- **The OSM layer's `hitTest()`** asks `editor.entitiesInBox()` for the entities whose box is
  within reach of the pointer (the furthest any feature drawn so far can be hit from its
  geometry: `hitReach`), and asks each of their features (`AbstractPixiFeature.hitTest()`). A
  point answers by its hit area, a shape in pixels around where the point is on screen. A line
  answers by its distance from the pointer in world coordinates, and an area by that distance
  from its rings or by being in its fill. None of that is Pixi's: a feature that its batches
  draw isn't in the scene. (One that draws itself, like a vertex of what's selected, answers by
  the rules Pixi has for one container: `containerHit()`.)
- **The feature on top is the one drawn last** (`featureOrder()`): by the place in the scene of
  what draws each (`sceneContainer`: a feature's own container, a line's strokes' batch, an
  area's fills' batch, the points' batch), and in one batch by the feature's order there.
- **The vertices and midpoints of what's selected** are in the map UI's container, which isn't a
  spatial container: Pixi still finds those.

Checked on a grid of 4,800 points, in Seattle and Užice, in nine states each (two zooms in and
out, rotated, wireframe, full fill, a way selected), while every line was still in the scene:
the same feature as Pixi's hit test over the whole scene at all 86,400 points. Since the lines
and the areas left the scene, Pixi can't be asked about them: `test/e2e/select.test.js` checks
the index against asking every feature of the layer. The points left it too (step 8): the test
draws them with sprites once more, and checks that the batch's points are hit where Pixi hits
those.
The numbers are in `design/graphics-system.md` section 15 (step 6).

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

What it changed (M4, `bun run measure --fresh`, DRAW phase in ms):

| | Seattle | Bochum | Staten Island | Golmud |
|---|---|---|---|---|
| Pan frame, before | 6.8 | 5.4 | 22.8 | 27.8 |
| Pan frame, after | 5.1 | 4.2 | 12.3 | 15.5 |

A frame that puts the hover class on one line at Staten Island went from 13 ms of DRAW to 1 ms (the
line's level has a few dozen lines). On one polygon it went from 13 to 8: the `polygons` container
there holds 11,763 parking spaces and other areas, and all of them are collected again. Redraw and
restyle frames cost the same as before, and there are a few more draw calls (775 against 768 in
Seattle), one batch break per group.

### OSM polygons are split by map tile

One `polygons` group can be huge (11,763 at Staten Island), so `PixiLayerOsm` splits its polygons
into a container per map tile (`_polygonTileContainer()`), each with its own render group. The tiles
are one zoom level past the view's zoom, rounded down, so a tile is 128 to 256 pixels wide on screen
and about 110 are in view. A polygon goes in the tile its extent's center is in, and moves to
another when the view crosses a whole zoom level: a whole old tile at a time, over the frames
after the zoom (`_retile()`; "A zoom without a pass" in `graphics-system.md`). A tile's container
is removed when it empties.

**Draw order between tiles isn't kept.** Polygons used to be sorted by area across the whole view,
small over big. Now:

- A polygon bigger than a tile, in either direction, goes in the `large` container, which is drawn
  below all the tiles and sorted by area as before. That's where landuse, water and forests end up,
  so they're still right among themselves and still under the buildings.
- Polygons in the same tile are sorted by area as before.
- Two polygons smaller than a tile, in different tiles, that overlap, are drawn in the order of
  their tiles: by row, then by column (at first it was the order the tiles were made in, which
  changed from one load to the next). That's the case that can look wrong: a small thing inside a
  slightly bigger one, across a tile edge. In the screenshots of Seattle it changed the tint of one
  building; nothing at Staten Island or Bochum. Decided with Bryan (Nov 18): try it, and watch for
  tile edges.

What it changed, on top of the render groups (DRAW phase in ms; tiles at the view's zoom, then one
level past it):

| | Seattle | Staten Island | Golmud |
|---|---|---|---|
| Pan frame, one `polygons` group | 5.1 | 12.3 | 15.5 |
| Pan frame, tiles of 256 to 512 px | 4.9 | 8.2 | 4.0 |
| Pan frame, tiles of 128 to 256 px | 4.8 | 7.3 | 3.7 |
| Draw calls, one group | 775 | 526 | 42 |
| Draw calls, tiles of 128 to 256 px | 782 | 560 | 132 |

A hover on one polygon at Staten Island went from 8 ms to about 1. The smaller tiles were chosen for
that: with the bigger ones the fullest tile there still held 3,232 polygons, with the smaller ones
194. GPU time didn't change with the extra draw calls.

### OSM lines and points are split too

Since Nov 19. In Užice all 49,259 points were one group and level 0 of the lines held 18,882, and
Pixi collected the whole group again whenever one of its features was made, removed, shown, hidden
or (for a line) drawn again: 35 ms of DRAW for one changed line or one new point, on every frame
that had one. That's a hover, each frame of a drag, and every frame of a load or a pan that makes
features (`graphics-system.md` section 10).

**What a render group costs, and what it saves.** Pixi's DRAW phase does two things with a group:
- It **builds** the group's list of instructions and its vertex buffer, only when the group's
  structure changed. That walks everything in the group, so it costs what the group holds, not
  what changed.
- It **replays** the list, on every frame: the group's matrix, a vertex array to bind, one draw
  call per batch. No vertices are touched. Each group costs a few microseconds here.

So more, smaller groups cost a little on every frame and save a lot on the frames where something
changed. A frame of Užice replays about 3,400 draw calls in 6 ms.

**Lines** (`_lineTileContainer()`): a container per level, road class and tile.
- Lines are drawn in the order of their road class (`zIndex`, from `HIGHWAYSTACK`; 0 for whatever
  isn't a highway). The containers of one level are ordered by class first, so that's kept exactly.
- Within a class: lines bigger than a tile (`<class>/large`), then the tiles by row and column,
  and within a tile by the way's ID. Before, lines of one class were drawn in the order their
  features were made.

**Points** (`_pointTileContainer()`): a container per tile, for points, vertices and the POI pins.
*(Since Nov 23 the layer's batch draws them, in one draw call, from north to south everywhere:
see `graphics-system.md` section 15, step 8. The tiles hold the few points that draw themselves,
and what follows is how those are ordered.)*
- Points are drawn from north to south, so that a pin overlaps the pins above it on the map. The
  tiles' containers are ordered by row, and points within a tile as before.
- **Not kept: two tiles side by side.** Where points overlap across the edge between them, the
  eastern tile's are on top, whichever is further south. In Užice at z16 that's 21,332 of the
  2,248,374 pairs of points that overlap (1%). Rows of tiles would have kept the order exactly,
  and were measured first: Užice's points are in a few rows (12,870 of them in one row of 128 px),
  and a pan sideways shows and hides points in every row at once.
- Points with viewfields go in a `viewfields` container above the tiles, as they were above the
  other points.

The tiles are at the view's zoom, rounded down (256 to 512 px on screen): twice the polygons'
size, because lines are split by class too.

**The picture is the same on every load now.** Tile containers used to be drawn in the order they
were made, and so were lines of one class. Since features are made over several frames, that order
depended on timing: two loads of the same place differed in 15,000 to 34,000 of 5 million pixels
(overlapping polygons from different tiles, lines of one class that cross, pins). Polygon tiles
are ordered by row and column now too, and two loads differ in 4 to 660 pixels.

What it changed (dev build, from tapes; DRAW in ms):

| Užice | Before | After |
|---|---|---|
| One line drawn again (a hover, a frame of a drag) | 36 | 8 |
| One line made | 35 | 8 |
| One point made | 35 | 10 |
| One point drawn again | 5 | 6 |
| A frame of the first pan that makes features (median) | 80 to 95 | 11 |
| Every feature made again (`layer.reset()`): DRAW in all | 3.0 s | 1.5 s |
| A frame that only moves the view | 5.8 | 7.4 |
| Render groups in the scene | 207 | 581 |
| Draw calls | 3,193 | 3,437 |

| A frame that only moves the view (`bun run measure`) | Seattle | Staten Island | Užice |
|---|---|---|---|
| DRAW before | 1.6 | 2.5 | 6.1 |
| DRAW after | 2.9 | 4.3 | 7.2 |
| A frame with a pass, while gliding: before | 37 | 86 | 241 |
| A frame with a pass, while gliding: after | 26 | 62 | 210 |

(One run each, medians of 9 frames. In another session Seattle's view-only frame measured 1.4 to
2.2 ms after the split, over 300 frames.)

### What's left

- ~~A pan still rebuilds the groups that have a feature scrolling in or out, and culling changes
  some feature's `visible` on every frame.~~ **Done for the OSM layer (Nov 19).** At Staten Island
  even a 2 px pan flipped 30 to 50 features, and a rebuild costs the same whether 1 feature changed
  or 1,800. The answer was to cull less often, not more cleverly: the OSM layer has features ready
  for a box bigger than the view, and leaves them alone while the view moves inside it. See "The
  cull box" in `graphics-system.md`. Other layers still cull on every frame.
- **Pixi's own culling doesn't help here.** `Culler` (and `CullerPlugin`) walks every `cullable`
  object on every frame, tests its bounds against the screen, and sets `culled`, which marks the
  render group changed exactly as `visible` does. We already know what's in view from the spatial
  index without touching what isn't.
- ~~Lines and points are still one group each.~~ **Split by tile (Nov 19)**, see "OSM lines and
  points are split too" above.
- **Every render group costs a few microseconds on every frame**, changed or not (its matrix, a
  vertex array to bind, at least one draw call). The split added 1 to 2 ms to a frame that only
  moves the view, at Seattle as much as in Užice. A class of lines with a handful of members doesn't need a container per tile:
  splitting only the classes that are big would get most of that back. Not tried.
- **Halos and other things that come and go could live in the `ui` group**, so that hovering never
  touches a big group. *(Done, Nov 23: halos are one batch in the `ui` group, and a hover's glow is
  in a small batch beside what it's around. See section 15 of `graphics-system.md`, step 10.)*

## 4. Later

- **Reordering spatial IDs.** With an explicit `zIndex` per spatial container, lifting OSM above the
  datasets while drawing, or a layer-order UI, is a `zIndex` write. We don't reorder while drawing by
  default: with the datasets non-interactive, the OSM line under a muted already-mapped line is
  reachable anyway, and that muted line staying visible is the point of the setting. Reordering is a
  visual preference, which is where a layer-order UI would belong.
- **Snapping by geometry.** The OSM layer's features are found through the spatial index now
  (section 2), but each still answers with its drawn hit area, so the answer is what Pixi gave.
  Choosing by distance instead (the nearest line, a vertex before a line) would make snapping
  independent of stroke width and z-order, and would make "don't snap to the segment next to the
  active node" (commented out in `HoverBehavior`/`DrawBehavior`) easy. A redesign of hover and
  snapping; noted as the direction, not planned.
