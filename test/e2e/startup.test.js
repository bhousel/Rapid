import { test, expect, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


test('starts, loads OSM data, and logs no errors', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);   // validation runs after the data loads
  expect(consoleErrors).toEqual([]);
});


test('draws the OSM data on the map', async ({ page }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);

  // `expect.poll` asks again until the answer passes (or the test times out), since drawing takes a few frames.
  await expect.poll(() => page.evaluate(() => rapidContext.systems.gfx.scene.layers.get('osm').features.size))
    .toBeGreaterThan(100);
});
