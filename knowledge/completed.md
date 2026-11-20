# Completed

Newest first, by month. Details live in git history and the design docs; these are breadcrumbs.

## November 2026

- **Partial fill masks are always batched** (Nov 20 2026) — a mask that crossed Pixi's 100-vertex
  batching line in a frame where its tile was rebuilt crashed every later frame that moved the tile
  (seen loading Newark). Same cause as Rapid#1636, whose workaround had been removed in May when
  pixijs#11207 looked fixed. Filed as pixijs#12437; `batchMode = 'batch'` measured the same as `'auto'`.
  E2e tests for the crash and for a mask never showing without its fill (pixijs#12388).

- **Label placement against a grid, over several frames** (Nov 20 2026, PR #11, `graphics-system.md`
  section 14) — points mark what labels avoid in `scene.avoidGrid` as they're drawn (they had stopped
  being avoided one by one when points were split by tile), features tell the scene when they change
  so the labels layer walks nothing, a hover moves no label, and labels are placed from a queue, not
  during a zoom or rotation. In Užice the frame that placed everything after a zoom went from 104 to
  132 ms to about 27, then into frames of 2 to 8 ms; a pan frame from 5 ms to 0.1.

- **pixi.js 8.23 and the frame work** (Nov 20 2026, PR #10, `design/graphics-system.md`,
  `design/scene.md`) — frame stats, the rendering card and `bun run measure`/`compare` with tapes; the
  scene's containers are render groups at an anchor, OSM polygons, lines and points split by map tile;
  a CULL pass, frame pacing in place of the 250 ms throttle, and a deadline on the frame. A hover, an
  edit, a change of mode, arriving tiles and a zoom no longer do the OSM layer's whole pass, and a
  smaller heap (Užice 2.26 → 1.69 GB) means fewer, shorter collections. Against `main` in Užice: a pan
  into new data at 38 to 44 frames a second (was 12), a pinch in 2 s (was 32). Also: the rate limit bar
  is back, ⌘Z works from an empty text field, and Pixi's `globalMove` events are really off.

- **Bryan's own packages, ESM-only now** (Nov 20 2026): country-coder 6, location-conflation 4,
  osm-community-index 7, node-diff3 4 and osm-auth 4, with patch bumps (maplibre-gl 6.19, marked,
  togeojson, oxlint). osm-auth is a class now (`new osmAuth()`), with its own types; `OsmService`
  dropped its copies of them and the unused `client_secret`.

- **Version 3.0.0-pre.4** (Nov 18 2026) — `package.json` and `Context.ts`; `package.json`'s project links
  point at bhousel/Rapid now.

