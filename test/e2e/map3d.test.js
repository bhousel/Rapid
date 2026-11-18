import { test, expect, startRapid, waitForOsmData, TEST_MAP } from './fixtures.js';


// MapLibre loads from the CDN and starts a worker, which our CSP can block (see `knowledge/quirks.md`).
test('the 3D map loads MapLibre and draws buildings', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);

  await page.evaluate(() => {
    const map3d = rapidContext.systems.map3d;
    map3d.visible = true;
    return map3d.startAsync();
  });

  await expect.poll(() => page.evaluate(() => {
    const maplibre = rapidContext.systems.map3d.maplibre;
    return maplibre?.loaded() ? maplibre.querySourceFeatures('osmbuildings').length : 0;
  }), { timeout: 20_000 }).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
