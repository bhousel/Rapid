# Database System Design

This document proposes a new `DatabaseSystem` for Rapid that wraps the browser's
[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) API. It is the
asynchronous, high-capacity counterpart to the existing `StorageSystem` (which wraps the small,
synchronous `localStorage` API), and it becomes the home for large, durable data: the user's
editing sessions, dropped-in data files, and any other bulk data a system needs to persist.

Tracked in [facebook/Rapid#1078](https://github.com/facebook/Rapid/issues/1078) (follow-up from the
core refactor [facebook/Rapid#961](https://github.com/facebook/Rapid/pull/961)). Related:
[facebook/Rapid#187](https://github.com/facebook/Rapid/issues/187) (localStorage quota limits on the
edit history).

> **Status:** Phases 0 and 1 implemented (see Rollout Plan below). Later phases (multi-session
> restore UI, data files, storage-management UI, worker offload) are still design proposals. The API
> sketches in this doc describe the shipped `DatabaseSystem` interface plus proposed future additions.

## Problem

Rapid currently abuses `StorageSystem` / `localStorage` to store the user's entire edit history as a
single serialized JSON blob (see [`EditSystem.immediateBackup()`](../../modules/core/EditSystem.ts)).
`localStorage` is the wrong tool for this:

- **It's tiny.** Most browsers cap `localStorage` at ~5 MB per origin. A moderately large edit
  session can exceed this, at which point the write silently fails
  ([facebook/Rapid#187](https://github.com/facebook/Rapid/issues/187)). `StorageSystem.setItem()`
  already swallows the `QuotaExceededError` and just returns `false`.
- **It's synchronous.** Every backup write blocks the main thread while serializing and persisting
  the whole history blob.
- **It's a single slot.** We can persist exactly one saved history per origin (see `_backupKey()`).
  There is no way to keep a list of sessions and let the user choose.
- **It's main-thread-only.** `localStorage` is not available to Web Workers, so we can't move
  serialization or heavy data handling off the main thread.
- **It can't hold binary data.** Files the user drags onto Rapid (GeoJSON, GPX, KML) are re-read
  from disk every session because we have nowhere durable to keep them.

IndexedDB solves all of these: it is asynchronous, worker-accessible, orders of magnitude larger
(quota is a percentage of free disk, often hundreds of MB to several GB), supports multiple named
object stores, and stores structured-clonable values including `Blob`/`File`/`ArrayBuffer` natively.

## Goals

1. Introduce a single, domain-agnostic `DatabaseSystem` that wraps IndexedDB behind a small, typed,
   Promise-based API.
2. Let consuming systems **own their own object stores** ("tables") — the engine knows nothing about
   what it holds, mirroring the `SettingsSystem` philosophy.
3. Version the database schema and support deterministic, ordered migrations (as `SettingsSystem`
   does for its payloads).
4. Replace the `localStorage` edit-history backup with IndexedDB-backed **multi-session storage**:
   serialize multiple named sessions, list them at startup, and let the user restore or remove each.
5. Persist **dropped-in data files** (GeoJSON/GPX/KML, stored as blobs) so they survive a restart
   and don't need to be re-added.
6. Make **storage management a first-class concern**: report usage, estimate remaining quota
   (`navigator.storage.estimate()`), and offer cleanup of old/large data.
7. Be worker-friendly in design, so serialization and bulk data handling can move off the main
   thread later.
8. Degrade gracefully when IndexedDB is unavailable (private-browsing edge cases, non-browser/CLI,
   test environments) — the same way `StorageSystem` falls back to a mock.

## Non-Goals (initial scope)

- Replacing `StorageSystem` / `localStorage`. Small, synchronous key/value preferences stay there
  (and in `SettingsSystem`). `DatabaseSystem` is for large/async/binary data only.
- Cross-device sync. IndexedDB is device-scoped, like `localStorage`. (Session/file sync to a remote
  backend is possible future work but out of scope here.)
- A conflict-free replicated data type (CRDT) or live-query/reactive layer.
- A full file-manager UI. We design the storage-management *API* now; the UI can come later.
- Moving edit serialization into a worker in v1 (design for it; implement later).

## Design Principles

- **Domain-agnostic engine.** `DatabaseSystem` stores and retrieves records in named stores and
  knows nothing about their meaning — exactly like `SettingsSystem` with its generic tree.
- **Store-owned by consumers.** Each system declares the store(s) it needs and owns the shape of the
  records it writes. The engine only coordinates the shared database, its version, and migrations.
- **Async first.** Every data method returns a `Promise`. No synchronous reads.
- **Migration-safe.** The database carries a single monotonic version number; schema changes go
  through ordered `upgrade` steps.
- **Quota-aware.** Storage usage and estimates are queryable; the system provides hooks for cleanup.
- **Graceful degradation (a general Rapid principle).** `DatabaseSystem` is an **optional system**.
  When persistent storage isn't available — private/incognito windows, browsers that deny IndexedDB,
  cleared-on-exit profiles, CLI, tests — Rapid must still work; only *durability* is lost, not
  functionality. The user can keep editing and dropping in files; that data simply lives for the
  session and is gone when it ends. Callers treat `database` like any optional system (capture it at
  the top, branch on presence) and always have a working path when it's absent. See
  [Graceful Degradation](#graceful-degradation) below.

## Library Evaluation: wrap `idb`, or roll our own?

IndexedDB's native API is notoriously awkward (event-based, verbose, no Promises). We surveyed the
leading helper libraries (data verified 2026-09, from npm / GitHub / bundlephobia):

| | `idb` 8.x | `dexie` 4.x | `idb-keyval` 6.x | `localForage` 1.10 | `rxdb` 17.x |
|---|---|---|---|---|---|
| **Gzip size** | **1.4 KB** ✅ | 30 KB ⚠️ | **0.8 KB** ✅ | 8.7 KB | 49 KB ❌ + rxjs |
| **Dependencies** | 0 | 0 | 0 | 1 (`lie` polyfill) | 23 |
| **Last release** | May 2025 | Sep 2026 ✅ | Jul 2026 ✅ | **Aug 2021** ❌ dead | Aug 2026 |
| **TS quality** | ⭐⭐⭐ `DBSchema` generics | ⭐⭐⭐ `EntityTable<T>` | ⭐⭐ basic generics | ⭐ basic | ⭐⭐⭐ JSON Schema |
| **Multi-store** | ✅ | ✅ | ❌ single store | ❌ single store | ✅ |
| **Migrations** | ✅ `upgrade()` cb | ✅ chained `.version()` | ❌ | ❌ | ✅ |
| **Transactions** | ✅ native IDB tx | ✅ | ❌ | ❌ | ✅ |
| **Cursor iteration** | ✅ `for await` | ✅ `.each()` | ❌ | ⚠️ callback | ✅ |
| **Blob/File** | ✅ native SC | ✅ native SC | ✅ native SC | ✅ explicit | ✅ plugin |
| **Bulk writes** | ⚠️ manual tx | ✅ `bulkPut` | ✅ `setMany` | ❌ | ✅ |
| **Quota helpers** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **License** | ISC | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |

Notes per candidate:

- **`idb`** (Jake Archibald) — a featherweight (1.4 KB gz, zero-dep, ISC) Promise wrapper over raw
  IDB. It keeps IDB's exact concepts (stores, transactions, cursors, `upgrade`) but makes them
  `async/await`-friendly. Its `DBSchema` interface gives **compile-time-typed store names, value
  shapes, key types, and index types** — an excellent fit for our "each subsystem declares its own
  store types" model. Most-downloaded IDB helper by a wide margin.
- **`dexie`** — the most ergonomic option (fluent `.where().above().sortBy()` query DSL, first-class
  chained `.version().upgrade()` migrations, fast `bulkPut`). But it costs **~30 KB gz (≈21× `idb`)**
  for an ORM/query layer we don't need. Rapid cares about bundle size, so this is the main reason not
  to adopt it now.
- **`idb-keyval`** — even smaller than `idb`, but it's a single-store key/value store with **no
  multi-store and no migrations**. It can't be the foundation for stores owned by many subsystems.
- **`localForage`** — **unmaintained** (last release Aug 2021, ships a `lie` Promise polyfill, no
  multi-store, no migrations). Disqualified.
- **`rxdb`** — a full local-first reactive database (49 KB gz + rxjs, 23 deps). Solves sync,
  replication, and reactive queries — none of which are requirements. Overkill.

### Recommendation: **build `DatabaseSystem` on `idb`**

Reasoning:

1. **Bundle cost is effectively nil** (1.4 KB gz, zero deps) — the single most important factor for
   Rapid, and the reason we don't take Dexie's nicer DX.
2. **`DBSchema` generics** map directly onto our architecture: the engine composes a union of the
   per-subsystem store schemas, and `openDB<RapidDB>()` type-checks every access.
3. **`idb` is a thin wrapper, not a framework.** We keep native IDB semantics (transactions,
   cursors, `upgrade`), so we retain full control and there's an easy exit if we ever outgrow it.
4. **Blob/File support is native** to IDB's structured clone — no library-specific machinery.
5. **We still write a `DatabaseSystem` wrapper** on top of `idb` to add what `idb` deliberately
   omits: the store registry, our migration ordering, quota/estimate/cleanup, and the
   `AbstractSystem` lifecycle. `idb` handles the IDB plumbing; `DatabaseSystem` handles the policy.

> Escape hatch: if Rapid later needs rich querying or large bulk imports and can absorb the size,
> Dexie is the natural upgrade path. Wrapping `idb` behind our own API keeps that door open — the
> `DatabaseSystem` interface is what consumers depend on, not `idb` directly.

`navigator.storage.estimate()` is orthogonal to every library; `DatabaseSystem` calls it directly.

## Architecture

```
     consuming systems (own their stores + record shapes)
   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
   │  EditSystem  │  │  RapidSystem │  │ (future systems) │
   │  'sessions'  │  │  'dataFiles' │  │  '...'           │
   └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘
          │  register store + migrations        │
          ▼                 ▼                   ▼
   ┌─────────────────────────────────────────────────────┐
   │                   DatabaseSystem                    │
   │  - opens/owns the single 'Rapid' IDB database       │
   │  - collects store definitions + ordered migrations  │
   │  - runs schema upgrades on version bump             │
   │  - CRUD / bulk / cursor helpers, all async          │
   │  - quota: usage(), estimate(), cleanup hooks        │
   │  - in-memory mock fallback when IDB unavailable     │
   └───────────────────────┬─────────────────────────────┘
                           │  wraps
                           ▼
                      idb  (openDB, transactions, cursors)
                           │
                           ▼
                   browser IndexedDB
```

- One IndexedDB database for the whole app (e.g. named `Rapid`), one schema version number.
- Multiple object stores within it, each owned by a consuming system.
- `DatabaseSystem` is the only code that talks to `idb`/IndexedDB directly.

## Store Registration

The engine must know the full set of stores and their indexes **before** it opens the database,
because IndexedDB can only create/alter stores inside an `upgrade` transaction. Two options:

**Option A — static manifest (recommended for v1).** A single module-private list of store
definitions inside `DatabaseSystem.ts` (the one place that carries this cross-cutting knowledge,
analogous to `SettingsSystem`'s migration table). Each entry names the store, its key strategy, and
its indexes. Consuming systems reference stores by name but don't have to register at runtime.

```ts
interface StoreDefinition {
  name: StoreName;               // e.g. 'sessions', 'dataFiles'
  keyPath?: string | string[];   // in-line keys, or omit for out-of-line keys
  autoIncrement?: boolean;
  indexes?: Array<{
    name: string;
    keyPath: string | string[];
    options?: IDBIndexParameters;   // { unique, multiEntry }
  }>;
  sinceVersion: number;          // schema version that introduced this store
}
```

**Option B — dynamic registration.** Systems call `database.registerStore(def)` during `initAsync`
before the DB opens. More decoupled, but requires careful ordering (all registrations must complete
before the first open) and complicates the version story. Deferred unless needed.

**Decision (agreed in review): Option A.** The `DatabaseSystem` owns a single store
manifest/schema and **asserts it at startup** (creating any missing stores/indexes via the migration
`upgrade`), rather than making each consuming system responsible for registering its own store. This
keeps the cross-cutting schema knowledge in one place, is deterministic, and matches how
`SettingsSystem` owns its migration table. Consuming systems reference stores by name and own only
their *record shapes and semantics*.

## Schema Versioning & Migrations

Follows the `SettingsSystem` pattern: one monotonically increasing version constant plus an ordered
list of migration steps. `idb`'s `upgrade(db, oldVersion, newVersion, tx)` callback runs exactly the
steps between the stored version and the current one.

```ts
const CURRENT_DB_VERSION = 1;

interface DatabaseMigration {
  toVersion: number;
  /** Runs inside the IDB upgrade transaction. Create/alter stores & indexes; transform records. */
  migrate(db: IDBPDatabase, tx: IDBPTransaction, oldVersion: number): void | Promise<void>;
}

const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    toVersion: 1,
    migrate(db) {
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('by-updatedAt', 'updatedAt');
      db.createObjectStore('dataFiles', { keyPath: 'id' });
    }
  }
  // future: { toVersion: 2, migrate(...) { ... } }
];
```

Migration guarantees (same contract as settings migrations):

- Deterministic and ordered; each step only runs once when crossing its version boundary.
- Store/index creation happens **only** inside `upgrade`; record back-fills that need to read data
  use the provided upgrade transaction.
- Unit-tested per step (against `fake-indexeddb`, see Testing).

## Proposed API Sketch

A generic, Promise-based, store-oriented API. `T` is the record type owned by the caller.

```ts
type StoreName = string;   // consider a branded `StoreName` id type

interface DatabaseSystem {
  readonly databaseVersion: number;
  readonly isAvailable: boolean;      // false when running on the in-memory mock

  // --- lifecycle (from AbstractSystem) ---
  initAsync(): Promise<void>;         // opens the DB, runs migrations
  startAsync(): Promise<void>;
  resetAsync(): Promise<void>;        // does NOT wipe durable data; clears in-memory caches only

  // --- single-record CRUD ---
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<IDBValidKey>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  has(store: StoreName, key: IDBValidKey): Promise<boolean>;

  // --- bulk / iteration ---
  getAll<T>(store: StoreName, query?: IDBKeyRange, count?: number): Promise<T[]>;
  getAllKeys(store: StoreName, query?: IDBKeyRange): Promise<IDBValidKey[]>;
  putMany<T>(store: StoreName, values: Array<{ key?: IDBValidKey; value: T }>): Promise<void>;
  deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void>;
  count(store: StoreName, query?: IDBKeyRange): Promise<number>;
  clear(store: StoreName): Promise<void>;
  iterate<T>(store: StoreName, fn: (value: T, key: IDBValidKey) => void, query?: IDBKeyRange): Promise<void>;

  // --- index queries ---
  getFromIndex<T>(store: StoreName, index: string, key: IDBValidKey): Promise<T | undefined>;
  getAllFromIndex<T>(store: StoreName, index: string, query?: IDBKeyRange): Promise<T[]>;

  // --- explicit transactions (advanced; atomic multi-op) ---
  transaction<R>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: DatabaseTransaction) => Promise<R>): Promise<R>;

  // --- storage management (first-class) ---
  estimateQuotaAsync(): Promise<StorageEstimate | null>;   // navigator.storage.estimate()
  usageByStoreAsync(): Promise<Map<StoreName, { count: number; bytes: number }>>;
  requestPersistentAsync(): Promise<boolean>;              // navigator.storage.persist()
}
```

Details:

- `resetAsync()` clears in-memory caches but **must not** delete durable records — sessions and data
  files should survive an edit-session reset / source switch. (Contrast with `EditSystem.clearBackup`,
  which is an explicit user action.)
- `put`/`get` accept a caller-supplied record type `T`; the engine itself stays untyped-generic. With
  `idb`'s `DBSchema` we can also expose per-store typed accessors internally.
- `usageByStoreAsync()` estimates per-store byte usage (by summing serialized record sizes) since IDB
  doesn't report it directly — this powers the storage-management UI.
- All methods no-op or return sensible empties on the in-memory mock, so callers don't special-case.

## Use Case 1 — Multiple Editing Sessions (replaces the localStorage backup)

**Today:** `EditSystem.toJSON()` produces a versioned blob (`{ version: 3, entities, baseEntities,
stack, nextIDs, index, timestamp }`) that `immediateBackup()` **stringifies** and writes to the
single `localStorage` key `Rapid_<origin>_saved_history`. On startup, `initAsync` checks for that one
key and offers restore/discard. Two long-standing pain points:

- **Serialization is slow.** `toJSON()` + `JSON.stringify()` walk the entire history and re-copy
  every modified entity on *every* debounced backup. As a session accumulates edits this gets
  expensive (see old Rapid/iD tickets about backup cost). IndexedDB stores **structured-clonable
  objects directly**, so we can persist the structured session object and skip the stringify step
  entirely — a real performance win.
- **The single-slot prompt is unreliable.** Because there's exactly one backup key gated by a
  multi-tab mutex, users hit confusing states: Rapid starts without prompting because another tab
  holds the lock, then days later (tabs closed) surfaces a forgotten session. Moving to a listed set
  of sessions with clear timestamps and an explicit restore/remove choice removes this class of bug.

**Implemented:** a `sessions` object store keyed by a generated `sessionID`, each record wrapping the
structured history object plus metadata (as shipped in Phase 2):

```ts
interface SessionRecord {
  id: SessionID;             // crypto.randomUUID (or the legacy backup key for a localStorage session)
  origin: string;            // window.location.origin (replaces the key-name scoping hack)
  createdAt: number;
  updatedAt: number;         // 0 if unknown (legacy)
  editCount: number;         // for the list UI
  bbox?: { minX; minY; maxX; maxY };  // geographic extent of the edits (for the list + geocoding)
  summary: string[];         // most common feature tag keys, e.g. ['building', 'highway']
  backupVersion: number;     // the existing EditSystem backup schema version (currently 3)
  legacy?: boolean;          // true for a synthetic localStorage-backed record (not yet upgraded)
  data: BackupJSON;          // the STRUCTURED backup object (not a JSON string) — stored via
                             // IndexedDB structured clone; no JSON.stringify on the hot path
}
```

- `EditSystem` mints a unique `crypto.randomUUID` session id per editing session (cleared on reset,
  set when restoring an existing session) and writes/updates that record (debounced, as before).
  Because IDB is async and much larger, quota failures become rare, the write no longer blocks the
  main thread, and — critically — we **store the structured object directly**, avoiding the costly
  `JSON.stringify` on every backup. Restore uses `fromBackupAsync()` (structured) — `fromJSONAsync()`
  is now a thin string-parsing wrapper over it.
- **On startup, list all sessions for this origin** (`listRestorableSessionsAsync`) and present them
  in the restore UI: restore one, delete one, or skip. This is the headline feature — moving from
  "one restorable backup" to "pick from a list" — and it fixes the unreliable single-slot/multi-tab
  prompt described above.
- **Retention: keep sessions indefinitely; evict only on explicit user action.** No auto-cap or
  auto-expiry. A session is removed only when the user deletes it from the list (or `clearBackup()`
  on source-switch / after upload removes the *active* session).
- **localStorage is read-only now.** Rapid no longer writes edits to `localStorage`. A legacy
  `Rapid_<origin>_saved_history` backup is still *read* and surfaced as a restore candidate; when the
  user restores it, it is **upgraded** to a fresh IndexedDB session and the legacy key is removed.
- **Session metadata** (`editCount`, `bbox`, `summary`) is computed from the backup at write time
  (and on the fly for the synthetic legacy record). The restore UI reverse-geocodes each `bbox`
  center via the `nominatim` service to show a place name.

### Multi-tab & the retired mutex

Phase 2 **retired `utilSessionMutex`**. It previously enforced a single writer across tabs (and
gated the single localStorage slot). With per-session unique ids, two tabs write independent session
records and never clobber each other, so the mutex's guarantee is unnecessary. Trade-off: a second
tab can now list (and fork) another tab's *live* session; acceptable for now — a future refinement
could mark a session "in use" via a recent-`updatedAt` heartbeat.

> **Gotcha uncovered (recorded as a lesson):** the EditSystem unit tests only ran under bare Bun
> because constructing `utilSessionMutex('lock')` had a **side effect of polyfilling `document`**.
> `EditSystem` calls `select(document).interrupt('editTransition')` in ~10 hot paths; removing the
> mutex exposed that latent DOM dependency. Fixed properly by guarding those calls behind a
> `_interruptTransition()` helper (no-op when there is no DOM) — also correct for a future CLI.

## Use Case 2 — Persisted Data Files (dropped-in GeoJSON/GPX/KML)

**Today:** `PixiLayerCustomData` reads dropped/selected files via `FileReader.readAsText()` and

## Use Case 2 — Persisted Data Files (dropped-in GeoJSON/GPX/KML)

**Today:** `PixiLayerCustomData` reads dropped/selected files via `FileReader.readAsText()` and
`RapidDataset.loadFileAsync()` parses them, but nothing is persisted — reload loses them.

**Proposed:** a `dataFiles` store keyed by a generated `dataFileID`:

```ts
interface DataFileRecord {
  id: DataFileID;
  name: string;              // original filename
  extension: string;         // '.geojson' | '.gpx' | '.kml' | '.json'
  mimeType?: string;
  addedAt: number;
  size: number;              // bytes, for storage management
  blob: Blob;                // stored natively via structured clone
}
```

- When the user drops a file, `RapidSystem`/`PixiLayerCustomData` also writes a `DataFileRecord`
  (the raw `Blob`) so it persists.
- On startup, offer to reload previously added files (or auto-reload, TBD) without re-dragging.
- Storing the raw `Blob` (not the parsed GeoJSON) keeps the original bytes and lets us re-parse with
  updated logic later. This is exactly the "blob-storage-ify a file" capability requested.

## Use Case 3 — Storage Management (first-class)

Because sessions and files can consume real space, `DatabaseSystem` treats storage as something to
be *managed*, not just written:

- **Estimate:** `estimateQuotaAsync()` wraps `navigator.storage.estimate()` → `{ usage, quota }`, so
  the UI can show "X MB of ~Y MB used."
- **Per-store breakdown:** `usageByStoreAsync()` attributes usage to `sessions` vs `dataFiles` vs
  other stores (approximate, by summing record sizes).
- **Persistence:** `requestPersistentAsync()` wraps `navigator.storage.persist()` to ask the browser
  not to evict our data under storage pressure.
- **Cleanup hooks:** helpers to delete old sessions (by `updatedAt`), large/unused data files, or a
  whole store. Retention policy (e.g. keep newest N sessions, evict older than M days) is a policy
  decision layered on top of these primitives.
- **Future:** a basic "file browser" UI to inspect and prune stored sessions and files.

## Ownership and Boundaries

- `DatabaseSystem` owns the database lifecycle: open, version, migrate, CRUD/bulk/transaction
  helpers, quota/estimate/cleanup, mock fallback.
- Consuming systems own their record shapes and semantics; they never open IDB directly.
- **`StorageSystem` stays** for small synchronous key/value data; `SettingsSystem` stays for durable
  typed preferences. `DatabaseSystem` is specifically for large / async / binary / multi-record data.

Boundary guidance:

| Data | Home |
|---|---|
| Small preferences, flags, UI state | `SettingsSystem` (→ `StorageSystem` / OSM prefs) |
| One-off small key/value | `StorageSystem` |
| Edit history / sessions (large, multi) | **`DatabaseSystem`** |
| Dropped data files / blobs | **`DatabaseSystem`** |

## Lifecycle & Dependencies

- `DatabaseSystem extends AbstractSystem`, registered in
  [`modules/core/index.ts`](../../modules/core/index.ts) and typed in
  [`modules/core/types.ts`](../../modules/core/types.ts) as `context.systems.database`. New
  `SystemID` `'database'`.
- `initAsync()` opens the `Rapid` database (running migrations). `DatabaseSystem` is an **optional**
  dependency everywhere it's used — `EditSystem`, `RapidSystem`, and any future consumer capture it
  at the top of the relevant function and branch on presence, always keeping a working path when it's
  absent (see [Graceful Degradation](#graceful-degradation)).
- **`EditSystem` treats `database` as optional**, with the existing `StorageSystem`/`localStorage`
  path as the fallback during rollout — so we ship incrementally and keep the `localStorage` backup
  working until the multi-session UI lands. Longer term, `localStorage` becomes the *degraded* path
  used only when no database is available.
- Because IDB is worker-accessible, the design keeps the API worker-portable for a future move of
  serialization into `WorkerSystem` (see [Future: Worker-Based Validation](#future-worker-based-validation)).

## Graceful Degradation

`DatabaseSystem` may be **entirely unavailable at runtime**, and that must be a supported state, not
an error:

- **Private / incognito windows.** Some browsers deny or heavily restrict IndexedDB in private mode,
  or wipe it when the last private window closes.
- **Locked-down / privacy-focused browsers** may block IndexedDB entirely.
- **Non-browser contexts** (a future CLI) and **tests** without a polyfill have no IndexedDB.
- **`openDB` can simply throw** (e.g. `SecurityError`), exactly as `localStorage` access can.

Behavior when unavailable:

- On open failure or a missing `indexedDB` global, fall back to an in-memory `Map`-of-`Map`s that
  satisfies the same API. `isAvailable` reports `false`. Data written during the session works
  normally but is **not durable** — it's gone when the session ends.
- **Tell the user, once, non-intrusively.** When a durability-dependent action happens without
  persistent storage (e.g. the user drops a file, or starts accumulating edits), surface a gentle
  notice like: *"Heads up — permanent storage isn't available right now. You can keep working, but
  this data won't be saved when you close Rapid."* We don't block the action.
- Concrete example: a user drops a GeoJSON file **in incognito mode**. It loads and renders fine, but
  it won't reappear in a later normal-mode session — and we told them so up front.

This "work first, persist if we can, and be honest when we can't" stance is a **general Rapid
principle**, not specific to this system. Other optional systems (`ui`, `locations`, `scheduler`)
already follow the "capture-and-branch, always keep a working path" pattern; `DatabaseSystem` extends
it to durable storage. (Worth codifying in the agent instructions / a top-level design note.)

## Future: Worker-Based Validation

A payoff beyond persistence: **IndexedDB is readable from Web Workers.** As the user's active session
accumulates edits, `EditSystem` already persists them to the `sessions` store. A worker can read
those edits back out of IndexedDB (at a slight delay) and run validation there — **without
`postMessage`-ing the edit graph across the worker boundary** on every change. Offloading validation
to a worker is a long-standing stretch goal in Rapid's docs; the shared IndexedDB backing store makes
it substantially cheaper, since the data is already there for the worker to read. Out of scope for
the initial phases, but the async, worker-portable API is designed with this in mind.

## Testing

- Unit-test against **`fake-indexeddb`** (a spec-compliant in-memory IDB polyfill) preloaded in the
  bun test setup, so store CRUD, transactions, cursors, and each migration step run headlessly.
- Test the mock fallback path (no IDB) independently.
- Follow the project's "meaningful assertions" rule: assert on actual stored/retrieved records and
  post-migration shapes, not `assert.isTrue(true)`.

## Rollout Plan

### Phase 0 — Design + scaffolding ✅ done
- Landed the `DatabaseSystem` skeleton in [`modules/core/DatabaseSystem.ts`](../../modules/core/DatabaseSystem.ts):
  `AbstractSystem` lifecycle, `idb` open + version, the central store manifest, manifest-driven
  schema `upgrade`, an in-memory mock fallback, CRUD/bulk/iterate/index/transaction helpers, and the
  quota/estimate/usage/persist API. Registered as `context.systems.database` (new `'database'`
  `SystemID`) and exported from `headless.js`. Added `idb` (dependency) and `fake-indexeddb`
  (dev). Unit tests in [`test/unit/core/DatabaseSystem.test.js`](../../test/unit/core/DatabaseSystem.test.js)
  cover CRUD, bulk, index queries, transactions, blob round-trips, storage management, and the
  no-IndexedDB fallback. No behavior change to existing systems.

### Phase 1 — Sessions store, behind the existing backup ✅ done
- Added the `sessions` store (keyed by a per-origin id, indexed `by-updatedAt` and `by-origin`).
- `EditSystem` now takes `database` as an **optional** dependency and **dual-writes**: it builds the
  structured backup once (`toBackup()`), writes the stringified copy to `localStorage` (fallback) and
  the **structured object** to IndexedDB (no `JSON.stringify` on the IDB path). `toJSON()` is now a
  thin wrapper over `toBackup()`, and `fromJSONAsync()` a thin wrapper over the new `fromBackupAsync()`
  (the shared restore path).
- On init (outside the test/CLI early-return), restore detection **prefers the IndexedDB session**,
  falling back to the legacy `localStorage` backup; the legacy key is imported into IndexedDB once.
  `restoreBackup()` restores from the structured session when present; `clearBackup()` removes both.
- Tests in [`test/unit/core/EditSystem.test.js`](../../test/unit/core/EditSystem.test.js) cover the
  `toBackup`/`fromBackupAsync` seam.

### Phase 2 — Multi-session restore UI ✅ done
- **Multiple concurrent sessions:** `EditSystem` mints a unique `crypto.randomUUID` per session
  (`_sessionID`, cleared on reset, set on restore, minted lazily on first backup). Sessions are keyed
  by uuid in the `sessions` store (indexed `by-origin` and `by-updatedAt`).
- **localStorage read-only:** Rapid no longer writes edits to localStorage; the legacy key is read
  and offered as a restore candidate, and **upgraded** to an IndexedDB session on restore.
- **Retired `utilSessionMutex`** and all its gates. Guarded the exposed `select(document)` calls
  behind `_interruptTransition()` (headless-safe).
- **Restore UI** (`UiRestore`) rewritten as a session list: date / location (reverse-geocoded via
  `nominatim`) / summary / per-row Restore + Delete, with a "Skip for now" footer, plus a
  no-permanent-storage notice. New `restore.*` l10n strings.
- **EditSystem API:** `listRestorableSessionsAsync`, `restoreSessionAsync(id)`, `deleteSessionAsync(id)`,
  `dismissRestore`, plus `_computeSessionMeta`/`_backupBBox`/`_backupSummary`. `immediateBackup()`
  now returns its write promise (awaitable in tests). `DatabaseSystem.getAllKeysFromIndex` added for
  a cheap startup existence check.
- Tests: `test/unit/core/EditSystemSessions.test.js` (multi-session, legacy upgrade, delete, dismiss,
  metadata) and an extra `DatabaseSystem` index-keys test.

### Phase 3 — Data files store
- Persist dropped-in files as `DataFileRecord` blobs; offer reload on startup.

### Phase 4 — Storage management
- Surface `estimateQuotaAsync` / `usageByStoreAsync`, retention/cleanup policies, and (later) a
  storage/file-browser UI.

### Phase 5 — Worker offload (optional, later)
- Move edit serialization / bulk data handling into `WorkerSystem`, leveraging IDB's worker access.

## Resolved Decisions

- **`idb` vs. roll-your-own** → wrap **`idb`** (1.4 KB gz, zero-dep, `DBSchema` generics). We still
  write our own `DatabaseSystem` policy layer on top.
- **Store registration** → **Option A**: `DatabaseSystem` owns a single central store manifest and
  asserts it at startup.
- **Session retention** → **keep indefinitely; evict only on explicit user restore/clear.** No
  auto-cap or auto-expiry.
- **Session payload** → store the **structured backup object directly** (no `JSON.stringify` on the
  hot path); keep `backupVersion` for the existing restore/upgrade logic.
- **`database` dependency strength** → **optional everywhere**, with `localStorage` as the degraded
  fallback during rollout. `DatabaseSystem` is an optional system (graceful degradation).

## Open Questions (for review)

1. **Data-file reload:** auto-reload persisted files on startup, or prompt the user? (Phase 3.)
2. **Database name/scoping:** single `Rapid` database with `origin` stored per-record (proposed), or
   a per-origin database name?
3. **Codify graceful degradation** as a general principle in the agent instructions / a top-level
   design note (not just here)?
