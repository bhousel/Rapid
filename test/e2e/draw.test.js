import { test, expect, locToPage, osmSceneState, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


/**
 * Finds places on the map with nothing near them, so clicking there doesn't snap to a feature.
 * @param page - The Playwright page
 * @param count - How many places to find
 * @param clearance - How far (in pixels) each place should be from any feature
 * @return The places, as page coordinates `{ x, y }`
 */
async function findEmptyPoints(page, count, clearance = 40) {
  return page.evaluate(({ count, clearance }) => {
    const editor = rapidContext.systems.editor;
    const graph = editor.staging.graph;
    const viewport = rapidContext.viewport;
    const map = document.querySelector('.over-map').getBoundingClientRect();
    const canvas = document.querySelector('.main-map canvas').getBoundingClientRect();

    // Every feature in view as screen segments (a point is a segment of length 0)
    const segments = [];
    for (const entity of editor.intersects()) {
      if (entity.type === 'node') {
        const p = viewport.project(entity.loc);
        segments.push([p, p]);
      } else if (entity.type === 'way') {
        const points = entity.nodes.map(nodeID => viewport.project(graph.entity(nodeID).loc));
        for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
      }
    }

    const distance = (p, [a, b]) => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };

    // Look on a grid, away from the edges of the map and its controls
    const found = [];
    for (let y = map.top + 60; y < map.bottom - 60 && found.length < count; y += 20) {
      for (let x = map.left + 60; x < map.right - 100 && found.length < count; x += 20) {
        const p = [x - canvas.left, y - canvas.top];
        if (segments.every(segment => distance(p, segment) > clearance)) found.push({ x, y });
      }
    }
    return found;
  }, { count, clearance });
}


/**
 * Waits until the map has drawn everything it was asked to (not for the network or the scheduler:
 * with something selected, the sidebar's lookups can take a long time to give up here).
 * @param page - The Playwright page
 */
async function mapSettled(page) {
  await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
  await page.waitForFunction(() => !rapidContext.systems.gfx.pending);
}


/**
 * Checks that what the OSM layer shows is what a full pass would show. Edits and changes of mode
 * are drawn without a pass (`PixiLayerOsm._renderChanged`), so after one of them a pass should
 * find nothing to change.
 * @param page - The Playwright page
 * @return What the layer shows (see `osmSceneState`)
 */
async function expectSameAsFullPass(page) {
  await mapSettled(page);
  const shown = await osmSceneState(page);
  expect(shown.filter(feature => feature.includes('| dirty |'))).toEqual([]);
  expect(shown.filter(feature => feature.includes('bound: false'))).toEqual([]);

  await page.evaluate(() => rapidContext.systems.gfx.immediateRedraw());
  await mapSettled(page);
  expect(await osmSceneState(page)).toEqual(shown);
  return shown;
}


test('draws a line, and undo takes it away', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const points = await findEmptyPoints(page, 3);
  expect(points).toHaveLength(3);

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('draw-line');

  for (const point of points) {
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.press('Enter');   // finish the line

  // The new line is selected, with a node for each click
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('select');
  const line = await page.evaluate(() => {
    const [wayID] = rapidContext.selectedIDs();
    const way = rapidContext.systems.editor.staging.graph.entity(wayID);
    return { id: way.id, nodes: way.nodes.length, isNew: way.isNew() };
  });
  expect(line).toEqual({ id: line.id, nodes: 3, isNew: true });

  // Each click was an edit: the first undo takes away the last node, the second takes away the line
  // (Finishing a feature, and each undo, puts the focus in a search field of the sidebar a moment
  // later. ⌘Z undoes from there too, while nothing has been typed in the field: wait for the
  // focus, so that this is what's tested.)
  const nodeCount = id => page.evaluate(id => rapidContext.systems.editor.staging.graph.hasEntity(id)?.nodes.length ?? 0, id);
  const focusInSearchField = () => page.evaluate(() => document.activeElement?.tagName === 'INPUT' && document.activeElement.value === '');
  await expect.poll(focusInSearchField).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => nodeCount(line.id)).toBe(2);

  await expect.poll(focusInSearchField).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => nodeCount(line.id)).toBe(0);
  expect(await page.evaluate(() => rapidContext.systems.editor.hasChanges())).toBe(false);

  expect(consoleErrors).toEqual([]);
});


