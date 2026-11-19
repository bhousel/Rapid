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

  // Makes a change, waits for a frame that began after it, and returns that frame's stats.
  // (A frame that held a pass back doesn't count: the pass it's waiting for is still to come.)
  const frameAfter = change => page.evaluate(async change => {
    const { gfx, map } = rapidContext.systems;
    const since = performance.now();
    if (change.pan) map.pan(change.pan);
    if (change.redraw) gfx.immediateRedraw();
    const settled = () => gfx.renderFrames.find(frame => frame.time >= since && !frame.held);
    while (!settled()) {
      await new Promise(resolve => { requestAnimationFrame(resolve); });
    }
    return settled().toJSON();
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


// Frame pacing: a frame that only moves the view doesn't wait, and a pass waits for the gap after the
// last pass (see "Frame pacing" in `design/graphics-system.md`).
test('draws frames as fast as the view moves, and holds a pass back until its gap is over', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // Move the view a little on every animation frame, staying inside the cull box.
  const panned = await page.evaluate(async () => {
    const { gfx, map } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const TICKS = 30;
    const startID = gfx.lastRenderFrame.id;
    let moves = 0;
    const onMove = () => moves++;
    gfx.on('move', onMove);
    for (let i = 0; i < TICKS; i++) {
      map.pan([i < TICKS / 2 ? 2 : -2, 0]);
      await nextFrame();
    }
    await nextFrame();
    await nextFrame();
    gfx.off('move', onMove);
    const frames = gfx.renderFrames.filter(frame => frame.id > startID);
    return { ticks: TICKS, moves: moves, frames: frames.length, kept: frames.filter(frame => frame.layers.get('osm').kept).length };
  });
  // A slow machine draws a frame in the tick after it was made, so not every tick has one.
  // (With a fixed wait of 250 ms between frames, there would be 2 or 3.)
  expect(panned.frames).toBeGreaterThanOrEqual(panned.ticks / 3);
  expect(panned.kept).toBeGreaterThanOrEqual(panned.ticks / 3);
  // ..and whatever follows the map on screen (the edit menu) hears about each move
  expect(panned.moves).toBeGreaterThanOrEqual(panned.ticks / 3);

  // Then, right after an expensive pass, move the view out of the cull box. The frames until the
  // gap is over move the view with the features as they are, and then the pass happens.
  const held = await page.evaluate(async () => {
    const { gfx, map } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const boxOf = frame => JSON.stringify(frame.toJSON().cullBox);

    // Wait until no frame is being made, so that no real pass finishes after the made-up one below.
    let lastID;
    do {
      lastID = gfx.lastRenderFrame.id;
      await nextFrame();
      await nextFrame();
    } while (gfx.lastRenderFrame.id !== lastID);
    const boxBefore = boxOf(gfx.lastRenderFrame);

    gfx.pacer.passed(performance.now(), 125);   // as if a pass that cost 125 ms just finished: the next waits 250 ms
    const since = performance.now();
    map.pan([400, 0]);

    const framesAfter = () => gfx.renderFrames.filter(frame => frame.time >= since);
    while (!framesAfter().some(frame => !frame.held)) {
      await nextFrame();
    }
    const frames = framesAfter();
    const pass = frames.find(frame => !frame.held);
    return {
      heldFrames: frames.filter(frame => frame.held && frame.time < pass.time).map(frame => {
        return { kept: frame.layers.get('osm').kept, sameBox: boxOf(frame) === boxBefore };
      }),
      waitedMs: pass.time - since,
      pass: { kept: pass.layers.get('osm').kept, sameBox: boxOf(pass) === boxBefore }
    };
  });
  expect(held.heldFrames.length).toBeGreaterThan(0);
  for (const frame of held.heldFrames) {
    expect(frame).toEqual({ kept: true, sameBox: true });
  }
  expect(held.waitedMs).toBeGreaterThan(200);
  expect(held.pass).toEqual({ kept: false, sameBox: false });

  await waitForIdle(page);
  expect(consoleErrors).toEqual([]);
});


// A deadline on the frame: after a zoom every feature has to be drawn again, and the ones a frame
// has no time for are drawn in the frames after it (see `design/graphics-system.md`, section 10).
test('after a zoom, draws the features again over the following frames, with the styles they had', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const zoomed = await page.evaluate(async () => {
    const { gfx, map, styles } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const layer = gfx.scene.layers.get('osm');

    // Count the styles worked out from tags, and give the frames no time for work that can wait.
    let styleMatches = 0;
    const styleMatch = styles.styleMatch;
    styles.styleMatch = function(...args) {
      styleMatches++;
      return styleMatch.apply(this, args);
    };
    const frameProto = Object.getPrototypeOf(gfx.lastRenderFrame);
    const hasTime = frameProto.hasTime;
    frameProto.hasTime = () => false;

    const startID = gfx.lastRenderFrame.id;
    map.zoom(map.zoom() + 0.25);
    while (!gfx.renderFrames.some(frame => frame.id > startID && frame.dirtyScene)) {
      await nextFrame();
    }
    const dirtyAfterFirst = [...layer.features.values()].filter(feature => feature.visible && feature.dirty).length;
    while (gfx.pending) {
      await nextFrame();
    }

    frameProto.hasTime = hasTime;
    styles.styleMatch = styleMatch;

    const frames = gfx.renderFrames.filter(frame => frame.id > startID);
    const first = frames.find(frame => frame.dirtyScene);
    const features = [...layer.features.values()].filter(feature => feature.visible);
    return {
      features: features.length,
      styleMatches: styleMatches,
      first: { unfinished: first.unfinished, waiting: first.layers.get('osm').waiting },
      dirtyAfterFirst: dirtyAfterFirst,
      unfinishedFrames: frames.filter(frame => frame.unfinished).length,
      last: { unfinished: frames.at(-1).unfinished, waiting: frames.at(-1).layers.get('osm').waiting },
      dirtyAtEnd: features.filter(feature => feature.dirty).length
    };
  });

  expect(zoomed.features).toBeGreaterThan(50);
  // The frame of the zoom put features off, and said that more frames should follow
  expect(zoomed.first.unfinished).toBe(true);
  expect(zoomed.first.waiting).toBeGreaterThan(50);
  expect(zoomed.dirtyAfterFirst).toBeGreaterThan(50);
  // ..they came, a few features at a time, until every feature was drawn at the new zoom
  expect(zoomed.unfinishedFrames).toBeGreaterThan(1);
  expect(zoomed.last).toEqual({ unfinished: false, waiting: 0 });
  expect(zoomed.dirtyAtEnd).toBe(0);
  // What the features are didn't change, so their styles weren't worked out again
  // (a few new features may appear at the new zoom)
  expect(zoomed.styleMatches).toBeLessThan(zoomed.features / 4);

  await waitForIdle(page);
  expect(consoleErrors).toEqual([]);
});


