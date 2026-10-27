# Design Docs

Design notes for Rapid's core systems: the problem each one solves, the decisions behind it, and its rollout status.
They record the "why" that the code alone doesn't show.

**Before changing one of these systems, read its design doc. If your change alters the design, update the doc in the same commit.**

| Doc | Covers | Status |
|-----|--------|--------|
| [`conflation-system.md`](conflation-system.md) | `ConflationSystem`: client-side matching of third-party data against OSM, partial-line accept | In progress: Steps 1–5 done (line matching, drawing, partial accept with joins) |
| [`database-system.md`](database-system.md) | `DatabaseSystem`: IndexedDB wrapper with `sessions` and `files` stores | Phases 0–4 done; files-management UI + worker offload open |
| [`draganddrop-system.md`](draganddrop-system.md) | `DragAndDropSystem`: claim-based router for dropped files | Implemented |
| [`edit-system.md`](edit-system.md) | `EditSystem`: undo/redo history, edits beyond the OSM graph (typed edit props), backups and restore | In progress: undone edits not saved; edit props, translated labels and `hasWork()`; viewport and selection on undo/redo, return view; next: backup v4 |
| [`keyboard-system.md`](keyboard-system.md) | `KeyboardSystem`: key binding scopes and commands | Phase 1 done; remappable shortcuts in backlog |
| [`network-system.md`](network-system.md) | `NetworkSystem`: fetch lifecycle, dedup, timeouts, worker fetches | Implemented |
| [`rapid-system.md`](rapid-system.md) | `RapidSystem`: the dataset catalog, its layers (services, asset files, the user), accepted and ignored features | Dataset assets, the user's datasets in `DatabaseSystem`, and stable feature IDs done; export/import next |
| [`scheduler-system.md`](scheduler-system.md) | `SchedulerSystem`: frame-budgeted task queue, timers, backpressure | Implemented |
| [`settings-system.md`](settings-system.md) | `SettingsSystem`: typed, versioned settings with optional OSM sync | Phases 0–3 and v2 Steps 1–2 done (safe sync; datasets as a collection); next: a VS Code-style `settings.json` |
| [`spatial-system.md`](spatial-system.md) | `SpatialSystem`: one home for all spatial indexes (`Tree` retired) | Steps 1–3c done; 3d continues in `conflation-system.md` |
| [`style-system.md`](style-system.md) | `StyleSystem`: style data model, matching, external style files | Implemented (reference) |
| [`ui-system.md`](ui-system.md) | `modules/ui/` modernization to TypeScript class components | Complete |

New system designs go here as `thing-system.md`. Add a row to this table when you do.
An older system gets a design doc when we make a substantial change to it, so the doc becomes a
running record of where that system is heading.
