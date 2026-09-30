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
- **Phase 2 done (committed `c28f834fd`):** multi-session support.
  Unique `crypto.randomUUID` per session; `localStorage` is now **read-only** (legacy restore only,
  upgraded to IDB on restore); **`utilSessionMutex` retired** (see lesson below). New EditSystem API:
  `listRestorableSessionsAsync` / `restoreSessionAsync(id)` / `deleteSessionAsync(id)` /
  `dismissRestore`, plus session metadata (`bbox`, `summary`, `editCount`). `UiRestore` rewritten as
  a session-list modal (date / reverse-geocoded location / summary / Restore+Delete / Skip). New
  `SessionID` id type; `DatabaseSystem.getAllKeysFromIndex` added. Tests:
  `test/unit/core/EditSystemSessions.test.js`. `immediateBackup()` now returns its write promise.
- **Phase 2.1 done (committed `f726a1628`):** liveness heartbeat / "in use" flag. `heartbeatAt`
  on each session record, refreshed on backup + a 20s timer (`_startHeartbeat`/`_heartbeatAsync`, via
  scheduler or `setInterval`); `listRestorableSessionsAsync` excludes sessions live in another tab
  (`_isLiveElsewhere`, 60s window). Own session recognized across **reloads** via `sessionStorage`
  (`_ownedSessionID`) so reloading never hides your own work. Heartbeat re-writes the cached
  `_activeSession` (no read) → race-free with backups. Tests in the `liveness heartbeat` describe.
- **Phase 3 done (committed):** generic `files` store + typed file API **on
  `DatabaseSystem`** (`putFileAsync`/`getFileAsync`/`listFilesAsync`/`deleteFileAsync`). Blobs stored
  **natively** (structured clone), no base64/ArrayBuffer. New `FileID` id type; `FileRecord`
  (id/name/extension/type/size/createdAt/updatedAt/blob). `estimateBytes` fixed to sum real blob
  bytes so `usageByStoreAsync` reports true file sizes. **DB schema v1→v2** (new store needs a
  versionchange tx; manifest-driven, no migration code) — verified existing v1 DBs upgrade + keep
  sessions. Ownership decision confirmed: `DatabaseSystem` is the persistent store for anything
  beyond localStorage, so it owns the generic file API (sessions stay domain-owned by EditSystem).
  See `decisions.md`. Tests: `files` describe in `DatabaseSystem.test.js`.

## Next up
- **`DragAndDropSystem` done (uncommitted, working tree):** new `core/DragAndDropSystem.ts` — central
  owner of the container drop handler, claim-based registry (`register`/`unregister`, priority, async
  `handle`, sync `accepts` pre-filter), file categorization (data/image/other), single drop overlay,
  ignores concurrent drops, `dropFilesAsync()` programmatic entry. Domain-agnostic — **no
  `DatabaseSystem` dep**; persistence is the claiming consumer's job. Migrated `PixiLayerCustomData`
  off its own container DOM handlers to a low-priority consumer. Registered in index/types/headless;
  `dragdrop.drop_files` l10n + `.dragdrop-overlay` CSS. Tests: `DragAndDropSystem.test.js` (17).
  `UiRapidAddDataset` high-priority consumer **deferred** (its file flow is commented-out/URL-only).
- **Follow-ups:** move the custom-data consumer's ownership off the Pixi layer into a real system;
  revive `UiRapidAddDataset` file→dataset flow as a high-priority consumer; reload-on-startup of
  persisted files; stretch: images → EXIF → photo markers.
- Open questions at the bottom of the DatabaseSystem design doc (reload UX; DB name/scoping; codifying
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
