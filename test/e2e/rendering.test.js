import { test, expect, osmSceneState, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


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
  expect(frame.draw.triangles).toBeGreaterThan(100);    // counted from the batches' sizes
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

  // A pan out of the cull box: the frame has a new box, and the layer follows it there without a
  // pass. It hides what the box left behind and looks at what it moved over (`_moveBox`).
  const far = await frameAfter({ pan: [400, 0] });
  expect(far.cullBox).not.toEqual(panned.cullBox);
  expect(far.layers.osm.kept).toBe(true);
  expect(far.layers.osm.steps.box).toBeGreaterThanOrEqual(0);
  expect(far.layers.osm.hidden).toBeGreaterThan(0);

  // Once it has caught up with the new box, it shows what a full pass shows there
  await waitForIdle(page);
  const followed = await osmSceneState(page);
  expect(followed.length).toBeGreaterThan(50);
  await frameAfter({ redraw: true });
  await waitForIdle(page);
  expect(await osmSceneState(page)).toEqual(followed);

  // ..and the same after going back, where its features were only hidden
  await frameAfter({ pan: [-400, 0] });
  await waitForIdle(page);
  const back = await osmSceneState(page);
  await frameAfter({ redraw: true });
  await waitForIdle(page);
  expect(await osmSceneState(page)).toEqual(back);

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
  // gap is over move the view with the features as they are, and then a frame gets the new box.
  // (The OSM layer follows the box there without a pass of its own: see `_moveBox`.)
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
      pass: { movedBox: pass.layers.get('osm').steps.box !== undefined, sameBox: boxOf(pass) === boxBefore }
    };
  });
  expect(held.heldFrames.length).toBeGreaterThan(0);
  for (const frame of held.heldFrames) {
    expect(frame).toEqual({ kept: true, sameBox: true });
  }
  expect(held.waitedMs).toBeGreaterThan(200);
  expect(held.pass).toEqual({ movedBox: true, sameBox: false });

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


// A line's casing and stroke, and each ring of an area's outline, is a mesh drawn from a stroke mesh
// that's built once, for any width (see `design/graphics-system.md`, section 15). A zoom changes the
// width in world units, so it moves the vertices the meshes have, and builds nothing.
test('draws lines and outlines as batched meshes, and keeps their vertices through a zoom', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const result = await page.evaluate(async () => {
    const { gfx, map } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const layer = gfx.scene.layers.get('osm');

    // The meshes of the lines and outlines that are drawn
    const collect = () => {
      const found = { lines: [], outlines: [] };
      for (const feature of layer.features.values()) {
        if (!feature.visible || feature.dirty) continue;
        const isLine = ('stroke' in feature);
        const meshes = isLine ? [feature.casing, feature.stroke] : (feature.strokes?.children ?? []);
        for (const mesh of meshes) {
          if (mesh?.strokeMesh?.vertexCount) found[isLine ? 'lines' : 'outlines'].push(mesh);
        }
      }
      return found;
    };

    const before = collect();
    const all = [...before.lines, ...before.outlines];
    const was = new Map();
    for (const mesh of all) {
      was.set(mesh, { strokeMesh: mesh.strokeMesh, positions: mesh.geometry.positions, first: Array.from(mesh.geometry.positions.subarray(0, 4)) });
    }
    const dashed = all.filter(mesh => mesh.geometry.uvs.length === mesh.geometry.positions.length && mesh.geometry.uvs.some(n => n !== 0));

    const startID = gfx.lastRenderFrame.id;
    map.zoom(map.zoom() + 0.5);
    while (!gfx.renderFrames.some(frame => frame.id > startID && frame.dirtyScene)) {
      await nextFrame();
    }
    while (gfx.pending) {
      await nextFrame();
    }

    const after = collect();
    let kept = 0;
    let rebuilt = 0;
    let moved = 0;
    for (const mesh of [...after.lines, ...after.outlines]) {
      const old = was.get(mesh);
      if (!old) continue;   // (a casing or an outline that this zoom is the first to show)
      if (mesh.strokeMesh === old.strokeMesh && mesh.geometry.positions === old.positions) {
        kept++;
      } else {
        rebuilt++;
      }
      if (old.first.some((n, i) => n !== mesh.geometry.positions[i])) moved++;
    }

    return {
      lines: before.lines.length,
      outlines: before.outlines.length,
      notBatched: all.filter(mesh => !mesh.batched).length,
      dashed: dashed.length,
      dashedRepeat: dashed.filter(mesh => mesh.texture.source.addressMode === 'repeat').length,
      kept: kept,
      rebuilt: rebuilt,
      moved: moved,
      graphicsDrawnAlone: gfx.lastRenderFrame.draw.unbatched.filter(graphic => /\/(casing|stroke\d*)$/.test(graphic.label)).length
    };
  });

  expect(result.lines).toBeGreaterThan(20);
  expect(result.outlines).toBeGreaterThan(5);
  expect(result.notBatched).toBe(0);
  expect(result.graphicsDrawnAlone).toBe(0);
  // Dashes are a texture that repeats along the line
  expect(result.dashed).toBeGreaterThan(0);
  expect(result.dashedRepeat).toBe(result.dashed);
  // The zoom built no stroke mesh and no array: every mesh has the ones it had, with other numbers in them
  expect(result.kept).toBeGreaterThan(20);
  expect(result.rebuilt).toBe(0);
  expect(result.moved).toBe(result.kept);

  await waitForIdle(page);
  expect(consoleErrors).toEqual([]);
});


