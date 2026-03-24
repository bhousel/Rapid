# Agent Context

This file contains agent-specific guidance only.

Read [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) first for general project information.

---

## Working Memory

The `.scratchpad/` folder contains persistent working memory for AI agents across sessions. It is committed to git.

At the start of a session, read `.scratchpad/current.md` for active work context. Pull in other files selectively:
- `decisions.md` — non-obvious design choices (the "why" behind things)
- `lessons.md` — patterns and gotchas to avoid repeating mistakes
- `quirks.md` — known runtime issues and workarounds

As you work, update these files. When work completes, move the "why" to `decisions.md`, lessons to `lessons.md`, and delete the rest from `current.md`. See `.scratchpad/README.md` for conventions.

## Prompt Files

This project has reusable Copilot prompt files in `.github/prompts/`:

- `/commit` — stage and commit all changes
- `/reflect` — update all project documentation with the current state of the code
- `/release` — prepare a new release (CHANGELOG entry + version bump); accepts version number as input
- `/suggest` — review the codebase and suggest concrete improvements
- `/sync` — sync scaffold files against a source repo; accepts source repo URL as input

When asked to do one of these tasks, prefer using the prompt file rather than improvising.

## General Guidelines

### Communication style
- Be concise. Maintainers review many contributions — get to the point.
- Plain language over formal structure. A sentence or two beats a page of headings.
- Don't explain things the maintainer already knows (project context, how Git works, etc.).
- If a PR does one thing, describe that one thing.

### Constructive Pushback
- **Don't just implement what's asked** — briefly flag if you see a concern. The user values a 1-2 sentence heads-up over silent compliance.
- This includes: unnecessary abstractions, deprecated patterns, simpler alternatives, or potential footguns.
- When the user proposes a solution, briefly evaluate whether a more elegant solution exists.

### Secrets hygiene
- Before making any edit or commit, ask: **could this write a secret in plaintext somewhere it shouldn't be?**
- Never put tokens, keys, or passwords in plaintext in any unencrypted file.

### Comments
- **Never remove comments** when modifying files unless:
  - The comment applies to code being removed
  - The meaning of the code has changed
  - Specifically asked to remove them
- Comments contain valuable domain knowledge - preserve them

---

## Working in the Rapid Codebase

### Code Style
- Use ES module syntax (`import`/`export`)
- Prefer `??` (nullish coalescing) over `||` for defaults
- Use `?.` (optional chaining) for safe property access
- **No trailing whitespace** - ensure lines don't end with spaces or tabs

### File Operations
- Use VS Code file tools (`create_file`, `replace_string_in_file`) instead of terminal commands
- This shows changes in VS Code's diff view for easier review
- Avoid using `cat` with heredoc or other terminal-based file writing

### Function Structure and Dependencies
- **Group system/service access at the top of functions** - this makes it easy to scan what a function depends on and understand coupling
- Separate dependency access from logic with a blank line
- Example:
  ```typescript
  enter(options: SomeOptions = {}): boolean {
    // Dependencies first
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const locations = context.systems.locations;  // optional system
    const ui = context.systems.ui;                // may not exist in CLI

    // Then logic
    const selection = options.selection ?? {};
    // ...
  }
  ```
- This pattern supports future goals like a CLI version of Rapid that won't have a UI system

### Optional Systems
- Some systems are optional and may not exist in all deployment contexts
- Use optional chaining (`?.`) for systems that might not be present:
  - `locations` - LocationManager may not be configured
  - `ui` - UiSystem won't exist in a future CLI build
- Example: `if (loc && locations?.isBlockedAt(loc)) continue;`
- This keeps code working even when optional systems are absent

### System Ownership of Runtime State
- All runtime-computed data in Rapid should be **owned by a core system** so that we can manage its state and lifecycle
- **Module-level mutable globals** (e.g. `export let osmAreaKeys = {}` with a setter function) break this rule — other code depends on them in ways where we can't guarantee they've been properly initialized or reset when changes occur
- The test for whether something should be on a system: "If I call this function right now, can I guarantee the data it depends on is ready?" If the answer requires knowing another system's startup sequence, the data belongs on that system.
- **Truly constant data** that does not change at runtime is fine as a module-level `const` — there's no lifecycle to manage. But if the data is a list of domain-specific "magic strings" (like lifecycle prefixes), prefer expressing it as a ruleset in `osm_rulesets.json5` so it's configurable and scope-owned.
- **Domain-specific logic** (like "is this tag interesting?" or "does this tag suggest an area?") belongs on the data class that represents the domain concept (e.g. `OsmEntity`), not as a free function reading a global. The instance method can access the system through `this.context` — making the dependency explicit and traceable.

