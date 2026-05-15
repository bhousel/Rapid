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
- DashLine made scale-aware: `scale` option converts local-coord widths/dashes to screen pixels. Line/Polygon halos use `scale: localScale`; Point halos use default `scale: 1` (container already counter-scaled).
- Zoom usage clarified: `viewZoom = viewport.transform.zoom` for scale chain math; `styleZoom = map?.effectiveZoom() ?? viewZoom` for LOD/styling thresholds. Every layer and feature file now uses the correct zoom for each purpose.
- `MapSystem.effectiveZoom()` simplified: replaced redundant `geoMetersToLon(1,lat)/geoMetersToLon(1,0)` ratio with direct `extraZoom = -log2(cos(lat * DEG2RAD))`; `geoMetersToLon` removed from the import.
- ~~Step 5 halo fixes committed as `ba78d87d2`~~
- `bun tsc --noEmit` clean.

### In progress / next steps

- ~~Step 1 (hit areas + halo): complete (`9d46afca3`)~~
- ~~Step 2 (polygon partial fill / mask / lowRes / SSR + use local.coords): complete (`f1a5296f3`)~~
- ~~Step 3 (migrate basemap + remaining setCoords callers): complete (`bdfa56684`)~~
- ~~Step 4 (PixiLayerLabels world-coord geometry): complete (`b3f5c4417`)~~
- ~~Halo dash fixes + zoom type cleanup: complete (`ba78d87d2`)~~

**Step 5 — Delete PixiGeometryPart (the payoff)**
- Remove `PixiGeometryPart`, `geom` field from `AbstractPixiFeature`, all `setCoords` callers and `geom.screen.*` reads.
- Collapse dual paths in each feature class into a single `update()`.
- ~500+ lines deleted.

### Key notes for handoff
- `_geom` (GeometryPart) is the new path; `geom` (PixiGeometryPart) is the legacy path. Branch on `if (this._geom)` in feature `update()` methods.
- `container.position` is set to `world.origin` (extent center in z16 world coords). All vertex drawing is origin-relative (small local numbers).
- `viewport` param in `updateWorld()` is currently unused — left for signature symmetry with legacy path; will drop in Step 5.
- **Zoom naming convention**: `viewZoom = viewport.transform.zoom` (scale math); `styleZoom = map?.effectiveZoom() ?? viewZoom` (LOD/styling). `PixiFeaturePolygon` has no LOD thresholds, so it uses only `viewZoom` — that's intentional.

