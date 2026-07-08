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

/** The result of a remote sync operation. */
export interface SyncResult {
  ok: boolean;
  reason: string;
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


// ---------------------------------------------------------------------------
// Storage key constants
// ---------------------------------------------------------------------------

/** Prefix shared by every settings storage key. */
const SETTINGS_PREFIX = 'rapid.settings';

/** Reserved namespace for engine metadata (version, timestamps). Not a user domain. */
const SETTINGS_META_PREFIX = `${SETTINGS_PREFIX}.meta.`;

/** The latest settings payload version. Bump this when adding a migration. */
const CURRENT_SETTINGS_VERSION = 1;


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
  return key.startsWith(`${SETTINGS_PREFIX}.`) || key.startsWith(`${SETTINGS_PREFIX}[`);
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
function importLegacyKeys(tree: SettingsTree, storage: StorageSystem): SettingsTree {
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

  // privacy
  const privacy: Record<string, SettingsValue> = {};
  put(privacy, 'thirdPartyIcons', getStr('preferences.privacy.thirdpartyicons'));
  if (Object.keys(privacy).length) {
    imported.privacy = privacy;
  }

  // experiments (formerly the `rapid-internal-feature.*` keys)
  const experiments: Record<string, SettingsValue> = {};
  put(experiments, 'allowLargeEdits', getStr('rapid-internal-feature.allowLargeEdits'));
  put(experiments, 'previewDatasets', getStr('rapid-internal-feature.previewDatasets'));
  put(experiments, 'showAutoFix', getStr('rapid-internal-feature.showAutoFix'));
  put(experiments, 'tagnosticRoadCombine', getStr('rapid-internal-feature.tagnosticRoadCombine'));
  if (Object.keys(experiments).length) {
    imported.experiments = experiments;
  }

  // validation
  const validation: Record<string, SettingsValue> = {};
  put(validation, 'squareDegrees', getStr('validate-square-degrees'));
  put(validation, 'what', getStr('validate-what'));
  put(validation, 'where', getStr('validate-where'));
  if (Object.keys(validation).length) {
    imported.validation = validation;
  }

  // restrictions
  const restrictions: Record<string, SettingsValue> = {};
  put(restrictions, 'maxDistance', getStr('turn-restriction-distance'));
  put(restrictions, 'viaWay0', getStr('turn-restriction-via-way0'));
  if (Object.keys(restrictions).length) {
    imported.restrictions = restrictions;
  }

  // changeset
  const changeset: Record<string, SettingsValue> = {};
  put(changeset, 'comment', getStr('comment'));
  put(changeset, 'commentDate', getStr('commentDate'));
  put(changeset, 'hashtags', getStr('hashtags'));
  put(changeset, 'source', getStr('source'));
  if (Object.keys(changeset).length) {
    imported.changeset = changeset;
  }

  // custom data
  const customDataURL = getStr('settings-custom-data-url');
  if (customDataURL !== undefined) {
    imported.customData = { url: customDataURL };
  }

  // ui
  const ui: Record<string, SettingsValue> = {};
  put(ui, 'sawRapidSplash', getStr('sawRapidSplash'));
  put(ui, 'sawPrivacyVersion', getStr('sawPrivacyVersion'));
  put(ui, 'sawVersion', getStr('sawVersion'));
  put(ui, 'sawWhatsNewVersion', getStr('sawWhatsNewVersion'));
  put(ui, 'mouseWheelInteraction', getStr('prefs.mouse_wheel.interaction'));

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

  if (Object.keys(ui).length) {
    imported.ui = ui;
  }

  // Existing tree values (if any) win over imported legacy values, keeping this idempotent.
  return TreeStore.merge(imported, tree) as SettingsTree;
}


/** The ordered list of migrations, applied whenever the stored version is behind. */
const SETTINGS_MIGRATIONS: SettingsMigration[] = [
  { toVersion: 1, migrate: importLegacyKeys }
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
 * Persistence is **key-per-setting** rather than one large blob, so the same
 * layout works for `localStorage` today and for OpenStreetMap's key/value user
 * preferences (with their 255-char and 150-key limits) in the future.
 *
 * The in-memory tree and its flat-key (de)serialization are handled by the
 * generic `TreeStore` (in `lib/`); this system only adds the settings-specific
 * `rapid.settings.*` namespace, engine metadata, and legacy-key migrations.
 *
 * Events available:
 * - `settingschange`   Fires after any mutation that changes the persisted settings
 */
export class SettingsSystem extends AbstractSystem {

  /** The in-memory settings tree (domain data only, no engine metadata). */
  protected _store: TreeStore;
  /** The current settings payload version. */
  protected _version: number;
  /** The Rapid app version that last wrote these settings. */
  protected _appVersion: string;
  /** ISO timestamp of the last mutation, used for future remote conflict resolution. */
  protected _updatedAt: string;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'settings';
    this.requiredDependencies = new Set<SystemID>(['storage']);

    this._store = new TreeStore();
    this._version = CURRENT_SETTINGS_VERSION;
    this._appVersion = context.version;
    this._updatedAt = new Date(0).toISOString();
  }


  /**
   * Called after all core objects have been constructed.
   * Loads settings from storage, applies any pending migrations, and persists the result.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync()
      .then(() => this.context.systems.storage!.initAsync())
      .then(() => {
        const storage = this.context.systems.storage!;
        const loaded = this._load();

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
          this._save();
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
   * Replaces all settings from a previously-exported envelope, then persists
   * and emits a `change` event.
   * @param envelope - The settings envelope to import
   */
  public fromJSON(envelope: RapidSettingsEnvelope): void {
    const settings = envelope?.rapid?.settings;
    this._store.replace(TreeStore.isPlainObject(settings) ? settings : {});
    this._version = CURRENT_SETTINGS_VERSION;
    this._appVersion = this.context.version;
    this._updatedAt = new Date().toISOString();
    this._save();
    this.emit('settingschange');
  }


  /**
   * Persists the current settings to storage.
   * @return  Promise resolved when the write completes
   */
  public saveAsync(): Promise<void> {
    this._save();
    return Promise.resolve();
  }


  /**
   * Pulls settings from the remote (OSM account) store. Not yet implemented.
   * @return  Promise resolved with the sync result
   */
  public pullRemoteAsync(): Promise<SyncResult> {
    return Promise.resolve({ ok: false, reason: 'remote-sync-not-implemented' });
  }


  /**
   * Pushes settings to the remote (OSM account) store. Not yet implemented.
   * @return  Promise resolved with the sync result
   */
  public pushRemoteAsync(): Promise<SyncResult> {
    return Promise.resolve({ ok: false, reason: 'remote-sync-not-implemented' });
  }


  /**
   * Runs a full remote sync (pull then conditional push). Not yet implemented.
   * @return  Promise resolved with the sync result
   */
  public syncNowAsync(): Promise<SyncResult> {
    return Promise.resolve({ ok: false, reason: 'remote-sync-not-implemented' });
  }


  /**
   * Loads the settings tree and engine metadata from storage.
   * @return  The loaded tree plus its stored version and metadata
   */
  protected _load(): LoadedSettings {
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
   * Persists the current settings to storage as one namespaced key per setting,
   * writing changed keys and removing any that no longer exist.
   */
  protected _save(): void {
    const storage = this.context.systems.storage!;

    const desired = new Map<string, string>();
    desired.set(`${SETTINGS_META_PREFIX}settingsVersion`, String(this._version));
    desired.set(`${SETTINGS_META_PREFIX}updatedAt`, this._updatedAt);
    desired.set(`${SETTINGS_META_PREFIX}appVersion`, this._appVersion);
    for (const [flatKey, value] of this._store.toFlat()) {
      // A leading `[` means a top-level array index; otherwise join with a `.`.
      const storageKey = flatKey.startsWith('[') ? `${SETTINGS_PREFIX}${flatKey}` : `${SETTINGS_PREFIX}.${flatKey}`;
      desired.set(storageKey, value);
    }

    const stale = new Set(storage.keys().filter(isSettingsKey));
    for (const [key, value] of desired) {
      storage.setItem(key, value);
      stale.delete(key);
    }
    for (const key of stale) {
      storage.removeItem(key);
    }
  }


  /**
   * Updates the modified timestamp, persists, and emits a `change` event.
   */
  protected _touch(): void {
    this._updatedAt = new Date().toISOString();
    this._save();
    this.emit('settingschange');
  }


  /**
   * Guards against writing to the reserved `meta` namespace.
   * @param parts - The parsed path segments
   * @throws Error if the top-level segment is `meta`
   */
  protected _assertNotReserved(parts: KeyPathPart[]): void {
    if (parts[0] === 'meta') {
      throw new Error(`Settings path '${String(parts[0])}' is reserved`);
    }
  }
}
