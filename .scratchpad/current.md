# Current Work

## Active

### Validator classes (schema-aware lifecycle)
Validators are still factory functions instantiated once at init time. They now use **time-of-use** access for schema prerequisites (variables, rulesets) — lookups happen inline when needed, not hoisted to factory scope. Guard patterns vary by validator file (optional chaining, nullish coalescing, early returns).

The longer-term fix is converting validators to proper classes with lifecycle management (subscribe to `schemachange` events, refresh cached prerequisites).

### Deferred styling work
- Move PixiLayerRapid's hardcoded styles into the style asset file (colors are currently dynamic from `dataset.color`)
- Have PixiLayerRapid call `styleMatch()` with a dataset/scope ID
- Per-dataset schema querying (different presets for Rapid vs OSM data)

### Performer-inspired statistics display
- HUD overlay showing frame timing (APP/DRAW split), scene complexity, draw calls, texture usage, queue depth
- Data sources: `scheduler.metrics`, GraphicsSystem performance marks (already in place, commented out), Pixi renderer stats, `scheduler.numPending`
- Inspiration: SGI Performer's `pfStats`/`pfFrameStats` system (Chapter 23 of Performer Programmer's Guide)

## Recently Completed (one-liners)
- **SchedulerSystem Phase 5: Backpressure** (Mar 2026) — Frame timing metrics (EMA of frame/render/idle time), dropped-frame ring buffer (60-frame window), pressure levels (none/light/moderate/heavy) with hysteresis, `'pressure'` event emission, idle queue throttling under pressure. 117 scheduler tests. See `.github/design/scheduler-system.md`.
- **SchedulerSystem Phase 4a: Migrate lodash debounce/throttle** (Mar 2026) — Migrated all lodash `debounce`/`throttle` call sites (22 across 16 files) to SchedulerSystem's workID-keyed API. Added `leading` option to `throttle()`. Zero lodash debounce/throttle imports remain. Services use `if (shouldDebounce && scheduler)` fallback pattern so requests still fire when scheduler is absent. `scheduler` added to `optionalDependencies` in OsmService, TaginfoService, OsmWikibaseService.
- **SchedulerSystem Phase 4: Unified Timer API with workID** (Mar 2026) — Added workID-keyed timer methods: `setTimeout`, `setInterval`, `debounce`, `throttle` with timer float (tasks enter priority queue instead of firing directly). `cancel(workID)` and `cancelAllTimers()` for named cancellation. Debounce supports `leading` option; setTimeout supports `exact` bypass. See `.github/design/scheduler-system.md`.
- **SchedulerSystem Phase 3: Frame-Aware Idle Execution** (Mar 2026) — Replaced `requestIdleCallback` backing with internal priority queues (urgent > normal > idle) drained per-frame within remaining budget. New `schedule(fn, opts)` API; `scheduleIdleTask` is now a convenience wrapper. `targetFrameTime` property (default ~16.7ms). Removed all rIC/cIC usage. 72 tests passing. See `.github/design/scheduler-system.md`.
- **SchedulerSystem Phase 2: Own the Game Loop** (Mar 2026) — SchedulerSystem now owns the `requestAnimationFrame` loop. GraphicsSystem registers `_tick(deltaMS)` as a frame callback. `PIXI.Ticker.shared` no longer used. Frame callbacks: `addFrameCallback(id, fn)` / `removeFrameCallback(id)`. Loop stops on pause, restarts on resume. rAF polyfill added for test env. 60 tests passing. See `.github/design/scheduler-system.md`.
- **SchedulerSystem Phase 1: Foundation** (Mar 2026) — Created SchedulerSystem with managed `scheduleIdleTask`, `scheduleTimeout`, `scheduleInterval`. Migrated all `requestIdleCallback` usage. Auto-cleanup on `resetAsync()`. `d3-timer`/`d3-transition` flagged as future migration targets (49 `.transition()` call sites in UI code).
- **Validators folder rename** (Mar 2026) — `modules/validations/` → `modules/validators/`, `duplicate_way_segments` → `duplicate_segments`. Tests moved to `test/unit/validators/`. All imports updated.
- **Validators TS conversion + JSDoc** (Mar 2026) — All 19 validator files converted to TypeScript. `types.ts` added with `ValidatorFunction`, `ValidatorFactory`, and `ValidatorResult` types. `ValidatorResult` is now `{ issues, provisional? }` (not array-with-flag). Factory names use `validate*` prefix, inner functions use `validator` variable. `D3Selection` typing on all `showReference` parameters. Entity narrowing pattern applied. `CrossingInfo`/`WayInfo` types in `crossing_ways.ts`.
- **Data class renames** (Mar 2026) — `Tags` → `OsmTags`, `GeoJSON` → `GeoJSONData`, `Marker` → `MarkerData`. Reduces ambiguity with `@types/geojson` namespace.
- **Context lifecycle split** (Mar 2026) — `prepareAsync()` → `initAsync()` → `startAsync()` → `run()`. Breaking change: simple consumers use `context.run()`.
- **JSON Schema validation** (Mar 2026) — 13 schemas in `data/schema/`, validated via `bun run validate:json`.
- **Scope-owned tag rulesets** (Mar 2026) — All tag globals eliminated. Rulesets on `SchemaScope`, accessed via `schema.getScope('osm')?.rulesets.get(id)`. `tags.ts` deleted.
- **Variables system** (Mar 2026) — `Variable` class with `var()` refs in both SchemaSystem and StyleSystem. Dual-props pattern for resolution.
- **Scoped customization** (Feb 2026) — `_scopes: Map<ScopeID, ScopeData>` is sole source of truth in both StyleSystem and SchemaSystem. `'*'` common scope for fallbacks.
- **Dynamic styling fixes** (Feb 2026) — `dirtyScene()` before redraw, removed hardcoded marker styles, selective fallback cascading, single `styleDefaults`.
- **Services TS conversion** (Feb 2026) — All 19 service files converted. Generic `MarkerData<P>` / `GeoJSONData<P>` for typed props.
- **`isForwardOneWay()` / `isBackwardOneWay()`** — Still TODO on OsmWay.
