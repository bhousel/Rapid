import { openDB } from 'idb';
import { AbstractSystem } from './AbstractSystem.ts';

import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { Context } from '../Context.ts';


// ---------------------------------------------------------------------------
// Database constants
// ---------------------------------------------------------------------------

/** Name of the single IndexedDB database that holds all of Rapid's durable data. */
const DATABASE_NAME = 'Rapid';
/**
 * The latest database schema version. Bump this when adding a store or migration.
 * - v1: `sessions` store (edit-history sessions, owned by `EditSystem`)
 * - v2: `files` store (arbitrary user files stored as native Blobs)
 */
const CURRENT_DB_VERSION = 2;


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Name of an object store ("table") within the Rapid database. */
export type StoreName = string;

/**
 * A file stored in the `files` object store. The file's bytes are kept as a **native `Blob`**
 * (structured clone) — no base64 / `ArrayBuffer` conversion — so writes and reads are cheap and the
 * browser can stream large files from disk. The metadata fields make the store queryable and let a
 * UI show name / type / size without reading the blob.
 */
export interface FileRecord {
  /** Unique id (a generated `crypto.randomUUID`, or a caller-supplied stable id for upsert). */
  id: FileID;
  /** Original filename, e.g. `'buildings.geojson'`. */
  name: string;
  /** Lowercased file extension including the dot, e.g. `'.geojson'` (derived from `name`). */
  extension: string;
  /** MIME type (`blob.type`), e.g. `'application/geo+json'`; may be `''` if the browser didn't set one. */
  type: string;
  /** Size in bytes (`blob.size`). */
  size: number;
  /** When the file was first stored (ms since epoch). */
  createdAt: number;
  /** When the file was last written (ms since epoch). */
  updatedAt: number;
  /** The file's bytes, stored natively as a `Blob` (a `File` is a `Blob` and round-trips as-is). */
  blob: Blob;
}

/** Options for `putFileAsync`. */
export interface PutFileOptions {
  /** Stable id to store under (enables upsert); a new `crypto.randomUUID` is generated if omitted. */
  id?: FileID;
  /** Override the filename; defaults to a `File`'s `.name`, else `'untitled'`. */
  name?: string;
  /** Override the MIME type; defaults to the blob's `.type`. */
  type?: string;
}

/** Definition of a single index on an object store. */
export interface StoreIndexDefinition {
  /** Index name, used to look the index up later. */
  name: string;
  /** The record property (or properties) the index is built on. */
  keyPath: string | string[];
  /** Standard IndexedDB index options (`unique`, `multiEntry`). */
  options?: IDBIndexParameters;
}

/** Definition of a single object store in the database manifest. */
export interface StoreDefinition {
  /** Store name. */
  name: StoreName;
  /** In-line key path, or omit for out-of-line keys supplied at write time. */
  keyPath?: string | string[];
  /** Whether the store generates auto-incrementing keys. */
  autoIncrement?: boolean;
  /** Indexes to create on the store. */
  indexes?: StoreIndexDefinition[];
  /** Schema version that first introduced this store. */
  sinceVersion: number;
}

/** A single ordered data-migration step (store creation is manifest-driven, see `_upgrade`). */
export interface DatabaseMigration {
  /** The schema version this step upgrades the database to. */
  toVersion: number;
  /**
   * Transforms records during an `upgrade` transaction. Runs only when crossing this
   * step's version boundary. Store/index creation is handled separately from the manifest.
   * @param db - The database being upgraded
   * @param tx - The active version-change transaction
   * @param oldVersion - The version the database is upgrading from
   */
  migrate(
    db: IDBPDatabase,
    tx: IDBPTransaction<unknown, string[], 'versionchange'>,
    oldVersion: number
  ): void | Promise<void>;
}

/** Per-store usage statistics reported by `usageByStoreAsync`. */
export interface StoreUsage {
  /** Number of records in the store. */
  count: number;
  /** Approximate size of the store's records, in bytes. */
  bytes: number;
}

/** A single entry for a bulk `putMany` write. */
export interface PutManyEntry<T = unknown> {
  /** The record to store. */
  value: T;
  /** Out-of-line key, omitted for stores that use an in-line `keyPath`. */
  key?: IDBValidKey;
}