// A zoom changes how features are drawn, not which ones there are. So the OSM layer follows the
// cull box to its new size without a pass, and runs its features through its `render…()`
// functions again over the next frames (see `design/graphics-system.md`, section 12).
test('follows a zoom without a pass, and ends up with what a full pass shows', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // In, across a whole zoom level (the features move to other tiles' containers), and back out
  for (const dz of [0.25, 1, -1.25]) {
    const frames = await page.evaluate(async (dz) => {
      const { gfx, map } = rapidContext.systems;
      const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
      const startID = gfx.lastRenderFrame.id;
      map.zoom(map.zoom() + dz);
      await nextFrame();
      await nextFrame();
      while (gfx.pending) {
        await nextFrame();
      }
      return gfx.renderFrames.filter(frame => frame.id > startID).map(frame => {
        const osm = frame.layers.get('osm');
        return { zoomed: frame.dirtyScene, held: frame.held, kept: osm.kept, box: osm.steps.box !== undefined };
      });
    }, dz);

    const zoomFrames = frames.filter(frame => frame.zoomed);
    expect(zoomFrames.length).toBeGreaterThan(0);
    expect(zoomFrames.filter(frame => !frame.kept || !frame.box)).toEqual([]);   // each followed the box
    expect(frames.filter(frame => !frame.kept && !frame.held)).toEqual([]);      // and no frame was a pass

    const shown = await osmSceneState(page);
    expect(shown.length).toBeGreaterThan(50);
    expect(shown.filter(feature => feature.includes('| dirty |'))).toEqual([]);
    await page.evaluate(() => rapidContext.systems.gfx.immediateRedraw());
    await waitForIdle(page);
    expect(await osmSceneState(page)).toEqual(shown);
  }

  expect(consoleErrors).toEqual([]);
});


