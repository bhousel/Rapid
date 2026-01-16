# Copilot Instructions for Rapid

This file contains guidance for AI assistants working on the Rapid codebase.

## Project Overview

Rapid is an AI-enhanced editor for OpenStreetMap, built with JavaScript/TypeScript. It uses:
- **Bun** as the runtime and bundler
- **ES Modules** throughout
- **Pixi.js** for rendering
- **D3** for UI components

## General Guidelines

### Comments
- **Never remove comments** when modifying files unless:
  - The comment applies to code being removed
  - The meaning of the code has changed
  - Specifically asked to remove them
- Comments contain valuable domain knowledge - preserve them

### Code Style
- Use ES module syntax (`import`/`export`)
- Prefer `??` (nullish coalescing) over `||` for defaults
- Use `?.` (optional chaining) for safe property access
- **No trailing whitespace** - ensure lines don't end with spaces or tabs

### File Operations
- Use VS Code file tools (`create_file`, `replace_string_in_file`) instead of terminal commands
- This shows changes in VS Code's diff view for easier review
- Avoid using `cat` with heredoc or other terminal-based file writing

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

### Avoid Unnecessary Casts
- Don't add type casts that TypeScript can already infer
- Before adding `as Type`, check if the expression already has that type (hover over it or check the type definition)
- Common unnecessary casts to avoid:
  - `as ReturnType` on function calls when the function already returns that type
    (e.g., `vecAdd(a, b) as Vec2` is unnecessary when `vecAdd` already returns `Vec2`)
  - `as SystemID` on string literals that already match the union type
  - `as Graph` or similar when accessing properties on an `any` typed variable (already returns `any`)
  - `as SomeType[]` on array literals passed to `new Set()` when TypeScript can infer the type
  - `as const` on literals - TypeScript infers literal types for `const` declarations automatically
- Example - avoid this:
  ```typescript
  this.id = 'validator' as SystemID;  // unnecessary - 'validator' is already a valid string
  this.requiredDependencies = new Set(['editor', 'schema'] as SystemID[]);  // unnecessary
  const graph = editor.base.graph as Graph;  // unnecessary if editor is `any`
  const name = 'foo' as const;  // unnecessary - const declarations already have literal types
  ```
- Prefer this:
  ```typescript
  this.id = 'validator';
  this.requiredDependencies = new Set(['editor', 'schema']);
  const graph = editor.base.graph;  // already `any`, assignable to Graph
  const name = 'foo';  // type is already 'foo', not string
  ```

### Interface Formatting
- Use concise formatting for interface properties (no blank lines between properties)
- Each property should have a JSDoc comment on the line directly above it
- Example:
  ```typescript
  export interface GraphCache {
    /** Map of entity ID to Entity */
    entities: Map<EntityID, Entity | undefined>;
    /** Map of entity ID to Set of parent Way IDs */
    parentWays: Map<EntityID, Set<EntityID>>;
  }
  ```

### Shared Types
- `types.ts` files exist per folder for **cross-file shared types only**
- Class-specific types (like `FooProps`) stay with the class
- **Never duplicate types** - if a type already exists in a class file, don't add it to `types.ts`
- When converting a file, check if types already exist before adding new ones

### String ID Types
- Use simple type aliases for identifiers: `type PhotoLayerID = string;`
- These are **validated at runtime**, not compile time (e.g., `this.photoLayerIDs.includes(layerID)`)
- This approach works well for Rapid because:
  - Valid IDs depend on deployment configuration (services can be added/removed)
  - IDs come from external sources (URLs, configs, APIs)
  - The type alias documents intent without adding casting friction
- Add JSDoc comments with example values:
  ```typescript
  /** Photo layer identifiers (e.g. 'streetside', 'mapillary', 'kartaview') */
  export type PhotoLayerID = string;
  ```

### Type Imports
- Use `import type { ... }` for type-only imports
- This prevents circular dependencies and improves tree-shaking

