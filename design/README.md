# Design Docs

Design notes for Rapid's core systems: the problem each one solves, the decisions behind it, and its rollout status.
They record the "why" that the code alone doesn't show.

**Before changing one of these systems, read its design doc. If your change alters the design, update the doc in the same commit.**

| Doc | Covers | Status |
|-----|--------|--------|
| [`conflation-system.md`](conflation-system.md) | `ConflationSystem`: client-side matching of third-party data against OSM, partial-line accept | In progress: Steps 1–3 done (line matching) |
| [`database-system.md`](database-system.md) | `DatabaseSystem`: IndexedDB wrapper with `sessions` and `files` stores | Phases 0–4 done; files-management UI + worker offload open |
| [`draganddrop-system.md`](draganddrop-system.md) | `DragAndDropSystem`: claim-based router for dropped files | Implemented |
| [`keyboard-system.md`](keyboard-system.md) | `KeyboardSystem`: key binding scopes and commands | Phase 1 done; remappable shortcuts in backlog |
| [`network-system.md`](network-system.md) | `NetworkSystem`: fetch lifecycle, dedup, timeouts, worker fetches | Implemented |
| [`scheduler-system.md`](scheduler-system.md) | `SchedulerSystem`: frame-budgeted task queue, timers, backpressure | Implemented |
| [`settings-system.md`](settings-system.md) | `SettingsSystem`: typed, versioned settings with optional OSM sync | Phases 0–3 done; later phases open |
| [`spatial-system.md`](spatial-system.md) | `SpatialSystem`: one home for all spatial indexes (`Tree` retired) | Steps 1–3c done; 3d continues in `conflation-system.md` |
| [`style-system.md`](style-system.md) | `StyleSystem`: style data model, matching, external style files | Implemented (reference) |
| [`ui-system.md`](ui-system.md) | `modules/ui/` modernization to TypeScript class components | Complete |

New system designs go here as `thing-system.md`. Add a row to this table when you do.
