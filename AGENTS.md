# Agent Context

This file contains agent-specific guidance only.

At session start, skim [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for general project information.

---

## Working Memory

The `.scratchpad/` folder contains persistent working memory for AI agents across sessions. It is committed to git.

At the start of a session, read `.scratchpad/current.md` for active work context. Pull in other files selectively:
- `decisions.md` — non-obvious design choices (the "why" behind things)
- `lessons.md` — patterns and gotchas to avoid repeating mistakes
- `quirks.md` — known runtime issues and workarounds

As you work, update these files. When work completes: add a one-liner to `completed.md`, move the "why" to `decisions.md`, lessons to `lessons.md`, and delete the rest from `current.md`. See `.scratchpad/README.md` for conventions.

## Skills

This project has reusable agent skills in `.claude/skills/`: one folder per skill, each with a `SKILL.md` in the open Agent Skills format. Claude Code and VS Code Copilot both find them there and list them in the `/` menu (or equivalent). When a task matches an existing skill, prefer invoking it over improvising — the skills encode project-specific conventions.

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
- Keep it proportional: a heads-up is a sentence, not a paragraph. Skip it entirely for trivial changes.

### Secrets hygiene
- Before making any edit or commit, ask: **could this write a secret in plaintext somewhere it shouldn't be?**
- Never put tokens, keys, or passwords in plaintext in any unencrypted file.

### Comments
- **Never remove comments** when modifying files unless:
  - The comment applies to code being removed
  - The meaning of the code has changed
  - Specifically asked to remove them
- Comments contain valuable domain knowledge — preserve them.
- Also **don't add unsolicited comments or docstrings** to code you're modifying. Only add explanatory comments when the user asks, when documenting a non-obvious decision (magic numbers, workarounds), or when the code is genuinely confusing without them.

### Lint warnings
- **Never circumvent lint warnings** by renaming, reformatting, or otherwise disguising the triggering code to silence a rule (e.g. rewriting `todo` as `@TODO` to dodge `no-warning-comments`).
- Lint warnings (like `todo`/`fixme`) are intentional project health signals — they should remain visible.
- If your change introduces a new lint warning, mention it; don't silently suppress it.

### File Operations
- **Edit files using the structured file-editing operations exposed by your host environment** — e.g. the `create_file` / `replace_string_in_file` / `multi_replace_string_in_file` tools in VS Code Copilot, the equivalent `Edit` / `Write` tools in Claude Code, Cursor's edit tools, an MCP filesystem server, or whatever your runtime offers. These show changes in a reviewable diff and (where applicable) require exact-match context, which prevents silent damage that regex-based tools can cause.
- For bulk/repetitive edits across multiple files, prefer a multi-edit operation (e.g. `multi_replace_string_in_file`) over many separate calls when your environment supports it.
- **Do not** mutate files via shell stream-editing tools like `sed`, `perl -i`, `awk -i`, or inline `python -c` / `node -e` scripts. Greedy regexes (especially around whitespace and line boundaries) can collapse or corrupt code in ways that are hard to spot without a full re-read. If an edit feels too repetitive for the structured edit tools, that's a signal to slow down, not to reach for a script.
- Avoid `cat` with heredoc or other terminal-based file writing.

---

## Working in the Rapid Codebase

### Design docs
- [`design/`](design/README.md) holds design docs for the core systems: conflation, database, drag-and-drop, keyboard, network, Rapid datasets, scheduler, settings, spatial, style and UI. [`design/README.md`](design/README.md) lists each one with its status.
- **When you make a substantial change to a system that has no design doc yet, start one** (what it owns, the decisions behind it, where it's heading), and point to it from the class JSDoc. These docs are a running record of where each system is going.
- **Before changing one of those systems, read its design doc.** The class JSDoc of each system points to it. If your change alters the design, update the doc in the same change.

### Folder-specific instructions
- Some folders have their own `AGENTS.md` with rules that apply only there (currently [`modules/ui/`](modules/ui/AGENTS.md) and [`modules/pixi/`](modules/pixi/AGENTS.md)). Agents that support nested `AGENTS.md` files load them automatically when working in that folder. If yours doesn't, read the folder's `AGENTS.md` before editing files there.
- Guidance that only applies to one folder belongs in that folder's `AGENTS.md`, not in this file and not in editor-specific locations like `.github/instructions/`.
- `README.md` describes what a folder contains, for humans. `AGENTS.md` holds the rules and checklists. Each one links to the other.

### Code Style
- Use ES module syntax (`import`/`export`)
- Prefer `??` (nullish coalescing) over `||` for defaults
- Use `?.` (optional chaining) for safe property access
- Use optional chaining for **optional callback/function calls** too, e.g. `callback?.apply(this)` or `fn?.(args)`, instead of `if (callback) callback.apply(this)`
- **No trailing whitespace** - ensure lines don't end with spaces or tabs

### Function Structure and Dependencies
- **Group system/service access at the top of functions** - this makes it easy to scan what a function depends on and understand coupling
- **List the captured dependencies in alphabetical order** - a predictable order lets a reader scan the coupling at a glance
- Separate dependency access from logic with a blank line
- **Capture a system in a local variable before using it - even optional ones.** Don't reach into `context.systems.foo` inline in the middle of a function body (e.g. `context.systems.scheduler?.debounce(...)`). Hoist it to a named `const` at the top with the other dependencies so every system the function touches is visible in one place.
- Example:
  ```typescript
  enter(options: SomeOptions = {}): boolean {
    // Dependencies first, alphabetical
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
- Capture them at the top of the function like any other dependency (no inline `context.systems.x?.…`), then branch on presence
- Use optional chaining (`?.`) for systems that might not be present:
  - `locations` - LocationManager may not be configured
  - `ui` - UiSystem won't exist in a future CLI build
  - `scheduler` - SchedulerSystem may not be initialized in tests or CLI
- Example: `if (loc && locations?.isBlockedAt(loc)) continue;`
- **Provide a fallback so the work still happens when an optional system is absent.** An optional system usually improves *how* something is done (debouncing, deferring, animating), not *whether* it happens. Don't let its absence silently skip the work - prefer an explicit branch over bare optional chaining when skipping would be wrong:
  ```typescript
  const scheduler = context.systems.scheduler;  // optional

  // scheduler debounces the redraw; without it, just redraw immediately
  if (scheduler) {
    scheduler.debounce('MyCard-render', () => this.render(), { ms: 250 });
  } else {
    this.render();
  }
  ```
- This keeps code working even when optional systems are absent

### System Ownership of Runtime State
- All runtime-computed data in Rapid should be **owned by a core system** so that we can manage its state and lifecycle
- **Module-level mutable globals** (e.g. `export let osmAreaKeys = {}` with a setter function) break this rule — other code depends on them in ways where we can't guarantee they've been properly initialized or reset when changes occur
- The test for whether something should be on a system: "If I call this function right now, can I guarantee the data it depends on is ready?" If the answer requires knowing another system's startup sequence, the data belongs on that system.
- **Truly constant data** that does not change at runtime is fine as a module-level `const` — there's no lifecycle to manage. But if the data is a list of domain-specific "magic strings" (like lifecycle prefixes), prefer expressing it as a ruleset in `osm_rulesets.json5` so it's configurable and scope-owned.
- **Domain-specific logic** (like "is this tag interesting?" or "does this tag suggest an area?") belongs on the data class that represents the domain concept (e.g. `OsmEntity`), not as a free function reading a global. The instance method can access the system through `this.context` — making the dependency explicit and traceable.

## TypeScript Patterns

### Class Member Visibility Conventions
- Always add an explicit access modifier to class members (`public` or `protected`).
- Do not use `private` for class members in this codebase; use `protected` instead.
- Protected member names must be prefixed with `_`.
- If outside code needs access to internal state, prefer exposing a `public` getter over directly reading a protected `_member`.

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
      this.requiredDependencies = new Set<SystemID>(['assets']);
      this.optionalDependencies = new Set<SystemID>(['gfx', 'storage']);
    }
  }
  ```
  Over this:
  ```typescript
  class FooSystem extends AbstractSystem {
    readonly id = 'foo';  // avoid field initializers
    requiredDependencies = new Set<SystemID>(['assets']);
    optionalDependencies = new Set<SystemID>(['gfx', 'storage']);

    constructor(context: Context) {
      super(context);
    }
  }
  ```

### Lifecycle Methods Run Once (`initAsync` / `startAsync`)
- Many callers await the same system's `initAsync()` / `startAsync()` (e.g. 7+ systems wait on `settings.initAsync()`), so each must do its work **once** and return the same promise every time.
- `AbstractSystem` provides `_initPromise` / `_startPromise`, but it can't enforce this: **an override that does any work must start with the guard and assign the chained promise.** Without it, every caller re-runs the work (re-reading storage, re-opening a database, re-sending requests).
  ```typescript
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const storage = context.systems.storage!;

    return this._initPromise = super.initAsync()
      .then(() => storage.initAsync())
      .then(() => { /* the work */ });
  }
  ```
- Overrides that only `return super.initAsync()` or `return Promise.resolve()` don't need the guard.

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

    this.props = structuredClone(props) as CategoryProps;
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
- **Don't repeat the symbol name as the first line of a doc comment** — it looks redundant in IntelliSense and adds no information. Start with a plain-English description of what the thing does instead.
  - ❌ `/** BlahSystem — Manages Rapid's collection of Blahs */`
  - ✅ `/** The \`BlahSystem\` manages Rapid's collection of Blahs. */`
- **Wrap inline code examples in markdown code fences** (` ```ts ` or ` ```json `) so they render correctly in IntelliSense. Bare object/array literals in JSDoc prose appear as plain text without fencing.
- **Never use JSDoc type annotations** in TypeScript files - use TypeScript types instead
  - ❌ `@param {string} name` → ✅ `@param name` with TypeScript parameter type
  - ❌ `@return {number}` → ✅ `@return` with TypeScript return type
  - ❌ `@type {Array<string>}` → ✅ TypeScript type annotation
- **Document every parameter.** If a method has parameters, its JSDoc must include a matching `@param name - description` for each one (e.g. a `render($selection)` needs `@param $selection - …`). Never include a `{type}` — the signature carries it.
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

### Prefer Generic Type Parameters Over Element Casts
- When constructing `Set`, `Map`, or other generic collections, **annotate the container** rather than casting each element
- This is cleaner: one annotation on the container vs. repeated `as` casts on every element
- ✅ `new Set<RequestID>(tiles.map(tile => `prefix-${tile.id}`))`
- ❌ `new Set(tiles.map(tile => `prefix-${tile.id}` as RequestID))`
- Same applies to `Map`: ✅ `new Map<EntityID, OsmNode>()` over casting keys/values individually
- This pattern is already used for `SystemID`: `new Set<SystemID>(['network', 'spatial'])`

### Type Inference in Callbacks
- Let TypeScript infer callback parameter types from the source array/collection
- If `graph.childNodes()` returns `OsmNode[]`, then `.map(n => n.loc)` already knows `n` is `OsmNode`
- Avoid redundant annotations like `.map((n: OsmNode) => n.loc)`

### Guard Clauses for Type Narrowing
- Use early returns to narrow types and simplify subsequent code
- Example: `if (!nodeIDs.length) return graph;` eliminates `| undefined` from variables computed from the array
- This avoids needing non-null assertions or union types later in the function

### Narrowing Entity Subclasses
- TypeScript can't narrow `OsmEntity` to `OsmWay`/`OsmNode`/`OsmRelation` from a `.type` string check — it's not a discriminated union
- After a guard like `if (entity.type !== 'way') return [];`, assign once: `const way = entity as OsmWay;`
- This keeps the single `as` cast near the guard and eliminates repeated casts downstream
- Example:
  ```typescript
  if (entity.type !== 'way' || entity.geometry(graph) !== 'line') return [];

  const way = entity as OsmWay;
  if (way.isClosed()) return [];
  if (!way.isOneWay()) return [];
  ```

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
| `requestID` | `RequestID` |
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
1. Regular `import` statements (sorted alphabetically)
2. Blank line
3. `import type` statements (sorted alphabetically)

Example:
```typescript
import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { geomRotate, geomViewportNudge, vecAdd } from '@rapid-sdk/math';
import { utilArrayGroupBy, utilArrayUniq } from '@rapid-sdk/util';

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
- **Callback type aliases** (`D3CallbackBoolean`, `D3CallbackValue`, `D3CallbackVoid`, from `global.d.ts`) describe the standard d3 `(datum, index, groups) => …` shape. Use them anywhere a variable/parameter is *typed* as a d3 callback, instead of spelling out `(datum: any, index: number, groups: any) => …`. (Inline lambdas passed straight to `.attr`/`.each`/etc. don't need them — d3's permissive types already cover those.)
- **Naming conventions**:
  - Prefix variables holding a selection with `$`, e.g., `$parent`, `$child`
  - Prefix variables holding an _enter_ selection with `$$`, e.g., `$$items`
  - **This applies to function parameters/arguments too**, not just local variables. A parameter that receives a `D3Selection` should be named `$selection`, `$parent`, etc. — e.g. `function render($parent: D3Selection)`, not `function render(parent: D3Selection)`.
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

### Relocalization (d3 render)
- **Set localized strings on the UPDATE (merged) selection, never on an enter-only (`$$`) selection.** Enter runs once; anything set there won't re-localize when the user changes language.
- `.text(...)`, `.html(...)`, and `.attr('title' | 'placeholder' | 'aria-label' | 'alt', …)` derived from `l10n.t(...)` / `l10n.tHtml(...)` belong on `$foo` **after** `.merge($$foo)`. Enter (`$$`) is for structure only — `.append(...)`, static `.attr('class', …)`, static `.on(...)`.
- For the full UI component checklist (render `$parent` capture, optional-system fallbacks, `@param` coverage, relocalization), see [`modules/ui/AGENTS.md`](modules/ui/AGENTS.md).

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

### headless.js
- **Never import from `headless.js`** in main application code
- `headless.js` is a test-only build - import from actual source files instead

### Environment Detection
- Prefer `globalThis` over `window` for browser globals
- When using browser-only APIs (like `KeyboardEvent`), check if they exist first
- Unit tests run without DOM globals unless using the happy-dom preload

## Testing

After making changes:
1. Run `bun run check:ts` to check types
2. Run `bun run check:lint` to perform linting
3. Run `bun run build:js` to verify build
4. Run `bun run test` to run the unit and browser tests (or the sub-commands below for faster iteration)
5. Run `bun run check:json` to validate data files against JSON schemas

### Test Commands
- `bun run test` — unit + browser tests (`test:unit` and `test:browser`). It does **not** lint or type-check.
- `bun run test:unit` — unit tests only (`test/unit/`)
- `bun run test:browser` — browser tests with happy-dom preload (`test/browser/`)
- `bun run check` — all static checks: `check:csp`, `check:json`, `check:lint`, `check:ts`
- `bun run check:ts` — type-check via `tsc --noEmit`
- `bun run all` — `clean` + `check` + `build` (no tests)
- **Do NOT use bare `bun test`** — it skips the `--preload ./test/test_setup.js` that provides happy-dom globals. Browser tests will fail with misleading errors about missing DOM APIs.
- If a test fails at line 1 with `describe is not defined`, suspect Bun's transpiler cache before the test (see `.scratchpad/quirks.md`).

### Testing in a Real Browser
Unit tests can't cover rendering (Pixi needs WebGL) or most UI behavior. **You can run Rapid in a real
Chrome and drive it yourself.** Do this to check rendering, UI, or behavior on real data, and to see
what the developer is seeing when they report a problem.

1. Start the server: `bun run start` (builds, then serves `dist/` on `http://127.0.0.1:8080`).
2. Start Chrome with remote debugging: `bun run start:chrome`. It opens the dev build, using its own
   profile in `.chrome-debug/` (gitignored). The developer may already have this running.
3. Drive the Rapid tab with `bun run cdp`. It attaches to the running Chrome (port 9222), so it sees
   exactly what the developer sees:
   - `bun run cdp shot <out.png>`: screenshot the tab, then read the image
   - `bun run cdp eval -e "<code>"` or `bun run cdp eval <file.js>`: run a snippet in the page; `return`
     a value to get it back as JSON
   - `bun run cdp reload [setup.js]`: reload, wait for Rapid to start, then run an optional setup snippet
   - `bun run cdp press <key>`: press a key (e.g. `Escape` closes the welcome screen after a reload)

Tips:
- **Query state rather than squinting at screenshots.** Rapid's context is `globalThis.rapidContext`
  (systems under `rapidContext.systems`, the dev build also exposes `globalThis.Rapid`). A query like
  "which features matched, and what are their tags?" settles more than any screenshot.
- **Ask before reloading the developer's tab.** A reload picks up a new build but loses state that isn't
  saved, such as console-applied settings. Put that setup in a snippet and pass it to `reload`.
- **Keep snippets, screenshots, and any data from the session out of the repo.** Use your scratch area.
- **No Chrome attached?** Launch headless with Playwright instead (`chromium.launch()` from
  `@playwright/test`, with `--use-angle=swiftshader --enable-unsafe-swiftshader` so WebGL works). If it
  wants a browser build that isn't downloaded, pass `executablePath` to one in `~/Library/Caches/ms-playwright`.

### JSON Schemas
- Data files in `data/` are validated by JSON Schema definitions in `data/schema/`
- The main data file schema is `main.schema.json` (includes `assetID`, `assetVersion`, `scopes[]`)
- Component schemas use `$ref` to reference each other (e.g. `matcher.schema.json` is used by both `selector.schema.json` and `ruleset.schema.json`)
- Imagery schema tracks the upstream [editor-layer-index schema](https://github.com/osmlab/editor-layer-index) closely
- Field, preset, category, defaults, deprecated, and discarded schemas are compatible with [schema-builder](https://github.com/ideditor/schema-builder) / [id-tagging-schema](https://github.com/openstreetmap/id-tagging-schema)
- When changing data file structure, update the corresponding schema and run `bun run check:json`

### Writing Meaningful Assertions
- **Avoid `assert.isTrue(true)` in feature tests** — If a `.then()` callback only does `assert.isTrue(true)`, ask: "what is this test actually verifying?"
- This pattern is fine in **lifecycle tests** where you just need to confirm a promise resolved without throwing (e.g. `initAsync`, `resetAsync`)
- In **feature tests** (e.g. "uses requestedAssetIDs when set"), always assert on the actual outcome — for example, check `loadedAssetIDs` to verify which assets were loaded
- When adding or reviewing tests, look for assertions that would pass even if the feature were completely broken

