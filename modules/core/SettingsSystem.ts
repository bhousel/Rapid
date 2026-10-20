import { AbstractSystem } from './AbstractSystem.ts';
import { TreeStore } from '../lib/TreeStore.ts';

import type { Context } from '../Context.ts';
import type { KeyPathPart, TreeNode, TreeValue } from '../lib/TreeStore.ts';
import type { StorageSystem } from './StorageSystem.ts';


// ---------------------------------------------------------------------------
// Settings tree types
// ---------------------------------------------------------------------------

/**
 * Any value that can live in the settings tree. Leaf values are always strings
 * (matching `localStorage` and the OSM user-preferences API); intermediate
 * containers are arrays or plain objects. This is the generic `TreeStore` leaf
 * type under a settings-domain name.
 */
export type SettingsValue = TreeValue;

/** The root settings tree — a map of domain keys to their values. */
export type SettingsTree = TreeNode;


/** The serialized form produced by `toJSON()` and consumed by `fromJSON()`. */
export interface RapidSettingsEnvelope {
  rapid: {
    settingsVersion: number;
    appVersion: string;
    updatedAt: string;
    settings: SettingsTree;
  };
}


/** The internal snapshot produced while loading settings from storage. */
interface LoadedSettings {
  tree: SettingsTree;
  storedVersion: number;
  updatedAt: string;
  appVersion: string;
  syncBase: SyncBase;
}

/** A single ordered migration step (see `SETTINGS_MIGRATIONS`). */
interface SettingsMigration {
  toVersion: number;
  migrate(tree: SettingsTree, storage: StorageSystem): SettingsTree;
}

/** The results of an attempted remote sync */
interface SyncResult {
  /** `true` if the sync succeeded, `false` if not */
  ok: boolean;
  /** Description of what occurred  */
  reason: string;
  /** How many synced settings took the remote value */
  pulled?: number;
  /** How many synced settings were sent to the remote */
  pushed?: number;
  /** How many remote keys were removed because they aren't synced settings */
  removed?: number;
}

/**
 * What we believe the remote holds for the synced settings, as of the last sync.
 * This is the base of a three-way merge: comparing it with the remote tells us whether
 * the remote changed, and comparing it with the local tells us whether the local changed.
 */
interface SyncBase {
  /** The OSM site and user this base belongs to; a different owner starts from an empty base */
  owner: string;
  /** Flat settings keys and values */
  entries: Map<string, string>;
}


// ---------------------------------------------------------------------------
// Storage key constants
// ---------------------------------------------------------------------------

/** Prefix shared by every settings storage key. */
const SETTINGS_PREFIX = 'rapid.settings';
/** Reserved namespace for engine metadata (version, timestamps). Not a user domain. */
const SETTINGS_META_PREFIX = `${SETTINGS_PREFIX}.meta.`;
/** The latest settings payload version. Bump this when adding a migration. */
const CURRENT_SETTINGS_VERSION = 1;
/** How long to wait (ms) after a settings change before pushing to the remote store. */
const SYNC_THROTTLE = 1000;


// ---------------------------------------------------------------------------
// Storage-key predicates — settings-specific (`rapid.settings.*` namespace).
// The generic tree/flat-key codec lives on `TreeStore`; here we only classify
// which localStorage keys belong to us.
// ---------------------------------------------------------------------------

/**
 * Tests whether a storage key belongs to the settings namespace.
 * @param key - The storage key to test
 * @return `true` if the key is under the settings prefix
 */
function isSettingsKey(key: string): boolean {
  return key.startsWith(SETTINGS_PREFIX);
}


/**
 * Tests whether a storage key is an engine metadata key.
 * @param key - The storage key to test
 * @return `true` if the key is under the reserved meta namespace
 */
function isMetaKey(key: string): boolean {
  return key.startsWith(SETTINGS_META_PREFIX);
}


