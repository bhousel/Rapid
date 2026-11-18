# Tests

Rapid has three kinds of tests, from fastest to most realistic:

| Folder | Runs in | Command | What it's for |
|--------|---------|---------|---------------|
| [`unit/`](unit/) | Bun | `bun run test:unit` | Code that doesn't need a DOM: data, graphs, actions, validators, systems |
| [`dom/`](dom/) | Bun, with [happy-dom](https://github.com/capricorn86/happy-dom) as a fake DOM (`test_setup.js`) | `bun run test:dom` | One UI component or behavior at a time, built on a `MockContext` |
| [`e2e/`](e2e/) | A real browser, with [Playwright](https://playwright.dev) | `bun run test:e2e` | The real app: rendering (WebGL), workers, the CSP, systems working together |

`bun run test` runs the unit and DOM tests. The e2e tests are slower and need a browser, so they run on
their own, and in their own CI workflow. See [`e2e/README.md`](e2e/README.md) to get started with them.

[`benchmark/`](benchmark/) is an older Playwright setup for performance benchmarks, not in use.