/** A minimal transactional facade passed to `transaction()` callbacks. */
export interface DatabaseTransaction {
  /**
   * Reads a single record within the transaction.
   * @param store - Store to read from
   * @param key - Key to look up
   * @return The stored record, or `undefined` if absent
   */
  get(store: StoreName, key: IDBValidKey): Promise<any>;
  /**
   * Reads all records from a store within the transaction.
   * @param store - Store to read from
   * @return An array of all stored records
   */
  getAll(store: StoreName): Promise<any[]>;
  /**
   * Writes a single record within the transaction.
   * @param store - Store to write to
   * @param value - The record to store
   * @param key - Out-of-line key, omitted for in-line `keyPath` stores
   * @return The key the record was stored under
   */
  put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  /**
   * Deletes a single record within the transaction.
   * @param store - Store to delete from
   * @param key - Key to delete
   */
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
}

/** The subset of an IndexedDB object store the transaction facade uses. */
interface FacadeStore {
  get(key: IDBValidKey): Promise<unknown>;
  getAll(): Promise<unknown[]>;
  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  delete(key: IDBValidKey): Promise<void>;
}


// ---------------------------------------------------------------------------
// Store manifest — the one place that carries the schema layout.
// `DatabaseSystem` owns this and asserts it at startup (see review decision in
// `.github/design/database-system.md`). Consuming systems reference stores by
// name and own only their record shapes, not the schema.
// ---------------------------------------------------------------------------

const STORE_MANIFEST: StoreDefinition[] = [
  {
    name: 'sessions',
    keyPath: 'id',
    indexes: [
      { name: 'by-updatedAt', keyPath: 'updatedAt' },
      { name: 'by-origin', keyPath: 'origin' }
    ],
    sinceVersion: 1
  },
  {
    name: 'files',
    keyPath: 'id',
    indexes: [
      { name: 'by-updatedAt', keyPath: 'updatedAt' },
      { name: 'by-name', keyPath: 'name' }
    ],
    sinceVersion: 2
  }
];

/** Ordered data migrations. Empty for v1 — store creation is manifest-driven. */
const DATABASE_MIGRATIONS: DatabaseMigration[] = [];


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clones a value for the in-memory mock so callers can't mutate stored state. */
function clone<T>(value: T): T {
  return (value === undefined) ? value : structuredClone(value);
}

/** Compares two index keys for ascending sort in the in-memory mock. */
function compareKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

/**
 * Estimates the byte size of a stored value. Counts real `Blob` bytes (including blobs nested
 * inside a record, e.g. a `FileRecord.blob`) plus the length of the record's other JSON, so the
 * `files` store's usage reflects actual file sizes rather than a short placeholder.
 * @param value - The stored value to size
 * @return The estimated size in bytes
 */
function estimateBytes(value: unknown): number {
  if (value instanceof Blob) return value.size;

  let blobBytes = 0;
  try {
    const jsonLength = JSON.stringify(value, (_key, v) => {
      if (v instanceof Blob) {
        blobBytes += v.size;
        return `blob:${v.size}`;   // keep the serialized form small; real bytes counted separately
      }
      return v;
    })?.length ?? 0;
    return jsonLength + blobBytes;
  } catch {
    return blobBytes;
  }
}


/**
 * The `DatabaseSystem` wraps the browser's asynchronous
 * [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) API. It is the
 * high-capacity, worker-accessible counterpart to `StorageSystem` (which wraps the small,
 * synchronous `localStorage`), and is the home for large durable data such as the user's edit
 * sessions and dropped-in data files.
 *
 * It is a **domain-agnostic** engine: it stores and retrieves records in named stores and knows
 * nothing about their meaning. The set of stores and indexes lives in a single central manifest
 * that this system owns and asserts at startup; consuming systems own only their record shapes.
 *
 * `DatabaseSystem` is an **optional system**. When IndexedDB is unavailable (private/incognito
 * windows, locked-down browsers, a future CLI, or tests without a polyfill), it falls back to an
 * in-memory mock that satisfies the same API — the app keeps working, but writes are not durable.
 * Callers should treat it like any optional system: capture it at the top of a function, branch on
 * presence, and always keep a working path when it is absent.
 *
 * See `.github/design/database-system.md` for the full design.
 */
export class DatabaseSystem extends AbstractSystem {