/**
 * Converts a flat settings key to its storage key.
 * @param flatKey - A flat key from `TreeStore.toFlat()`, e.g. `imagery.favorites[0]`
 * @return The storage key, e.g. `rapid.settings.imagery.favorites[0]`
 */
function toStorageKey(flatKey: string): string {
  // A leading `[` means a top-level array index; otherwise join with a `.`.
  return flatKey.startsWith('[') ? `${SETTINGS_PREFIX}${flatKey}` : `${SETTINGS_PREFIX}.${flatKey}`;
}


/**
 * Converts a storage key to its flat settings key (the inverse of `toStorageKey`).
 * @param key - A storage key under the settings prefix
 * @return The flat key
 */
function toFlatKey(key: string): string {
  // Strip the `rapid.settings` prefix (and its separating `.`) to recover the flat key.
  const flatKey = key.slice(SETTINGS_PREFIX.length);
  return flatKey.startsWith('.') ? flatKey.slice(1) : flatKey;
}



// ---------------------------------------------------------------------------
// Migrations — the one place that carries domain knowledge about settings.
// ---------------------------------------------------------------------------

/**
 * v0 → v1: imports Rapid's historical ad-hoc localStorage keys into the
 * structured settings tree. Legacy keys are read but left in place so that
 * not-yet-migrated code can still find them during the deprecation window.
 * All leaf values stay as raw strings; callers coerce them on read.
 * @param tree - The existing (usually empty) settings tree
 * @param storage - The storage system to read legacy keys from
 * @return A tree seeded with any legacy values that were present
 */
