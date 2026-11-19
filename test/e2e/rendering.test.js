import { test, expect, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


// Frame stats read Pixi's internals (its instruction lists and GPU contexts), which can change in any
// Pixi release. These tests check that they still look the way `modules/pixi/lib/RenderStats.ts` expects.
// They don't check how much a frame costs: there are no budgets yet (see `design/graphics-system.md`).

test('records what each frame drew, from Rapid\'s layers and Pixi\'s instructions', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // Draw a frame with the data in view, and take the first one that began after the request.
  // (A frame already under way doesn't count: the OSM layer may have kept its features in it.)
  const since = await page.evaluate(() => {
    rapidContext.systems.gfx.immediateRedraw();
    return performance.now();
  });
  const requested = since => rapidContext.systems.gfx.renderFrames.find(frame => frame.time >= since);
  await page.waitForFunction(requested, since);

  const frame = await page.evaluate(since => {
    return rapidContext.systems.gfx.renderFrames.find(frame => frame.time >= since).toJSON();
  }, since);

  // From the APP pass: each layer's time and features
  expect(frame.appMs).toBeGreaterThan(0);
  expect(frame.layers.osm.enabled).toBe(true);
  expect(frame.layers.osm.visible).toBeGreaterThan(50);
  expect(frame.layers.osm.renderMs).toBeGreaterThan(0);
  expect(frame.layers.osm.kept).toBe(false);                  // a redraw was requested, so it did its pass
  expect(frame.layers.osm.steps).toHaveProperty('gather');    // ..and timed its steps (a step can take 0 ms)
  expect(frame.layers.osm.steps).toHaveProperty('vertices');

  // From the DRAW pass: Pixi's instructions, read from its internals
  expect(frame.draw.ms).toBeGreaterThan(0);
  expect(frame.draw.renderGroups).toBeGreaterThan(5);   // the scene's containers are render groups
  expect(frame.draw.rebuiltGroups).toBeLessThanOrEqual(frame.draw.renderGroups);
  expect(frame.draw.instructions.batch).toBeGreaterThan(0);
  expect(Object.keys(frame.draw.batchTextures).length).toBeGreaterThan(0);
  for (const graphic of frame.draw.unbatched) {
    expect(graphic.reason).not.toBe('unknown');   // we found its GPU context
    expect(graphic.floats).toBeGreaterThan(0);
  }
  expect(frame.draw.gl).toBeUndefined();   // detailed stats are off

  expect(consoleErrors).toEqual([]);
});


// The CULL pass: a layer has features ready for more than the view, so that a frame where only the
// view moved has nothing to do (see "A CULL pass" in `design/graphics-system.md`).
test('keeps the OSM features as they are while only the view moves, and does the work when something changes', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // Makes a change, waits for a frame that began after it, and returns that frame's stats
  const frameAfter = change => page.evaluate(async change => {
    const { gfx, map } = rapidContext.systems;
    const since = performance.now();
    if (change.pan) map.pan(change.pan);
    if (change.redraw) gfx.immediateRedraw();
    while (!(gfx.lastRenderFrame?.time >= since)) {
      await new Promise(resolve => { requestAnimationFrame(resolve); });
    }
    return gfx.renderFrames.find(frame => frame.time >= since).toJSON();
  }, change);

  // A small pan: nothing asked for a redraw, and the view is still inside the cull box
  await frameAfter({ pan: [10, 6] });
  await waitForIdle(page);   // in case the pan loaded something
  const panned = await frameAfter({ pan: [-10, -6] });
  expect(panned.contentChanged).toBe(false);
  expect(panned.layers.osm.kept).toBe(true);
  expect(panned.layers.osm.visible).toBeGreaterThan(50);
  expect(panned.layers.osm.updated).toBe(0);

  // A redraw request: something may have changed, so the layer does its pass. Nothing did.
  const redrawn = await frameAfter({ redraw: true });
  expect(redrawn.contentChanged).toBe(true);
  expect(redrawn.layers.osm.kept).toBe(false);
  expect(redrawn.layers.osm.visible).toBe(panned.layers.osm.visible);
  expect(redrawn.layers.osm.shown + redrawn.layers.osm.hidden).toBe(0);

  // A pan out of the cull box: the layer does its pass for a new box
  const far = await frameAfter({ pan: [400, 0] });
  expect(far.layers.osm.kept).toBe(false);
  expect(far.cullBox).not.toEqual(panned.cullBox);

  await waitForIdle(page);
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