// Each click of a drawing is an edit, and finishing it is a change of mode. None of them asks for a
// redraw of everything: the OSM layer draws what each one affects.
test('shows each step of drawing a line as a full pass would, without doing one', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const points = await findEmptyPoints(page, 3);
  expect(points).toHaveLength(3);

  await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    globalThis.__passes = 0;
    globalThis.__counting = true;
    gfx.on('draw', () => {
      if (globalThis.__counting && !gfx.lastRenderFrame.layers.get('osm').kept) globalThis.__passes++;
    });
  });
  // (The checks ask for passes of their own, which don't count.)
  const check = async () => {
    await mapSettled(page);
    await page.evaluate(() => { globalThis.__counting = false; });
    const shown = await expectSameAsFullPass(page);
    await page.evaluate(() => { globalThis.__counting = true; });
    return shown;
  };

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('draw-line');
  await check();

  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await check();
  }
  await page.keyboard.press('Enter');   // finish the line
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('select');

  // The line is on the map, selected, with its three vertices above everything
  const wayID = await page.evaluate(() => rapidContext.selectedIDs()[0]);
  const drawn = await check();
  expect(drawn.filter(feature => feature.startsWith(`osm-${wayID}-0 `) && feature.includes('| select |'))).toHaveLength(1);
  expect(drawn.filter(feature => feature.includes('| selected |') && !feature.includes('midpoint'))).toHaveLength(3);

  expect(await page.evaluate(() => globalThis.__passes)).toBe(0);

  // Undo all of it, and it's gone from the map too
  await page.evaluate(() => {
    const { editor } = rapidContext.systems;
    rapidContext.enter('browse');
    while (editor.hasChanges()) {
      editor.undo();
    }
  });
  const undone = await check();
  expect(undone.filter(feature => feature.includes(wayID))).toEqual([]);

  expect(consoleErrors).toEqual([]);
});


// A drag is an edit on every pointer move. The OSM layer draws what each edit affects (the node,
// its ways) on a frame where it keeps everything else, not with a pass over everything.
test('dragging a vertex moves its road with it, without a pass', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // A place with nothing near it to drag to, and the vertex of a road that's nearest to it
  const [target] = await findEmptyPoints(page, 1, 50);
  const vertex = await page.evaluate(target => {
    const editor = rapidContext.systems.editor;
    const graph = editor.staging.graph;
    const rect = document.querySelector('.main-map canvas').getBoundingClientRect();
    let best = null;
    for (const way of editor.intersects()) {
      if (way.type !== 'way' || !way.tags.highway) continue;
      for (const nodeID of way.nodes) {
        const node = graph.hasEntity(nodeID);
        if (!node || graph.parentWays(node).length !== 1) continue;   // not a junction: one road moves
        const [x, y] = rapidContext.viewport.project(node.loc);
        const distance = Math.hypot(rect.left + x - target.x, rect.top + y - target.y);
        if (distance > 60 && (!best || distance < best.distance)) {
          best = { id: node.id, wayID: way.id, loc: node.loc, distance: distance };
        }
      }
    }
    return best;
  }, target);

  // Hover it first: a plain vertex is only shown, and can only be grabbed, while its road is hovered
  const start = await locToPage(page, vertex.loc);
  await page.mouse.move(start.x - 20, start.y - 20);
  await page.mouse.move(start.x, start.y, { steps: 5 });
  await mapSettled(page);

  // Count the passes from here on
  await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    globalThis.__frames = [];
    gfx.on('draw', () => globalThis.__frames.push(gfx.lastRenderFrame.layers.get('osm').kept));
  });

  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(start.x + ((target.x - start.x) * i / 10), start.y + ((target.y - start.y) * i / 10));
    await page.waitForTimeout(20);   // (a pointer event each, as a hand would make them)
  }
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => rapidContext.systems.editor.hasChanges())).toBe(true);
  await mapSettled(page);

  // The node moved, and frames were drawn for it, none of them a pass
  const moved = await page.evaluate(nodeID => rapidContext.systems.editor.staging.graph.entity(nodeID).loc, vertex.id);
  expect(moved).not.toEqual(vertex.loc);
  const kept = await page.evaluate(() => globalThis.__frames.splice(0));
  expect(kept.length).toBeGreaterThan(5);
  expect(kept.filter(wasKept => !wasKept)).toEqual([]);

  // What's shown is what a full pass shows, with the road in it
  const after = await expectSameAsFullPass(page);
  expect(after.some(feature => feature.startsWith(`osm-${vertex.wayID}-0 `))).toBe(true);

  // Undo puts it back, and that's drawn the same way
  await page.evaluate(() => {
    rapidContext.enter('browse');
    rapidContext.systems.editor.undo();
  });
  expect(await page.evaluate(() => rapidContext.systems.editor.hasChanges())).toBe(false);
  await expectSameAsFullPass(page);

  expect(consoleErrors).toEqual([]);
});