// Labels are placed around the points and vertices: each of those marks where it's drawn in the
// scene's avoid grid, and no label goes there (see `design/graphics-system.md`, section 14).
// (For a while the avoids were made for whole map tiles of points, wherever those were at the time.)
test('marks every point in view for labels to avoid, and puts no label over a point', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const check = () => page.evaluate(() => {
    const { gfx, spatial } = rapidContext.systems;
    const scene = gfx.scene;
    const grid = scene.avoidGrid;
    const offset = scene.labelOffset;
    const screen = gfx.pixi.screen;

    const labelBoxes = spatial.getCache('labels').rbush.all().filter(item => item.contents.labelID).length;
    const result = { points: 0, notMarked: [], markedElsewhere: [], underALabel: [], labelBoxes: labelBoxes };
    for (const feature of scene.layers.get('osm').features.values()) {
      if (feature.type !== 'Point' || !feature.visible || feature.dirty) continue;
      const rect = feature.container.getBounds().rectangle;
      if (rect.x + rect.width < 0 || rect.y + rect.height < 0 || rect.x > screen.width || rect.y > screen.height) continue;
      result.points++;

      // where it's drawn, a pixel in from each edge
      const x = rect.x - offset.x;
      const y = rect.y - offset.y;
      const drawn = grid.cellsOf(x + 1, y + 1, x + rect.width - 1, y + rect.height - 1);
      const marked = feature.avoidCells;
      if (!marked) {
        result.notMarked.push(feature.id);
      } else if (!feature.viewfields && (marked[0] > drawn[0] || marked[1] > drawn[1] || marked[2] < drawn[2] || marked[3] < drawn[3])) {
        result.markedElsewhere.push(feature.id);     // (hidden viewfields count in `getBounds`, and aren't marked)
      }
      if (marked && grid.isTaken('label', marked)) {
        // a point's own label may touch it; another feature's may not cover it
        const box = { minX: x + 2, minY: y + 2, maxX: x + rect.width - 2, maxY: y + rect.height - 2 };
        if (spatial.getItemsAtBox('labels', box).some(item => item.contents.labelID && item.contents.featureID !== feature.id)) {
          result.underALabel.push(feature.id);
        }
      }
    }
    return result;
  });

  const loaded = await check();
  expect(loaded.points).toBeGreaterThan(20);
  expect(loaded.labelBoxes).toBeGreaterThan(0);
  expect(loaded.notMarked).toEqual([]);
  expect(loaded.markedElsewhere).toEqual([]);
  expect(loaded.underALabel).toEqual([]);

  // ..and after a pan, with the points that came into view
  await page.evaluate(async () => {
    const { map } = rapidContext.systems;
    for (let i = 0; i < 10; i++) {
      map.pan([-12, -8]);
      await new Promise(resolve => { requestAnimationFrame(resolve); });
    }
  });
  await waitForIdle(page);
  const panned = await check();
  expect(panned.points).toBeGreaterThan(5);
  expect(panned.notMarked).toEqual([]);
  expect(panned.markedElsewhere).toEqual([]);
  expect(panned.underALabel).toEqual([]);

  // ..and in a view that's zoomed in and turned: label space is another one, and everything is marked again
  await page.evaluate(() => {
    const { gfx } = rapidContext.systems;
    const viewport = rapidContext.viewport;
    const t = viewport.transform.props;
    const c = viewport.center();
    return gfx.setTransformAsync({ x: c[0] + (t.x - c[0]) * 2, y: c[1] + (t.y - c[1]) * 2, z: t.z + 1, r: 0.6 }, 0);
  });
  await waitForIdle(page);
  const turned = await check();
  expect(turned.points).toBeGreaterThan(5);
  expect(turned.notMarked).toEqual([]);
  expect(turned.markedElsewhere).toEqual([]);
  expect(turned.underALabel).toEqual([]);

  expect(consoleErrors).toEqual([]);
});


// ..and when there are many features to make, as after a load, they're made over several frames too.

test('leaves every label where it is while features are hovered', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // Where each label is, in label space
  const placements = () => page.evaluate(() => {
    const labels = rapidContext.systems.gfx.scene.layers.get('labels');
    const result = {};
    for (const [labelID, props] of labels._placeholders) {
      result[labelID] = (props.kind === 'text') ? [props.x, props.y] : props.coords;
    }
    return result;
  });

  // The labeled lines: a hovered line gets its vertices drawn, along where its label runs
  const wayIDs = await page.evaluate(() => {
    const scene = rapidContext.systems.gfx.scene;
    const labels = scene.layers.get('labels');
    const ids = [];
    for (const feature of scene.layers.get('osm').features.values()) {
      if (feature.type === 'LineString' && feature.visible && labels._featureBoxes.has(feature.id)) {
        ids.push(feature.data.id);
      }
    }
    return ids.slice(0, 8);
  });
  expect(wayIDs.length).toBeGreaterThan(0);

  const before = await placements();
  expect(Object.keys(before).length).toBeGreaterThan(0);

  for (const wayID of wayIDs) {
    const vertices = await page.evaluate(id => {
      const { gfx } = rapidContext.systems;
      gfx.scene.setClass('hover', id);
      gfx.requestFrame();
      return rapidContext.systems.editor.staging.graph.entity(id).nodes.length;
    }, wayID);
    expect(vertices).toBeGreaterThan(1);
    await waitForIdle(page);
    expect(await placements()).toEqual(before);

    await page.evaluate(id => {
      const { gfx } = rapidContext.systems;
      gfx.scene.unsetClass('hover', id);
      gfx.requestFrame();
    }, wayID);
    await waitForIdle(page);
    expect(await placements()).toEqual(before);
  }

  expect(consoleErrors).toEqual([]);
});



