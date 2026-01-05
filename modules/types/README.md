# Types

TypeScript type declaration files for external libraries that don't have their own type definitions.

## Overview

This folder contains ambient module declarations (`.d.ts` files) for third-party libraries that don't publish TypeScript types and don't have types available in DefinitelyTyped (`@types/*`).

## Key Files

| File | Description |
|------|-------------|
| `polylabel.d.ts` | Types for the `polylabel` library (pole of inaccessibility) |

## When to Add Types Here

Add a `.d.ts` file here when:
1. You're using a JavaScript library that has no TypeScript support
2. There's no `@types/` package available on npm
3. The library is used in Rapid's TypeScript code

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

- `global.d.ts` (in project root) - Module augmentations to fix incorrect external types
- `*/types.ts` files in other folders - Shared types for that module (not ambient declarations)
