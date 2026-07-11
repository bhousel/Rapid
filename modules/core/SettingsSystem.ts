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
 * Events available:
 * - `settingschange`   Fires after any change in the persisted settings
 */
export class SettingsSystem extends AbstractSystem {

  /** The in-memory settings tree (domain data only, no engine metadata). */
  protected _store: TreeStore;
  /** The current settings version. */
  protected _version: number;
  /** The Rapid app version that last wrote these settings. */
  protected _appVersion: string;
  /** ISO timestamp of the last mutation, used for future remote conflict resolution. */
  protected _updatedAt: string;
  /** Settings that are stored in the remote store, if any */
  protected _remote: Map<string, string>;


  /**
   * @constructor
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
    this._remote = new Map<string, string>();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.syncRemote = this.syncRemote.bind(this);
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

        if (migrated) {
          this._saveLocal();
        }
      });
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
    this._touch();
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
    this._touch();
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
    this._updatedAt = new Date().toISOString();
    this._saveLocal();
    this.emit('settingschange');
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
        }
        continue;
      }

      // Strip the `rapid.settings` prefix (and its separating `.`) to recover the flat key.
      let flatKey = key.slice(SETTINGS_PREFIX.length);
      if (flatKey.startsWith('.')) flatKey = flatKey.slice(1);
      entries.push([flatKey, raw]);
    }

    return {
      tree: TreeStore.fromFlat(entries).toJSON(),
      storedVersion: storedVersion ?? 0,
      updatedAt: updatedAt ?? new Date(0).toISOString(),
      appVersion: appVersion ?? this.context.version
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

    for (const [flatKey, value] of this._store.toFlat()) {
      // A leading `[` means a top-level array index; otherwise join with a `.`.
      const storageKey = flatKey.startsWith('[') ? `${SETTINGS_PREFIX}${flatKey}` : `${SETTINGS_PREFIX}.${flatKey}`;
      all.set(storageKey, value);
    }
    return all;
  }


  /**
   * Updates the modified timestamp, persists locally, emits a `settingschange` event,
   * and schedules a deferred sync with the remote store.
   */
  protected _touch(): void {
    this._updatedAt = new Date().toISOString();
    this._saveLocal();
    this.emit('settingschange');
    this._deferredSyncRemote();
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
   * Runs a full remote sync, if possible.
   * - `pullRemoteAsync()`: pull remote settings if possible, and apply those settings
   *   locally if they are newer (based on the last-update-wins `updatedAt` timestamp).
   * - `pushRemoteAsync()` push settings that have changed against the `_remote` copy,
   *   and update the remote `updatedAt` timestamp.
   * @return  Promise resolved with the sync result
   */
  public syncRemote(): Promise<SyncResult> {
    return this.pullRemoteAsync()
      .then(result => {
        // If we just pulled a newer remote copy, we're already in sync.
        if (result.reason === 'pulled') return result;
        // Otherwise push our (newer, or seed) copy up.
        return this.pushRemoteAsync();
      });
  }


  /**
   * Pulls settings from the remote (OSM account) store and applies them locally
   * if the remote copy is newer (based on last-update-wins `updatedAt` timestamp).
   * (Requires the OSM service to exist and the user to be logged in.)
   *
   * Regardless of whether the remote copy is applied, we retain a copy of the remote
   * settings in `this._remote`, so that the next push only sends the differences.
   *
   * @return  Promise resolved with the sync result
   */
  public pullRemoteAsync(): Promise<SyncResult> {
    const osm = this.context.services?.osm;
    if (!osm) return Promise.resolve({ ok: false, reason: 'no-osm-service' });
    if (!osm.authenticated()) return Promise.resolve({ ok: false, reason: 'not-authenticated' });

    return osm.getUserPreferencesAsync()
      .then(result => {
        const userPreferences: Record<string, unknown> = result ?? {};
        const entries: [string, string][] = [];        // just the data (flat) entries
        let remoteUpdatedAt: string | undefined;

        // Gather the settings keys stored in the remote, so the followup push only sends deltas.
        this._remote.clear();
        for (const [key, value] of Object.entries(userPreferences)) {
          if (!isSettingsKey(key)) continue;  // not a rapid setting
          const str = String(value);
          this._remote.set(key, str);
          if (isMetaKey(key)) {
            if (key.slice(SETTINGS_META_PREFIX.length) === 'updatedAt') {
              remoteUpdatedAt = str;
            }
            continue;
          }
          let flatKey = key.slice(SETTINGS_PREFIX.length);
          if (flatKey.startsWith('.')) flatKey = flatKey.slice(1);
          entries.push([flatKey, str]);
        }

        if (remoteUpdatedAt === undefined) {
          return { ok: false, reason: 'no-remote-settings' };
        }

        // Last-write-wins: only apply the remote copy if it is newer than ours.
        if (Date.parse(remoteUpdatedAt) <= Date.parse(this._updatedAt)) {
          return { ok: true, reason: 'local-newer' };
        }

        // Remote is newer
        this._store.replace(TreeStore.fromFlat(entries).toJSON());
        this._updatedAt = remoteUpdatedAt;
        this._saveLocal();
        this.emit('settingschange');
        return { ok: true, reason: 'pulled' };
      })
      .catch(err => ({ ok: false, reason: err?.message ?? 'pull-failed' }));
  }


  /**
   * Pushes settings to the remote (OSM account) store using **single-key** PUT/DELETE
   * calls for just the differences since the last known remote state (`this._remote`).
   * (Requires the OSM service to exist and the user to be logged in.)
   *
   * This is non-destructive to other applications' preferences — we only ever touch
   * keys we own (`rapid.settings.*`). Settings that can't be represented remotely are
   * silently skipped and stay local-only:
   * - empty values (the OSM API requires a value length of at least 1), and
   * - values whose key or value exceeds the OSM 255-char limit.
   *
   * The `_remote` snapshot is updated only for calls that succeed, so that in the event
   * that the API is temporarily unavailable, the updates can be pushed again later.
   *
   * @return  Promise resolved with the sync result
   */
  public pushRemoteAsync(): Promise<SyncResult> {
    const context = this.context;
    const osm = context.services?.osm;
    if (!osm) return Promise.resolve({ ok: false, reason: 'no-osm-service' });
    if (!osm.authenticated()) return Promise.resolve({ ok: false, reason: 'not-authenticated' });

    const maxKey = context.maxCharsForTagKey || 255;
    const maxValue = context.maxCharsForTagValue || 255;

    // The desired remote set: our settings minus anything the OSM API can't store.
    const desired = new Map<string, string>();
    for (const [key, value] of this._allSettings()) {
      if (value.length === 0) continue;   // OSM requires a value length >= 1; empty stays local-only
      if (key.length > maxKey || value.length > maxValue) {
        console.warn(`SettingsSystem: skipping oversized setting for remote sync: ${key}`);  // eslint-disable-line no-console
        continue;
      }
      desired.set(key, value);
    }

    // Diff against what we believe is already on the remote.
    const puts: string[] = [];      // keys to PUT (added or changed)
    const deletes: string[] = [];   // keys to DELETE (no longer present locally)
    for (const [key, value] of desired) {
      if (this._remote.get(key) !== value) puts.push(key);
    }
    for (const key of this._remote.keys()) {
      if (!desired.has(key)) deletes.push(key);
    }

    if (!puts.length && !deletes.length) {
      return Promise.resolve({ ok: true, reason: 'up-to-date' });
    }

    const jobs: Promise<{ key: string; op: 'put' | 'delete'; ok: boolean }>[] = [];
    for (const key of puts) {
      jobs.push(
        osm.putUserPreferenceAsync(key, desired.get(key)!)
          .then(() => ({ key, op: 'put' as const, ok: true }))
          .catch(() => ({ key, op: 'put' as const, ok: false }))
      );
    }
    for (const key of deletes) {
      jobs.push(
        osm.deleteUserPreferenceAsync(key)
          .then(() => ({ key, op: 'delete' as const, ok: true }))
          .catch(() => ({ key, op: 'delete' as const, ok: false }))
      );
    }

    // Perform the updates
    return Promise.all(jobs).then(outcomes => {
      let failed = 0;
      for (const { key, op, ok } of outcomes) {
        if (!ok) { failed++; continue; }
        if (op === 'put') {
          this._remote.set(key, desired.get(key)!);
        } else {
          this._remote.delete(key);
        }
      }
      return failed ? { ok: false, reason: `partial-failure (${failed})` } : { ok: true, reason: 'pushed' };
    });
  }


}
