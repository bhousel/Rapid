# Current Work

## In progress
**`DatabaseSystem`** ([facebook/Rapid#1078](https://github.com/facebook/Rapid/issues/1078)) — new
`AbstractSystem` wrapping IndexedDB. Design doc:
[`.github/design/database-system.md`](../.github/design/database-system.md).

- **Phase 0 done:** [`core/DatabaseSystem.ts`](../modules/core/DatabaseSystem.ts) wraps the `idb`
  library (1.4 KB, chosen over Dexie/localForage/idb-keyval/rxdb). Domain-agnostic engine owning a
  central store manifest + manifest-driven schema `upgrade`; CRUD/bulk/iterate/index/transaction
  helpers; quota/estimate/usage/persist API; in-memory mock fallback when IndexedDB is unavailable
  (graceful degradation — it's an **optional** system). Registered as `context.systems.database`,
  exported from `headless.js`. Deps added: `idb`, `fake-indexeddb` (dev). Tests:
  `test/unit/core/DatabaseSystem.test.js`.
- **Phase 1 done:** `sessions` store. `EditSystem` dual-writes the structured backup object to
  IndexedDB (no `JSON.stringify` on that path) alongside the localStorage fallback; `toJSON`/
  `fromJSONAsync` are now thin wrappers over new `toBackup`/`fromBackupAsync`. Restore prefers the
  IDB session, imports the legacy localStorage key once. `database` is optional on `EditSystem`.
- **Phase 2 done (committed separately? no — uncommitted, in working tree):** multi-session support.
  Unique `crypto.randomUUID` per session; `localStorage` is now **read-only** (legacy restore only,
  upgraded to IDB on restore); **`utilSessionMutex` retired** (see lesson below). New EditSystem API:
  `listRestorableSessionsAsync` / `restoreSessionAsync(id)` / `deleteSessionAsync(id)` /
  `dismissRestore`, plus session metadata (`bbox`, `summary`, `editCount`). `UiRestore` rewritten as
  a session-list modal (date / reverse-geocoded location / summary / Restore+Delete / Skip). New
  `SessionID` id type; `DatabaseSystem.getAllKeysFromIndex` added. Tests:
  `test/unit/core/EditSystemSessions.test.js`. `immediateBackup()` now returns its write promise.

## Next up
- **Phase 3:** persist dropped-in data files (`RapidSystem`/`PixiLayerCustomData`) as blobs.
- **Multi-tab refinement:** mark a session "in use" (recent-`updatedAt` heartbeat) so a second tab
  doesn't offer to fork another tab's live session.
- Open questions at the bottom of the design doc (data-file reload UX; DB name/scoping; codifying
  graceful degradation in agent instructions).

## Last landed
`KeyboardSystem` phase 1 — `util/keybinding.ts` is now `core/KeyboardSystem.ts`, an
`AbstractSystem` reachable via `context.systems.keyboard`. See `completed.md`,
[`.github/design/keyboard-system.md`](../.github/design/keyboard-system.md), and
[facebook/Rapid#1076](https://github.com/facebook/Rapid/issues/1076).

## Next up
- **KeyboardSystem phases 2 & 3** (remappable shortcuts — SettingsSystem persistence, then UI).
  Full plan in `backlog.md`.

## Still-open future work
- **Automated testing of `UiSystem` + `UiWhatever` components.** The modal stack + Esc/Backspace
  routing (and now the `KeyboardSystem` document listeners) can't be unit-tested under bun without a
  browser. Figure out a headless-browser or testable-seam approach.
- **Manual smoke-test** the nested Rapid dataset modals (catalog / add-custom-data / colorpicker) in
  a real browser to confirm stacking, Esc, and close behavior.
- **`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs`.** The one remaining module-level
  mutable global in `operations/`. Consider moving it onto a system per the system-ownership rule —
  left with a comment for now.

## Open questions
- Delete the 2 dead quarantined `sections/*.jsx` React demo files + `section.ts`/`uiSection`?
