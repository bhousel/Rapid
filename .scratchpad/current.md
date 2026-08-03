# Current Work

## UI System modernization (2026-07-29) — branch `ui_refactors`

- Added design doc: [.github/design/ui-system.md](../.github/design/ui-system.md)
- Plan: convert ALL of `modules/ui/` (~130 files) to TypeScript class components following the
  newest conventions (`UiMapToolbar`/`UiSystem` shape) — idempotent render, relocalization-safe,
  lifecycle-aware. Dependency-first phasing (foundational primitives → fields → sidebar → QA
  editors → panes → toolbar/cards → rapid/dialogs → intro → barrels).
- Quarantined: `sections/*.jsx` React demo (only a commented import). Disabled `field_help.js` /
  `fields/restrictions.js` will be converted too (un-commented later). Barrels (`index.js`) last.
- **Key finding:** `moduleResolution: bundler` resolves `./foo.js` imports to `foo.ts` at
  type-check AND build — so `.js`→`.ts` renames need no importer-extension churn.
- **Design principle:** lifecycle components (render into a `$parent`, own state/events) → TS
  classes; a small set of shared, stateless DOM-builders still consumed by unconverted JS stay
  typed functions (`icon`, `toggle`, `tooltip`, `popover`, `combobox`, `form_fields`, `disclosure`,
  `section`). **Everything else is a class** (user preference: "convert to classes wherever possible").
- **Phase 1 DONE + verified**: icon, toggle, modal, confirm, loading, popover, tooltip, combobox,
  form_fields, `UiFlash` (class + `ui.Flash.show({…})`). `disclosure`/`section` kept as functions.
- **Phase 2 (field system) DONE + verified**: all `fields/*` are **TS classes** (`UiFieldAccess`,
  `UiFieldCombo`, `UiFieldText`, `UiFieldCheck`, `UiFieldRadio`, `UiFieldLocalized`, `UiFieldWikidata`,
  `UiFieldWikipedia`, `UiFieldTextarea`, `UiFieldLanes`, `UiFieldRoadspeed`, `UiFieldCycleway`,
  `UiFieldAddress`) + `UiTagReference`. `fields/index.ts` is a typed `uiFields` registry of **class
  constructors**; `UiField` does `new uiFields[type](...)` + `.render`. `restrictions`/`field_help`
  stay commented-out (converted, wired-but-disabled).
- **Phase 3 (sidebar/inspector) DONE + verified**: `sections/*` are classes extending a new
  `AbstractUiSection` (`UiSectionFeatureType`, `UiSectionRawTagEditor`, `UiSectionValidation*`, …);
  `UiEntityEditor`, `UiPresetList`, `UiPresetIcon`, `UiInspector`, `UiOvertureInspector`, `UiSidebar`,
  `UiFeatureList`, `UiDataEditor`, `UiDataHeader` are TS classes.
- **Filenames renamed to `CamelCase.ts`** (class name) via `git mv` for all converted components;
  barrels + import sites updated. Removed 5 untracked orphan dupes left from an earlier bad rename
  (`entity_editor.ts` etc.). Verified: tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail.
- **Learnings** (see design-doc Progress log + lessons.md): `$`-selection props must be `public`
  (lint `naming-convention` vs `$var`); always `git mv` (grep for stale sibling files after a rename
  pass); element-`this` d3 handlers → arrows via `d3_event.currentTarget` / `.each((_,i,nodes)=>…)`.
- **Next:** Phase 4 (QA / issue editors) — **DONE**: all five families converted to TS classes and
  renamed to `CamelCase.ts` (keepRight, osmose, note[+report], detection, maproulette[+menu]). Class
  shape: public `datum`, bound `render($selection)`, `on('change')` via `d3_dispatch`+`utilRebind`;
  the maproulette menu is owned by `UiSystem` (props `datum`/`anchorLoc`/`triggerType` + `close()`).
  Updated `SelectMode.ts` branches, `UiSidebar.ts`/`UiSystem.ts` sites, `ui/index.js` barrel, and two
  browser tests. Verified tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail.
