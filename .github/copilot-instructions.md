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

### Shared Types
- `types.ts` files exist per folder for **cross-file shared types only**
- Examples: `Context`, `Entity`, `EntityID`, `Tags`, `Vec2`
- Class-specific types (like `FooProps`) stay with the class

### Type Imports
- Use `import type { ... }` for type-only imports
- This prevents circular dependencies and improves tree-shaking

## Testing

After making changes:
1. Run `bun tsc --noEmit` to check types
2. Run `bun run build:js` to verify build
3. Run `bun test` for full test suite
