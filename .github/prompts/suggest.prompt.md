---
description: Review the codebase and suggest (then implement) concrete improvements
argument-hint: additional optional context
---

You are doing an improvement review of this codebase. The goal is to find **concrete, actionable improvements** — not a wishlist. Think like an experienced staff engineer or architect who respects the existing style and doesn't over-engineer.

## How to approach this

Get a broad picture of the project before forming any opinions.
1. Check with the `AGENTS` file to understand the project structure.
2. Use `#codebase` to survey the current state of the project.

Pay particular attention to:
- Package/dependency manifests (`package.json`, etc.)
- Compiler/type-checker config (`tsconfig.json`, etc.)
- Runtime/bundler config (`bunfig.toml`, etc.)
- Build and tooling scripts
- The README — how the project presents itself and what it's for

## Categories to evaluate

For each category below, look for real issues and note them. Skip categories where things look fine — don't invent problems.  Provide best-practices recommendations appropriate for this project, language, toolchain, etc.

**Correctness / Bugs**
- Are there any scripts or config values that are plainly wrong? (e.g. calling `npm run` in a Bun-only project)
- Any typos in user-facing strings (error messages, log output)?

**Code Quality**
- Are we using any outdated practices or deprecated APIs?
- Is the code easy to understand?  Does it use unnecessary redirection or nesting (e.g. "spaghetti code")?
- Do we have multiple pieces of code that do the same thing?  Are we DRY (dont repeat yourself) principles?
- Are there code comments that are outdated or misleading?
- Are there any obvious simplifications?

**Performance**
- Is anything in the code likely to cause performance issues?
  - unnecessary looping or recursion
  - making extra copies
  - redundant function calls
  - known slow browser APIs

**TypeScript (if applicable)**
- Are types as precise as they should be? (e.g. `String[]` vs `string[]`, missing type annotations on parameters)
- Are we overusing `as any` - can `any` or `unknown` types be narrowed?
- Are there untyped third-party modules that need a `.d.ts` declaration?
- Are there `tsconfig.json` options enabled that don't apply to this project?

**Testing**
- Are we gathering code coverage and is the code reasonably covered?
- Are there tests that don't actually test what they claim to?

**Runtime / tooling**
- Does the project use Node.js APIs where a Bun-native equivalent exists and is simpler? (e.g. `node:fs` vs `Bun.file()`)
- Are there npm/yarn artifacts in the scripts that should use `bun`?
- Are there dependencies that Bun now handles natively (e.g. a test runner, a bundler)?

**Developer Experience**
- Does the project have a `CONTRIBUTING` guide and plenty of internal documenation, source doc?
- Are there missing or misleading `package.json` scripts?
- Is the `.gitignore` / `.gitattributes` complete and correct?


## How to respond

1. **Group findings by category.** Within each category, distinguish between:
   - 🔴 Actionable issues (bugs, broken things) — implement the fix immediately
   - 🟡 Improvements (best practices, clarity) — implement unless non-trivial
   - 💡 Suggestions (optional tools, bigger changes) — describe but don't implement; let the user decide

2. **Be direct and brief.** One sentence per finding is usually enough. Don't pad.

3. **Implement the 🔴 and 🟡 items** using file edits. Verify there are no new TypeScript errors or test failures afterward.

Make edits and do not commit changes. The user will review your findings before committing.