// ..and when there are many features to make, as after a load, they're made over several frames too.
test('makes features over several frames when there are many to make, and ends up with all of them', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const made = await page.evaluate(async () => {
    const { gfx } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const layer = gfx.scene.layers.get('osm');
    const shownIDs = () => [...layer.features.values()].filter(feature => feature.visible).map(feature => feature.id).sort();
    const before = shownIDs();

    // Give the frames no time for work that can wait, and make the layer start from nothing.
    const frameProto = Object.getPrototypeOf(gfx.lastRenderFrame);
    const hasTime = frameProto.hasTime;
    frameProto.hasTime = () => false;

    const startID = gfx.lastRenderFrame.id;
    layer.reset();
    gfx.deferredRedraw();
    while (gfx.pending) {
      await nextFrame();
    }
    frameProto.hasTime = hasTime;

    const frames = gfx.renderFrames.filter(frame => frame.id > startID);
    const pass = frames.find(frame => !frame.layers.get('osm').kept);
    const after = shownIDs();
    return {
      shownBefore: before.length,
      shownAfter: after.length,
      sameFeatures: JSON.stringify(before) === JSON.stringify(after),
      pass: { unfinished: pass.unfinished, waiting: pass.layers.get('osm').waiting },
      mostMadeInAFrame: Math.max(...frames.map(frame => frame.layers.get('osm').created)),
      unfinishedFrames: frames.filter(frame => frame.unfinished).length,
      last: { unfinished: frames.at(-1).unfinished, waiting: frames.at(-1).layers.get('osm').waiting },
      dirtyAtEnd: [...layer.features.values()].filter(feature => feature.visible && feature.dirty).length
    };
  });

  expect(made.shownBefore).toBeGreaterThan(150);
  // The pass made a batch of features, and left the rest waiting
  expect(made.pass.unfinished).toBe(true);
  expect(made.pass.waiting).toBeGreaterThan(50);
  // ..and the frames after it made a couple of batches each, until all of them were there
  expect(made.mostMadeInAFrame).toBeLessThan(made.shownBefore);
  expect(made.unfinishedFrames).toBeGreaterThan(1);
  expect(made.last).toEqual({ unfinished: false, waiting: 0 });
  expect(made.sameFeatures).toBe(true);
  expect(made.dirtyAtEnd).toBe(0);

  await waitForIdle(page);
  expect(consoleErrors).toEqual([]);
});


