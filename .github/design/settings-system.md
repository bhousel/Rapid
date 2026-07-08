# Settings System Design

This document proposes a new `SettingsSystem` for Rapid that replaces ad-hoc localStorage keys with a versioned, typed settings model, and supports optional account-backed sync.

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

  // Persistence
  saveAsync(): Promise<void>;
  resetAsync(): Promise<void>;   // no-op: settings are durable, survive resets

  // Sync controls (stubbed until Phase 3)
  pullRemoteAsync(): Promise<SyncResult>;
  pushRemoteAsync(): Promise<SyncResult>;
  syncNowAsync(): Promise<SyncResult>;
}
```

Implementation details:
- Backed by `StorageSystem` (a required dependency) for local key/value persistence.
- Uses simple built-in TypeScript/JavaScript data structures; no third-party state libraries.
- Values are type-tagged (`s:` / `n:` / `b:`) so scalars round-trip losslessly.
- `get()` and `getAll()` return deep copies so callers cannot mutate internal state.
- The reserved `meta` top-level namespace holds engine metadata (version, timestamps);
  writing to it throws.
- Consuming systems may still add small typed helpers (e.g. `addCustomSource`) on top of
  the generic API to reduce path-level mistakes.

## Persistence Adapters

```ts
interface SettingsAdapter {
  id: 'local' | 'remote-osm';
  loadAsync(): Promise<RapidSettingsEnvelope | null>;
  saveAsync(envelope: RapidSettingsEnvelope): Promise<void>;
  clearAsync(): Promise<void>;
}
```

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

## Legacy Key Mapping (initial)

Initial one-time import into v1 envelope:

- `background-custom-template` -> `rapid.imagery.custom[0].template`
- `background-favorites` -> `rapid.imagery.favorites`
- `background-last-used` -> `rapid.imagery.lastUsed`
- `background-last-used-toggle` -> `rapid.imagery.lastUsedToggle`
- `background-opacity` -> `rapid.imagery.opacity`
- `preset_recents` -> `rapid.schema.presetRecents`
- `preferences.privacy.thirdpartyicons` -> `rapid.privacy.thirdPartyIcons`
- `prefs.mouse_wheel.interaction` -> `rapid.ui.mouseWheelInteraction`
- `rapid-internal-feature.*` -> `rapid.experiments.*`
- `sawRapidSplash`, `sawWhatsNewVersion`, `sawPrivacyVersion` -> `rapid.ui.*`
- `inspector.collapsed`, `inspector.width` -> `rapid.ui.inspector.*`
- `walkthrough_*` -> `rapid.ui.walkthrough.*`

Notes:
- Some existing keys should remain outside settings scope for now (for example edit backup/history managed by `EditSystem`).
- Maintain compatibility reads for a limited deprecation window.

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

### Phase 2: First callsite migrations (next)

Migrate highest-impact settings first, defining each domain's settings interface in its
owning system:
- Custom background template flow.
- Imagery custom/favorites/last used/opacities.
- Schema preset recents.

Keep behavior parity while replacing direct key access.

### Phase 3: OSM sync foundation

- Add OSM preference write APIs in `OsmService`.
- Implement remote adapter for all supported settings domains using key-per-setting sync.
- Add explicit sync triggers and telemetry/logging.

### Phase 4: Expand domain coverage

- Move remaining suitable preferences into typed settings tree.
- Add settings UI for sync controls and account state.
- Deprecate direct ad-hoc storage key usage in code review guidance.

### Phase 5: Optional backend upgrades

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
2. Remote sync should cover all settings domains by default once authenticated.
3. OSM limits are treated as hard constraints: 255-char key/value, max 150 keys per PUT request.
4. Add `toJSON`/`fromJSON` methods on `SettingsSystem` now to enable future manual export/import in a later sprint.

## Summary

`SettingsSystem` establishes a typed, versioned, and migration-safe foundation for Rapid preferences, while preserving compatibility with existing storage keys and enabling optional OSM-backed sync. This directly supports upcoming growth in custom background/custom data features without further key sprawl.