### No Inline Imports
- **Keep all imports at the top of the file** - don't use inline `import()` syntax in type annotations
- Group `import` lines before `import type` lines.  Sort the `import` and `import type` lines alphabetically.
- Example - avoid this:
  ```typescript
  setCoords(source: import('../lib/GeometryPart.ts').GeometryPart): void { ... }
  ```
- Prefer this:
  ```typescript
  import type { GeometryPart } from '../lib/GeometryPart.ts';
  // ...
  setCoords(source: GeometryPart): void { ... }
  ```

### Import Extensions
- This is a **Bun project** - use `.ts` extensions for TypeScript file imports
- For files that have been converted to TypeScript, import with `.ts`:
  ```typescript
  import type { Context } from '../Context.ts';
  import { ValidationFix } from './ValidationFix.ts';
  ```
- For files still in JavaScript, continue using `.js`:
  ```typescript
  import { osmAreaKeys } from './tags.js';
  ```
- The `tsconfig.json` has `allowImportingTsExtensions: true` to support this

### Indentation
- **2-space indent** is the modern standard
- **4-space indent** indicates legacy code that hasn't been touched in a while
- When converting a file to TypeScript, also update to 2-space indent

### Variable Declarations
- Put each variable declaration on its own line
- This makes types easier to read, especially for complex types
- Example - prefer this:
  ```typescript
  let leaf: OsmWay | undefined;
  let survivor: OsmWay | undefined;
  ```
  Over this:
  ```typescript
  let leaf: OsmWay | undefined, survivor: OsmWay | undefined;
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
- **Naming conventions**:
  - Prefix variables holding a selection with `$`, e.g., `$parent`, `$child`
  - Prefix variables holding an _enter_ selection with `$$`, e.g., `$$items`
- Example:
  ```typescript
  import type { D3Selection, D3EnterSelection } from 'd3-selection';

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
- **Note**: The `data/GeoJSON.ts` class wraps arbitrary GeoJSON - be aware of the naming collision with the global namespace.

### Working with Untyped JavaScript Components
- It's OK to assert `as any` for parts of the codebase that haven't been converted to TypeScript yet
- This pattern keeps code readable while allowing gradual TypeScript adoption

### Browser Globals
- Prefer `globalThis` over `window` for browser globals
- This is more portable and works in all JavaScript environments

### headless.js
- **Never import from `headless.js`** in main application code
- `headless.js` is a test-only build that re-exports modules for test consumption
- Import from the actual source files instead (e.g., `../lib/ImagerySource.ts`)

### Environment Detection
- When using browser-only APIs (like `KeyboardEvent`), check if they exist first
- Unit tests run without DOM globals unless using the happy-dom preload
- Pattern:
  ```typescript
  if (typeof KeyboardEvent === 'function') {
    evt = new KeyboardEvent('keydown', { ... });
  } else {
    // Fallback for environments without DOM
    evt = { type: 'keydown', key: 'a', ... } as KeyboardEvent;
  }
  ```

### Converting Legacy Patterns
- **IIFE singletons** → Convert to classes with static methods
- **Function with static properties** → Use TypeScript namespace merging (add `// eslint-disable-next-line @typescript-eslint/no-namespace`)

## Conversion Status

Track TypeScript conversion progress here:

| Folder | Status | Notes |
|--------|--------|-------|
| `modules/util/` | ✅ Complete | All files converted |
| `modules/lib/` | ✅ Complete | All files converted |
| `modules/pixi/` | ✅ Complete | All files converted |
| `modules/core/` | ✅ Complete | All files converted |
| `modules/behaviors/` | ✅ Complete | All files converted |
| `modules/actions/` | ❌ Not started | |
| `modules/modes/` | ❌ Not started | |
| `modules/operations/` | ❌ Not started | |
| `modules/services/` | ❌ Not started | |
| `modules/ui/` | ❌ Not started | |
| `modules/validations/` | ❌ Not started | |

## Testing

After making changes:
1. Run `bun tsc --noEmit` to check types
2. Run `bun run lint` to perform linting
3. Run `bun run build:js` to verify build
4. Run `bun test` for full test suite
