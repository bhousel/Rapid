import { test as base, expect } from '@playwright/test';
import { HAR_PATH, RECORD, RECORDING_DIR } from './recording.js';
import { join } from 'node:path';

// Hosts that load live: the dev server, and the CDN that Rapid's assets come from.
const LIVE = /^https?:\/\/(127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)[:/]/;

// Hosts whose responses come from the recording, so tests don't depend on (or load) live services.
const RECORDED = new RegExp('^https://(' + [
  'api\\.openstreetmap\\.org',
  'browser-update\\.org',
  'stac\\.overturemaps\\.org',
  'taginfo\\.openstreetmap\\.org',
  'wayback\\.maptiles\\.arcgis\\.com/arcgis/rest/services/World_Imagery/MapServer/tilemap'
].join('|') + ')');

// Requests answered with a fixed response, because the real one is big and no test needs it yet.
// To test with the real data, move the host to `RECORDED` and record again.
const STUBBED = [
  { url: /^https:\/\/openstreetmap\.maps\.arcgis\.com\/sharing\/rest\/content\/groups\//, json: { results: [], nextStart: -1 } }  // Esri dataset catalog
];

// Images and map tiles from any other host get a transparent pixel.
// Any other request is aborted, which shows up in `consoleErrors`: record that host, or block it here.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Where the tests look at the map. The recording has the OSM data for this view, so tests that
// move the map somewhere else need to record again.
export const TEST_MAP = 'map=18.00/41.94950/-85.63230';


/**
 * Rapid's `test`, which every e2e test file imports instead of Playwright's.
 * It adds:
 * - network handling: live, recorded or aborted, by host (see above)
 * - `consoleErrors`: what the page logged with `console.error`, plus uncaught exceptions
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    // Routes run in the opposite order of how they were added, so the recording goes last.
    // (While recording, the recording passes its requests on to this route, so let them through.)
    await context.route('**/*', route => {
      const request = route.request();
      const url = request.url();
      if (LIVE.test(url) || RECORDED.test(url)) return route.fallback();
      const stub = STUBBED.find(stub => stub.url.test(url));
      if (stub) return route.fulfill({ json: stub.json });
      if (request.resourceType() === 'image' || /\/tiles?\//.test(url)) {
        return route.fulfill({ contentType: 'image/png', body: PIXEL });
      }
      return route.abort();
    });
    // While recording, each test saves its own part, and `recording.js` merges them when all tests are done.
    const harPath = RECORD ? join(RECORDING_DIR, `${testInfo.testId}.har`) : HAR_PATH;
    await context.routeFromHAR(harPath, {
      url: RECORDED,
      update: RECORD,
      updateContent: 'embed',
      notFound: 'abort'
    });
    await use(context);
  },

  consoleErrors: async ({ page }, use) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));
    // The console only says "Failed to load resource", so say which.
    page.context().on('requestfailed', request => {
      errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText})`);
    });
    await use(errors);
  }
});

export { expect };


/**
 * Opens the dev build of Rapid and waits for it to start.
 * @param page - The Playwright page
 * @param hash - The url hash to start with, e.g. `'map=18.00/41.94834/-85.63275'`
 */
export async function startRapid(page, hash = '') {
  await page.goto(`/dist/index-dev.html#background=none&${hash}`);
  await page.waitForFunction(() => globalThis.rapidContext?.systems?.editor?.started, null, { timeout: 60_000 });

  // A new browser profile gets the welcome screen, which covers the map.
  const splash = page.locator('.modal-splash');
  if (await splash.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(splash).toBeHidden();
  }
}


/**
 * Returns where a `[lon, lat]` location is on the page, for `page.mouse`.
 * @param page - The Playwright page
 * @param loc - The location, e.g. `[-85.6323, 41.9495]`
 * @return The page coordinates `{ x, y }`
 */
export async function locToPage(page, loc) {
  return page.evaluate(loc => {
    // The viewport's coordinates are relative to the map's canvas, which is bigger than the map (overscan).
    const [x, y] = rapidContext.viewport.project(loc);
    const rect = document.querySelector('.main-map canvas').getBoundingClientRect();
    return { x: rect.left + x, y: rect.top + y };
  }, loc);
}


/**
 * Waits for OSM data in view, after the map has moved somewhere.
 * @param page - The Playwright page
 * @param min - How many OSM entities in view count as loaded
 */
export async function waitForOsmData(page, min = 100) {
  await page.waitForFunction(min => rapidContext.systems.editor.intersects().length >= min, min, { timeout: 30_000 });
}


/**
 * Waits until Rapid has nothing left to do: no requests in flight, and no tasks waiting in the
 * scheduler (validation, for example, runs there after data loads). Wait for this before checking
 * `consoleErrors`, so errors from work that happens after data loads aren't missed.
 * @param page - The Playwright page
 */
export async function waitForIdle(page) {
  await page.waitForFunction(() => {
    const { network, scheduler } = rapidContext.systems;
    return !network.numInflight && !network.numQueued && !scheduler.numPending;
  }, null, { timeout: 30_000 });
}