- **End-to-end tests with Playwright** (Nov 18 2026, PR #9, `test/e2e/README.md`) — tests that drive the
  dev build in Chromium: startup with no console errors, OSM data drawn, the 3D map, selecting a road,
  drawing a line and undoing it, adding a Rapid dataset feature. Requests are live, recorded in a HAR,
  stubbed or blocked, by host. CI runs them on every PR to `main` (about 2 minutes). `test/browser`
  became `test/dom` (it needed a DOM, not a browser), and mocha is gone. See `decisions.md`.

- **OSM tiles no longer load their `bounds` as an entity** (Nov 18 2026, PR #8) — found by the first e2e
  startup test. Since the `skipSeen` removal (Oct), `EditSystem.merge` had made the map response's
  `bounds` an `OsmEntity` with an empty ID, so `crossing_ways` and `missing_tag` threw on every tile load.

- **maplibre-gl 6** (Nov 18 2026) — ESM-only, so `Map3dSystem` loads `maplibre-gl.mjs` with `import()`.
  It hands MapLibre its worker as a blob, because the CSP's `'strict-dynamic'` blocks the worker's own
  import (`quirks.md`). The e2e 3D map test fails without that.

- **CDN pins come from `package.json`** (Nov 18 2026) — `utilCDNPath()` and `utilDependencyVersion()` in
  `modules/util/dependencies.ts`. What users loaded had drifted from what was installed and tested
  (MapLibre 5.15 vs 5.24, id-tagging-schema 6.6 vs 6.19, osm-community-index 5.9 vs 6.2). See
  `decisions.md`.

- **Dependency checkup** (Nov 18 2026) — removed `@pixi/jsdoc-template` and `@mapbox/geojson-area`
  (unused); happy-dom 21, geojson-vt 5, cssnano 9, @transifex/api 8 and in-range updates; current
  Actions pins; CI enabled on the fork. What's left is in `current.md`.

- **TypeScript 7** (Nov 17 2026) — `tsc --noEmit` ~4× faster. One fix: `window.Rapid` only typed because
  TS 6 inferred a global from the `globalThis.Rapid = …` assignment in `main_dev.js`. JS tests stay
  untype-checked for now (226 files, not worth the churn).

- **ESLint → oxlint** (Nov 17 2026) — same rules and warnings, lint ~10× faster, 160 fewer packages.
  The protected-`_` and no-`private` conventions live in a local plugin (`scripts/oxlint_plugin.js`).
  `prefer-const`/`no-var`/`prefer-rest-params`/`prefer-spread` now cover JS tests too. Clears the way
  for TypeScript 7.

- **`conflation-system` merged into `main`** (Nov 16 2026, PR #7, for v3.0.0-pre.4) — data IDs, graph
  geometry, the validation audit, both bug hunts, edit props and backup v4, the upload path, the scene,
  and conflation Steps 1–6 (first version). Last fix before merging: an accept from a custom dataset
  records the dataset ID in `data_used` (an empty `dataUsed` used to win over the fallback).

- **pre.4 release check** (Nov 10 2026, agency sidewalk and crossing data) — accept with joins,
  autoconnect, undo/redo, Autofix All, panning while editing, backup restore and a faked upload conflict
  all passed, plus ~220 random UI steps with invariant checks. Its one bug (matched Rapid lines taking
  the pointer in draw mode) became the scene work; the rest is in `backlog.md`.

- **The scene stacks by spatial ID, and a mode says what the pointer can reach** (Nov 11 2026, `design/scene.md`) — every layer draws under `<group>/<spatialID>` (`basemap/osm/lines/<level>`, `points/<dataset>`, `qa/<layer>`), never straight into a group, and `AbstractMode.interactiveSpatialIDs` (`['osm']` for draw, add-point and drag-node) has the scene skip the other subtrees. Fixes drawing not connecting to the OSM line under an already-mapped Rapid line, a photo marker or a QA item (pre.4 release check). Checked live on agency sidewalk data: 22 of 22 OSM midpoints hit in draw mode (was 39 of 50), browse unchanged. See `decisions.md`.
- **A data ID's first part is its `spatialID`** (Nov 10 2026, `design/data-ids.md` Terms) — the data prop `namespace` is now `spatialID`, like the `SpatialID` type, `SpatialSystem`'s parameters and `RapidDataset.spatialID` (Bryan found "namespace" confusing: it's the spatial cache's ID, or a resolver's for OSM and vector tiles). Code, tests and docs; data IDs themselves didn't change.

- **Mapillary traffic signs have their own cache** (Nov 10 2026, `design/data-ids.md`) — `mapillary-signs`, apart from the other detections. A sign's data ID starts with that cache ID, and the layer has the same ID, so a link to a sign turns on the signs layer, and nothing guesses the layer from `object_type`. Signs' data IDs changed (no shim, per the pre.4 plan).

- **Switching the API offers that API's sessions** (Nov 10 2026, `design/database-system.md`) — startup is always on live, so dev sessions were never offered. `editor.findRestorableSessionsAsync()` (also used by startup) settles the API's interrupted uploads and finds its sessions; the source switcher shows the restore screen after switching. From the first bug hunt.

- **A new changeset when OSM closed the open one** (Nov 10 2026, `design/uploader-system.md` "A closed changeset") — the service forgets a changeset the API says is closed (it used to keep it, so every save got the same 409 until a reload), and the uploader uploads again in a new changeset, once.

- **Settings declare how they're kept** (Nov 10 2026, `design/settings-system.md` "What syncs") — `registerSync`, `registerLocal` and `unregister`, like Chrome or VS Code. The sync deletes the account's copies of local and retired settings and v1's `meta`; unknown keys are left alone. `imagery.lastUsed` and `imagery.overlays` sync; datasets stay local. See `decisions.md`.

- **Second bug hunt** (Nov 4–10 2026, `/bughunt`) — 40 findings before handing the branch to testers, all fixed except the conflation ones (now "Known bugs" in `design/conflation-system.md`): the database upgrade blocked by another tab, upload marks and "can't tell" uploads, conflict choices on shared nodes, redacted base versions, settings sync, the selection after undo and redo, custom-data links, walkthrough sessions, MapRoulette (auth turned off: MapRoulette expired the keys), layer parent-child links and midpoints, editing between an upload and the reset, arrow keys, validating the nodes next to a connection, building crossings, curbs on short crossings. Clean coverage: 400 seeds × 250 steps of random `EditSystem` histories with 2,432 backup round trips, and two live soaks on Seattle data. See `decisions.md`.

- **The url holds overrides, not state** (Nov 9 2026, `design/settings-system.md` Step 1 bullets) — Rapid only writes `map`, `id`, `photo` and `detection` as you go. Every other param (layers, filters, imagery, datasets, photo filters, MapRoulette challenges, `map3d`) is read, stays as the link had it until the state no longer matches, then is dropped; changes are saved one at a time. New `imagery.overlays` setting; the system saves `imagery.lastUsed`. See `decisions.md`.

- **First bug hunt** (Nov 3 2026, `/bughunt`) — 36 findings before handing the branch to testers, all fixed: iD#2085 restores per graph, sessions per API, the conflict screen's choices and Cancel, conflation runs as their own data, QA editors that keep their state while typing, undo during drag and draw, stable IDs in links and backups.

- **One autofix runner** (Nov 2 2026, `design/validation-system.md` rollout item 5) — `actionAutofix` applies one fix at a time and validates again, for autoconnect and Autofix All (`ValidationSystem.autofixAction`, which finds the shown issues again by kind and entities, via `issue.foundOnID`). Closes the validation audit.

- **Graph versions and their geometry** (Oct 30 – Nov 2 2026, `design/graph-geometry.md` steps 0–10) — Fixed validation audit findings 1 (shared geometry) and 2 (wrong spatial index) by construction. Graphs share structure (`PersistentVector` records, O(1) derive, structural diffs), emit from a change journal, keep their own shapes, and catch up with rebases and schema changes (`syncWithBase()`). Backups hold each edit's own changes. One base spatial index plus local indexes for stable and staging, searchable for any graph (`editor.entitiesInBox`). No data changed in place: `touch()` gone, every layer rebinds by object. Reference model test in `test/unit/lib/graph_model.test.js`. Step 7 (memos in records) measured and left for later. See `decisions.md`.

## October 2026

- **Validation audit** (Oct 29–30 2026, `design/validation-system.md`) — Autoconnect applies one fix at a time, a throwing validator no longer hides other issues, Autofix All and `curb_nodes` fixes repaired, no side effects while detecting, edits validated again when data loads near them, fixes look up the graph they run on. Findings 1 and 2 became the graph-geometry rollout.

- **Data IDs and selecting any mix of data** (Oct 28–29 2026, `design/data-ids.md` steps 1–5) — `${namespace}:${localID}` data IDs, `spatial.getData()` with resolvers, deterministic IDs for file datasets, pieces, Esri and custom data, one `SelectMode` for any mix of data, and `id=` takes data IDs. Step 6 became `design/multiselection.md`.

- **Upload path and conflicts** (Oct 27 2026, `design/uploader-system.md`) — the conflict path had been
  broken for years, several bugs deep (iD#7199, Rapid#1361/#1366/#1480): checks use versioned
  multi-fetch, merges reach the upload, 409 retries are limited, local deletions merge, the conflict
  screen opens. Every upload failure ends the save; an upload with no answer checks the changeset;
  the session is kept until the upload succeeds and the next tab settles interrupted uploads.

- **What an edit records, steps 2–5** (Oct 26–27 2026, `design/edit-system.md`) — undone edits aren't
  backed up; `Edit<P>` carries typed props with a `stringID` label; edits record extent and the
  selection before and after, so undo/redo restore both and move the map only when needed; backups are
  v4, saving base versions that restore fetches from the OSM API.

- **Conflation Steps 1–6, first version** (Oct 2026, `design/conflation-system.md`) — coverage boxes,
  `ConflationSystem` line matching with source/target rules, drawing matched/partial lines, accepting a
  run with its joins (trimmed to them), even sampling with smoothed headings, stable feature and piece
  IDs with acted ranges, and the Conflation Settings UI (switches and a rules table). The "near" band
  and "needs review" were dropped after the first demo (Oct 26).

- **Settings v2 Steps 1–2** (Oct 2026, `design/settings-system.md`, `design/rapid-system.md`) — only
  registered settings sync to the OSM account; custom datasets and changes to shipped datasets are
  kept in the `DatabaseSystem` `datasets` store.

- **OSM features lost after a cancelled request** (Oct 2026) — Removed `skipSeen` and the parsers' seen cache (and the `osmService:reset` / `network:reset` listeners that cleared it); `EditSystem.merge` now skips entities already in the base graph instead. A tile request cancelled or timed out after the worker parsed it no longer hides its features until reload. See `decisions.md`.

- **Agent tooling for Claude Code + Copilot** (Oct 2026) — Prompts → Agent Skills in `.claude/skills/` (agent-practices PR #1, then `/sync` to AGENTS.md v4). `.github/instructions/` → nested `modules/{ui,pixi}/AGENTS.md`. See `decisions.md`.

- **File-backed custom Rapid datasets** (Oct 2026, facebook/Rapid#1078) — `UiRapidAddDataset` file picker restored, plus a `priority: 1` `DragAndDropSystem` consumer. Files are stored through `DatabaseSystem` and referenced by `RapidDataset.sourceFileID`, and deleted with their dataset.

- **Default imagery selection** (Oct 2026) — `visibleSources()` tests the viewport center instead of the bbox. `chooseDefaultSource()` skips overlays, `none`, and custom sources without a template.

- **NSI startup off the main startup chain** (Oct 2026) — `NsiService` now starts on its own promise chain, so it no longer blocks Rapid startup.

- **Global-symbol leak in browser bundles** (Oct 2026) — `scripts/build_js.ts` sets `format: 'iife'` on every browser bundle. Bun's default `esm` left our export-less entry points' top-level declarations on `window`, and d3-selection's `dispatchEvent` clobbered the native one. See `lessons/build.md` and `decisions.md`.

- **`DatabaseSystem` phase 4, storage management** (Oct 2026) — `estimateQuotaAsync` / `canStoreAsync` / `requestPersistentAsync`. Write-time per-store stats counters were tried and reverted (a `JSON.stringify` on the hot path, and drift on overwrites). See `design/database-system.md`.

## September 2026

- **TypeScript conversion of `modules/` complete** — every folder is TS. Only the entry points (`index.js`, `main_dev.js`, `main_prod.js`, `headless.js`) and the 2 quarantined React-demo `ui/sections/*.jsx` remain JS.
- **`DatabaseSystem` + `DragAndDropSystem`** (facebook/Rapid#1078, `design/database-system.md`, `design/draganddrop-system.md`) — an IndexedDB store (`idb`) with a manifest-driven schema; edit backups go to IndexedDB, `UiRestore` lists sessions, and a heartbeat keeps tabs from offering each other's live sessions; files are stored as Blobs; drops go through a claim-based registry.
- **`KeyboardSystem`** (`design/keyboard-system.md`) — `utilKeybinding` became a system with named scopes that can be turned on and off; one callback per key event across all scopes, matching on `event.key` only. Remapping phases 2–3 are in `backlog.md`.
- **Operations are `ThingOperation` classes** — 17 factories became `AbstractOperation` subclasses with `run()` and an `operations.available` registry. See `decisions.md`.
- **UI rerender guards** — listeners call zero-arg wrappers, so an event's arguments can't be taken for a parent selection.

## August 2026

- **UI primitives became classes** — `UiModal` / `UiConfirm` with the modal stack owned by `UiSystem` (Esc and Backspace go to the top modal; the nested-modal hacks are gone), `UiTooltip` (about 28 `any`s removed), `UiCombobox`, `UiDisclosure`, `UiLoading`. `d3_dispatch` and `utilRebind` were replaced by `EventEmitter` (tseep) everywhere. See `decisions.md`.
- **UI fields: inheritance over composition** — the 14 `UiFieldX` classes extend `UiField`, built by `createUiField()`; this broke an import cycle. `UiFieldRestrictions` is a stub until the turn-restriction editor is redone in Pixi.
- **UI modernization Phases 6, 7 and 9** — `modules/ui/` is all TypeScript. Fixed the `UiCurtain` `botom` typo (the bottom-toolbar trim never applied).

## July 2026

- **UI modernization Phases 1–5 and 8** — primitives, fields, the sidebar and inspector, the QA editors, panes, and the walkthrough became TS classes (chapters on `AbstractIntroChapter`, their step chains as async/await).
- **HTML injection hardening** — upstream XSS fixes, an allowlist sanitizer, safe URL handling, and a hash-based CSP checked in CI.
- **`TreeStore`** (`modules/lib/TreeStore.ts`) — the nested store behind `SettingsSystem` and `LocalizationSystem`; `<TX_DOT>` retired (dots are percent-encoded).
- **`design/settings-system.md`** proposed typed, versioned settings with adapters for local and OSM-synced storage.

## June 2026

- **All spatial indexes in `SpatialSystem`** — no standalone RBush left (labels, Nominatim, validation, vector tiles); one RBush per spatial ID.
- **Rope labels use `geomLineSegments`** — `geomCoverageBoxes` isn't evenly spaced, which squished text on roads of many short segments. Coverage boxes are for conflation.
- **`NetworkSystem` records outcomes** — `_completed` maps request IDs to an HTTP status or a sentinel; `FetchEnvelope<T>` from every worker listener; services that retry call `network.forget(id)`.

## May 2026

- **Rendering in world coordinates** (branch `render_worldcoord`) — native z16 world coordinates end to end; `PixiGeometryPart` and the screen-coordinate paths deleted (about 1,000 lines); labels, line markers and pattern textures ported.
- **`actionMove` in world space** — fixed spurious vertices when moving a U-shaped way joined to a road at both ends.
- **Pixi fixes** — label textures made outside `render()` through `SchedulerSystem`; atlas uploads straight from their sources (#1650); DashLine halos use `textureSpace: 'global'` with the pow2-padded texture scaled to match.

## April 2026

- **Every fetch goes through `NetworkSystem`**, on workers by default: OSM fetch and parse on a worker, MVT parsing on a worker, results resolved through `SchedulerSystem` (`resultPriority`), and request interceptors for OSM auth (osm-auth 3.2).
- **Pixi canvas renderer** (`renderer=canvas`, experimental), with canvas-backed atlas textures.
- xmldom 0.9, NSI v7 types in `NsiService`, and tooling that fails loudly (`validate_json.ts`, `build_data.ts`).

## March 2026

- **`SchedulerSystem` phases 1–5** — owns the frame loop, priority queues within a frame budget, keyed timers (replacing lodash debounce/throttle), and backpressure.
- **`WorkerSystem`** split out of the scheduler and network systems; `*.worker.ts` companion files.
- **`NetworkSystem`** centralizes fetches (inflight, dedup, timeouts, workers, concurrency); every service migrated.
- Validators in TypeScript (`modules/validations/` → `modules/validators/`), data class renames (`OsmTags`, `GeoJSONData`, `MarkerData`), the context lifecycle (`prepareAsync` → `initAsync` → `startAsync` → `run`), JSON Schemas for `data/`, tag rulesets owned by scopes, and `var()` variables.

## February 2026

- Scoped customization in `StyleSystem` and `SchemaSystem`, dynamic styling fixes, and services in TypeScript (generic `MarkerData<P>` / `GeoJSONData<P>`).