test('places no labels while the zoom or rotation is changing, and places them once the view holds still', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const numLabels = () => page.evaluate(() => rapidContext.systems.gfx.scene.layers.get('labels')._placeholders.size);
  expect(await numLabels()).toBeGreaterThan(0);

  // A pinch, then a turn: a small step each frame. Every step takes all labels away, so any
  // that were placed between two steps would only flash.
  for (const [dz, dr] of [[0.01, 0], [0, 0.01]]) {
    const shown = await page.evaluate(async ([dz, dr]) => {
      const { gfx } = rapidContext.systems;
      const viewport = rapidContext.viewport;
      const labels = gfx.scene.layers.get('labels');
      let most = 0;
      for (let i = 0; i < 30; i++) {
        const t = viewport.transform.props;
        const c = viewport.center();
        const k = 2 ** dz;
        gfx.setTransformAsync({ x: c[0] + (t.x - c[0]) * k, y: c[1] + (t.y - c[1]) * k, z: t.z + dz, r: t.r + dr }, 0);
        await new Promise(resolve => { requestAnimationFrame(resolve); });
        most = Math.max(most, labels._placeholders.size);
      }
      return most;
    }, [dz, dr]);
    expect(shown).toBe(0);

    await waitForIdle(page);
    expect(await numLabels()).toBeGreaterThan(0);
  }

  expect(consoleErrors).toEqual([]);
});

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


// Lines and points are split into containers by map tile, each with its own render group, so that
// a change to one feature makes Pixi rebuild a small group. The order they're drawn in stays.
test('keeps lines in the order of their road class, and points from north to south, across tile containers', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const result = await page.evaluate(() => {
    const { gfx } = rapidContext.systems;
    const layer = gfx.scene.layers.get('osm');
    const visible = [...layer.features.values()].filter(feature => feature.visible);

    // A feature's container is in its tile's container, which is in that container's render group.
    const groupOf = feature => feature.container.parent.parent;
    const lines = visible.filter(feature => feature.type === 'LineString');
    const points = visible.filter(feature => feature.type === 'Point' && feature.container.parent.label !== 'selected');

    // In draw order, the lines' containers go from the lowest road class to the highest.
    let outOfOrder = 0;
    const lineGroups = new Set();
    for (const level of layer.lineContainer.children) {
      const groups = level.children[0].children;
      for (let i = 0; i < groups.length; i++) {
        lineGroups.add(groups[i]);
        if (i > 0 && groups[i].zIndex < groups[i - 1].zIndex) outOfOrder++;
      }
    }
    const pointGroups = layer.pointContainer.children;
    for (let i = 1; i < pointGroups.length; i++) {
      if (pointGroups[i].zIndex < pointGroups[i - 1].zIndex) outOfOrder++;
    }

    return {
      lines: lines.length,
      lineGroups: lineGroups.size,
      // every line is in a container of its own road class (the whole part of its `zIndex`)
      linesInAnotherClass: lines.filter(feature => Math.floor(groupOf(feature).zIndex) !== Math.floor(feature.container.zIndex)).length,
      linesInRenderGroups: lines.filter(feature => groupOf(feature).isRenderGroup).length,
      points: points.length,
      pointGroups: pointGroups.length,
      pointsInRenderGroups: points.filter(feature => groupOf(feature).isRenderGroup).length,
      outOfOrder: outOfOrder
    };
  });

  expect(result.lines).toBeGreaterThan(10);
  expect(result.lineGroups).toBeGreaterThan(1);
  expect(result.linesInRenderGroups).toBe(result.lines);
  expect(result.linesInAnotherClass).toBe(0);
  expect(result.points).toBeGreaterThan(10);
  expect(result.pointGroups).toBeGreaterThan(0);
  expect(result.pointsInRenderGroups).toBe(result.points);
  expect(result.outOfOrder).toBe(0);

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


// Rapid#1636, pixijs#12437: in Pixi's 'auto' batch mode, a mesh of 100 vertices or fewer is
// batched. A partial fill's mask that crosses that line in a frame where its tile's render group is
// rebuilt made Pixi throw on every later frame that moved the tile (`MeshPipe.updateRenderable`),
// until something rebuilt it. The masks are always batched now, so crossing the line changes nothing.
test('keeps drawing a partial fill whose mask crosses 100 vertices in a frame its tile is rebuilt', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const result = await page.evaluate(async () => {
    const { gfx } = rapidContext.systems;
    const scene = gfx.scene;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const drawFrame = async () => {
      gfx.requestFrame();
      await nextFrame();
      await nextFrame();
    };
    // A mask geometry of n vertices, as `_drawShapes()` makes one (with uvs)
    const strip = n => {
      const positions = new Float32Array(n * 2);
      const indices = [];
      for (let i = 0; i < n; i++) {
        positions[i * 2] = (i >> 1) * 4;
        positions[i * 2 + 1] = (i & 1) * 4;
      }
      for (let i = 0; i + 2 < n; i++) indices.push(i, i + 1, i + 2);
      return new PIXI.MeshGeometry({ positions, uvs: new Float32Array(n * 2), indices: new Uint32Array(indices) });
    };

    const layer = scene.layers.get('osm');
    const feature = [...layer.features.values()].find(feature => feature.visible && feature.mask?.visible);
    if (!feature) return { found: false };

    const mask = feature.mask;
    const tile = feature.container.parent;
    const batched = [];

    // A mask of 200 vertices (more than Pixi batches in 'auto' mode), that Pixi has never batched,
    // like one first drawn zoomed in. (A mask that was batched once keeps its old place in a batch,
    // and Pixi writes it there instead of throwing.)
    mask.unload();
    feature._setMaskGeometry(strip(200));
    await drawFrame();
    batched.push(mask.batched);

    // In one frame: the tile's render group is rebuilt (a child added), and the mask gets 50 vertices
    const child = new PIXI.Container();
    tile.addChild(child);
    feature._setMaskGeometry(strip(50));
    await drawFrame();
    batched.push(mask.batched);

    // Then frames that move the tile, without a rebuild: the anchor moves its container
    const [x, y] = scene.anchor;
    scene.setAnchor([x + 256, y]);
    await drawFrame();
    scene.setAnchor([x, y]);
    await drawFrame();

    tile.removeChild(child);
    child.destroy();
    feature.dirty = true;   // draw its real mask again
    gfx.immediateRedraw();
    return { found: true, batched: batched };
  });

  expect(result.found).toBe(true);
  expect(result.batched).toEqual([true, true]);

  await waitForIdle(page);
  expect(consoleErrors).toEqual([]);
});