  /** The open IndexedDB database, or `null` when running on the in-memory mock. */
  protected _db: IDBPDatabase | null;
  /** In-memory fallback store used when IndexedDB is unavailable. */
  protected _mock: Map<StoreName, Map<IDBValidKey, unknown>> | null;
  /**
   * In-memory stats counters updated at write time so reads are O(1) with no serialization.
   * Counts are seeded from IDB on `initAsync()`; bytes start at 0 each session and accumulate
   * as writes happen (they are not persisted across page reloads).
   */
  protected _stats: Map<StoreName, StoreUsage>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'database';

    this._db = null;
    this._mock = null;
    this._stats = this._freshStats();
  }


  /**
   * Called after all core objects have been constructed.
   * Opens the database and asserts the store manifest, falling back to an in-memory mock
   * if IndexedDB is unavailable.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync()
      .then(() => this._openAsync())
      .then(() => this._seedStatsAsync());
  }


  /**
   * Called after completing an edit session to reset any internal state.
   * Durable data (sessions, files) is intentionally preserved across resets — this only
   * clears transient in-memory caches (currently none), so it is a no-op.
   * @return  Promise resolved immediately
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * The current database schema version.
   * @readonly
   */
  public get databaseVersion(): number {
    return CURRENT_DB_VERSION;
  }


  /**
   * Whether durable IndexedDB storage is available. `false` means the system is running on the
   * in-memory mock and writes will not survive the session.
   * @readonly
   */
  public get isAvailable(): boolean {
    return !!this._db;
  }


  /**
   * The names of all object stores defined in the manifest.
   * @readonly
   */
  public get storeNames(): StoreName[] {
    return STORE_MANIFEST.map(def => def.name);
  }


  // -------------------------------------------------------------------------
  // Single-record CRUD
  // -------------------------------------------------------------------------

  /**
   * Retrieves a single record by key.
   * @param store - Store to read from
   * @param key - Key to look up
   * @return The stored record, or `undefined` if not found
   */
  public async get<T = unknown>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    if (this._db) {
      return this._db.get(store, key) as Promise<T | undefined>;
    }
    return clone(this._mockStore(store).get(key)) as T | undefined;
  }


  /**
   * Stores a single record, overwriting any existing record with the same key.
   * @param store - Store to write to
   * @param value - The record to store
   * @param key - Out-of-line key, omitted for stores that use an in-line `keyPath`
   * @return The key the record was stored under
   */
  public async put<T = unknown>(store: StoreName, value: T, key?: IDBValidKey): Promise<IDBValidKey> {
    if (this._db) {
      const k = await this._db.put(store, value, key);
      this._statsAdd(store, value);
      return k;
    }
    const k = this._keyFor(store, value, key);
    this._mockStore(store).set(k, clone(value));
    this._statsAdd(store, value);
    return k;
  }


  /**
   * Removes a single record by key.
   * @param store - Store to delete from
   * @param key - Key to delete
   */
  public async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    if (this._db) {
      await this._db.delete(store, key);
      this._statsRemove(store, 1);
      return;
    }
    this._mockStore(store).delete(key);
    this._statsRemove(store, 1);
  }


  /**
   * Tests whether a record exists for the given key.
   * @param store - Store to check
   * @param key - Key to look up
   * @return `true` if a record exists
   */
  public async has(store: StoreName, key: IDBValidKey): Promise<boolean> {
    if (this._db) {
      return (await this._db.getKey(store, key)) !== undefined;
    }
    return this._mockStore(store).has(key);
  }


  // -------------------------------------------------------------------------
  // Bulk / iteration
  // -------------------------------------------------------------------------

  /**
   * Retrieves all records in a store.
   * @param store - Store to read from
   * @return An array of all stored records
   */
  public async getAll<T = unknown>(store: StoreName): Promise<T[]> {
    if (this._db) {
      return this._db.getAll(store) as Promise<T[]>;
    }
    return [...this._mockStore(store).values()].map(v => clone(v)) as T[];
  }


  /**
   * Retrieves all keys in a store.
   * @param store - Store to read from
   * @return An array of all keys
   */
  public async getAllKeys(store: StoreName): Promise<IDBValidKey[]> {
    if (this._db) {
      return this._db.getAllKeys(store);
    }
    return [...this._mockStore(store).keys()];
  }


  /**
   * Writes many records in a single transaction.
   * @param store - Store to write to
   * @param entries - The records (with optional out-of-line keys) to store
   */
  public async putMany<T = unknown>(store: StoreName, entries: PutManyEntry<T>[]): Promise<void> {
    if (this._db) {
      const tx = this._db.transaction(store, 'readwrite');
      await Promise.all([
        ...entries.map(entry => tx.store.put(entry.value, entry.key)),
        tx.done
      ]);
    } else {
      const mock = this._mockStore(store);
      for (const entry of entries) {
        mock.set(this._keyFor(store, entry.value, entry.key), clone(entry.value));
      }
    }
    for (const entry of entries) {
      this._statsAdd(store, entry.value);
    }
  }


  /**
   * Deletes many records by key in a single transaction.
   * @param store - Store to delete from
   * @param keys - The keys to delete
   */
  public async deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
    if (this._db) {
      const tx = this._db.transaction(store, 'readwrite');
      await Promise.all([
        ...keys.map(key => tx.store.delete(key)),
        tx.done
      ]);
    } else {
      const mock = this._mockStore(store);
      for (const key of keys) {
        mock.delete(key);
      }
    }
    this._statsRemove(store, keys.length);
  }


  /**
   * Counts the records in a store.
   * @param store - Store to count
   * @return The number of records
   */
  public async count(store: StoreName): Promise<number> {
    if (this._db) {
      return this._db.count(store);
    }
    return this._mockStore(store).size;
  }


  /**
   * Removes all records from a store.
   * @param store - Store to clear
   */
  public async clear(store: StoreName): Promise<void> {
    if (this._db) {
      await this._db.clear(store);
    } else {
      this._mockStore(store).clear();
    }
    // Reset this store's stats to zero — clear is the one operation where bytes are accurate.
    const s = this._stats.get(store);
    if (s) { s.count = 0; s.bytes = 0; }
  }


  /**
   * Iterates over every record in a store, invoking a callback for each.
   * @param store - Store to iterate
   * @param fn - Callback receiving each record and its key
   */
  public async iterate<T = unknown>(
    store: StoreName,
    fn: (value: T, key: IDBValidKey) => void
  ): Promise<void> {
    if (this._db) {
      const tx = this._db.transaction(store, 'readonly');
      let cursor = await tx.store.openCursor();
      while (cursor) {
        fn(cursor.value as T, cursor.key);
        cursor = await cursor.continue();
      }
      await tx.done;
      return;
    }
    for (const [key, value] of this._mockStore(store)) {
      fn(clone(value) as T, key);
    }
  }


  // -------------------------------------------------------------------------
  // Index queries
  // -------------------------------------------------------------------------

  /**
   * Retrieves a single record via one of a store's indexes.
   * @param store - Store to read from
   * @param index - Name of the index to query
   * @param key - Index key to look up
   * @return The first matching record, or `undefined`
   */
  public async getFromIndex<T = unknown>(
    store: StoreName, index: string, key: IDBValidKey
  ): Promise<T | undefined> {
    if (this._db) {
      return this._db.getFromIndex(store, index, key) as Promise<T | undefined>;
    }
    const keyPath = this._indexKeyPath(store, index);
    for (const value of this._mockStore(store).values()) {
      if (readPath(value, keyPath) === key) return clone(value) as T;
    }
    return undefined;
  }


  /**
   * Retrieves all records via one of a store's indexes, sorted ascending by the index key.
   * @param store - Store to read from
   * @param index - Name of the index to query
   * @param key - Optional exact index key to filter by; omit to return all records sorted
   * @return An array of matching records, sorted by the index key
   */
  public async getAllFromIndex<T = unknown>(
    store: StoreName, index: string, key?: IDBValidKey
  ): Promise<T[]> {
    if (this._db) {
      return this._db.getAllFromIndex(store, index, key) as Promise<T[]>;
    }
    const keyPath = this._indexKeyPath(store, index);
    let values = [...this._mockStore(store).values()];
    if (key !== undefined) {
      values = values.filter(v => readPath(v, keyPath) === key);
    }
    values.sort((a, b) => compareKeys(readPath(a, keyPath), readPath(b, keyPath)));
    return values.map(v => clone(v)) as T[];
  }


  /**
   * Retrieves the primary keys of all records matching one of a store's indexes, without loading
   * the record values. Useful for cheap existence/count checks.
   * @param store - Store to read from
   * @param index - Name of the index to query
   * @param key - Optional exact index key to filter by; omit to return all matching primary keys
   * @return An array of primary keys
   */
  public async getAllKeysFromIndex(
    store: StoreName, index: string, key?: IDBValidKey
  ): Promise<IDBValidKey[]> {
    if (this._db) {
      return this._db.getAllKeysFromIndex(store, index, key);
    }
    const keyPath = this._indexKeyPath(store, index);
    const out: IDBValidKey[] = [];
    for (const [primaryKey, value] of this._mockStore(store)) {
      if (key === undefined || readPath(value, keyPath) === key) {
        out.push(primaryKey);
      }
    }
    return out;
  }


  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  /**
   * Runs a set of operations against one or more stores as an atomic transaction.
   * @param stores - The stores participating in the transaction
   * @param mode - `'readonly'` or `'readwrite'`
   * @param fn - Callback that performs work using the provided transaction facade
   * @return The value returned by `fn`
   */
  public async transaction<R>(
    stores: StoreName[],
    mode: IDBTransactionMode,
    fn: (tx: DatabaseTransaction) => Promise<R>
  ): Promise<R> {
    if (this._db) {
      const tx = this._db.transaction(stores, mode);
      const objectStore = (store: StoreName): FacadeStore => tx.objectStore(store) as unknown as FacadeStore;
      const facade: DatabaseTransaction = {
        get: (store, key) => objectStore(store).get(key),
        getAll: (store) => objectStore(store).getAll(),
        put: (store, value, key) => objectStore(store).put(value, key),
        delete: (store, key) => objectStore(store).delete(key)
      };
      const result = await fn(facade);
      await tx.done;
      return result;
    }

    // Mock facade — best effort, no real atomicity.
    const facade: DatabaseTransaction = {
      get: async (store, key) => clone(this._mockStore(store).get(key)),
      getAll: async (store) => [...this._mockStore(store).values()].map(v => clone(v)),
      put: async (store, value, key) => {
        const k = this._keyFor(store, value, key);
        this._mockStore(store).set(k, clone(value));
        return k;
      },
      delete: async (store, key) => { this._mockStore(store).delete(key); }
    };
    return fn(facade);
  }


  // -------------------------------------------------------------------------
  // Storage management
  // -------------------------------------------------------------------------

  /**
   * Estimates the origin's overall storage usage and quota via `navigator.storage.estimate()`.
   * @return A `StorageEstimate`, or `null` if the API is unavailable
   */
  public async estimateQuotaAsync(): Promise<StorageEstimate | null> {
    const storageManager = globalThis.navigator?.storage;
    if (storageManager?.estimate) {
      try {
        return await storageManager.estimate();
      } catch {
        return null;
      }
    }
    return null;
  }


  /**
   * Returns per-store usage statistics (record count and estimated byte size).
   *
   * This is an **O(1) in-memory read** — counters are maintained at write time so there is no
   * record scanning or serialization on the read path. Counts are seeded from IDB on
   * `initAsync()`; bytes start at 0 each session and accumulate as writes happen (they are not
   * persisted, so bytes may undercount on the first query after a cold page load). Use
   * `estimateQuotaAsync()` when you need the precise total usage reported by the browser.
   * @return A map of store name to its usage statistics
   */
  public async usageByStoreAsync(): Promise<Map<StoreName, StoreUsage>> {
    const out = new Map<StoreName, StoreUsage>();
    for (const [store, s] of this._stats) {
      out.set(store, { count: s.count, bytes: s.bytes });
    }
    return out;
  }


  /**
   * Asks the browser to make the origin's storage persistent (resistant to eviction) via
   * `navigator.storage.persist()`.
   * @return `true` if storage is now persistent
   */
  public async requestPersistentAsync(): Promise<boolean> {
    const storageManager = globalThis.navigator?.storage;
    if (storageManager?.persist) {
      try {
        return await storageManager.persist();
      } catch {
        return false;
      }
    }
    return false;
  }


  // -------------------------------------------------------------------------
  // Files — a convenient typed API over the generic `files` store.
  // Blobs are stored natively (structured clone), never base64/ArrayBuffer.
  // -------------------------------------------------------------------------

  /**
   * Store a file, keeping its bytes as a native `Blob`. Pass a stable `id` in `opts` to upsert an
   * existing file (preserving its `createdAt`); otherwise a new id is generated.
   * @param input - The file or blob to store (a `File` supplies its own `name`/`type`)
   * @param opts - Optional id / name / type overrides
   * @return The stored `FileRecord` (with its id and derived metadata)
   */
  public async putFileAsync(input: File | Blob, opts: PutFileOptions = {}): Promise<FileRecord> {
    const now = Date.now();
    const id = opts.id ?? this._newID();
    const name = opts.name ?? (input instanceof File ? input.name : undefined) ?? 'untitled';
    const type = opts.type ?? input.type ?? '';

    let createdAt = now;
    if (opts.id) {
      const existing = await this.get<FileRecord>('files', opts.id);
      if (existing) createdAt = existing.createdAt;
    }

    const record: FileRecord = {
      id,
      name,
      extension: fileExtension(name),
      type,
      size: input.size,
      createdAt,
      updatedAt: now,
      blob: input
    };
    await this.put('files', record);
    return record;
  }


  /**
   * Retrieve a stored file by id.
   * @param id - The file id
   * @return The `FileRecord`, or `undefined` if not found
   */
  public async getFileAsync(id: FileID): Promise<FileRecord | undefined> {
    return this.get<FileRecord>('files', id);
  }


  /**
   * List all stored files, newest first. Records include the `blob` (a lazy on-disk reference in
   * real IndexedDB — reading its contents via `.text()` / `.arrayBuffer()` is deferred until asked).
   * @return The stored files, sorted by `updatedAt` descending
   */
  public async listFilesAsync(): Promise<FileRecord[]> {
    const files = await this.getAll<FileRecord>('files');
    files.sort((a, b) => b.updatedAt - a.updatedAt);
    return files;
  }


  /**
   * Delete a stored file by id.
   * @param id - The file id
   */
  public async deleteFileAsync(id: FileID): Promise<void> {
    return this.delete('files', id);
  }


  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Opens the IndexedDB database and asserts the store manifest, or falls back to the in-memory
   * mock. Idempotent — safe to call more than once.
   * @return  Promise resolved when the database (or mock) is ready
   */
  protected async _openAsync(): Promise<void> {
    if (this._db || this._mock) return;  // already opened

    try {
      if (!('indexedDB' in globalThis) || !globalThis.indexedDB) {
        throw new Error('IndexedDB not available');
      }
      this._db = await openDB(DATABASE_NAME, CURRENT_DB_VERSION, {
        upgrade: (db, oldVersion, newVersion, tx) => {
          this._upgrade(db, oldVersion, newVersion ?? CURRENT_DB_VERSION, tx);
        }
      });
    } catch (e) {
      console.error('DatabaseSystem: IndexedDB unavailable, using in-memory fallback', e);  // eslint-disable-line no-console
      this._db = null;
      this._initMock();
    }
  }


  /**
   * Runs the schema upgrade: creates any stores/indexes introduced between `oldVersion` and
   * `newVersion` from the manifest, then applies any ordered data migrations.
   * @param db - The database being upgraded
   * @param oldVersion - The version being upgraded from
   * @param newVersion - The version being upgraded to
   * @param tx - The active version-change transaction
   */
  protected _upgrade(
    db: IDBPDatabase,
    oldVersion: number,
    newVersion: number,
    tx: IDBPTransaction<unknown, string[], 'versionchange'>
  ): void {
    // Create stores/indexes from the manifest.
    for (const def of STORE_MANIFEST) {
      if (def.sinceVersion > oldVersion && def.sinceVersion <= newVersion) {
        const store = db.createObjectStore(def.name, {
          keyPath: def.keyPath,
          autoIncrement: def.autoIncrement ?? false
        });
        for (const idx of def.indexes ?? []) {
          store.createIndex(idx.name, idx.keyPath, idx.options);
        }
      }
    }

    // Apply ordered data migrations.
    for (const migration of DATABASE_MIGRATIONS) {
      if (migration.toVersion > oldVersion && migration.toVersion <= newVersion) {
        migration.migrate(db, tx, oldVersion);
      }
    }
  }


  /** Initializes the in-memory mock stores from the manifest. */
  protected _initMock(): void {
    this._mock = new Map<StoreName, Map<IDBValidKey, unknown>>();
    for (const def of STORE_MANIFEST) {
      this._mock.set(def.name, new Map<IDBValidKey, unknown>());
    }
  }


  /**
   * Returns the mock backing map for a store.
   * @param store - Store name
   * @return The store's in-memory map
   * @throws Error if the mock is not initialized or the store is unknown
   */
  protected _mockStore(store: StoreName): Map<IDBValidKey, unknown> {
    const mock = this._mock?.get(store);
    if (!mock) {
      throw new Error(`DatabaseSystem: unknown store '${store}'`);
    }
    return mock;
  }


  /**
   * Determines the storage key for a value in the mock, using the store's in-line `keyPath`
   * when no explicit key is supplied.
   * @param store - Store name
   * @param value - The record being stored
   * @param key - Optional explicit out-of-line key
   * @return The key to store the record under
   * @throws Error if no key can be determined
   */
  protected _keyFor(store: StoreName, value: unknown, key?: IDBValidKey): IDBValidKey {
    if (key !== undefined) return key;

    const keyPath = STORE_MANIFEST.find(def => def.name === store)?.keyPath;
    if (typeof keyPath === 'string') {
      return readPath(value, keyPath) as IDBValidKey;
    } else if (Array.isArray(keyPath)) {
      return keyPath.map(k => readPath(value, k)) as IDBValidKey;
    }
    throw new Error(`DatabaseSystem: no key for store '${store}'`);
  }


  /**
   * Looks up the key path for one of a store's indexes.
   * @param store - Store name
   * @param index - Index name
   * @return The index's key path
   * @throws Error if the index is unknown
   */
  protected _indexKeyPath(store: StoreName, index: string): string | string[] {
    const keyPath = STORE_MANIFEST
      .find(def => def.name === store)?.indexes
      ?.find(idx => idx.name === index)?.keyPath;
    if (keyPath === undefined) {
      throw new Error(`DatabaseSystem: unknown index '${index}' on store '${store}'`);
    }
    return keyPath;
  }


  /**
   * Mint a new unique id.
   * @return A `crypto.randomUUID`, or a timestamp-based fallback if unavailable
   */
  protected _newID(): string {
    return globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }


  /**
   * Build a zeroed stats map for all stores in the manifest.
   * @return A fresh zeroed `StoreUsage` map
   */
  protected _freshStats(): Map<StoreName, StoreUsage> {
    return new Map(STORE_MANIFEST.map(def => [def.name, { count: 0, bytes: 0 }]));
  }


  /**
   * Seed stats counts from IDB after opening. Uses the lightweight `count()` call (no record
   * data loaded) so this is fast even for large stores. Bytes start at 0 — they accumulate as
   * writes happen during this session.
   * @return  Promise resolved when seeding completes
   */
  protected async _seedStatsAsync(): Promise<void> {
    for (const def of STORE_MANIFEST) {
      const s = this._stats.get(def.name);
      if (!s) continue;
      try {
        s.count = await this.count(def.name);
      } catch {
        // best effort — stats stay at 0 if the count fails
      }
    }
  }


  /**
   * Update stats when a record is added or overwritten. Called at write time so reads are free.
   * @param store - Store being written to
   * @param value - The value being stored
   */
  protected _statsAdd(store: StoreName, value: unknown): void {
    const s = this._stats.get(store);
    if (!s) return;
    s.count++;
    s.bytes += estimateBytes(value);
  }


  /**
   * Update stats when records are deleted. We decrement count accurately but do not adjust bytes
   * (we don't have the deleted value at hand). Bytes are reset to 0 on `clear()`.
   * @param store - Store being deleted from
   * @param n - Number of records removed
   */
  protected _statsRemove(store: StoreName, n: number): void {
    const s = this._stats.get(store);
    if (!s) return;
    s.count = Math.max(0, s.count - n);
  }
}


/**
 * Derives a lowercased file extension (including the leading dot) from a filename.
 * @param name - The filename, e.g. `'Buildings.GeoJSON'`
 * @return The extension, e.g. `'.geojson'`, or `''` if there is none
 */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0) ? name.slice(dot).toLowerCase() : '';
}


/**
 * Reads a (possibly nested) property from a record for mock key/index resolution.
 * @param value - The record to read from
 * @param keyPath - A dotted property path or array of property names
 * @return The value at the path, or `undefined`
 */
function readPath(value: unknown, keyPath: string | string[]): unknown {
  if (value === null || typeof value !== 'object') return undefined;

  const parts = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