function migrate_v0_v1(tree: SettingsTree, storage: StorageSystem): SettingsTree {
  const getStr = (k: string): string | undefined => storage.getItem(k) ?? undefined;

  const getJSON = (k: string): unknown => {
    const v = storage.getItem(k);
    if (v === null) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  };

  // Assigns `value` to `obj[key]` only when `value` is defined.
  const put = (obj: Record<string, SettingsValue>, key: string, value: string | undefined): void => {
    if (value !== undefined) {
      obj[key] = value;
    }
  };

  const imported: SettingsTree = {};

  // imagery
  const imagery: Record<string, SettingsValue> = {};
  const template = getStr('background-custom-template');
  if (template !== undefined) {
    imagery.custom = [{ name: 'Custom', template }];
  }
  const favorites = getJSON('background-favorites');
  if (Array.isArray(favorites)) {
    imagery.favorites = favorites.filter((v): v is string => typeof v === 'string');
  }
  put(imagery, 'lastUsed', getStr('background-last-used'));
  put(imagery, 'lastUsedToggle', getStr('background-last-used-toggle'));
  put(imagery, 'opacity', getStr('background-opacity'));
  if (Object.keys(imagery).length) {
    imported.imagery = imagery;
  }

  // schema
  const recents = getJSON('preset_recents');
  if (Array.isArray(recents)) {
    const presetRecents = recents
      .map(item => (item !== null && typeof item === 'object') ? (item as { id?: unknown }).id : item)
      .filter((v): v is string => typeof v === 'string');
    imported.schema = { presetRecents };
  }

  // poweruser (formerly the `rapid-internal-feature.*` keys)
  const poweruser: Record<string, SettingsValue> = {};
  put(poweruser, 'allowLargeEdits', getStr('rapid-internal-feature.allowLargeEdits'));
  put(poweruser, 'autoConnect', getStr('rapid-internal-feature.autoConnect'));
  put(poweruser, 'previewDatasets', getStr('rapid-internal-feature.previewDatasets'));
  put(poweruser, 'showAutoFix', getStr('rapid-internal-feature.showAutoFix'));
  put(poweruser, 'tagnosticRoadCombine', getStr('rapid-internal-feature.tagnosticRoadCombine'));
  put(poweruser, 'tagSources', getStr('rapid-internal-feature.tagSources'));
  if (Object.keys(poweruser).length) {
    imported.poweruser = poweruser;
  }

  // validator
  const validator: Record<string, SettingsValue> = {};
  put(validator, 'disabledRules', getStr('validate-disabledRules'));
  put(validator, 'squareDegrees', getStr('validate-square-degrees'));
  put(validator, 'what', getStr('validate-what'));
  put(validator, 'where', getStr('validate-where'));
  if (Object.keys(validator).length) {
    imported.validator = validator;
  }

  // filters
  const filters: Record<string, SettingsValue> = {};
  put(filters, 'disabledFilters', getStr('disabled-features'));
  if (Object.keys(filters).length) {
    imported.filters = filters;
  }

  // map
  const map: Record<string, SettingsValue> = {};
  put(map, 'areaFill', getStr('area-fill'));
  put(map, 'areaFillToggle', getStr('area-fill-toggle'));
  if (Object.keys(map).length) {
    imported.map = map;
  }

  // ui
  const ui: Record<string, SettingsValue> = {};
  put(ui, 'sawRapidSplash', getStr('sawRapidSplash'));
  put(ui, 'sawPrivacyVersion', getStr('sawPrivacyVersion'));
  put(ui, 'sawVersion', getStr('sawVersion'));
  put(ui, 'sawWhatsNewVersion', getStr('sawWhatsNewVersion'));
  put(ui, 'mouseWheelInteraction', getStr('prefs.mouse_wheel.interaction'));
  put(ui, 'rawTagEditorView', getStr('raw-tag-editor-view'));

  const inspector: Record<string, SettingsValue> = {};
  put(inspector, 'collapsed', getStr('inspector.collapsed'));
  put(inspector, 'width', getStr('inspector.width'));
  if (Object.keys(inspector).length) {
    ui.inspector = inspector;
  }

  const walkthrough: Record<string, SettingsValue> = {};
  put(walkthrough, 'started', getStr('walkthrough_started'));
  put(walkthrough, 'completed', getStr('walkthrough_completed'));
  put(walkthrough, 'progress', getStr('walkthrough_progress'));
  if (Object.keys(walkthrough).length) {
    ui.walkthrough = walkthrough;
  }

  const entityIssues: Record<string, SettingsValue> = {};
  put(entityIssues, 'referenceExpanded', getStr('entity-issues.reference.expanded'));
  if (Object.keys(entityIssues).length) {
    ui.entityIssues = entityIssues;
  }

  const privacy: Record<string, SettingsValue> = {};
  put(privacy, 'thirdPartyIcons', getStr('preferences.privacy.thirdpartyicons'));
  if (Object.keys(privacy).length) {
    ui.privacy = privacy;
  }

  const restrictions: Record<string, SettingsValue> = {};
  put(restrictions, 'maxDistance', getStr('turn-restriction-distance'));
  put(restrictions, 'viaWay0', getStr('turn-restriction-via-way0'));
  if (Object.keys(restrictions).length) {
    ui.restrictions = restrictions;
  }

  const customDataURL = getStr('settings-custom-data-url');
  if (customDataURL !== undefined) {
    ui.customData = { url: customDataURL };
  }

  if (Object.keys(ui).length) {
    imported.ui = ui;
  }

  // Existing tree values (if any) win over imported legacy values, keeping this idempotent.
  return TreeStore.merge(imported, tree) as SettingsTree;
}


/** The ordered list of migrations, applied whenever the stored version is behind. */
const SETTINGS_MIGRATIONS: SettingsMigration[] = [
  { toVersion: 1, migrate: migrate_v0_v1 }
];