- **Next up:** Phase 5 (panes & their sections + settings/*) — **DONE**: all 14 remaining `.js`
  sections → `UiSectionX` classes extending `AbstractUiSection`; `pane` → `UiPane` base class + five
  `UiPaneX` subclasses (UiMapPanes news them up); `settings/custom_*` → `UiSettingsCustom*` classes
  (consumed by the BackgroundList/DataLayers sections). All barrels + `commit.js` wired. Verified
  tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail.
- **Next:** Phase 6 (toolbar/controls/cards + many already-Level-3 root `Ui*` components → TS)
  — **SKIPPED then DONE** (converted 2026-08-01 after Phase 7).
- **Phase 7 (Rapid-specific & dialogs) — DONE + verified**: 5 already-class `UiRapid*` files JS→TS'd
  (git mv only, zero consumer changes); 12 factory functions → classes (`UiSplash`/`UiRestore`/
  `UiWhatsNew`/`UiRapidSplash`/`UiRapidFirstEditDialog`/`UiCommit`/`UiChangesetEditor`/
  `UiCommitWarnings`/`UiSuccess`/`UiConflicts`/`UiEditMenu`/`UiRapidColorpicker`). Consumers wired:
  `ui/index.js` barrel, `UiSystem.ts`, `SaveMode.ts`, `UiRapidDatasetToggle.ts`, `commit_warnings.test.js`.
  Key insight: components handed to `Sidebar.show(fn)`/`$sel.call(fn)` must pass the bound `.render`.
- **Phase 6 (toolbar/controls/cards/overmap + 24 root `Ui*`) — DONE + verified**: all 38 files were
  already ES6 classes, so pure JS→TS (git mv + types, **zero consumer changes** — same class names,
  bundler resolves `.js`→`.ts`, barrels unchanged). `cards/*` (5, `AbstractUiCard` → abstract),
  `controls/*` (4), `tools/*` (5), and 24 root components (`UiMinimap`/`UiShortcuts`/`UiSpector`/
  `UiOvermap`/`UiInfoCards`/`UiPhotoViewer`/`UiMap3dViewer`/`UiMapControls`/`UiMapPanes`/`UiMapToolbar`/
  `UiMapFooter`/`UiAttribution`/`UiContributors`/`UiSourceSwitch`/`UiProjectLinks`/`UiVersionInfo`/
  `UiViewOn`/`UiApiStatus`/`UiFilterStatus`/`UiValidatorStatus`/`UiAccount`/`UiScale`/`UiDefs`/
  `UiFullscreen`). Added `modules/types/geojson-rewind.d.ts` ambient decl. Verified tsc/eslint/build
  clean, browser 133 / unit 3290 / 0 fail.
- **Phase 8 (intro/walkthrough) — DONE + verified**: converted the walkthrough with a deliberate
  departure from the D3-component conventions (chapters are state machines, not `render($parent)`
  components). `helper.ts` (typed fns) + `UiCurtain.ts` (JS→TS) + new `AbstractIntroChapter` base
  (owns `enter/exit/restart`, the async `_runAsync` step runner, and the 4 event-wait hooks) + 8
  chapter classes (`UiIntroWelcome/Navigation/Point/Area/Line/Building/Rapid/StartEditing`) +
  `UiIntro` orchestrator class. **Promises → async/await** throughout the step machine. Wired 5
  consumers (`ui/index.js`, `UiSystem`, `UiSplash`, `UiRapidSplash`, `UiPaneHelp`) to
  `new UiIntro(context).start(...)`. Verified tsc/eslint/build clean + browser 133 / unit 3290 +
  a live browser smoke-test (walkthrough launches, nav bar, chapter switching, Points step all work).
- **Phase 9 (barrels & cleanup) — DONE. 🎉 `modules/ui/` TS conversion COMPLETE.** Fixed the
  `UiCurtain` `botom`→`bottom` typo; `git mv` the 7 `index.js` barrels → `index.ts` (no importer
  changes — bundler resolves `./ui/index.js`→`.ts`); `git rm` the 3 orphaned `panes/*.js` dupes;
  left the 2 quarantined `sections/*.jsx` (dead React demo) + disabled `UiFieldRestrictions`/`field_help`.
  No `.js` left under `modules/ui/`. AGENTS.md conversion row → ✅ Complete. Verified tsc0/eslint0/
  build/browser133/unit3290.
- **Next:** nothing outstanding for `modules/ui/`. (Open question for the user: delete the 2 dead
  `sections/*.jsx` demo files, or keep them quarantined?)

## Settings System design (2026-07-07)

- Added design doc: [.github/design/settings-system.md](../.github/design/settings-system.md)
- Captures goals, typed/versioned settings envelope, adapter architecture (local + OSM), migration mapping from legacy keys, and phased rollout plan.
- Motivation: upcoming custom background/custom data work needs scalable persistence beyond ad-hoc localStorage keys.

## Settings System implementation scaffold (2026-07-07)

Design: [.github/design/settings-system.md](../.github/design/settings-system.md)

**Phase 0 + 1 done.** Domain-agnostic implementation:
- `modules/lib/TreeStore.ts` — the single home for nested-tree logic: path access
  (`get`/`peek`/`set`/`has`/`unset`), flat-key (de)serialization (`toFlat`/`fromFlat`),
  and the folded-in key-path primitives (public static `TreeStore.parsePath`; get/set/has/
  delete are module-private). `KeyPathPart` type exported here. Own tests
  (`test/unit/lib/TreeStore.test.js`). (`modules/util/keypath.ts` was folded in and deleted.)
- `modules/core/SettingsSystem.ts` — holds a `TreeStore` (`_store`) and only adds the
  settings-specific `rapid.settings.*` namespace, engine metadata, and legacy migrations.
  Public API: `get/set/unset/has/getAll/toJSON/fromJSON` + sync stubs. Emits
  `settingschange`. `resetAsync` is a no-op (settings are durable). Requires `storage`;
  key-per-setting persistence.
- `modules/core/LocalizationSystem.ts` — `_strings` is now a `TreeStore` keyed
  `[locale][scope][...stringID]`; hot reads use `peek` (copy-free).
- `StorageSystem` gained a `keys()` enumeration method (used by SettingsSystem + tested).
- Registered as system id `settings` in index.ts/types.ts/headless.js.
- **Values are plain strings** (localStorage/OSM-prefs contract); callers coerce on read.
- Legacy `SettingsCodec.ts` / `SettingsMigrations.ts` were folded in and deleted.
- **`<TX_DOT>` retired** — dotted keys (imagery IDs like `basemap.at`) now percent-encode
  dots as `%2E` at the producer (`ImagerySource`), and `LocalizationSystem` normalizes any
  legacy `<TX_DOT>` data-file keys to literal dots at load time. The resolver keeps no fallback.

**Key design decision (user-driven):** domain settings interfaces (`ImagerySettings`, etc.)
do NOT live in SettingsSystem — they belong to the systems that own them. The engine stores a
generic `SettingsTree` and never learns what it holds. Only migrations carry legacy-key domain
knowledge (a one-time, version-scoped concern).

Tests: `test/unit/lib/TreeStore.test.js` (path access, copy semantics, `toFlat`/`fromFlat`
round-trips, `merge`, `parsePath`) + `test/unit/core/SettingsSystem.test.js` (49 cases incl. type
fidelity, array compaction, legacy import, reserved-namespace guard, persistence, toJSON/fromJSON)
+ `keys()` tests in StorageSystem.test.js. Full unit suite green (3260 pass) + browser (121 pass),
tsc + eslint clean.

**Phase 2 done (2026-07-08):** migrated all legacy `storage` key callsites to the typed
`settings.get/set` API. `settings` is an OPTIONAL dependency everywhere (`settings?.`); kept
`storage` only where a file still uses non-migrated keys (EditSystem backups). Paths follow the
migration mapping (`imagery.custom[0].template`, `schema.presetRecents`, `experiments.*`,
`validation.*`, `ui.walkthrough.*`, `changeset.*`, `privacy.thirdPartyIcons`,
`ui.mouseWheelInteraction`, `ui.inspector.*`, etc.). schema.presetRecents now stored as a native
array (no JSON.stringify). Extended the v0→v1 migration to also import `experiments.autoConnect`,
`experiments.tagSources`, and `validation.disabledRules`; poweruser `.was.` backups →
`experiments.was.*`. tsc + eslint clean; unit + browser-op tests green (7 pre-existing failures
unrelated to this work: utilDetect env, Mapillary/Streetside net timeouts, one UrlHash test).

**Phase 2 follow-up — key naming + changeset ownership (2026-07-08):**
- Settings keys now start with the **owning systemID** (camelCase leaves): `validation.*`→`validator.*`,
  `experiments.*`→`poweruser.*` (incl. `.was.`), `customData`→`ui.customData`.
- Migrated a few missed prefs: `disabled-features`→`filters.disabledFilters`,
  `area-fill`/`area-fill-toggle`→`map.areaFill`/`map.areaFillToggle`,
  `raw-tag-editor-view`→`ui.rawTagEditorView`, `disclosure.<key>.expanded`→`ui.disclosure.<key>.expanded`.
- **Changeset draft metadata removed from settings.** `comment`/`source`/`hashtags` are now public,
  session-scoped properties on `UploaderSystem`, seeded from the urlhash in `initAsync` (urlhash added
  as an optional dep). The old 2-day-expiry localStorage hack is gone. Behavior change: a changeset
  comment no longer survives a page reload (it was only persisted via that hack).
- Migration extended so nothing is orphaned; tests updated. tsc + eslint + unit + browser all green.

**Phase 3 — OSM sync foundation (2026-07-10):**
- `OsmService`: `getUserPreferencesAsync` now caches a decoded plain `Record<string, string>`.
  The dotted-key routing workaround remains `.` ↔ `~`, and both single-key writes and the bulk
  XML writer currently persist the `~`-substituted form for Rapid's dotted keys. The single-key
  write methods call `getUserPreferencesAsync()` first so a remote baseline is pulled before they
  mutate local cached state or skip no-op writes.
- `OsmService` no longer invalidates `_userPreferences` after successful writes. Instead it keeps
  the cache current in place: bulk PUT replaces the full record, single PUT updates one key,
  DELETE removes one key. `logout()` and connection switches clear the cache, and successful auth
  / preauthenticated `switchAsync()` eagerly call `loadCurrentUserDataAsync()` to preload details,
  preferences, and changesets.
- `SettingsSystem`: local helpers were renamed around the current implementation
  (`_loadLocal`, `_saveLocal`, `_allSettings`, `_deferredSyncRemote`, `_remote`). Sync entrypoint
  is now `syncRemote()`, which always does pull-then-push. `pullRemoteAsync()` seeds `_remote` and
  applies remote settings only when the remote `updatedAt` is newer; `pushRemoteAsync()` diffs
  against `_remote` and issues single-key PUT/DELETE calls for Rapid-owned keys only.
- Pushes remain throttled through `SchedulerSystem`, values that OSM can't represent stay
  local-only, and the unit suite is green aside from the known unrelated env/network failures.


## Spatial System — Step 3 (conflation: coverage/buffers + two-phase querying)

Design: [.github/design/spatial-system.md](../.github/design/spatial-system.md) — see Decision 5 and Sequencing Step 3a–3d.

**Goal of Step 3:** let Rapid take arbitrary third-party data (POIs/sidewalks/buildings) and
determine how much already exists in OSM (conflation). Buffers are quantized "coverage boxes"
(fast, not mathematically exact), per geometry type. The buffer doubles as the RBush query.

### Sub-steps
- **3a — Lazy `GeometryPart`** ✅ done (`328a4c388`). Derived products are lazy memoized getters;
  `clone()` re-derives from `orig`.
- **3b — Coverage helper** ✅ done. `geomCoverageBoxes(coords, radius, step?)` in
  [modules/geo/geom.ts](../modules/geo/geom.ts) — unit-agnostic; point → one box, polyline →
  boxes every `step` along each segment (each carries heading angle), shared vertices not
  double-covered. 13 new unit tests in `test/unit/geo/geom.test.js`.
  `GeometryPart.computeCoverage(r)` still TODO (deferred to when a conflation consumer needs it).
  **Note**: `geomCoverageBoxes` was briefly used in `PixiLayerLabels.placeRopeLabel` (commit
  `f9f34ffdc`) but was reverted — rope labels need a *uniform sampler* (equal arc-length spacing),
  not a coverage sampler (per-segment subdivision). Use `geomLineSegments(coords, boxsize)` for
  rope placement; reserve `geomCoverageBoxes` for conflation.
- **3c — Query plumbing** ✅ done. `SpatialSystem.getItemsAtBoxes(spatialID, boxes)`
  (phase-1 bbox prefilter over many boxes, deduped by `boxID`) + `refineItems(candidates, predicate)`
  (phase-2 precise refine with a caller-supplied predicate — SpatialSystem stays domain-agnostic).
  Follow-up simplification: SpatialSystem storage is now **flat** (one RBush per `spatialID`, no nested
  cache/index map), and the legacy `(spatialID, indexID, ...)` API overloads are removed.
  Callers now use flat IDs directly (e.g. `editor_staging-segments`) with
  `replaceItems`/`removeItems`/`getItemsAtBox`/`getItemsAtBoxes` flat signatures only.
  SpatialSystem unit tests were migrated and still pass.
- **3d** — `Conflation` module (graduates the `PixiLayerDebug` POC); owns match semantics.

### Notes / gotchas
- `geomCoverageBoxes` is unit-agnostic (radius/step in the same planar units as coords). Labels
  pass pixel sizes; conflation will pass world units (meters→world conversion done by the caller).
- Label box sampling changed slightly: `geomCoverageBoxes` includes segment endpoints/vertices and
  samples uniformly, vs. `getLineSegments`' offset-accumulating, endpoint-skipping behavior. All
  unit + browser tests still pass; placement is visually equivalent/cleaner.
- Phase-2 predicates already exist in `@rapid-sdk/math` (`geomPointInPolygon`,
  `geomPolygonIntersectsPolygon`, `geomPolygonContainsPolygon`, `geomLineIntersection`,
  `vecProject`/`vecLength`). We control `rapid-sdk`, so new helpers can start in `modules/geo`.
- No code serializes `geoms` across the worker boundary, and nothing spreads/`structuredClone`s a
  part's `world`/`local` — so lazy getters + re-derive `clone()` are safe.

## Session work (2026-06-18) — uncommitted

All in working tree; 3170 unit tests pass; `check:ts` + `check:lint` clean.

### RBush → SpatialSystem consolidation
Removed all remaining `new RBush` usages outside `SpatialSystem` itself:
- **`PixiLayerLabels`** — `_labelRBush`, `_debugRBush`, `_boxes` Map → two `SpatialSystem` caches
  (`SPATIAL_LABELS = 'labels'`, `SPATIAL_DEBUG = 'labels-debug'`). Items use `LabelItem extends
  SpatialItem` with `contents: LabelContents` (type/featureID/labelID/objectID/tint). Kept
  `_featureBoxes` (feature→box secondary index; SpatialSystem doesn't provide this).
- **`NominatimService`** — `_nominatimCache` RBush → `SpatialSystem` cache `'nominatim'` (WGS84
  coords). `spatial` added to `requiredDependencies`.
- **`ValidationCache`** — `recheckRBush` + `recheckBoxes` → `SpatialSystem` cache `validation-${which}`.
  Threaded `context` into constructor (`new ValidationCache(context, which)`). Public `spatialID`
  getter. Updated all 5 construction sites in `ValidationSystem` + tests.
- **`VectorTileService`** — per-source×zoom `boxes` Map + `rbush` → `SpatialSystem` caches
  `vt-${source.id}-z${zoom}`. `reset()` → `spatial.clearMatching(id => id.startsWith('vt-'))`.
  `spatial` added to `requiredDependencies`.

### PixiLayerLabels rope-label squish bug
- **Root cause**: commit `f9f34ffdc` switched rope box sampling from `geomLineSegments` (uniform
  arc-length sampler) to `geomCoverageBoxes` (per-segment subdivider). Coverage boxes space
  closer than `boxsize` so `scaleX = lWidth / ((numBoxes-1)*boxsize)` was wrong → labels squished.
- **Fix**: reverted rope walker back to `geomLineSegments(coords, boxsize)` with the original
  count-based chain math. `geomCoverageBoxes` stays for its conflation purpose only.

### VectorTileService GeometryCollection guard
- `_toSingleFeatures` typed `geometry` as `GeoJSON.Geometry` (union including `GeometryCollection`,
  which has no `coordinates`). Added early-return guard for `geometry.type === 'GeometryCollection'`.