// An icon's texture is made the first time a feature asks for it, and arrives a little later.
// The features drawn without it are drawn again then, and no layer does its pass for that.
test('draws a point again when its icon arrives, without another pass', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const result = await page.evaluate(async () => {
    const { gfx } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const settle = async () => {
      await nextFrame();
      while (gfx.pending) {
        await nextFrame();
      }
    };
    const layer = gfx.scene.layers.get('osm');
    const textures = gfx.textureManager;
    const EMPTY = PIXI.Texture.EMPTY;

    const withIcon = [...layer.features.values()].filter(feature => feature.visible && feature.icon?.visible);
    const feature = withIcon[0];
    const image = feature.style.icon.image;
    const startup = { withIcons: withIcon.length, missing: withIcon.filter(f => f.icon.texture === EMPTY || f.dirty).length };

    // Pretend the icon hasn't loaded, and draw the feature again: it's drawn without, and stays dirty.
    const getTexture = textures.getTexture;
    textures.getTexture = (atlasID, textureID) => (textureID === image) ? EMPTY : getTexture.call(textures, atlasID, textureID);
    feature.dirty = true;
    gfx.immediateRedraw();
    await settle();
    const without = { missing: feature.icon.texture === EMPTY, dirty: feature.dirty, pending: gfx.pending };

    // The icon arrives.
    const startID = gfx.lastRenderFrame.id;
    delete textures.getTexture;
    gfx.scene.texturesLoaded();
    await settle();
    const frames = gfx.renderFrames.filter(frame => frame.id > startID);
    return {
      startup: startup,
      without: without,
      after: { missing: feature.icon.texture === EMPTY, dirty: feature.dirty },
      frames: frames.length,
      passes: frames.filter(frame => !frame.layers.get('osm').kept).length
    };
  });

  // Everything that has an icon got it while the page loaded
  expect(result.startup.withIcons).toBeGreaterThan(0);
  expect(result.startup.missing).toBe(0);
  // A feature without its icon waits for it, and asks for no more frames meanwhile
  expect(result.without).toEqual({ missing: true, dirty: true, pending: false });
  // ..and is drawn with it once it's there, in a frame where the layer kept its features
  expect(result.after).toEqual({ missing: false, dirty: false });
  expect(result.frames).toBeGreaterThan(0);
  expect(result.passes).toBe(0);

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
