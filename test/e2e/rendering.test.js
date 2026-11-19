import { test, expect, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


// Frame stats read Pixi's internals (its instruction lists and GPU contexts), which can change in any
// Pixi release. These tests check that they still look the way `modules/pixi/lib/RenderStats.ts` expects.
// They don't check how much a frame costs: there are no budgets yet (see `design/graphics-system.md`).

test('records what each frame drew, from Rapid\'s layers and Pixi\'s instructions', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // Draw a frame with the data in view
  const frameID = await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    gfx.immediateRedraw();
    return gfx.lastRenderFrame?.id ?? -1;
  });
  await page.waitForFunction(frameID => rapidContext.systems.gfx.lastRenderFrame?.id > frameID, frameID);

  const frame = await page.evaluate(() => rapidContext.systems.gfx.lastRenderFrame.toJSON());

  // From the APP pass: each layer's time and features
  expect(frame.appMs).toBeGreaterThan(0);
  expect(frame.layers.osm.enabled).toBe(true);
  expect(frame.layers.osm.visible).toBeGreaterThan(50);
  expect(frame.layers.osm.renderMs).toBeGreaterThan(0);

  // From the DRAW pass: Pixi's instructions, read from its internals
  expect(frame.draw.ms).toBeGreaterThan(0);
  expect(frame.draw.instructions.batch).toBeGreaterThan(0);
  expect(Object.keys(frame.draw.batchTextures).length).toBeGreaterThan(0);
  for (const graphic of frame.draw.unbatched) {
    expect(graphic.reason).not.toBe('unknown');   // we found its GPU context
    expect(graphic.floats).toBeGreaterThan(0);
  }
  expect(frame.draw.gl).toBeUndefined();   // detailed stats are off

  expect(consoleErrors).toEqual([]);
});


test('counts WebGL calls while detailed stats are on', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const frameID = await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    gfx.enableDetailedStats(true);
    gfx.immediateRedraw();
    return gfx.lastRenderFrame?.id ?? -1;
  });
  await page.waitForFunction(frameID => rapidContext.systems.gfx.lastRenderFrame?.id > frameID, frameID);

  const gl = await page.evaluate(() => rapidContext.systems.gfx.lastRenderFrame.draw.gl);
  expect(gl.draws).toBeGreaterThan(0);
  expect(gl.programs).toBeGreaterThan(0);

  // Turning them off removes the counters
  const hasCounters = await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    gfx.enableDetailedStats(false);
    return gfx.detailedStats || Object.hasOwn(gfx.pixi.renderer.gl, 'drawElements');
  });
  expect(hasCounters).toBe(false);

  expect(consoleErrors).toEqual([]);
});