## TypeScript Patterns

### File Conversion
- Use `git mv` to rename `.js` → `.ts` (preserves git history)
- Update barrel `index.js` to export from `.ts` file

### Class Property Initialization
- **Initialize class properties inside the constructor**, not as field initializers
- This keeps initialization in one place and matches the original JavaScript patterns
- Field initializers run after `super()` returns but before constructor body code, which can cause subtle ordering issues
- Example - prefer this:
  ```typescript
  class FooSystem extends AbstractSystem {
    constructor(context: Context) {
      super(context);
      this.id = 'foo';
      this.requiredDependencies = new Set(['assets']);
      this.optionalDependencies = new Set(['gfx', 'storage']);
    }
  }
  ```
  Over this:
  ```typescript
  class FooSystem extends AbstractSystem {
    readonly id = 'foo';  // avoid field initializers
    requiredDependencies = new Set(['assets']);
    optionalDependencies = new Set(['gfx', 'storage']);

    constructor(context: Context) {
      super(context);
    }
  }
  ```

### Props Interfaces
- Define `FooProps` interface in the same file as the `Foo` class (not in a shared `types.ts`)
- `FooProps` should have **all required properties**
- Constructor accepts `Partial<FooProps>` (caller can pass any subset)
- Constructor assigns defaults for all properties
- Result: `props: FooProps` is fully typed without intersection types

Example:
```typescript
export interface CategoryProps {
  id: string;
  name: string;
  members: string[];
  searchable: boolean;
  matchScore: number;
}

export class Category {
  props: CategoryProps;

  constructor(context: Context, props: Partial<CategoryProps> = {}) {
    if (!props.id) {
      throw new Error('Category missing id property');
    }

    this.props = globalThis.structuredClone(props) as CategoryProps;
    this.props.name ??= props.id;
    this.props.matchScore = -1;
    this.props.members ??= [];
    this.props.searchable ??= true;
  }
}
```

### JSDoc Comments
- Document properties in the interface (single source of truth)
- Keep JSDoc block on constructor
- Avoid duplicating property docs in the class body
- **Never use JSDoc type annotations** in TypeScript files - use TypeScript types instead
  - ❌ `@param {string} name` → ✅ `@param name` with TypeScript parameter type
  - ❌ `@return {number}` → ✅ `@return` with TypeScript return type
  - ❌ `@type {Array<string>}` → ✅ TypeScript type annotation
- **Use `@throws` for methods that throw exceptions** - document what conditions cause throws
  - Format: `@throws Error description of when/why it throws`
  - No curly braces around the type (consistent with other JSDoc in TypeScript)
- JSDoc in `.ts` files should describe **what** and **why**, not types
- Example:
  ```typescript
  /**
   * Returns the display name for the preset.
   * @return Localized name
   */
  get name(): string {
    return this._currStrings.name;
  }

  /**
   * @constructor
   * @param props - Properties defining the matcher
   * @throws Error if `key` property is missing
   */
  constructor(props: MatcherProps) {
    if (!props.key) {
      throw new Error('Matcher: key is required');
    }
  }
  ```

### Destroy Methods and Nullability
- Declare class properties as **non-null** if they are always valid during normal usage
- In `destroy()` methods, use `null!` to set properties to null while satisfying the type checker
- This keeps the type declarations clean and avoids `!` assertions throughout the class
- Example:
  ```typescript
  class Foo {
    context: Context;  // non-null during normal usage

    destroy(): void {
      this.context = null!;  // null! satisfies the type checker
    }
  }
  ```

### Narrowing `Partial<P>` in Subclasses with `declare`
- `AbstractData.props` is typed as `Partial<P>` so the base class constructor can accept incomplete props (useful for tests and incremental construction)
- Subclasses like `MarkerData` and `GeoJSONData` represent real data that always has required properties set at construction time
- Use `declare props: P;` to narrow the stored type from `Partial<P>` to `P`:
  ```typescript
  class MarkerData<P extends MarkerProps = MarkerProps> extends AbstractData<P> {
    // `declare` emits no JavaScript — it only narrows the type for access sites.
    // The constructor still accepts `Partial<P>` for flexibility.
    declare props: P;
  }
  ```
- **Why**: Eliminates `!` assertions at every access site (e.g. `props.loc!` → `props.loc`) by localizing the trust decision to the class definition
- **Tradeoff**: If someone constructs `new MarkerData(context, {})` (no `loc`), TypeScript won't warn at access sites — but the constructor still accepts `Partial` so tests compile. In practice, real data paths always provide required props, and tests that skip them don't access them.
- When constructing a MarkerData/GeoJSONData with service-specific props, **specify the generic type param** on the constructor: `new MarkerData<KartaviewImageProps>(context, { ... })`

