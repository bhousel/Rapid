# Decisions: Tooling

Tests, the build, dependencies and agent instructions. Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## Testing: happy-dom for components, Playwright for the real app (Nov 2026)

- **Component tests stay on Bun + happy-dom (`test/dom`), not in a real browser.** They need a DOM, not
  a browser, and run 200 tests in about 2 s. Runners that put them in a real browser (Vitest browser mode,
  Web Test Runner) mean a new toolchain and slower tests, to fix a few happy-dom gaps. Rejected: keeping
  the mocha page (`test/index.html`), which had drifted to 18 of 38 files and wasn't run.
- **E2E tests use Playwright Test directly** against the dev build, because what they catch only exists
  in a real browser: WebGL, workers, the CSP. The MapLibre 6 worker bug passed all 4,149 unit and DOM tests.
- **E2E network: record and replay with a HAR, not hand-written fixtures.** Real responses, refreshed with
  one command (`E2E_RECORD=1`). The CDN stays live: its assets are many MB and are what users load anyway.
  Unknown hosts are blocked, so a test can never reach a live service by accident.

## CDN versions come from `package.json` (Nov 2026)

- **The files Rapid loads from the CDN are pinned to the versions in `package.json`**, through
  `utilCDNPath()` in `modules/util/dependencies.ts`. Hand-written pins had drifted from what was installed
  and tested (MapLibre 5.15 at runtime, 5.24 installed). `@latest` was rejected: a new major release
  would reach users before anyone tested it.
- **The exact version is the range's lower bound** (`^6.18.0` → `6.18.0`). `bun update` rewrites the lower
  bound to the installed version, so they stay equal as long as upgrades go through `bun update`.
- **Importing `package.json` puts its `dependencies` in the bundle** (`devDependencies` get tree-shaken
  out). A small cost, accepted for one source of truth.

## Folder-specific agent rules live in nested `AGENTS.md`, not `.github/instructions/`

`.github/instructions/*.instructions.md` with `applyTo:` globs only work in Copilot. Claude Code never loaded
them, and `pixi.instructions.md` wasn't linked from anywhere. Folder READMEs aren't a good home either:
no agent loads a README automatically, so rules there only get read if the agent happens to open it. Nested
`AGENTS.md` is the cross-tool convention (Claude Code, Codex, Cursor, the Copilot coding agent). Claude Code
was confirmed (Oct 2026) to load `modules/<dir>/AGENTS.md` as soon as it reads a file in that folder.
In VS Code Copilot Chat, nested `AGENTS.md` sits behind an experimental setting (`chat.useNestedAgentsMdFiles`).
The two files were moved with `git mv` (history preserved) and their `applyTo` frontmatter was dropped.

## `build_js.ts` forces `format: 'iife'` on every browser bundle

- **Why not Bun's default `esm`?** Our entry points have no exports and only attach globals, so ESM
  output is bare top-level declarations, which a classic `<script>` puts on `window` (d3-selection's
  `dispatchEvent` replaced the native one). esbuild, the old bundler, defaulted to `iife` for browsers.
  Details in `lessons/build.md`.
- **Why not `<script type="module">`?** It would push a workaround onto every embedding app's loader for
  bundles that have no ESM API to preserve. IIFE is the honest format for "load me, I attach a global".
- **Workers are iife as defense-in-depth**: they're module workers already, so nothing leaks into `self`;
  iife guards a future switch to a classic worker and still loads as a module.
- **Real ESM consumers** would be a separate, additive build (`modules/index.js`, which has exports, with a
  `package.json` `"exports"` map), not a reason to unwrap these bundles.