/**
 * The `SettingsSystem` manages Rapid's durable user preferences.
 *
 * It is a **domain-agnostic** store: it persists an arbitrary tree of settings
 * and knows nothing about what those settings mean. Each consuming system defines
 * its own settings shape and reads/writes paths, e.g.:
 *
 * ```ts
 * const template = settings.get('imagery.custom[0].template');
 * settings.set('schema.presetRecents', ['highway/residential', 'building']);
 * ```
 *
 * Leaf values are always strings (the same contract as `localStorage` and the OSM
 * user-preferences API); callers coerce as needed (e.g. `Number(...)`, `=== 'true'`).
 *
 * The in-memory tree and its flat-key (de)serialization are handled by the
 * generic `TreeStore` (in `lib/`); this system only adds the settings-specific
 * `rapid.settings.*` namespace, engine metadata, and legacy-key migrations.
 *
 * Only the settings that their systems register with `registerSync()` are synced to the
 * user's OSM account. Everything else stays in this browser.
 *
 * Events available:
 * - `settingschange` - Fires after any change in the persisted settings
 *
 * See `design/settings-system.md` for the full design.
 */
export class SettingsSystem extends AbstractSystem {

  /** The in-memory settings tree (domain data only, no engine metadata). */
  protected _store: TreeStore;
  /** The current settings version. */
  protected _version: number;
  /** The Rapid app version that last wrote these settings. */
  protected _appVersion: string;
  /** ISO timestamp of the last mutation. */
  protected _updatedAt: string;
  /** The settings paths that sync to the OSM account (see `registerSync`) */
  protected _syncPaths: Set<string>;
  /** What the remote held for the synced settings at the last sync */
  protected _syncBase: SyncBase;
  /** The sync in progress, if any */
  protected _syncing: Promise<SyncResult> | null;
  /** Whether another sync was requested while one was in progress */
  protected _syncAgain: boolean;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'settings';
    this.requiredDependencies = new Set<SystemID>(['storage']);
    this.optionalDependencies = new Set<SystemID>(['scheduler']);

    this._store = new TreeStore();
    this._version = CURRENT_SETTINGS_VERSION;
    this._appVersion = context.version;
    this._updatedAt = new Date(0).toISOString();
    this._syncPaths = new Set<string>();
    this._syncBase = { owner: '', entries: new Map<string, string>() };
    this._syncing = null;
    this._syncAgain = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.syncRemote = this.syncRemote.bind(this);
    this._deferredSyncRemote = this._deferredSyncRemote.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * Loads settings from storage, applies any pending migrations, and persists the result.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    const context = this.context;
    const storage = context.systems.storage!;