### Avoid Unnecessary Casts
- Don't add type casts that TypeScript can already infer
- Before adding `as Type`, check if the expression already has that type
- Common unnecessary casts:
  - `as ReturnType` on functions that already return that type
  - `as SystemID` on valid string literals
  - `as const` on literals in const declarations
  - `obj.update({...}) as SameType` - the `update()` method returns `this`, so if `obj` is already the right type, no cast needed
  - `variable as any` followed by passing to a typed parameter - often the types actually match after refactoring
  - Casts that were needed before an inline type was replaced with a proper interface

**When reviewing TypeScript files**, look for `as` keywords and ask:
1. What type does the expression already have?
2. Does the target type match what TypeScript already infers?
3. Was this cast added as a workaround that's no longer needed?

If a cast seems necessary, consider whether the root cause is:
- A missing or incorrect type elsewhere (fix the source type instead)
- A type declaration that doesn't match reality (fix the declaration)
- A genuine case where TypeScript can't infer the type (e.g., after `JSON.parse`)

### Type Inference in Callbacks
- Let TypeScript infer callback parameter types from the source array/collection
- If `graph.childNodes()` returns `OsmNode[]`, then `.map(n => n.loc)` already knows `n` is `OsmNode`
- Avoid redundant annotations like `.map((n: OsmNode) => n.loc)`

### Guard Clauses for Type Narrowing
- Use early returns to narrow types and simplify subsequent code
- Example: `if (!nodeIDs.length) return graph;` eliminates `| undefined` from variables computed from the array
- This avoids needing non-null assertions or union types later in the function

### Coordinate Types
- Use `Vec2` from `@rapid-sdk/math` instead of `[number, number]` for coordinate pairs
- This provides better semantic meaning and matches the math library's conventions

### Shared Types
- `types.ts` files exist per folder for **cross-file shared types only**
- Class-specific types (like `FooProps`) stay with the class
- **Never duplicate types** - if a type already exists in a class file, don't add it to `types.ts`
- When converting a file, check if types already exist before adding new ones

### Avoid Re-exporting Types for Convenience
- **Import types from their source file**, not from convenience re-exports
- This avoids "spaghetti code" where a type can be imported via convoluted paths
- Example: Import `Context` from `'../Context.ts'`, not from `'./core/types.ts'`
- Exception: Barrel files (`index.ts`) may re-export for the public API of a module

### Registry Pattern (Systems, Behaviors, etc.)
Rapid uses a consistent pattern for managing collections of pluggable components:

**File structure per module folder:**
- `types.ts` - Contains the instances interface and constructor type
- `index.ts` - Contains the registry interface and `available` Map

**Example: `modules/behaviors/`**

```typescript
// types.ts - Instance container interface
export type BehaviorConstructor = new (context: Context) => AbstractBehavior;

export interface Behaviors {
  [key: BehaviorID]: AbstractBehavior | undefined;  // index signature for flexibility
  drag?: DragBehavior;      // specific typed properties
  hover?: HoverBehavior;
  // ...
}

// index.ts - Registry for available constructors
interface BehaviorRegistry {
  available: Map<BehaviorID, BehaviorConstructor>;
}

export const behaviors: BehaviorRegistry = {
  available: new Map<BehaviorID, BehaviorConstructor>()
};

behaviors.available.set('drag', DragBehavior);
// ...
```

**Key points:**
- **Instances interface** (`Systems`, `Behaviors`): Has index signature + specific optional properties for type-safe access
- **Registry interface** (`SystemRegistry`, `BehaviorRegistry`): Contains `available` Map of ID → Constructor
- **Index signature** uses `| undefined` because properties are optional (not all may be instantiated)
- Components with non-standard constructors (e.g., `KeyOperationBehavior` requires extra args) are **not** in the registry - they're created dynamically
- Context uses the instances interface: `context.systems: Systems`, `context.behaviors: Behaviors`

### String ID Types
- Common string ID types are defined in `modules/types/ids.ts`
- They are both **exported** (for external library consumers) and **declared globally** (for internal use)
- Available types include:
  - `EntityID` - OSM entity IDs (e.g. 'n123', 'w456', 'r789')
  - `SystemID` - System identifiers (e.g. 'editor', 'gfx', 'map')
  - `BehaviorID` - Behavior identifiers (e.g. 'drag', 'draw', 'hover')
  - `LayerID` - Layer identifiers for photo and rendering layers
  - `PhotoLayerID`, `LayerID`, `PhotoType` - Photo system types
  - `FeatureID`, `GroupID`, `ClassID` - Pixi rendering types
  - `ModeID`, `OperationID`, `ServiceID`, `ValidatorID` - and more
