# Settings System Design

This document proposes a new `SettingsSystem` for Rapid that replaces ad-hoc localStorage keys with a versioned, typed settings model, and supports optional account-backed sync.

> **Status:** Phases 0–3 and v2 Steps 1–2 (safe sync of registered settings; datasets as a collection)
> are implemented. The guiding principle: make Rapid's settings work more like VS Code's. In October
> 2026 we agreed on a new direction: **everything the user can change becomes a document**, layered and
> merged like the asset files, with a `settings.json` the user can open and edit, a short list of
> settings that sync, and export/import as JSON files. See [Layered Settings (v2)](#layered-settings-v2).
> It replaces Phases 4–5 and some of the Resolved Decisions below.

## Problem

Rapid currently persists preferences as many independent key/value entries via `StorageSystem`.

Current pain points:
- Settings are scattered across unrelated keys (`background-custom-template`, `preset_recents`, `prefs.mouse_wheel.interaction`, etc.) with no shared schema.
- There is no centralized migration/versioning story.
- Callers can read/write arbitrary keys, so naming and ownership drift over time.
- Local browser storage is device-scoped, so users lose settings when moving browsers/devices.
- There is no clear boundary between durable user preferences and runtime/session state.

Rapid will soon need to persist substantially more user configuration (custom backgrounds, custom data, and related UI state), so the current model will become harder to maintain.

## Goals

1. Introduce a single typed settings model, validated at load time.
2. Version settings schema and support deterministic migrations.
3. Preserve backwards compatibility with existing localStorage keys during rollout.
4. Support multiple persistence backends through adapters:
   - local (initially localStorage, with room for IndexedDB later)
   - remote (OpenStreetMap account preferences)
5. Keep `SettingsSystem` focused on durable preferences only.
6. Provide ergonomic typed APIs for systems to read/update settings by path/domain.
7. Enable future growth for custom imagery/custom data without introducing more ad-hoc keys.
8. Migrate all existing settings keys that we care about in a single release.

## Non-Goals (initial scope)

- Replacing all app state management with a frontend framework store.
- Syncing large edit-history/session payloads through OSM preferences.
- Building a full conflict-free replicated data type (CRDT) sync layer in v1.

## Design Principles

- Typed first: callers use typed selectors/actions, not stringly-typed raw keys.
- Schema-owned: settings shape is defined in one place and validated.
- Migration-safe: every persisted payload declares a settings version.
- Adapter-based: persistence mechanism is swappable and testable.
- Domain-oriented: settings organized by system/domain ownership.
- Explicit sync: cloud sync is opt-in and scoped by domain.

## Proposed Data Model

The `SettingsSystem` engine is **domain-agnostic**: it stores an arbitrary
JSON-like tree (`SettingsTree`) and knows nothing about the shape of what it
holds. Each consuming system owns and defines its own settings interface (see
"Interface Ownership" below) and reads/writes typed paths.

The serialized envelope produced by `toJSON()` wraps the tree with engine metadata:

```ts
interface RapidSettingsEnvelope {
  rapid: {
    settingsVersion: number;
    appVersion: string;
    updatedAt: string;   // ISO timestamp
    settings: SettingsTree;   // the domain tree (imagery, schema, ui, ...)
  };
}

type SettingsScalar = string | number | boolean;
type SettingsValue = SettingsScalar | SettingsValue[] | { [key: string]: SettingsValue };
type SettingsTree = Record<string, SettingsValue>;
```

The domain sections below are **illustrative** of the tree's runtime shape. In
the implementation these interfaces live with their owning systems, not in
`SettingsSystem`:

```ts
// e.g. defined by ImagerySystem
interface ImagerySettings {
  custom: Array<{
    id: string;
    name: string;
    template: string;
    type?: 'tms' | 'wms';
    createdAt: string;
    updatedAt: string;
  }>;
  favorites: string[];
  lastUsed?: string;
  lastUsedToggle?: boolean;
  opacity?: number;
}

// e.g. defined by SchemaSystem
interface SchemaSettings {
  presetRecents: string[];
}

interface UISettings {
  sawRapidSplash?: boolean;
  sawWhatsNewVersion?: number;
  sawPrivacyVersion?: number;
  inspector?: {
    collapsed?: boolean;
    width?: number;
  };
  walkthrough?: {
    started?: boolean;
    completed?: boolean;
    progress?: string;
  };
}

interface PrivacySettings {
  thirdPartyIcons?: boolean;
}

interface ExperimentSettings {
  allowLargeEdits?: boolean;
  previewDatasets?: boolean;
  showAutoFix?: boolean;
  tagnosticRoadCombine?: boolean;
}
```

### Interface Ownership

Domain settings interfaces (`ImagerySettings`, `SchemaSettings`, …) are **owned
by the systems that use them**, not centralized in `SettingsSystem`. This keeps
the engine domain-agnostic: it never learns what a "preset recent" or a "custom
imagery source" is — it just stores and retrieves a generic tree.

- **Pro:** each system evolves its own settings without touching the engine;
  ownership matches the project's "system owns its state" principle; no central
  "god type" that couples every domain together.
- **Con:** there is no single type describing the whole tree. This is rarely
  needed, and export/import round-trips through the generic `SettingsTree`.
- Migrations are the one deliberate exception: legacy key mappings live in a
  module-private migration step inside `SettingsSystem.ts` (a one-time,
  version-scoped concern), so the engine stays clean while the mapping knowledge
  lives in exactly one place.

JSON5 example for persisted payload:

```json5
{
  rapid: {
    settingsVersion: 1,
    appVersion: '2.6.0',
    updatedAt: '2026-07-07T12:00:00.000Z',

    imagery: {
      custom: [
        {
          id: 'custom-1',
          name: 'County WMS',
          template: 'https://example.com/wms?bbox={bbox}&width={width}&height={height}&srs={proj}',
          type: 'wms',
          createdAt: '2026-07-07T11:00:00.000Z',
          updatedAt: '2026-07-07T11:00:00.000Z'
        }
      ],
      favorites: ['EsriWorldImagery'],
      lastUsed: 'custom-1',
      opacity: 1
    },

    schema: {
      presetRecents: ['highway/residential', 'building']
    },

    ui: {
      sawRapidSplash: true,
      sawWhatsNewVersion: 12
    },

    privacy: {
      thirdPartyIcons: true
    },

    experiments: {
      allowLargeEdits: false
    }
  }
}
```

## Ownership and Boundaries

- `SettingsSystem` owns settings lifecycle: load, validate, migrate, query/update, persist, optional sync.
- Other systems own semantics for their domains but do not read/write raw storage keys.
- `StorageSystem` becomes a low-level backend utility (or can be folded into adapters later).

Important boundary:
- Durable preference data belongs in `SettingsSystem`.
- High-churn runtime/session/edit data should stay in runtime systems or move to IndexedDB-backed domain stores, not OSM preferences.

## API Sketch

The engine exposes a generic, path-based API (implemented):

```ts
interface SettingsSystem {
  // Reads
  get<T = SettingsValue>(path: string, fallback?: T): T | undefined;
  has(path: string): boolean;
  getAll(): SettingsTree;
  readonly settingsVersion: number;

  // Writes (each persists + emits a `change` event)
  set(path: string, value: SettingsValue): void;
  unset(path: string): void;   // deleting an array element compacts the array

  // Export / import
  toJSON(): RapidSettingsEnvelope;
  fromJSON(envelope: RapidSettingsEnvelope): void;

  // Sync (v2 Step 1: replaced pullRemoteAsync / pushRemoteAsync)
  registerSync(paths: string[]): void;
  syncRemote(): Promise<SyncResult>;

  // A clean slate, here and on the OSM account (for testing and the developer console)
  clearAllAsync(): Promise<SyncResult>;
}
```

Implementation details:
- Backed by `StorageSystem` (a required dependency) for local key/value persistence.
- Uses simple built-in TypeScript/JavaScript data structures; no third-party state libraries.
- Leaf values are plain strings; consuming systems coerce on read.
- `get()` and `getAll()` return deep copies so callers cannot mutate internal state.
- The reserved `meta` top-level namespace holds engine metadata (version, timestamps);
  writing to it throws.
- Consuming systems may still add small typed helpers (e.g. `addCustomSource`) on top of
  the generic API to reduce path-level mistakes.


### Key Codec (Shared by Local + Remote)

Both adapters use the same key codec so keys round-trip deterministically between:
- in-memory settings object paths
- localStorage key strings
- OSM preference key strings

Canonical key format:
- Prefix: `rapid.settings.`
- Object path separator: `.`
- Array index syntax: `[n]`
- Reserved metadata namespace: `rapid.settings.meta.*`

Encoding rules:
- Keys are ASCII-only.
- Path segments are encoded with URL percent-encoding (`encodeURIComponent`) before joining.
- Keep `.` and `[`/`]` structural only; if those characters occur in source field names, they must be encoded in the segment.
- Values are stored as strings and decoded by expected type at read time.

Type/value encoding rules:
- Leaf values are always **plain strings** — the same contract as `localStorage` and
  the OpenStreetMap user-preferences API.
- Callers are responsible for converting to and from their own types on read
  (e.g. `Number(settings.get('ui.width'))`, `settings.get('flag') === 'true'`).
- `null`/missing: represented by key removal.
- `object` and `array`: flattened to child keys (each leaf is a string).

Determinism rules:
- Key generation order is stable and lexical.
- Decoder must ignore unknown keys under `rapid.settings.*` (forward compatibility).
- Unknown keys outside prefix are untouched.

Key examples:
- `rapid.settings.imagery.custom[0].name = "A Custom Source"`
- `rapid.settings.imagery.custom[0].template = "https://example1.com/..."`
- `rapid.settings.ui.sawWhatsNewVersion = "20241222"`
- `rapid.settings.meta.updatedAt = "2026-07-07T12:00:00.000Z"`

### Delete Semantics and Array Compaction

Deletion policy (v1): remove key + compact indexes.

Object property delete:
- Remove that property key and all descendant keys.

Array element delete:
- Remove the deleted element keys.
- Shift all following indices left by one (compaction).

Compaction example:
- Before delete index 1:
  - `rapid.settings.imagery.custom[0].name = "A"`
  - `rapid.settings.imagery.custom[1].name = "B"`
  - `rapid.settings.imagery.custom[2].name = "C"`
- After delete index 1:
  - `rapid.settings.imagery.custom[0].name = "A"`
  - `rapid.settings.imagery.custom[1].name = "C"`

Consistency rule:
- Compaction is applied to the in-memory tree first, then persisted by writing the
  new key set and removing any keys that no longer exist (a single save pass).

### Local Adapter (v1)

- Backing store: localStorage.
- Storage layout: one namespaced key per setting path (not a single large blob).
- Key examples:
  - `rapid.settings.imagery.custom[0].name`
  - `rapid.settings.imagery.custom[0].template`
  - `rapid.settings.schema.presetRecents[0]`
- Reads legacy keys only during migration bootstrap.

Future option:
- Swap local adapter backend to IndexedDB while preserving `SettingsSystem` API.

### Remote Adapter (OSM Preferences)

Observations:
- Rapid already reads OSM user preferences.
- Write path for preferences needs to be implemented in `OsmService`.
- OSM preferences are key/value with strict API limits.
- OSM API limits to account for:
  - max 255 chars for key
  - max 255 chars for value
  - max 150 preferences per PUT request
  - duplicate keys rejected (`406`)
  - oversized batch rejected (`413`)

Recommended layout:
- Store one setting per namespaced key, matching local adapter key paths where possible.
- Example keys:
  - `rapid.settings.imagery.custom[0].name`
  - `rapid.settings.imagery.custom[0].template`
  - `rapid.settings.ui.sawWhatsNewVersion`
  - `rapid.settings.meta.updatedAt`
- For arrays, enumerate members by index:
  - `rapid.settings.imagery.custom[0].name`
  - `rapid.settings.imagery.custom[0].template`
  - `rapid.settings.imagery.custom[1].name`
- Empty arrays and objects serialize as absent (no keys); consumers apply their own
  defaults on read (e.g. `settings.get('imagery.favorites', [])`). This avoids a
  `.length` marker key and its collision edge cases.

Why key-per-setting:
- Compatible with OSM value-size limits.
- Allows partial updates and recovery.
- Avoids large serialized blobs that exceed API constraints.

## Sync Model (v1)

- Sync is enabled by default when authenticated and gated by authentication state.
- Local remains source of truth for responsiveness.
- Pull latest settings on app start/login.
- Push on debounce or explicit user action, using batched PUT operations capped at 150 keys per request.
- Conflict policy: latest timestamp wins (`updatedAt`), with remote pull first then conditional push if local is newer.
- Preserve remote payload if parse/validation fails; do not overwrite blindly.

Multi-account/server note:
- Sync keys are scoped to the active OSM endpoint/account context; switching between production/dev servers should perform a fresh pull for that endpoint.

Future enhancements:
- Per-field merge policies for selected domains.
- Sync status UI and conflict inspection tools.

## Validation and Migration

### Validation

- Validate loaded envelope against runtime schema.
- On validation failure:
  - attempt migration if settings version is older
  - else fallback to defaults + log non-fatal error

### Migration Pipeline

```ts
function migrateToLatest(input: unknown): RapidSettingsEnvelope {
  // detect version
  // apply ordered migrations v0->v1, v1->v2, ...
  // validate final payload
  // return latest
}
```

Migration guarantees:
- Pure and deterministic migration functions.
- Idempotent when rerun on same version.
- Unit tests for each migration step.

## Legacy Key Mapping

One-time import into the v1 envelope. Settings paths are **owned by the systemID** of the
system responsible for them and use **camelCase** leaf names:

- `background-custom-template` -> `imagery.custom[0].template`
- `background-favorites` -> `imagery.favorites`
- `background-last-used` -> `imagery.lastUsed`
- `background-last-used-toggle` -> `imagery.lastUsedToggle`
- `background-opacity` -> `imagery.opacity`
- `preset_recents` -> `schema.presetRecents`
- `preferences.privacy.thirdpartyicons` -> `ui.privacy.thirdPartyIcons`
- `prefs.mouse_wheel.interaction` -> `ui.mouseWheelInteraction`
- `rapid-internal-feature.*` -> `poweruser.*` (active flags) / `poweruser.was.*` (backups)
- `validate-what` / `validate-where` / `validate-square-degrees` / `validate-disabledRules`
  -> `validator.what` / `validator.where` / `validator.squareDegrees` / `validator.disabledRules`
- `disabled-features` -> `filters.disabledFilters`
- `area-fill` / `area-fill-toggle` -> `map.areaFill` / `map.areaFillToggle`
- `turn-restriction-distance` / `turn-restriction-via-way0` -> `ui.restrictions.maxDistance` / `ui.restrictions.viaWay0`
- `raw-tag-editor-view` -> `ui.rawTagEditorView`
- `disclosure.<key>.expanded` -> `ui.disclosure.<key>.expanded`
- `settings-custom-data-url` -> `ui.customData.url`
- `sawRapidSplash`, `sawWhatsNewVersion`, `sawPrivacyVersion`, `sawVersion` -> `ui.*`
- `inspector.collapsed`, `inspector.width` -> `ui.inspector.*`
- `walkthrough_*` -> `ui.walkthrough.*`
- `entity-issues.reference.expanded` -> `ui.entityIssues.referenceExpanded`

### Why the legacy key names matter (iD compatibility)

The legacy localStorage key names read by the migration are **the same keys the iD editor
uses**. When Rapid and iD are served from the same origin (which happens via tasking managers
and similar tools), reading these exact keys lets us **honor a user's existing iD preferences**
on their first Rapid session. For this reason the migration must keep reading the original iD
key names verbatim — do not rename the *source* keys, only the destination settings paths.


### Key naming convention

- Each settings path begins with the **systemID of the owning system** (e.g. `validator.*`,
  `filters.*`, `map.*`, `imagery.*`, `schema.*`, `poweruser.*`), so ownership is obvious from
  the key. UI-only preferences with no single owning system live under `ui.*`.
- Leaf names are **camelCase**.

### Not persisted (deliberately)

- **Changeset draft metadata** (`comment`, `source`, `hashtags`) is *session state*, not a
  durable preference — it is seeded from the urlhash at init and owned by `UploaderSystem`
  as public properties (`uploader.comment` / `.source` / `.hashtags`). It is intentionally
  **not** stored in settings. (The old localStorage `comment`/`commentDate`/`hashtags`/`source`
  keys, with their 2-day expiry hack, are retired.)
- Edit backup/history stays with `EditSystem` (high-churn, out of settings scope).

Notes:
- Legacy keys are read (never re-written) during a limited deprecation window.

## Layered Settings (v2)

**Status:** agreed direction (October 2026); Steps 1–2 done. Rapid's settings should work more like
VS Code's or Sublime Text's: built-in defaults, with the user's changes layered on top, a deployment
layer for embedding apps, and the user's layer exportable as a JSON file.

**The tangible target:** a "Settings (JSON)" editor in Rapid, like VS Code's user `settings.json`,
showing only what the user changed, next to a read-only "Default Settings (JSON)". See
[The target: `settings.json`](#the-target-settingsjson).

### Problems with v1

Found while adding custom datasets with data mappings and conflation rules:

- **Too much syncs, one request per key.** Every setting syncs to the OSM account, and a push sends one
  PUT or DELETE per changed key, all at once. A custom dataset with a 3-row data mapping is about 25
  keys. With a longer data mapping and conflation rules it is more like 150. Arrays are stored by index
  (`transforms[3].source`), so removing an early element rewrites every element after it.
- **Sync can delete the user's settings** (fixed in v2 Step 1). From reading the code:
  - The only thing that starts a sync is a local change (`_touch()` → `_deferredSyncRemote()`).
    Nothing pulls at startup or when the user signs in.
  - The pull applies the remote copy only if it is newer, compared over the whole tree
    (last-write-wins). The push then deletes every remote key that the local copy doesn't have.
  - In a new browser, the v0→v1 migration and the settings written during startup make the local
    copy "newer". So the first change after signing in deletes the user's synced settings instead of
    restoring them.
- **Values over 255 characters stay local without a warning.** A synced custom dataset can arrive
  without its `sourceUrl`.
- **Secrets.** Custom imagery templates and dataset URLs may carry access tokens (Resolved Decision 1),
  and under v1 those sync to the user's OSM account.
- **Strings only.** Every value is a string, a limit that came from localStorage and the OSM API.
  Conflation rules are mostly numbers.
- **No defaults layer.** `get(path, fallback)` repeats the default at every call site. What's stored
  is the full value, not what the user changed. For example, `RapidDataset.toJSON()` saves
  `beta=false` and `hidden=false`, so a default we change later never reaches users who already have
  the old value stored.
- **Reads before settings load.** `UiSystem.initAsync` builds its UI components without waiting for
  `settings.initAsync()`. Six constructors read settings and only get values because loading l10n and
  assets usually takes longer:
  - `UiVersionInfo`
  - `UiSectionBackgroundList`
  - `UiSectionBackgroundDisplayOptions`
  - `UiSectionPrivacy`
  - `UiSectionEntityIssues`
  - `UiSectionRawTagEditor` (the copy built by `UiEntityEditor`)
- `SchemaSystem.resetAll()` has a `// HACK for demo` that clears `schema.presetRecents` on every startup.

### Vocabulary: everything is a document

- **Document** (or "content"): any JSON that Rapid reads, layers and merges, like the asset files
  (`main.json` format, `null` deletes, applied in order). This is the one mechanism for everything the
  user can change, as opposed to loose keys in localStorage.
- Inside documents there are three kinds of data. VS Code has the same three:

| Kind | What it is | The user… | Rapid examples | VS Code |
|---|---|---|---|---|
| **Settings** | Preferences at known keys, each with a default | changes a value | area fill, validator options, power-user flags | `settings.json` |
| **Collections** | Items keyed by ID | adds items, or changes fields of existing ones | `imagery`, `styles`, `presets`, `datasets` | keybindings, snippets, tasks |
| **State** | What the app remembers | doesn't edit it directly | seen-splash flags, panel widths, recents, enabled datasets, last background | `globalState` (`setKeysForSync`) |

- **Not documents:** stored files (blobs) and edit sessions. Those are records in `DatabaseSystem`,
  outside the layering.

So settings, collections and state differ only in what's inside, not in how they're stored or merged.
localStorage becomes a fallback.

Rapid datasets are a collection: an asset file can contain `datasets`, next to `imagery` and `styles`.
That lets an embedding app or a URL preload datasets the way imagery and styles are loaded today.

### The target: `settings.json`

What the user sees when they open "Settings (JSON)": only what they changed, with flat dotted keys
(VS Code's style, which are already our paths) and real JSON types:

```jsonc
// Rapid user settings: only what you've changed. See "Default Settings (JSON)" for everything else.
{
  "map.areaFill": "wireframe",
  "imagery.opacity": 0.8,
  "imagery.favorites": ["EsriWorldImagery", "Bing"],
  "filters.disabledFilters": ["boundaries", "landuse"],
  "validator.what": "all",
  "validator.where": "visible",
  "validator.squareDegrees": 7,
  "validator.disabledRules": ["crossing_ways/highway-railway"],
  "poweruser.allowLargeEdits": true,
  "poweruser.showAutoFix": true,
  "ui.privacy.thirdPartyIcons": false,
  "ui.mouseWheelInteraction": "zoom"
}
```

Of the 40 paths in `SettingsSystem` today, only about 15 are settings. Sorted by kind:

| Kind | Paths today |
|---|---|
| **Settings** | `map.areaFill`, `imagery.opacity`, `imagery.favorites`, `filters.disabledFilters`, `validator.*`, `poweruser.*` (not `poweruser.was.*`), `ui.privacy.thirdPartyIcons`, `ui.mouseWheelInteraction` |
| **State** | `ui.saw*`, `ui.walkthrough.*`, `ui.inspector.*`, `ui.disclosure.*`, `ui.entityIssues.*`, `ui.restrictions.*`, `ui.rawTagEditorView`, `ui.customData.url`, `imagery.lastUsed*`, `map.areaFillToggle`, `schema.presetRecents`, `rapid.addedDatasetIDs`, `rapid.enabledDatasetIDs`, `poweruser.was.*` |
| **Collections** | `imagery.custom[0].template` (a user imagery source), `rapid.dataset.<id>` (the user's changes to a dataset), and the `DatabaseSystem` `datasets` store (the user's own datasets) |

How it works:
- **Systems register their settings**: path, default, type, description, allowed values, and whether
  it syncs (`registerSync` becomes one field of this). The registry generates "Default Settings
  (JSON)" and a JSON Schema to validate the user's file.
- **The user's `settings.json` is one sparse document**, stored as one record in `DatabaseSystem`,
  read once at init. `settings.get()` returns the effective value (defaults, then deployment, then
  user, then session), so most callers barely change.
- **An asset file can carry a `settings` block**, so an embedding app sets preferences the same way it
  sets imagery or datasets (the deployment layer).
- **State moves into its own document**, not shown in the editor. `registerSync` matters most there:
  seen-splash flags sync, panel widths don't.
- **Collections stay their own documents.** Later, the user's datasets and imagery can open in the same
  editor as their own JSON files, the way VS Code shows `keybindings.json`.

### One format, one merge rule

The longer-term idea is to bring asset files and settings closer together: both are JSON trees keyed
by systemID, and both are combined in layers by the same rule. That rule is
[JSON Merge Patch (RFC 7396)](https://www.rfc-editor.org/rfc/rfc7396): objects merge recursively, `null`
deletes, and scalars and arrays replace. That is `TreeStore.merge` plus `null` deletes.

- Collections are **objects keyed by ID, never arrays**, so one layer can add, replace or delete a
  single item.
- **The deciding open question:** whether a layer may change a single field of an item (deep merge),
  or must replace the whole item, as asset `merge()` does today. With deep merge, the user's change to
  a dataset's color is just `datasets: { fbRoads: { color: '#ff8800' } }` in their layer, the same
  collection that holds their own datasets. Then `rapid.dataset.*` settings and the `datasets` store
  become one thing, and the same goes for custom imagery.

### Layers

From lowest to highest; the effective value merges all four in order:

1. **Built-in defaults.** Settings: the defaults each system registers. Collections: Rapid's default
   asset files, plus the dataset catalogs from services.
2. **Deployment.** Supplied by an embedding app: settings and collections in the same formats. It
   overrides defaults but doesn't lock anything; a user can still change a setting.
3. **User.** Sparse: only what the user changed (`settings.json`, the user's collections, state).
   Stored in `DatabaseSystem`. Writes from the UI go here, and "reset to default" removes the key.
4. **Session.** URL parameters (`background=`, `datasets=`, …). Never saved.

A deployment layer, or a shared file loaded later, must not be able to set the OSM API connection or
anything else to do with authentication.

### Storage and lifecycle

- The user layer is a few JSON documents in `DatabaseSystem` (`settings.json`, state, and the
  collections). Values keep their real types.
- `SettingsSystem.initAsync` reads them once. From then on, reads are synchronous, served from memory,
  and writes are saved in the background.
- **Systems update live.** A change from the editor, an import or a sync arrives as `settingschange`,
  and the systems that read a setting must react to it. Today only two UI components listen, so this
  is most of the work of the editor.
- **Lifecycle contract:** during `initAsync`, systems connect to each other. A system that reads
  settings in `initAsync` waits for `settings.initAsync()` first. From `startAsync` on, settings are
  ready for everyone. The six UI constructors listed above must move their reads to render time (or
  `UiSystem.initAsync` must wait for settings).
- **Fallback:** if IndexedDB is unavailable, fall back to localStorage for as much as fits, and then to
  memory, as `StorageSystem` does now. In most private-browsing modes both exist but are discarded
  when the window closes, so losing settings there is expected.
- **Several tabs:** the last tab to save wins. No `BroadcastChannel` for now.
- **Migration:** a one-time import of the `rapid.settings.*` localStorage keys into the user layer.
  (`rapid.custom.*` isn't migrated: custom datasets now live in the `DatabaseSystem` `datasets` store.)

### What syncs to the OSM account

The experience we want: sign in from another browser, and within a moment Rapid looks and behaves the
way you left it (the background, panel sizes, power-user flags, and so on). That needs only a short,
explicit list of small values, the way VS Code separates synced settings from machine-scoped ones.

- **Systems declare which of their settings sync, and `SettingsSystem` enforces it.** For example, in
  `ImagerySystem.initAsync`: `settings?.registerSync(['imagery.lastUsed', 'imagery.opacity'])`.
  Later, the same registration can also declare defaults (the defaults layer).
- **No async `get`.** Remote values arrive as an ordinary change (`settingschange`), and the systems
  that care already react to changes. Pull when Rapid starts with the user already signed in, and when
  the user signs in.
- **Merge one key at a time, using the last synced copy as the base,** saved locally:
  - If only the remote changed, take it.
  - If only the local changed, push it.
  - Never delete a remote key just because the local side doesn't have it.
- Collections (datasets, custom imagery) never sync this way.
- Cleanup: once the allowlist is in place, delete the `rapid.settings.*` keys that v1 pushed but that
  no longer sync.

### Export and import

- **Export** writes the user layer (settings and collections) as one JSON file. **Import** merges a
  file into the user layer. Open: whether state is exported too (VS Code profiles leave most of it out).
- Possibly later: named profiles to share with a team (a dataset with its data mapping, its rules
  and its imagery), and a `profile=` URL parameter.
- File-backed datasets export their `sourceFileID` but not the file. When the file is missing, at
  startup or after the browser evicts it under storage pressure (unless
  `DatabaseSystem.requestPersistentAsync()` was granted), `setupCustomDatasetAsync` already copes.
  Rapid should tell the user, not fail quietly.
- Warn on export that URLs and templates may contain access tokens.

### Embedding apps

Embedding apps configure Rapid today by reaching into systems between lifecycle phases. One real
integration does all of these:
- removes services from `Rapid.services.available`;
- adds a network request interceptor for its auth headers;
- replaces OSM service and `UiSuccess` methods;
- writes string overrides into the `LocalizationSystem` store;
- merges imagery and styles;
- fakes a `hashchange` to switch projects.

Most of that should be configuration supplied as the deployment layer: disabled services, string
overrides, imagery, styles and datasets. A few things are real extension points, such as the request
interceptor and an auth provider. Both kinds belong in a customization guide (`docs/` or `API.md`),
modeled on how VS Code documents its settings and extension points.

### Open questions (v2)

- ~~The URL parameter name for dataset assets.~~ Resolved: the old `datasets=` became `dataset_ids=`,
  and `datasets=` now lists asset IDs.
- **Deep merge vs. whole-item replace within a collection** (see above). This decides where the user's
  changes to collection items live.
- Where the user's own collection items are kept: one document per collection (like the `datasets`
  store today, one record per item), or one user document with all of them.
- The asset load order bug: Imagery, Style and Schema register their default asset IDs *after*
  `assets.initAsync()`. This overwrites an `assets=` override of a default ID, and `merge()` throws if
  the same assetID is merged twice. A user layer gets merged again on every asset reload, so this has
  to be fixed first.
- Asset files have `scopes`; does the user layer need them too?

### Rollout (v2)

1. **Make sync safe.** ✅ Done.
   - Systems register the settings that sync (`settings.registerSync(paths)`), and only those sync.
     Each path syncs as one unit, so an array never arrives half-written.
   - `syncRemote()` merges each one against the last synced copy (`meta.syncBase` in localStorage,
     scoped to the OSM site and user). If the remote changed, it wins; otherwise a local change is
     sent. Requests go one at a time, and only one sync runs at once.
   - Rapid syncs at startup when the user is already signed in, on every `authchange`, and after a
     change to a synced setting. Remote `rapid.settings.*` keys that aren't synced are removed.
   - Synced so far: imagery favorites and opacity; area fill; disabled filters; validator options;
     privacy and raw tag editor view; the "seen" flags; and the power-user flags. Device-specific
     settings (inspector width, mouse wheel) and collections stay local.
   - Few systems listen for `settingschange` yet. A value pulled after startup shows up the next time
     it's read (render time, or the next reload).
   - `UiSystem.initAsync` now waits for `settings`, which fixes the six constructor reads.
2. **Datasets as a collection.** ✅ Done. A `datasets` collection in asset files, and custom datasets
   in `DatabaseSystem`, with their conflation settings.
   - Asset files can define datasets (`datasets: {…}` in a scope, `data/schema/dataset.schema.json`),
     loaded by the `datasets=` url parameter (assetIDs, like `imagery=`) or `RapidSystem.merge()`.
     The old `datasets=` (datasetIDs to enable) is now `dataset_ids=`. Default asset: `rapid_datasets`
     (empty).
   - The user's custom datasets are records in the `DatabaseSystem` `datasets` store (schema v3),
     with their data mapping and conflation settings, in plain JSON types. The old `rapid.custom.*`
     settings aren't migrated (they never shipped). See [`rapid-system.md`](rapid-system.md).
3. **`settings.json`, first version.**
   - A settings registry: each system registers its settings (path, default, type, description,
     allowed values, sync) in `initAsync`. It generates "Default Settings (JSON)" and a JSON Schema.
   - The user's `settings.json` as one sparse record in `DatabaseSystem`, with real types; a one-time
     import of the settings among today's `rapid.settings.*` keys.
   - A modal with a JSON5 text editor (the `json5` package is already a dependency) and a "Default
     Settings" view. It validates on save, and applies the changes.
   - Systems that read settings update live on `settingschange`.
4. **State moves out of settings** into its own document, not shown in the editor, with
   `registerSync` choosing what syncs.
5. **Collections in the user layer:** decide deep merge, then move `rapid.dataset.*` and custom
   imagery into the user's collections.
6. **Export / import.**
7. **Deployment layer** (a `settings` block in asset files) **and a customization guide.**
8. Later: a settings form view, like VS Code's settings UI.

## Rollout Plan

### Phase 0: Design + scaffolding ✅ done

- `TreeStore` (`modules/lib/TreeStore.ts`) — generic, domain-agnostic nested-tree store:
  path access (`get`/`peek`/`set`/`has`/`unset`), flat-key (de)serialization
  (`toFlat`/`fromFlat`), `merge`, and the key-path primitives (static `parsePath`;
  get/set/has/delete module-private). Independently tested. `modules/util/keypath.ts`
  was folded into it and deleted.
- `SettingsSystem` (`modules/core/SettingsSystem.ts`) — holds a `TreeStore` and adds only
  the settings-specific `rapid.settings.*` namespace, engine metadata, and legacy migrations.
- `LocalizationSystem` also builds on `TreeStore` (its `_store`, keyed `[locale][resource][…]`);
  hot `t()` reads use `peek` (copy-free).
- Local persistence via `StorageSystem` (new `keys()` enumeration method), key-per-setting.

### Phase 1: Compatibility bootstrap ✅ done

- v0→v1 migration imports all existing settings keys we care about on first init.
- Legacy keys are read but left in place so not-yet-migrated callsites still work.
- Idempotent: existing settings win over re-imported legacy values.

### Phase 2: First callsite migrations ✅ done

All callsites that previously read/wrote the legacy `storage` keys now use the typed
`SettingsSystem` paths instead. Systems access `settings` as an **optional** dependency
(`settings?.get(...)` / `settings?.set(...)`) to keep coupling low; `storage` is only kept
where a file still uses it for non-migrated keys (e.g. `EditSystem` edit backups). Settings
paths are keyed by the **owning systemID** and use **camelCase** (see naming convention above).
Highlights:
- Imagery: custom template, favorites, last-used (+toggle), opacity.
- Schema: preset recents, now stored as a native array (no `JSON.stringify`).
- Validator: `validator.what` / `where` / `squareDegrees` / `disabledRules`.
- Poweruser: all `rapid-internal-feature.*` flags → `poweruser.*`; `.was.` backups → `poweruser.was.*`.
- Filters / Map: `filters.disabledFilters`, `map.areaFill` / `map.areaFillToggle`.
- UI: splash/whatsnew/version flags, walkthrough progress, inspector width/collapsed,
  mouse-wheel interaction, third-party-icon privacy, raw-tag-editor view, disclosure state,
  custom-data URL.

Changeset draft metadata (`comment`/`source`/`hashtags`) was moved *out* of settings and onto
`UploaderSystem` as public, session-scoped properties (see "Not persisted" above).

The v0→v1 migration was extended to also import `poweruser.autoConnect`, `poweruser.tagSources`,
`validator.disabledRules`, `filters.disabledFilters`, `map.areaFill`/`areaFillToggle`, and
`ui.rawTagEditorView` so no previously-persisted value is orphaned. Legacy keys are still read
(never written) during the deprecation window.

### Phase 3: OSM sync foundation ✅ done (initial)

#### OSM preferences API — findings (verified against openstreetmap-website source)

The API is under-documented; confirmed from `api/user_preferences_controller.rb` + `user_preference.rb`:
- **GET** (`index`) supports both XML and JSON responses.
- **Bulk PUT** (`update_all`) parses the request body as **XML only** (`LibXML::XML::Parser`),
  regardless of a `.json` URL suffix — there is **no JSON write payload**. It's also a full
  *replace*, and it parses with `NOERROR`, so sending a non-XML body silently matches zero
  `<preference>` nodes and **wipes all preferences** (a real footgun — full-replace is dangerous).
- **Single-key PUT** (`update`) takes a **raw plain-text body** (`pref.v = request.raw_post`) —
  no XML or JSON at all. Single-key GET/DELETE are equally trivial.
- **Hard limits:** key and value are each **1–255 chars** (`validates :length => 1..255`). Notably,
  there is **no count limit** in the current code — the "150 preferences" figure is stale/folklore.
- **Dotted-key routing gotcha (important).** The single-key routes expose the key as a Rails route
  param constrained to `[^/.?]+`, so any key containing `.` (or `/`, `?`) can't be addressed — the
  route stops at the first dot and the request **404s**. Percent-encoding the dot doesn't help
  either: the OSM front-end normalizes `%2E` back to `.` before routing. Our settings keys are
  dotted (`rapid.settings.*`), so this affects every write.

Implications: single-key writes are simpler (plain text, no serialization), non-destructive by
construction, and scale past any count concern — so they are the default sync mechanism. The
dotted-key routing gotcha is worked around entirely inside `OsmService` (see below), so the rest
of the system keeps using normal dotted keys.

#### `OsmService` preference write APIs (`modules/services/OsmService.ts`)
- `putUserPreferenceAsync(key, value)` — single `PUT /user/preferences/[key]` (plain-text body).
- `deleteUserPreferenceAsync(key)` — single `DELETE /user/preferences/[key]` (404 = success).
- `putUserPreferencesAsync(prefs)` — bulk `PUT /user/preferences` (full replace). Builds the
  preferences XML directly (escaped) rather than via `JXON` (whose `document.implementation` use
  breaks under happy-dom). Kept for completeness / one-shot seed-reset; **not** used by the sync.
- **Dot substitution (`.` ↔ `~`).** To dodge the dotted-key routing gotcha, the single-key
  methods substitute `.` → `~` for the stored/URL key (`encodePreferenceKey`), and
  `getUserPreferencesAsync` reverses it (`decodePreferenceKey`) so callers always see dotted keys.
  `~` is chosen because it's a URL-safe unreserved char (never percent-encoded by
  `encodeURIComponent`, never path-normalized) and no known preference key uses it, so the mapping
  is reversible. Only keys starting with `rapid~settings` are decoded, since other applications'
  keys may contain a `~` of their own. `rapid.settings.*` keys stored with real dots (written by
  early development code) are left out of the cache, because the single-key routes can't address
  them; only the bulk PUT can remove them. **Current implementation note:** `putUserPreferencesAsync` also encodes keys with
  `encodePreferenceKey` when building the XML, so bulk and single-key writes both persist the same
  `~`-substituted key form for Rapid's dotted keys.
- All validate the OSM limits (key/value **1–255 chars**, reject empty).
- **`_userPreferences` cache semantics.** `null` means "not pulled yet" — `getUserPreferencesAsync`
  does the fetch (a "pull") and populates it as a plain `Record<string, string>`, and thereafter
  serves from cache. The write methods currently call `getUserPreferencesAsync()` first to ensure a
  baseline has been pulled before mutating or diffing. Writes **keep the cache current in place**
  (single-key PUT sets `preferences[key]`, DELETE removes it, bulk PUT replaces the whole map)
  instead of invalidating it. `logout()` and connection switches reset it to `null`; `switchAsync()`
  and successful auth eagerly call `loadCurrentUserDataAsync()` to preload details, preferences,
  and changesets. `resetAsync()` itself does not currently clear `_userPreferences`. Tests in
  `OsmService.test.js`.

#### Remote adapter + sync triggers (`SettingsSystem`)

> Replaced in v2 Step 1 by the three-way merge of registered settings. See
> [Rollout (v2)](#rollout-v2). Kept here for history.
- `pushRemoteAsync()` uses **single-key PUT/DELETE for just the deltas** since the last known
  remote state (`_remote` snapshot). Non-destructive by construction — only `rapid.settings.*`
  keys are ever touched. **Empty values** (OSM requires length ≥ 1) and over-limit key/values
  are silently skipped and stay local-only. The snapshot is updated only for calls that succeed,
  so failures retry on the next push. Returns `up-to-date` when there's no diff.
- `pullRemoteAsync()` reads remote prefs, seeds `_remote`, and applies the remote copy **only if
  its `updatedAt` is newer** (last-write-wins).
- `syncRemote()` is the public "do the whole thing" method: it always pulls first, then pushes
  unless the pull already superseded local.
- Pushes are **throttled** (`SchedulerSystem`, 2s window) via `_deferredSyncRemote()`, scheduled
  from `_touch()` — mirrors `UrlHashSystem._deferredUpdateHash`. No-op when OSM is absent or the
  user is logged out. `scheduler` is a new optional dependency.
- There is no longer a separate `_pulledRemote` gate in the implementation; the deferred sync path
  simply calls `syncRemote()` every time, so the remote baseline is re-pulled before each push.
- Tests in `SettingsSystem.test.js` (single-key PUT/DELETE deltas, empty+oversized skip,
  no-op re-push, foreign-pref preservation, LWW pull/push).

Still TODO (later): telemetry/logging, a settings UI for sync status/controls, and re-seeding the
`_remote` snapshot on OSM endpoint switch (Phase 4).

### Phase 4: Expand domain coverage

> Superseded by [Layered Settings (v2)](#layered-settings-v2).

- Move remaining suitable preferences into typed settings tree.
- Add settings UI for sync controls and account state.
- Deprecate direct ad-hoc storage key usage in code review guidance.

### Phase 5: Optional backend upgrades

> Superseded by [Layered Settings (v2)](#layered-settings-v2).

- Evaluate IndexedDB local adapter for larger payloads.
- Optionally partition local docs by domain when payload size grows.

## Testing Strategy

- Unit tests for:
  - schema validation success/failure
  - migration steps and idempotency
  - adapter load/save error handling
  - legacy key import mapping
  - conflict resolution behavior (v1 LWW)
- Integration tests for:
  - startup load and fallback behavior
  - callsite parity for migrated systems
  - authenticated remote sync happy-path and failure recovery

## Risks and Mitigations

- Risk: corrupt/malformed remote payloads.
  - Mitigation: validate before apply; quarantine invalid docs; never hard-overwrite unknown data.

- Risk: migration regressions for legacy users.
  - Mitigation: explicit mapping tests with real-world fixtures; keep deprecation window.

- Risk: excessive write frequency.
  - Mitigation: debounced saves, domain-level writes, and dirty-checking.

- Risk: over-scoping v1.
  - Mitigation: phase implementation (local migration first, then remote sync), while keeping the target state as all-settings sync by default once authenticated.

## Resolved Decisions

Resolved direction:

1. Custom imagery/data entries may include auth metadata as part of the template/config payload (matching current behavior).
2. ~~Remote sync should cover all settings domains by default once authenticated.~~ Reversed in v2: only
   settings that their systems register for sync go to the OSM account.
3. OSM limits are treated as hard constraints: 255-char key/value. (The 150-keys-per-PUT limit turned
   out not to exist; see Phase 3.)
4. Add `toJSON`/`fromJSON` methods on `SettingsSystem` now to enable future manual export/import in a later sprint.

## Summary

`SettingsSystem` establishes a typed, versioned, and migration-safe foundation for Rapid preferences, while preserving compatibility with existing storage keys and enabling optional OSM-backed sync. This directly supports upcoming growth in custom background/custom data features without further key sprawl.
