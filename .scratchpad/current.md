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
- Groups `points`, `qa`, `streetview`, `basemap`, `blocks`, `debug`, `ui` placed under `world` container in PixiScene.
- All layer files migrated: KartaPhotos, KeepRight, MapRoulette, MapillaryDetections, MapillaryPhotos, MapillarySigns, OsmNotes, Osmose, StreetsidePhotos, CustomData, Osm, Rapid, EditBlocks, Debug, Labels, MapUI, and remaining.
- `PixiLayerLabels` fully migrated to world-coord geometry (step 4): label positions computed in world space, rope labels use world-local coords, zoom/rotation invalidation guard kept.
- DashLine made scale-aware: `scale` option converts local-coord widths/dashes to screen pixels. Line/Polygon halos use `scale: localScale`; Point halos use `useTexture: false` for exact CSS-pixel dash sizes (bypasses `textureSpace: 'global'` matrix complexity).
- 3066 tests pass, `bun tsc --noEmit` clean, build green.

### In progress / next steps

- ~~Step 1 (hit areas + halo): complete (`9d46afca3`)~~
- ~~Step 2 (polygon partial fill / mask / lowRes / SSR + use local.coords): complete (`f1a5296f3`)~~
- ~~Step 3 (migrate basemap + remaining setCoords callers): complete (`bdfa56684`)~~
- ~~Step 4 (PixiLayerLabels world-coord geometry): complete (`b3f5c4417`)~~

**Pending commit — halo fixes (uncommitted)**
- `PixiLayerMapUI.reset()`: iterate `[...children]` snapshot (live array was being spliced during iteration).
- `AbstractPixiFeature.destroy()`: `halo.destroy({ children: true })` (children were leaking).
- `PixiFeatureLine` / `PixiFeaturePolygon` halos: typed `haloParent` access, `scale: localScale` in `HALO_STYLE`.
- `DashLine.ts`: fix `textureSpace` to `'global'`, store the pow2-padded texture dimensions on the instance (`texW`, `texH`), and use them to non-uniformly scale the per-segment matrix so one full cycle covers exactly `dashSize * userScale` local units along the line and `width * userScale` perpendicular — regardless of pow2 padding, container transform, or segment length. (Pow2 padding kept for WebGL1 REPEAT-wrap support.) Matrix composition reordered to scale-then-rotate (non-uniform scale requires this to keep the texture-x axis aligned with the line direction).

**Step 5 — Delete PixiGeometryPart (the payoff)**
- Remove `PixiGeometryPart`, `geom` field from `AbstractPixiFeature`, all `setCoords` callers and `geom.screen.*` reads.
- Collapse dual paths in each feature class into a single `update()`.
- ~500+ lines deleted.

### Key notes for handoff
- `_geom` (GeometryPart) is the new path; `geom` (PixiGeometryPart) is the legacy path. Branch on `if (this._geom)` in feature `update()` methods.
- `container.position` is set to `world.origin` (extent center in z16 world coords). All vertex drawing is origin-relative (small local numbers).
- `viewport` param in `updateWorld()` is currently unused — left for signature symmetry with legacy path; will drop in Step 5.