- These types are **validated at runtime**, not compile time
- **Don't import these types internally** - they're available globally via `declare global`
- External consumers can import: `import type { ModeID } from '@rapideditor/rapid';`
- This approach works well for Rapid because:
  - Valid IDs depend on deployment configuration (services can be added/removed)
  - IDs come from external sources (URLs, configs, APIs)
  - No import friction throughout the codebase

### Using ID Types Instead of `string`
- **Prefer specific ID types over `string`** when the purpose is clear from context
- This makes the code **self-documenting** and helps catch mismatched ID usage

**Heuristic: Match variable/property name suffix to ID type:**
| Name pattern | Type to use |
|--------------|-------------|
| `assetID` | `AssetID` |
| `behaviorID` | `BehaviorID` |
| `categoryID` | `CategoryID` |
| `classID` | `ClassID` |
| `dataID` | `DataID` |
| `datasetID` | `DatasetID` |
| `entityID`, `nodeID`, `wayID`, `relationID` | `EntityID` |
| `featureID` | `FeatureID` |
| `fieldID` | `FieldID` |
| `graphID` | `GraphID` |
| `issueID` | `IssueID` |
| `languageCode` | `LanguageCode` |
| `layerID` | `LayerID` |
| `localeCode`, `locale` | `LocaleCode` |
| `modeID` | `ModeID` |
| `photoID` | `PhotoID` |
| `presetID` | `PresetID` |
| `scriptCode` | `ScriptCode` |
| `sequenceID` | `SequenceID` |
| `serviceID` | `ServiceID` |
| `systemID` | `SystemID` |
| `tileID` | `TileID` |
| `validatorID` | `ValidatorID` |

**Exceptions - NOT string ID types:**
- `intervalID`, `timeoutID`, `requestID` - timer/animation frame handles (numbers)
- DOM element IDs - typically just `string`

**Also check these patterns:**
- `Map<string, X>` where keys are IDs → `Map<EntityID, X>`
- `Set<string>` holding IDs → `Set<EntityID>`
- `string[]` arrays of IDs → `EntityID[]`
- Return types of ID-returning functions
- Parameters named `id` in context of specific types (e.g., `entity.id` → `EntityID`)

**When editing or reviewing TypeScript files**, actively look for `string` that should be a specific ID type.

### Imports
- Keep all imports at the top of the file
- Use `import type { ... }` for type-only imports
- This is a **Bun project** - use `.ts` extensions for TypeScript imports, `.js` for JavaScript
- The `tsconfig.json` has `allowImportingTsExtensions: true`

**Import organization order:**
1. Regular `import` statements (sorted alphabetically by module path)
2. Blank line
3. `import type` statements (sorted alphabetically by module path)

Example:
```typescript
import { geomRotatePoints, geomViewportNudge, vecAdd } from '@rapid-sdk/math';
import { utilArrayGroupBy, utilArrayUniq } from '@rapid-sdk/util';
import { actionAddMidpoint } from '../actions/add_midpoint.ts';

import type { Action } from '../actions/types.ts';
import type { Graph } from '../core/Graph.ts';
import type { OsmNode, OsmWay } from '../core/index.ts';
```

### Type Declarations
- **Module augmentations** (fixing incorrect or inconvenient external types): Add to `global.d.ts` with `export {}`
- **Ambient module declarations** (no @types package available): Add to `modules/types/*.d.ts` without export
- Use `declare global { ... }` block for global types (since `global.d.ts` has `export {}`)
- Example: `global.d.ts` has the fix for `d3-geo`'s `geoMercatorRaw` return type

### Global Types
- Common utility types like `Nullable<T>` are declared globally in `global.d.ts`
- These types don't need to be imported - they're available everywhere
- Example:
  ```typescript
  // In global.d.ts
  declare global {
    type Nullable<T> = T | null | undefined;
  }

  // Usage - no import needed
  function foo(value: Nullable<string>): void { ... }
  ```

### D3 Types
- `D3Selection` and `D3EnterSelection` are permissive type aliases defined in `global.d.ts`
- Import directly from `'d3-selection'`, not from `types.ts`
- The module augmentation makes D3 callbacks accept `any` datum type to reduce friction
- These types are intentionally loose — they improve code clarity and are more self-documenting than `as any` casts or unwieldy built-in d3 generic types
- **Naming conventions**:
  - Prefix variables holding a selection with `$`, e.g., `$parent`, `$child`
  - Prefix variables holding an _enter_ selection with `$$`, e.g., `$$items`
