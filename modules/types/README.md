# Types

TypeScript type declarations that are shared across Rapid: the global string ID types, plus type definitions for external libraries that don't have their own.

## Overview

This folder contains:
- `ids.ts` - String ID types (`EntityID`, `SystemID`, `ModeID`, ...) used throughout Rapid
- Ambient module declarations (`.d.ts` files) for third-party libraries that don't publish TypeScript types and don't have types available in DefinitelyTyped (`@types/*`)

## Key Files

| File | Description |
|------|-------------|
| `ids.ts` | String ID types, exported for external consumers and declared globally for internal use |
| `geojson-area.d.ts` | Types for `@mapbox/geojson-area` (area of GeoJSON geometries) |
| `geojson-rewind.d.ts` | Types for `@mapbox/geojson-rewind` (fix polygon winding order) |
| `polylabel.d.ts` | Types for `@mapbox/polylabel` (pole of inaccessibility) |
| `postcss-selector-prepend.d.ts` | Types for the `postcss-selector-prepend` plugin (used by `scripts/build_css.ts`) |
| `sexagesimal.d.ts` | Types for `@mapbox/sexagesimal` (parse/format degrees-minutes-seconds) |
| `which-polygon.d.ts` | Types for `which-polygon` (point-in-polygon index) |
| `wkt.d.ts` | Types for `wkt` (Well-Known Text to GeoJSON parsing) |

## String ID Types

The ID types in `ids.ts` are plain `string` aliases that make code self-documenting. They are validated at runtime, not compile time, because valid IDs depend on configuration and external data.

They are available globally inside Rapid, so **don't import them internally**:

```typescript
function selectEntity(entityID: EntityID): void { ... }   // no import needed
```

External consumers can import them from the package:

```typescript
import type { ModeID } from '@rapideditor/rapid';
```

## When to Add Types Here

Add a `.d.ts` file here when:
1. You're using a JavaScript library that has no TypeScript support
2. There's no `@types/` package available on npm
3. The library is used in Rapid's TypeScript code (including build scripts)

## Format

Ambient module declarations should NOT export anything at the top level:

```typescript
// types/example.d.ts
declare module 'example-library' {
  export function doSomething(): void;
  export interface Config {
    option: string;
  }
}
```

## Related

- `global.d.ts` (in project root) - Module augmentations to fix incorrect external types, and global utility types like `Nullable<T>`
- `*/types.ts` files in other folders - Shared types for that module (not ambient declarations)
