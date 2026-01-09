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
- Examples: `Context`, `Entity`, `EntityID`, `Tags`, `Vec2`, GeoJSON types
- Class-specific types (like `FooProps`) stay with the class
- **Never duplicate types** - if a type already exists in a class file, don't add it to `types.ts`
- When converting a file, check if types already exist before adding new ones

### Type Imports
- Use `import type { ... }` for type-only imports
- This prevents circular dependencies and improves tree-shaking

### Import Extensions
- This is a **Bun project** - use `.ts` extensions for TypeScript file imports
- For files that have been converted to TypeScript, import with `.ts`:
  ```typescript
  import type { Context } from '../core/types.ts';
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
- **Module augmentations** (fixing incorrect external types): Add to `global.d.ts` with `export {}`
- **Ambient module declarations** (no @types package available): Add to `modules/types/*.d.ts` without export
- Example: `global.d.ts` has the fix for `d3-geo`'s `geoMercatorRaw` return type

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

### Working with Untyped Systems
- It's OK to assert `as any` for parts of the codebase that haven't been converted to TypeScript yet
- This is especially common for `context.systems.*` which are typed as `System | undefined`
- Cast upfront, then use optional chaining throughout:
  ```typescript
  const gfx = context.systems.gfx as any;
  const editor = context.systems.editor as any;

  // Then use optional chaining for safe access
  gfx?.immediateRedraw();
  const graph = editor?.staging?.graph;
  ```
- This pattern keeps code readable while allowing gradual TypeScript adoption

### Updating the Systems Interface
When a system is converted to TypeScript, update `modules/core/types.ts` to provide proper typing:

1. **Add the import** at the top of types.ts:
   ```typescript
   import type { FooSystem } from './FooSystem.ts';
   ```

2. **Add to the `AnySystem` union**:
   ```typescript
   type AnySystem =
     | AssetSystem
     | FooSystem  // add here
     | ...
     | System;
   ```

3. **Update the property** in the `Systems` interface:
   ```typescript
   export interface Systems {
     // Converted to TypeScript - use specific types:
     foo?: FooSystem;  // move from "not converted" section
     ...
   }
   ```

Using `import type` avoids runtime circular dependencies. Once updated, code can access `context.systems.foo` with full type checking instead of `as any` casts.
- As systems get properly typed, these `as any` casts can be removed

### Browser Globals
- Prefer `globalThis` over `window` for browser globals
- This is more portable and works in all JavaScript environments
- When augmenting global types, extend the `Window` interface in `global.d.ts`

### Converting Legacy Patterns
- **IIFE singletons** → Convert to classes with static methods
- **Function with static properties** → Use TypeScript namespace merging (add `// eslint-disable-next-line @typescript-eslint/no-namespace`)

## Conversion Status

Track TypeScript conversion progress here:

| Folder | Status | Notes |
|--------|--------|-------|
| `modules/util/` | ✅ Complete | All 14 files converted |
| `modules/lib/` | 🔄 Partial | `Tree.js`, `tag_classes.js` remain |
| `modules/pixi/lib/` | 🔄 Partial | `DashLine.js`, `AtlasAllocator.js` remain |
| `modules/core/` | 🔄 Partial | 8 systems converted (see below) |
| `modules/actions/` | ❌ Not started | |
| `modules/behaviors/` | ❌ Not started | |
| `modules/modes/` | ❌ Not started | |
| `modules/operations/` | ❌ Not started | |
| `modules/services/` | ❌ Not started | |
| `modules/ui/` | ❌ Not started | |
| `modules/validations/` | ❌ Not started | |

### modules/core/ Systems

| System | Status |
|--------|--------|
| `AbstractSystem.ts` | ✅ Converted |
| `AssetSystem.ts` | ✅ Converted |
| `FilterSystem.ts` | ✅ Converted |
| `LocationSystem.ts` | ✅ Converted |
| `RapidSystem.ts` | ✅ Converted |
| `SpatialSystem.ts` | ✅ Converted |
| `StorageSystem.ts` | ✅ Converted |
| `StyleSystem.ts` | ✅ Converted |
| `UrlHashSystem.ts` | ✅ Converted |
| `EditSystem.js` | ❌ Not started |
| `GraphicsSystem.js` | ❌ Not started |
| `ImagerySystem.js` | ❌ Not started |
| `LocalizationSystem.js` | ❌ Not started |
| `Map3dSystem.js` | ❌ Not started |
| `MapSystem.js` | ❌ Not started |
| `PhotoSystem.js` | ❌ Not started |
| `SchemaSystem.js` | ❌ Not started |
| `UiSystem.js` | ❌ Not started |
| `UploaderSystem.js` | ❌ Not started |
| `ValidationSystem.js` | ❌ Not started |

## Testing

After making changes:
1. Run `bun tsc --noEmit` to check types
2. Run `bun run lint` to perform linting
3. Run `bun run build:js` to verify build
4. Run `bun test` for full test suite