- **When editing or reviewing TypeScript files**, look for `$`-prefixed variables without a type annotation and add `D3Selection`. Look for `$$`-prefixed variables and add `D3EnterSelection`.
- Where `merge()` is used to combine a selection with an enter selection, type the result as `D3Selection` (no need for `as any`):
  ```typescript
  $label = $label.merge($$label) as D3Selection;
  ```
- Example:
  ```typescript
  import type { D3EnterSelection, D3Selection } from 'd3-selection';

  function render($parent: D3Selection): void {
    const $child: D3Selection = $parent.select('.child');
    let $$child: D3EnterSelection = $child.enter().append('div');
  }
  ```

### GeoJSON Types
- **`@types/geojson`** is installed as a dev dependency and exposes a global `GeoJSON` namespace via UMD declaration
- Use the global `GeoJSON.*` types directly without importing:
  ```typescript
  // No import needed - uses global namespace from @types/geojson
  function processData(fc: GeoJSON.FeatureCollection): void { ... }
  const geom = feature.geometry as GeoJSON.LineString;
  ```
- **Type aliases** in `lib/types.ts` provide convenient names and define concepts not in the standard types:
  - `SingularGeometry` = `GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon` (excludes Multi* and GeometryCollection)
  - `SingularGeometryType` = `'Point' | 'LineString' | 'Polygon'`
  - `GeoJSONFeature`, `GeoJSONObject` - slightly looser versions that allow optional `geometry` for easier construction

### Working with Untyped JavaScript Components
- It's OK to assert `as any` for parts of the codebase that haven't been converted to TypeScript yet
- This pattern keeps code readable while allowing gradual TypeScript adoption

### headless.js
- **Never import from `headless.js`** in main application code
- `headless.js` is a test-only build - import from actual source files instead

### Environment Detection
- Prefer `globalThis` over `window` for browser globals
- When using browser-only APIs (like `KeyboardEvent`), check if they exist first
- Unit tests run without DOM globals unless using the happy-dom preload

## Conversion Status

Track TypeScript conversion progress here:

| Folder | Status | Notes |
|--------|--------|-------|
| `modules/util/` | ✅ Complete | All files converted |
| `modules/lib/` | ✅ Complete | All files converted |
| `modules/pixi/` | ✅ Complete | All files converted |
| `modules/core/` | ✅ Complete | All files converted |
| `modules/behaviors/` | ✅ Complete | All files converted |
| `modules/actions/` | ✅ Complete | All files converted |
| `modules/modes/` | ✅ Complete | All files converted |
| `modules/data/` | ✅ Complete | All files converted |
| `modules/geo/` | ✅ Complete | All files converted |
| `modules/operations/` | ❌ Not started | |
| `modules/services/` | ✅ Complete | All files converted |
| `modules/ui/` | ❌ Not started | |
| `modules/validations/` | ❌ Not started | |

## Testing

After making changes:
1. Run `bun tsc --noEmit` to check types
2. Run `bun run lint` to perform linting
3. Run `bun run build:js` to verify build
4. Run `bun test` for full test suite
5. Run `bun run validate:json` to validate data files against JSON schemas

### JSON Schemas
- Data files in `data/` are validated by JSON Schema definitions in `data/schema/`
- The main data file schema is `main.schema.json` (includes `assetID`, `assetVersion`, `scopes[]`)
- Component schemas use `$ref` to reference each other (e.g. `matcher.schema.json` is used by both `selector.schema.json` and `ruleset.schema.json`)
- Imagery schema tracks the upstream [editor-layer-index schema](https://github.com/osmlab/editor-layer-index) closely
- Field, preset, category, defaults, deprecated, and discarded schemas are compatible with [schema-builder](https://github.com/ideditor/schema-builder) / [id-tagging-schema](https://github.com/openstreetmap/id-tagging-schema)
- When changing data file structure, update the corresponding schema and run `bun run validate:json`

### Writing Meaningful Assertions
- **Avoid `assert.isTrue(true)` in feature tests** — If a `.then()` callback only does `assert.isTrue(true)`, ask: "what is this test actually verifying?"
- This pattern is fine in **lifecycle tests** where you just need to confirm a promise resolved without throwing (e.g. `initAsync`, `resetAsync`)
- In **feature tests** (e.g. "uses requestedAssetIDs when set"), always assert on the actual outcome — for example, check `loadedAssetIDs` to verify which assets were loaded
- When adding or reviewing tests, look for assertions that would pass even if the feature were completely broken

