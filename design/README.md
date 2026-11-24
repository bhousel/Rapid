# Design Docs

Design notes for Rapid's core systems: the problem each one solves, the decisions behind it, and its rollout status.
They record the "why" that the code alone doesn't show.

**Before changing one of these systems, read its design doc. If your change alters the design, update the doc in the same commit.**

| Doc | Covers | Status |
|-----|--------|--------|
| [`conflation-system.md`](conflation-system.md) | `ConflationSystem`: client-side matching of third-party data against OSM, partial-line accept | In progress: Steps 1–5 done (line matching, drawing, partial accept with joins); Step 6 (settings UI) first version |
| [`data-ids.md`](data-ids.md) | How data is named across sources: data IDs that start with their cache's spatial ID, looking data up, selecting any mix of data | Steps 1–5 done: `SpatialSystem.getData()`, caches renamed to be the start of data IDs, deterministic IDs (file datasets, pieces, Esri, custom data), selections and scene classes by `DataID`, one `SelectMode` for any mix of data, `id=` takes data IDs. Step 6 moved to `multiselection.md` |
| [`database-system.md`](database-system.md) | `DatabaseSystem`: IndexedDB wrapper with `sessions` and `files` stores | Phases 0–4 done; files-management UI + worker offload open |
| [`draganddrop-system.md`](draganddrop-system.md) | `DragAndDropSystem`: claim-based router for dropped files | Implemented |
| [`edit-system.md`](edit-system.md) | `EditSystem`: undo/redo history, edits beyond the OSM graph (typed edit props), backups and restore | In progress: undone edits not saved; edit props, translated labels and `hasWork()`; viewport and selection on undo/redo, return view; backup v4 (base versions fetched on restore; each item holds only its own edit's changes) |
| [`filter-system.md`](filter-system.md) | `FilterSystem`: which OSM features are hidden (the Map Features list), its rules, its cache, what it costs each pass, and the direction toward level of detail | Started Nov 2026: how it works today and measurements; cache keyed by entity and remembered answers done; level of detail is open questions, for after `pixi-8.23` |
| [`graph-geometry.md`](graph-geometry.md) | How `Graph` keeps versions (sharing structure), and the geometry, memoized answers and spatial indexes that belong to each version instead of the shared data objects | Done (Nov 2026): change journal, graphs that share structure (O(1) derive, structural diffs), each graph's own shapes, backups of each edit's own changes, graphs that catch up with rebases and schema changes (`syncWithBase()`), one base index plus local indexes searchable for any graph (`entitiesInBox`), and no data changed in place (every layer rebinds by object). Step 7 (memoized answers in records) measured and left for later; follow-ups (slim nodes, multipolygon ring cache, …) to measure one at a time |
| [`graphics-system.md`](graphics-system.md) | `GraphicsSystem` and the Pixi scene: how a frame is made and paced, the cull box, the frame's deadline, work done without a pass, label placement, batches with shaders of our own, the hit test, hovers and animation draws, the line builder, frame stats and measuring | Built (Nov 2026, PRs #10 to #12); what's left is under "Where it's heading" and in `backlog.md` |
| [`graphics-system-log.md`](graphics-system-log.md) | The record behind `graphics-system.md`: measurements, comparisons with `main`, Rapid 2.5 and iD, what other map renderers do, and the plans as they were built, by date | A log (Nov 18 to 24, 2026); add to it, don't keep it up to date |
| [`keyboard-system.md`](keyboard-system.md) | `KeyboardSystem`: key binding scopes and commands | Phase 1 done; remappable shortcuts in backlog |
| [`multiselection.md`](multiselection.md) | Editing a multiselection: the selection list, commands (replace geometry, copy tags, merge, …) and their command panes | Proposed |
| [`network-system.md`](network-system.md) | `NetworkSystem`: fetch lifecycle, dedup, timeouts, worker fetches | Implemented |
| [`profiling.md`](profiling.md) | Performance and memory profiling: what to measure (heaps, GPU resources, the worker, draw calls), how to drive it over CDP, suspects, and the line-batching idea (`RenderLayer`) | Proposed (Nov 2026); nothing built yet |
| [`rapid-system.md`](rapid-system.md) | `RapidSystem`: the dataset catalog, its layers (services, asset files, the user), accepted and ignored features | Dataset assets, the user's datasets in `DatabaseSystem`, and stable feature IDs done; export/import next |
| [`scene.md`](scene.md) | `PixiScene`: the display tree (containers per spatial ID under each group), draw order, which spatial IDs the pointer can reach in each mode, and render groups (each at an anchor near the view) | In progress (Nov 2026): containers per spatial ID, interactivity by mode and render groups done (OSM polygons, lines and points split by map tile, in an order that's the same on every load); reordering and batching are ideas |
| [`scheduler-system.md`](scheduler-system.md) | `SchedulerSystem`: frame-budgeted task queue, timers, backpressure | Implemented |
| [`settings-system.md`](settings-system.md) | `SettingsSystem`: typed, versioned settings with optional OSM sync | Phases 0–3 and v2 Steps 1–2 done (safe sync; datasets as a collection); next: a VS Code-style `settings.json` |
| [`spatial-system.md`](spatial-system.md) | `SpatialSystem`: one home for all spatial indexes (`Tree` retired) | Steps 1–3c done; 3d continues in `conflation-system.md`; OSM indexes are one base index plus local indexes since graph-geometry step 9 |
| [`style-system.md`](style-system.md) | `StyleSystem`: style data model, matching, external style files | Implemented (reference) |
| [`ui-system.md`](ui-system.md) | `modules/ui/` modernization to TypeScript class components | Complete |
| [`uploader-system.md`](uploader-system.md) | `UploaderSystem`: uploading changesets, checking and resolving conflicts | October 2026 audit done: conflicts work again, upload errors end the save, edits are kept until the upload succeeds |
| [`validation-system.md`](validation-system.md) | `ValidationSystem` and the validators: running them on any graph, autofixes | October 2026 audit done; autoconnect fixed, a failing validator no longer hides other issues, Autofix All and `curb_nodes` fixes repaired, no side effects while detecting, edits checked again when data loads near them, fixes look up the graph they run on, smaller items fixed; shared geometry and the spatial index fixed (graph-geometry steps 6, 8, 9); one runner for autoconnect and Autofix All (`actionAutofix`) |

New system designs go here as `thing-system.md`. Add a row to this table when you do.
An older system gets a design doc when we make a substantial change to it, so the doc becomes a
running record of where that system is heading.
A doc whose record of measurements and experiments outgrows its design can move that record to a
log beside it (`graphics-system-log.md`): the doc then says how the system works now, and the log
is added to, by date, and not kept up to date.