    return super.initAsync()
      .then(() => storage.initAsync())
      .then(() => {
        const loaded = this._loadLocal();

        let tree = loaded.tree;
        let migrated = false;
        for (const migration of SETTINGS_MIGRATIONS) {
          if (migration.toVersion > loaded.storedVersion) {
            tree = migration.migrate(tree, storage);
            migrated = true;
          }
        }

        this._store.replace(tree);
        this._version = CURRENT_SETTINGS_VERSION;
        this._appVersion = this.context.version;
        this._updatedAt = migrated ? new Date().toISOString() : loaded.updatedAt;
        this._syncBase = loaded.syncBase;

        if (migrated) {
          this._saveLocal();
        }
      });
  }


  /**
   * Called after all core objects have been initialized.
   * Syncs with the user's OSM account now if they're signed in, and again whenever they sign in.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const context = this.context;
    const osm = context.services?.osm;

    osm?.on('authchange', this._deferredSyncRemote);
    this._deferredSyncRemote();

    this._started = true;
    return this._startPromise = super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state.
   * Settings are durable user preferences, so they intentionally survive resets
   * (including live/dev API switches) — this is a no-op.
   * @return  Promise resolved immediately
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * The current settings payload version.
   * @return  The version number
   * @readonly
   */
  public get settingsVersion(): number {
    return this._version;
  }


  /**
   * Marks settings paths to sync to the user's OSM account. Each path syncs as a unit,
   * including everything beneath it. Systems call this for the small preferences that
   * should follow the user between browsers; register them before `startAsync`.
   * ```ts
   * settings?.registerSync(['map.areaFill', 'map.areaFillToggle']);
   * ```
   * @param paths - Settings paths, e.g. `imagery.favorites`
   * @throws Error if a path is malformed or targets the reserved `meta` namespace
   */
  public registerSync(paths: string[]): void {
    for (const path of paths) {
      this._assertNotReserved(TreeStore.parsePath(path));
      this._syncPaths.add(path);
    }
  }


  /**
   * Reads the value at a settings path.
   * @param path - A dotted/bracketed path, e.g. `imagery.custom[0].template`
   * @param fallback - Value to return when the path is not set
   * @return A deep copy of the value, or `fallback` if the path is not set.
   *   Leaf values are always strings; callers coerce as needed
   *   (e.g. `Number(settings.get('ui.width'))`).
   * @throws Error if the path is malformed
   */
  public get<T = string>(path: string, fallback?: T): T | undefined {
    const value = this._store.get<T>(path);
    return value === undefined ? fallback : value;
  }


  /**
   * Tests whether a settings path is currently set.
   * @param path - A dotted/bracketed path
   * @return `true` if a value exists at the path
   * @throws Error if the path is malformed
   */
  public has(path: string): boolean {
    return this._store.has(path);
  }


  /**
   * Writes a value at a settings path, creating intermediate containers as needed,
   * then persists and emits a `change` event.
   * @param path - A dotted/bracketed path
   * @param value - The value to store
   * @throws Error if the path is malformed or targets the reserved `meta` namespace
   */
  public set(path: string, value: SettingsValue): void {
    const parts = TreeStore.parsePath(path);
    this._assertNotReserved(parts);
    this._store.set(parts, value);
    this._touch(path);
  }


  /**
   * Removes the value at a settings path. Deleting an array element compacts
   * the array. Persists and emits a `change` event.
   * @param path - A dotted/bracketed path
   * @throws Error if the path is malformed or targets the reserved `meta` namespace
   */
  public unset(path: string): void {
    const parts = TreeStore.parsePath(path);
    this._assertNotReserved(parts);
    this._store.unset(parts);
    this._touch(path);
  }


  /**
   * Guards against modifying the reserved `meta` namespace.
   * @param parts - The parsed path segments
   * @throws Error if the top-level segment is `meta`
   */
  protected _assertNotReserved(parts: KeyPathPart[]): void {
    if (parts[0] === 'meta') {
      throw new Error(`Settings path '${String(parts[0])}' is reserved`);
    }
  }


  /**
   * Returns a deep copy of the entire settings tree.
   * @return  A structural copy of all settings
   */
  public getAll(): SettingsTree {
    return this._store.toJSON();
  }


  /**
   * Serializes all settings to a versioned envelope, suitable for export.
   * @return  The settings envelope
   */
  public toJSON(): RapidSettingsEnvelope {
    return {
      rapid: {
        settingsVersion: this._version,
        appVersion: this._appVersion,
        updatedAt: this._updatedAt,
        settings: this._store.toJSON()
      }
    };
  }


  /**
   * Replaces all settings from a previously-exported envelope,
   * then persists and emits a `settingschange` event.
   * @param envelope - The settings envelope to import
   */
  public fromJSON(envelope: RapidSettingsEnvelope): void {
    const settings = envelope?.rapid?.settings;
    this._store.replace(TreeStore.isPlainObject(settings) ? settings : {});
    this._version = CURRENT_SETTINGS_VERSION;
    this._appVersion = this.context.version;
    this._touch();
  }


  /**
   * Removes every setting from this browser, and from the user's OSM account if they're
   * signed in, for a clean slate. Meant for testing and the developer console:
   * ```js
   * await rapidContext.systems.settings.clearAllAsync();
   * ```
   * Reload Rapid afterwards, so that every system starts again from its defaults.
   * Other applications' preferences are never touched.
   * @return  Promise resolved with the result of clearing the OSM account
   */
  public async clearAllAsync(): Promise<SyncResult> {
    const context = this.context;
    const osm = context.services?.osm;

    // Let any sync in progress finish first, so it can't send settings back afterwards.
    this._syncAgain = false;
    await this._syncing;

    this._store.clear();
    this._syncBase = { owner: '', entries: new Map<string, string>() };
    this._updatedAt = new Date().toISOString();
    this._saveLocal();
    this.emit('settingschange');

    if (!osm) return { ok: true, reason: 'cleared-local' };
    if (!osm.authenticated()) return { ok: true, reason: 'cleared-local' };

    let prefs: Record<string, string>;
    try {
      prefs = (await osm.getUserPreferencesAsync()) ?? {};
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? 'clear-failed' };
    }

    let removed = 0;
    let failed = 0;
    for (const key of Object.keys(prefs)) {
      if (!isSettingsKey(key)) continue;   // not ours
      try {
        await osm.deleteUserPreferenceAsync(key);
        removed++;
      } catch {
        failed++;
      }
    }

    if (failed) {
      return { ok: false, reason: `partial-failure (${failed})`, removed };
    }
    return { ok: true, reason: 'cleared', removed };
  }


  /**
   * Loads the settings tree and engine metadata from storage.
   * @return  The loaded tree plus its stored version and metadata
   */
  protected _loadLocal(): LoadedSettings {
    const storage = this.context.systems.storage!;
    const entries: [string, string][] = [];

    let storedVersion: number | undefined;
    let updatedAt: string | undefined;
    let appVersion: string | undefined;
    let syncBase: SyncBase | undefined;

    for (const key of storage.keys()) {
      if (!isSettingsKey(key)) continue;

      const raw = storage.getItem(key);
      if (raw === null) continue;

      if (isMetaKey(key)) {
        const name = key.slice(SETTINGS_META_PREFIX.length);
        if (name === 'settingsVersion') {
          const n = Number(raw);
          if (Number.isFinite(n)) storedVersion = n;
        } else if (name === 'updatedAt') {
          updatedAt = raw;
        } else if (name === 'appVersion') {
          appVersion = raw;
        } else if (name === 'syncBase') {
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.owner === 'string' && TreeStore.isPlainObject(parsed?.entries)) {
              syncBase = { owner: parsed.owner, entries: new Map<string, string>(Object.entries(parsed.entries)) };
            }
          } catch {
            // an unreadable base is treated as no base
          }
        }
        continue;
      }

      entries.push([toFlatKey(key), raw]);
    }

    return {
      tree: TreeStore.fromFlat(entries).toJSON(),
      storedVersion: storedVersion ?? 0,
      updatedAt: updatedAt ?? new Date(0).toISOString(),
      appVersion: appVersion ?? this.context.version,
      syncBase: syncBase ?? { owner: '', entries: new Map<string, string>() }
    };
  }


  /**
   * Returns the complete set of `rapid.settings.*` storage keys and values.
   * Includes metadata keys plus the flattened settings tree.
   * @return  Map of storage key to string value
   */
  protected _allSettings(): Map<string, string> {
    const all = new Map<string, string>();
    all.set(`${SETTINGS_META_PREFIX}settingsVersion`, String(this._version));
    all.set(`${SETTINGS_META_PREFIX}updatedAt`, this._updatedAt);
    all.set(`${SETTINGS_META_PREFIX}appVersion`, this._appVersion);
    if (this._syncBase.owner) {
      const syncBase = { owner: this._syncBase.owner, entries: Object.fromEntries(this._syncBase.entries) };
      all.set(`${SETTINGS_META_PREFIX}syncBase`, JSON.stringify(syncBase));
    }

    for (const [flatKey, value] of this._store.toFlat()) {
      all.set(toStorageKey(flatKey), value);
    }
    return all;
  }


  /**
   * Updates the modified timestamp, persists locally, emits a `settingschange` event,
   * and schedules a deferred sync with the remote store if a synced setting may have changed.
   * @param path - The settings path that changed, or `undefined` if everything may have changed
   */
  protected _touch(path?: string): void {
    this._updatedAt = new Date().toISOString();
    this._saveLocal();
    this.emit('settingschange');
    if (path === undefined || this._affectsSync(path)) {
      this._deferredSyncRemote();
    }
  }


  /**
   * Persists the current settings to storage as one namespaced key per setting,
   * writing changed keys and removing any that no longer exist.
   */
  protected _saveLocal(): void {
    const storage = this.context.systems.storage!;
    const stale = new Set(storage.keys().filter(isSettingsKey));
    const allSettings = this._allSettings();

    for (const [key, value] of allSettings) {
      storage.setItem(key, value);
      stale.delete(key);
    }
    for (const key of stale) {  // unused settings keys remain in stale, they can be removed
      storage.removeItem(key);
    }
  }


  /**
   * Schedules a throttled sync with the remote (OSM account) store, so that a burst
   * of settings changes results in a single sync. No-op when there is no
   * OSM service or the user is not logged in.
   */
  protected _deferredSyncRemote(): void {
    const context = this.context;
    const osm = context.services?.osm;
    const scheduler = context.systems.scheduler;
    if (!osm || !osm.authenticated()) return;   // can't sync

    if (scheduler) {
      scheduler.throttle('settings-remote-push', this.syncRemote, { ms: SYNC_THROTTLE, leading: false });
    } else {
      this.syncRemote();
    }
  }


  /**
   * Tests whether a change at `path` could affect a synced setting.
   * @param path - A settings path that was set or unset
   * @return `true` if the path is at, under, or above a synced path
   */
  protected _affectsSync(path: string): boolean {
    const flatKey = TreeStore.pathToFlatKey(path);
    for (const syncPath of this._syncPaths) {
      if (TreeStore.isFlatKeyWithin(flatKey, syncPath)) return true;
      if (TreeStore.isFlatKeyWithin(TreeStore.pathToFlatKey(syncPath), path)) return true;
    }
    return false;
  }


  /**
   * Tests whether a flat key belongs to a synced setting.
   * @param flatKey - A flat settings key
   * @return `true` if the key is at or under a synced path
   */
  protected _isSynced(flatKey: string): boolean {
    for (const syncPath of this._syncPaths) {
      if (TreeStore.isFlatKeyWithin(flatKey, syncPath)) return true;
    }
    return false;
  }


  /**
   * Syncs the registered settings with the user's OSM account, if possible.
   * Only one sync runs at a time; a sync requested meanwhile runs when it finishes.
   * @return  Promise resolved with the sync result
   */
  public syncRemote(): Promise<SyncResult> {
    if (this._syncing) {
      this._syncAgain = true;
      return this._syncing;
    }

    this._syncing = this._syncRemoteAsync()
      .catch(err => ({ ok: false, reason: err?.message ?? 'sync-failed' }))
      .finally(() => {
        this._syncing = null;
        if (this._syncAgain) {
          this._syncAgain = false;
          this.syncRemote();
        }
      });

    return this._syncing;
  }


  /**
   * Merges each synced setting with the user's OSM account (a three-way merge against
   * `_syncBase`, what the remote held at the last sync):
   * - If the remote changed since the last sync, the remote value wins. In a new browser
   *   there is no base yet, so the user's synced settings replace this browser's.
   * - Otherwise, if the local value changed, it is sent with single-key PUT/DELETE calls.
   * - A remote key is only deleted when the user removed that setting here, never just
   *   because this browser doesn't have it.
   *
   * Remote `rapid.settings.*` keys that aren't synced settings (earlier versions synced
   * everything) are removed. Other applications' preferences are never touched.
   * Requests are sent one at a time. A synced setting that the OSM API can't store
   * (an empty value, or a key or value over 255 characters) stays local.
   * @return  Promise resolved with the sync result
   */
  protected async _syncRemoteAsync(): Promise<SyncResult> {
    const context = this.context;
    const osm = context.services?.osm;
    if (!osm) return { ok: false, reason: 'no-osm-service' };
    if (!osm.authenticated()) return { ok: false, reason: 'not-authenticated' };

    const maxKey = context.maxCharsForTagKey || 255;
    const maxValue = context.maxCharsForTagValue || 255;

    const user = await osm.getUserDetailsAsync().catch(() => null);
    const prefs: Record<string, string> = (await osm.getUserPreferencesAsync()) ?? {};

    // A base from another OSM site or user says nothing about this remote, so start over.
    const owner = `${osm.wwwroot}#${user?.id ?? ''}`;
    if (this._syncBase.owner !== owner) {
      this._syncBase = { owner, entries: new Map<string, string>() };
    }
    const base = this._syncBase.entries;

    // Sort the remote `rapid.settings.*` keys into synced settings and leftovers to remove.
    const remote = new Map<string, string>();
    const leftovers: string[] = [];
    for (const [key, value] of Object.entries(prefs)) {
      if (!isSettingsKey(key)) continue;   // not ours
      const flatKey = toFlatKey(key);
      if (this._isSynced(flatKey)) {
        remote.set(flatKey, String(value));
      } else {
        leftovers.push(key);
      }
    }

    const local = this._store.toFlat();
    let pulled = 0;
    let pushed = 0;
    let removed = 0;
    let failed = 0;

    for (const path of this._syncPaths) {
      const localEntries = TreeStore.flatEntriesWithin(local, path);
      const remoteEntries = TreeStore.flatEntriesWithin(remote, path);
      const baseEntries = TreeStore.flatEntriesWithin(base, path);

      if (TreeStore.sameFlat(localEntries, remoteEntries)) {   // already in sync
        TreeStore.replaceFlatEntriesWithin(base, path, remoteEntries);
        continue;
      }

      // The remote changed since the last sync, so it wins.
      if (!TreeStore.sameFlat(remoteEntries, baseEntries)) {
        const value = TreeStore.fromFlat(remoteEntries).get(path);
        if (value === undefined) {
          this._store.unset(path);
        } else {
          this._store.set(path, value);
        }
        TreeStore.replaceFlatEntriesWithin(base, path, remoteEntries);
        pulled++;
        continue;
      }

      // Only the local changed, so send it, if the OSM API can store it.
      const unstorable = [...localEntries].find(([key, value]) =>
        !value.length || value.length > maxValue || toStorageKey(key).length > maxKey
      );
      if (unstorable) {
        console.warn(`SettingsSystem: can't sync '${path}' to the OSM account, keeping it local: ${unstorable[0]}`);  // eslint-disable-line no-console
        continue;
      }

      for (const [key, value] of localEntries) {
        if (remoteEntries.get(key) === value) continue;
        try {
          await osm.putUserPreferenceAsync(toStorageKey(key), value);
          base.set(key, value);
        } catch {
          failed++;
        }
      }
      for (const key of remoteEntries.keys()) {
        if (localEntries.has(key)) continue;
        try {
          await osm.deleteUserPreferenceAsync(toStorageKey(key));
          base.delete(key);
        } catch {
          failed++;
        }
      }
      pushed++;
    }

    for (const key of leftovers) {
      try {
        await osm.deleteUserPreferenceAsync(key);
        removed++;
      } catch {
        failed++;
      }
    }

    if (pulled) {
      this._updatedAt = new Date().toISOString();
    }
    this._saveLocal();   // also saves the sync base
    if (pulled) {
      this.emit('settingschange');
    }

    const counts = { pulled, pushed, removed };
    if (failed) {
      return { ok: false, reason: `partial-failure (${failed})`, ...counts };
    }
    return { ok: true, reason: (pulled || pushed || removed) ? 'synced' : 'up-to-date', ...counts };
  }


}
