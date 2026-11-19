# End-to-end tests

These tests open the real Rapid app (the dev build) in a real browser, using
[Playwright](https://playwright.dev/docs/intro), and check what it does. They cover what the unit and DOM
tests can't: drawing with WebGL (Pixi, MapLibre), workers, the Content Security Policy, and the systems
working together. Rules for writing them are in [`AGENTS.md`](../../AGENTS.md) under "Testing".

## Running them

```sh
bunx playwright install chromium   # once, and again after Playwright is upgraded
bun run test:e2e                   # builds and serves Rapid, then runs the tests
bun run test:e2e --ui              # watch the tests run, step by step
bun run test:e2e map3d             # only the files whose name matches
```

If a server is already running on port 8080 (`bun run start`), the tests use it instead of building, so
rebuild first if you changed something. In CI, Playwright always builds and starts its own.

When a test fails, Playwright saves a screenshot, a trace and an `error-context.md` under `results/`, and
an HTML report under `report/` (both gitignored). Open a trace with
`bunx playwright show-trace test/e2e/results/<test>/trace.zip`.

## How a test works

The test file runs in Bun, and Rapid runs in the browser. The `page` object connects the two:
`page.evaluate(() => …)` runs a function in the page and returns its result, so a test can ask
`rapidContext` (Rapid's context, a global in the dev build) what happened. `expect.poll()` repeats a check
until it passes, which suits things that take a few frames.

```js
import { test, expect, startRapid, waitForOsmData, TEST_MAP } from './fixtures.js';

test('draws the OSM data on the map', async ({ page }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await expect.poll(() => page.evaluate(() => rapidContext.systems.gfx.scene.layers.get('osm').features.size))
    .toBeGreaterThan(100);
});
```

Import `test` from [`fixtures.js`](fixtures.js), not from Playwright. It adds the network handling below,
and `consoleErrors`: what the page logged with `console.error`, uncaught exceptions, and failed requests.

## The network

Tests shouldn't depend on live services, or put load on them. `fixtures.js` sorts every request by host:

- **Live:** the dev server, and the CDN that Rapid's assets come from (`cdn.jsdelivr.net`).
- **Recorded:** OSM, Overture's catalog, taginfo and a few others are answered from
  [`data/recorded.har`](data/recorded.har), a recording of real responses.
- **Stubbed:** big responses that no test needs yet get a fixed answer (the Esri dataset catalog).
- **Everything else:** images and map tiles get a transparent pixel. Other requests are aborted, which
  shows up in `consoleErrors`, so a new service gets noticed.

The recording has the OSM data around `TEST_MAP`, and whatever else the tests asked those hosts for (taginfo
values for the inspector's fields, for example). Record again after adding a test that asks for something
new, or when a service's responses change:

```sh
E2E_RECORD=1 bun run test:e2e
```

While recording, each test saves its own part, and [`recording.js`](recording.js) merges them into
`data/recorded.har` when all the tests are done, sorted by URL. So record with all the tests, not a few: a
part you didn't record is lost. Look at the diff before committing: the file is real data from those services.

Data that a test brings itself goes in `data/` too, and the dev server serves it (it serves the whole repo):
`rapid.test.js` loads a small Rapid dataset from `/test/e2e/data/paths.geojson`.

## Helpers in `fixtures.js`

- `startRapid(page, hash)` opens the dev build (with `background=none`), waits for it to start, and closes
  the welcome screen.
- `waitForOsmData(page)` waits for OSM data in view. `waitForIdle(page)` waits until no requests or
  scheduled work are left and no frame of the map is still to come (`gfx.pending`): wait for it before
  clicking on the map (so the features are drawn), and before checking `consoleErrors` (validation runs
  after the data loads).
- `locToPage(page, loc)` turns a `[lon, lat]` into page coordinates, for `page.mouse.click()`.
