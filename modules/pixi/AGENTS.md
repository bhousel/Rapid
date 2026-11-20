# Pixi Module Guidelines

Guidelines for working with the `modules/pixi/` folder.
(For an overview of what's in this folder, see [`README.md`](README.md).)

## Pixi's reference skill, and where Rapid differs

Pixi ships an agent skill with the version we have installed: `node_modules/pixi.js/skills/pixijs/SKILL.md`.
Before you write or change Pixi API code, read `SKILL.md` and the topic files it routes you to (e.g.
`references/scene-graphics.md`). It knows the v8 API, its silent pitfalls and its performance traps
better than memory does, and it matches the installed version.

The skill is written for a typical Pixi app. Rapid departs from that on purpose in a few places. Where the
skill and Rapid disagree, follow Rapid, and don't "fix" these:
- **No Pixi ticker.** `GraphicsSystem` destroys the `Application` ticker; `SchedulerSystem` runs the frame
  loop, and Rapid renders only when something changed. Don't add `app.ticker` callbacks or call
  `app.render()` from a layer or feature: mark it dirty and let the next frame draw it.
- **Nothing renders inside `render()`.** `renderer.generateTexture()` calls `renderer.render()`, which
  corrupts a render already in progress, so texture work is queued through the scheduler (see
  `PixiLayerLabels`).
- **Textures come from `PixiTextures`**, which packs icons, symbols and tiles into its own atlas. Don't
  use `Texture.from()` or `Assets.load()` for them (only area patterns use an `Assets` bundle).
- **Features draw in z16 world coordinates**, under the `origin` and `world` containers, positioned at
  their extent's center. Line widths and dash lengths are in world units (`localScale`), and points
  counter-scale to stay screen-sized. The skill's screen-pixel examples need converting. See
  "Pixi World-Coord Rendering" in [`knowledge/decisions.md`](../../knowledge/decisions.md).
- **Dashed lines use Rapid's `lib/DashLine.ts`** (texture-based, works with plain `Graphics`). Pixi's
  `DashLineShader` needs `SmoothGraphics`, and a context with it is never batched.
- **Render groups go through `PixiScene.worldContainer()`.** The skill says to put a panning world in
  `new Container({ isRenderGroup: true })`. Ours is in z16 world coordinates, which are too big for the
  32-bit floats a render group keeps its vertices in: shapes come out distorted, more so when zoomed
  in and further east. Make containers for features with the layer's `_spatialContainer()` and
  `_childContainer()`; each gets a render group at an anchor near the view. Never set `isRenderGroup`
  on a container whose children are in world coordinates. See "Render groups" in
  [`design/scene.md`](../../design/scene.md).
- **Pointer events go through `PixiEvents` and Rapid's behaviors.** Pixi's `globalMove` and `wheel`
  events are off (`eventFeatures` in `GraphicsSystem._initPixi()`), and the mode decides which
  subtrees can be hit (`interactiveSpatialIDs`, see [`design/scene.md`](../../design/scene.md)).
  Don't add pointer listeners to features, and don't listen for `globalpointermove`: with
  `globalMove` on, every pointer move visits every interactive object in the scene.
- **After `scene.setClass()` or `unsetClass()`, ask for a frame with `gfx.requestFrame()`,** not
  for a redraw. The scene tells the layers which data changed class, and the OSM layer draws
  that data's features again without its pass (`PixiLayerOsm._renderChanged()`): a hover in
  Užice costs 3 ms of APP that way, and 175 with `immediateRedraw()`.
- **For an edit, `scene.dataChanged('osm', ids)` and `gfx.requestFrame()`,** with everything the
  edit affects (`Difference.complete()`). `MapSystem` does this for `stagingchange`. The layer
  draws those entities again without its pass; `scene.dirtyData()` still means "do the pass".
- **For data that arrived, `scene.dataArrived('osm', ids)` and `gfx.requestFrame()`.**
  `MapSystem` does this for `merge`. The layer sorts and draws it when its frames have time.
  A service whose data another layer draws names that layer: `gfx.deferredRedraw('mapillary')`.
- **Destroy the Pixi objects you replace.** `removeChildren()` and assigning a new
  `mesh.geometry` leave the old ones alive: Pixi keeps what it built for them until they're
  destroyed, or until its own collector finds them unused a minute later. After a zoom that
  was 550 MB. (`for (const child of parent.removeChildren()) child.destroy();`, and
  `geometry.destroy(true)`: a `Mesh` doesn't destroy its geometry either.)
- **In a loop over every feature, don't make an object per feature.** Iterate
  `map.values()`, not `for (const [id, feature] of map)`. Don't work out a shape that only a
  hover or a click needs (`BufferHitArea`). Garbage is what brings the half-second collections
  (`design/graphics-system.md` section 13).
- **Put an OSM feature in its tile's container with `_setTile()`**, not by setting
  `parentContainer`. After the view crosses a whole zoom level, features move to the new zoom's
  tiles a whole old tile at a time (`_retile()`), and a feature moved on its own in between
  makes Pixi rebuild both tiles.
- **The OSM layer's pass doesn't see every vertex.** It leaves out the ones that only shape
  their way (`OsmNode.vertexKind()`), and adds the ones related to what's selected or hovered
  afterwards (`_addRelatedVertices()`). Something new that should draw such a vertex has to say
  so there, and in `_isIdleVertex()` for the ones that arrive.
- **The OSM layer rarely does its whole pass now**, so don't count on one to pick something up.
  It does one when it's marked dirty (`dirtyLayer()`, `dirtyData()`: a filter, the styles) or
  when a redraw is asked for without a layer. A view that leaves the cull box isn't one, and
  neither is a zoom or a rotation: the layer follows the box (`_moveBox()`), and after a zoom
  it runs its features through `render…()` again over the next frames. So what a `render…()`
  function decides from the zoom is picked up there, a batch at a time, not all in one frame.
- **A change of mode asks for a frame, not a redraw** (`Context.enter()`). If a mode changes
  what the map shows, it has to reach the layers: through a class, an edit, a redraw request of
  its own, or (for something a layer draws in one mode only, like the OSM layer's midpoints)
  `AbstractPixiLayer.modeChanged()`.
- **Check work done without a pass against a pass.** After it, `gfx.immediateRedraw()` should
  change nothing that's shown: `osmSceneState()` in `test/e2e/fixtures.js` describes what's
  shown, for comparing before and after.
- **Pixi's accessibility layer is off** (`activateOnTab: false`): Tab moves between the UI's fields.
- **The `Application` options live in `GraphicsSystem._initPixi()`**, with reasons (`multiView` for the
  minimap, `autoStart: false`, the renderer choice from the url).

## Frames, passes and redraw requests

How a frame is made, the CULL pass, frame pacing and the frame's deadline are in
[`design/graphics-system.md`](../../design/graphics-system.md) (sections 1, 3, 8, 9 and 10). The
rules that come out of it:

- **A layer's `render()` and `cull()` take the `RenderFrame`**, and so does `retainFeature()`. Pass it
  on to the layer's own `render…()` helpers.
- **A redraw request means something changed. Name the layer if only one did.**
  `gfx.deferredRedraw()` and `gfx.immediateRedraw()` make every layer do its whole pass on the next
  frame. When what changed is drawn by one layer only (a tile of imagery arrived, a label texture
  was made, a dataset's data loaded), pass that layer's ID: `gfx.deferredRedraw(this.id)`. Then
  layers like OSM can keep their features as they are.
- **Every change to what a layer draws needs a redraw request.** Moving the view doesn't make one,
  and the OSM layer skips its pass on frames that come only from a move. Marking features dirty
  (`dirtyScene()`, `dirtyLayers()`, `dirtyData()`) makes their layer do its next pass, but doesn't
  ask for a frame. Changing a class (`scene.setClass()`) tells the layers which data it was, and
  doesn't ask for a frame either: follow it with `gfx.requestFrame()` (above).
- **A layer that can skip its pass gathers by `frame.cullBox`, not by the view.** The box is the
  view and padding around it. Call `this.keepFeatures(frame)` in `render()`, after anything that
  must happen on every frame (asking the service for the view's tiles), and return if it says
  `true`. Only the OSM layer does this so far. Don't use it in a layer whose features depend on the
  view itself (the labels, the imagery tiles).
- **Count work in passes, not frames.** `cull()` destroys a feature after 20 passes without seeing
  it, and a layer that kept its features did no pass.
- **Work out a feature's style when `feature.needsStyle` says so, not when it's `dirty`.** A zoom
  makes every feature dirty (it has to be drawn again), but what it is hasn't changed, and matching
  a style to tags costs several times what drawing does. Keep under `if (feature.dirty)` only what
  depends on the zoom or the rotation.
  ```ts
  if (feature.needsStyle) {
    feature.style = styles.styleMatch(entity.tags, geometry, 'osm');
    feature.label = l10n.displayName(entity.tags);
  }
  this.updateFeature(feature, frame, viewport);   // draws it now, or in a later frame
  this.retainFeature(feature, frame);
  ```
- **For a new zoom or rotation, `scene.dirtyTransform()`. For anything else, `scene.dirtyScene()`**
  (or `dirtyLayers()`, `dirtyData()`): those say the features themselves may have changed, and
  set `needsStyle`.
- **In a layer that keeps its features, draw with `this.updateFeature(feature, frame, viewport)`,**
  not `feature.update(viewport)`, and call `this.continueWaiting(frame, viewport)` on the frames
  where `keepFeatures()` says yes. A feature may then be drawn a few frames late (section 10), so
  don't read anything off a feature that's still `dirty` (its bounds, its hit area).
- **A feature may not exist yet for data the layer has seen.** The OSM layer puts off making
  features that aren't needed at once (`_waitToMake()`), and makes them over the next frames.
  Code that looks a feature up right after data arrives should wait for `gfx.pending` to be
  `false`, or handle it not being there.
- **Go easy on the OSM API when measuring.** `bun run measure --fresh` and every reload of the
  debug Chrome ask it for 20 to 36 map tiles. After enough of them it answers 429 (five loads of
  Užice in an hour and a half did it), and the map stays empty until the time it gives is up. To
  make features again without the network, use `layer.reset()`. To load a place again and again,
  record it once: `--tape places.tape.json` on `bun run measure` and `bun run compare`
  (`scripts/tape.ts`).
- **A redraw request without a layer is a pass in every layer.** In a dense place that's 200 ms
  of the OSM layer walking everything it has, to find the little that changed. Don't make one
  for each item of something that arrives in hundreds (each icon, each tile of another layer):
  name the layer, or go on with waiting work (below).
- **When a texture arrives, call `scene.texturesLoaded()`, not `deferredRedraw()`.** A feature
  drawn without its icon stays dirty (`PixiFeaturePoint.updateStyle`), and a layer that draws
  with `updateFeature()` remembers it. `texturesLoaded()` has those drawn again over the next
  frames, and asks for a frame (`gfx.requestFrame()`), not for a pass.
- **A layer's `render()` can run 60 times a second.** While the view moves, a frame is drawn on
  every tick. Whatever a layer does before `keepFeatures()`, and everything in a layer that doesn't
  call it, is paid on each one. The same goes for listeners to `gfx`'s `draw` event: throttle them
  (`scheduler.throttle()`).
- **`immediateRedraw()` is for something the user did.** It skips the wait that spaces out
  expensive frames. With a layer's ID, only that layer is drawn at once (in a held frame, if a pass
  is waiting). For data that arrived, use `deferredRedraw()`.
- **Don't change the frame loop's timing without measuring it.** `bun run measure` reports frames
  a second and long animation frames while the view moves on every animation frame (`glide`), and
  section 9 has a real drag and a load to compare with. `FramePacer` holds the rule and has unit
  tests; `test/e2e/rendering.test.js` checks it in a browser.

## Working with Services

All services are now TypeScript. Access them via `context.services` with proper types:
- Use optional chaining since services may not be instantiated: `const mapillary = context.services.mapillary;`
- Or use non-null assertion if you know the service exists: `const osm = context.services.osm!;`
- Import the service type if needed: `import type { MapillaryService } from '../services/MapillaryService.ts';`

All core systems ARE now TypeScript - use non-null assertion:
- `const photos = context.systems.photos!;`
- `const editor = context.systems.editor!;`

Use `!` for systems that definitely exist when the code runs. Only use `?.` for truly optional dependencies.

## Viewport Type

Import `Viewport` from `@rapid-sdk/math`, not from `pixi-viewport`:
```typescript
import type { Viewport } from '@rapid-sdk/math';
```

## Style Objects

### Getting Styles from StyleSystem

For OSM features (polygons, lines, vertices, points), always get the base style from `StyleSystem.styleMatch()`:

```typescript
const styles = context.systems.styles!;
const style = styles.styleMatch(entity.tags, geometry) as MatchedStyle;

// Then apply any necessary overrides
if (node.hasInterestingTags()) {
  style.marker.image = 'taggedCircle';
}
feature.style = style;
```

**Why:** `styleMatch()` returns a fully resolved style with:
- Defaults filled in from `styleDefaults`
- Fallback cascading (base.color → marker.color, etc.)
- Selector-based style matching (highway=primary → road_primary style)
- Structure overrides (bridge, tunnel, surface)
- Lifecycle overrides (abandoned, proposed, etc.)

**Don't** construct hardcoded style objects when `styleMatch()` could be used:
```typescript
// BAD - bypasses styleMatch(), ignores custom styles
const markerStyle: Partial<MatchedStyle> = {
  icon: { image: iconName, color: 0x111111, opacity: 1, size: 11 },
  marker: { image: 'smallCircle', color: 0xffffff, opacity: 1 }
};
```

### Constant Styles for Non-OSM Features

For non-OSM layers (photos, QA issues, debug overlays), define constant style objects. All style properties are **optional** — use type assertions:

```typescript
import type { MatchedStyle } from '../core/StyleSystem.ts';

const LINESTYLE = {
  casing: { alpha: 0 },
  stroke: { alpha: 0.7, width: 4, color: 0x0fffc4 }
} as Partial<MatchedStyle>;

const MARKERSTYLE = {
  marker: { image: 'mediumCircle', color: 0x0fffc4, opacity: 0.8 }
} as Partial<MatchedStyle>;
```

Style type interfaces are defined in `modules/lib/Style.ts`:
- `StyleProps` — Full style with all property groups
- `FillStyleProps` — Area fill (color, opacity, width, pattern)
- `LineStyleProps` — Line casing/stroke (color, opacity, width, cap, join, dash)
- `PointStyleProps` — Marker, icon, lineMarker, sidedMarker (color, opacity, image, size, anchor, scale)
- `ViewfieldStyleProps` — Extends PointStyleProps with `angles` array
- `LabelStyleProps` — Label (color, opacity, size)

The resolved style returned by `StyleSystem.styleMatch()` is a `MatchedStyle` (defined in `modules/core/StyleSystem.ts`).

## D3 Selection Types

D3 selection variables follow a naming + typing convention:
- Variables prefixed with `$` are D3 selections — type them as `D3Selection`
- Variables prefixed with `$$` are D3 _enter_ selections — type them as `D3EnterSelection`
- Import from `'d3-selection'`: `import type { D3EnterSelection, D3Selection } from 'd3-selection';`
- For `merge()` calls combining a selection with an enter selection, cast to `D3Selection`:
  ```typescript
  $label = $label.merge($$label) as D3Selection;
  ```
- Avoid using `as any` for D3 selection code — use these types instead

## Type-Only Imports

When importing data classes (`GeoJSONData`, `MarkerData`) only for type annotations, use `import type`:
```typescript
import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { MarkerData } from '../data/MarkerData.ts';
```

## Binding Data to Features

Data is never changed in place: a change is a new object (`d.update(...)`), with a new `Geometry`.
So a layer binds a feature's data and geometry part whenever either is a different object, not only
when it creates the feature. Style that depends only on the layer can stay in the creation block.

```typescript
if (!feature) {
  feature = new PixiFeaturePoint(this, featureID);
  feature.parentContainer = parentContainer;
}

if (feature.data !== d || feature.geometry !== part) {   // changed data is a new object
  feature.geometry = part;
  feature.data = d;
}
```

- Don't compare version numbers (`v`): there is no `feature.v`, and nothing changes a datum's `v` in place.
- OSM ways and relations: take the part from `graph.geometry(entity).parts[i]`, never `entity.geoms`
  (it throws for them). See `PixiLayerOsm` and [`design/graph-geometry.md`](../../design/graph-geometry.md) section 4.
- Setting `feature.data` marks the feature dirty, so it's restyled on the next `update()`. Changes
  that don't make a new object (e.g. a vertex becoming shared) are marked with `scene.dirtyData()`.

## Filtering Data (MarkerData, GeoJSONData, etc.)

When filtering `MarkerData` or `GeoJSONData` data, always access `.props` for filterable data (not `.properties`):

```typescript
filterMarkers(markers: MarkerData[]): MarkerData[] {
  return markers.filter(marker => {
    const props = marker.props;
    // Check types before using values
    const capturedAt = props.captured_at;
    if (typeof capturedAt === 'number' || typeof capturedAt === 'string') {
      const timestamp = new Date(capturedAt).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
    }
    return true;
  });
}
```

Key points:
- Use `marker.props` or `sequence.props` (not `.properties`)
- Extract values into variables and check their types before using
- Cast when needed: `props.captured_by as string`

## D3 Selection Callbacks

D3's `.data()` and other selection methods have complex generic signatures. TypeScript often can't infer the datum type in callbacks. Explicitly annotate callback parameters:
```typescript
.data(blocks, (d: GeoJSONData) => d.id)
.text((d: GeoJSONData) => d.props.text as string)
```