// pixijs#12295, #12388: a stencil mask that's still visible when nothing draws it (its fill hidden,
// or no longer masked) keeps its place from an earlier batch, and Pixi writes it there when an
// ancestor moves, over other features' vertices. So a mask is visible only while its fill is.
test('shows a partial fill\'s mask only with its fill, in every area fill mode', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const result = await page.evaluate(async () => {
    const { gfx, map } = rapidContext.systems;
    const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
    const layer = gfx.scene.layers.get('osm');

    const counts = {};
    for (const mode of ['partial', 'full', 'wireframe', 'partial']) {
      map.areaFillMode = mode;
      await nextFrame();
      while (gfx.pending) {
        await nextFrame();
      }
      const polygons = [...layer.features.values()].filter(feature => feature.visible && feature.mask);
      counts[mode] = {
        masks: polygons.filter(feature => feature.mask.visible).length,
        alone: polygons.filter(feature => feature.mask.visible && !(feature.fill.visible && feature.fill.mask === feature.mask)).length
      };
    }
    return counts;
  });

  expect(result.partial.masks).toBeGreaterThan(0);
  expect(result.full.masks).toBe(0);
  expect(result.wireframe.masks).toBe(0);
  for (const mode of ['partial', 'full', 'wireframe']) {
    expect(result[mode].alone).toBe(0);
  }

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
  // (A frame can switch shaders zero times: lines are batched meshes now, so on this small map
  // everything is drawn with the batch shader, which the frame before left bound.)
  expect(gl.programs).toBeGreaterThanOrEqual(0);
  expect(gl.textureBinds).toBeGreaterThanOrEqual(0);
  expect(gl.bufferUploads).toBeGreaterThanOrEqual(0);

  // Turning them off removes the counters
  const hasCounters = await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    gfx.enableDetailedStats(false);
    return gfx.detailedStats || Object.hasOwn(gfx.pixi.renderer.gl, 'drawElements');
  });
  expect(hasCounters).toBe(false);

  expect(consoleErrors).toEqual([]);
});
