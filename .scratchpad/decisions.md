# Design Decisions

Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## Architecture

- **Scoped data, no aggregate caches** — Both StyleSystem and SchemaSystem store data in `_scopes: Map<ScopeID, ScopeData>`. No aggregate maps across scopes. Callers access scope data directly: `schema.getScope('osm')?.fields.get(id)`.
- **`'*'` common scope** — Holds geometry fallback presets and default styles. Created by `resetAll()`. Always available even without loaded data. Production `rapid_style.json5` uses `scope: '*'`.
- **Scoped format only** — `merge()` only accepts `{ scopes: [{ scope: 'osm', ... }] }`. External flat data (id-tagging-schema, NsiService) gets wrapped before merging.

## Rulesets & Variables

- **Separate `osm_rulesets.json5`** — Not inside `rapid_schema.json5`. Load order: id_tagging_schema → osm_rulesets → rapid_schema.
- **Lookup tables stay as Records** — `areaKeys`/`pointTags`/`vertexTags` are O(1) Record lookups on SchemaScope. Rulesets would be 50-150x slower on these hot paths.
- **`lifecycle` ruleset as config container** — The Set of prefixes is derived from its key patterns, not used for `match()` directly. `lifecycle_prefixes` variable is the canonical source.
- **`match()` and excludes subtlety** — `match({k: v})` only sees the key/value pairs you pass. When excludes reference different keys than includes, pass the full tag object.
- **Actions access schema via `graph.context.systems.schema`** — `Graph.context` is always set. This is fine and explicit.

## Dual-Props Pattern

Used when a class resolves references (`var()`, locale strings) in its props:
- `props` = raw/immutable (never mutated after construction)
- `_resolved` / `_resolvedValue` = lazy resolved copy
- Getter returns `resolved ?? raw` (zero overhead when no vars)
- `reset()` = null out the resolved copy
- Applied to: `Style`, `PropMatcher`. NOT needed for `Preset`/`Field` (localization cached in `_strings` Map).

## Context Lifecycle

- **No backward compat for old `initAsync()`** — It now only inits (doesn't start). Simple consumers use `context.run()`. v3 breaking change.
- **`prepareAsync()` → `initAsync()` → `startAsync()`** — Each phase chains the previous. All idempotent. `run()` is a convenience that chains everything.

## Style Resolution

- **Fallback cascading is selective** — `fill.color` ← `base.color` or `stroke.color`; `marker.color` ← `base.color` only; etc. Not uniform `base.color` on everything.
- **Single `styleDefaults`** — Defined once in `Style.ts`, not duplicated per PixiFeature class.
- **Rendering code starts with `styleMatch()`** — Don't construct marker/style objects with hardcoded values. Apply specific overrides after `styleMatch(tags, geometry)`.
