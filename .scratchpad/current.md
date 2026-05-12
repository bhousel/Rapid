# Current Work

## Branch: `render_worldcoord`

Partial migration from legacy screen-coord rendering (`PixiGeometryPart` / `setCoords()`) to
native z16 world-coordinate rendering (`GeometryPart` / `.geometry = part` API).

### Completed so far
- `world` Pixi container added to GraphicsSystem scene graph; `stage → origin → world → groups → features`.
- `world.position` + `world.scale` math is correct (see decisions.md "Pixi World-Coord Rendering").
- `PixiFeaturePoint.updateWorld`: renders, counter-scales sprites to screen size, counter-rotates bearing. Hit area and halo already work (they operate in local counter-scaled space).
- `PixiFeatureLine.updateWorld` + `updateWorldGraphic`: renders strokes with world-local widths (`px × 2^(WORLD_ZOOM - zoom)`). Dash spacing pre-scaled the same way.
- `PixiFeaturePolygon.updateWorld`: renders strokes + full fill + partial fill mask + lowRes sprite + SSR.
- Groups `points`, `qa`, `streetview` placed under `world` container in PixiScene.
- 12+ layer files migrated: KartaPhotos, KeepRight, MapRoulette, MapillaryDetections, MapillaryPhotos, MapillarySigns, OsmNotes, Osmose, StreetsidePhotos, CustomData, Osm, Rapid.
- `PixiLayerLabels.render` early-returns (`return; // not yet`) — labels are invisible but don't crash.
- 3066 tests pass, `bun tsc --noEmit` clean, build green.

### In progress / next steps

- ~~Step 1 (hit areas + halo): complete (`9d46afca3`)~~
- ~~Step 2 (polygon partial fill / mask / lowRes / SSR + use local.coords): complete (`f1a5296f3`)~~

**Step 3 — Inventory remaining `setCoords` callers, migrate remaining layer groups**
- `basemap`, `labels`, `blocks`, `ui` groups still under `origin` (screen coords).
- `background` (tile imagery) stays under `origin` permanently — it's tile-based, not entity-based.
- Priority: `basemap` → `labels` (blocked on basemap) → remaining groups.

**Step 4 — Port PixiLayerLabels to world coords**
- Label positions are stable across panning in world coords (only zoom/rotation invalidates). The existing `tCurr.z !== tPrev.z || tCurr.r !== tPrev.r` invalidation guard becomes the only needed trigger.
- Text labels (point labels): add counter-scale container so text stays screen-sized.
- Rope labels: compute rope coords in world-local space, use counter-scaled sprite children.
- Avoidances cache (`_placement`, `_avoided`) can survive pan — should reduce per-frame work.

**Step 5 — Delete PixiGeometryPart (the payoff)**
- Remove `PixiGeometryPart`, `geom` field from `AbstractPixiFeature`, all `setCoords` callers and `geom.screen.*` reads.
- Collapse dual paths in each feature class into a single `update()`.
- ~500+ lines deleted.

### Key notes for handoff
- `_geom` (GeometryPart) is the new path; `geom` (PixiGeometryPart) is the legacy path. Branch on `if (this._geom)` in feature `update()` methods.
- `container.position` is set to `world.origin` (extent center in z16 world coords). All vertex drawing is origin-relative (small local numbers).
- `viewport` param in `updateWorld()` is currently unused — left for signature symmetry with legacy path; will drop in Step 5.
- `_bufferdata = null` + `container.hitArea = null` in current world path = placeholder; Step 1 fills these in.
- `PixiLayerLabels.render` has `return;` at line 307 as a safe early-out. Remove once Steps 3+4 are done.

