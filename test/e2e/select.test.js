import { test, expect, locToPage, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


test('clicking a road selects it and shows it in the inspector', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);   // drawn, so there's something to click

  // Find East Bennett Street, and the middle of its first segment
  const road = await page.evaluate(() => {
    const editor = rapidContext.systems.editor;
    const graph = editor.staging.graph;
    const way = editor.intersects().find(entity => entity.type === 'way' && entity.tags.name === 'East Bennett Street');
    const [a, b] = way.nodes.slice(0, 2).map(nodeID => graph.entity(nodeID).loc);
    return { id: way.id, loc: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  });

  const point = await locToPage(page, road.loc);
  await page.mouse.click(point.x, point.y);

  // It's selected, and the map draws it as selected
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toEqual([road.id]);
  await expect.poll(() => page.evaluate(() => [...rapidContext.systems.gfx.scene.getDataWithClass('select')]))
    .toEqual([road.id]);

  // The inspector shows what it is
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name: 'Residential Road' })).toBeVisible();
  await expect(sidebar.getByRole('textbox', { name: /^Name/ })).toHaveValue('East Bennett Street');

  // Escape goes back to browsing
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('browse');
  expect(consoleErrors).toEqual([]);
});


// A hover changes two features' classes and which vertices show. The OSM layer draws those again
// on a frame where it keeps everything else (`PixiLayerOsm._renderChanged`): its pass takes 200 ms
// in a dense place, and the pointer moves over a new feature many times a second.
test('hovering a road highlights it and shows its vertices, without a pass', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const road = await page.evaluate(() => {
    const editor = rapidContext.systems.editor;
    const graph = editor.staging.graph;
    const way = editor.intersects().find(entity => entity.type === 'way' && entity.tags.name === 'East Bennett Street');
    const [a, b] = way.nodes.slice(0, 2).map(nodeID => graph.entity(nodeID).loc);
    return { id: way.id, nodes: way.nodes.length, loc: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  });

  // Count the passes from here on
  await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    globalThis.__frames = [];
    gfx.on('draw', () => {
      const frame = gfx.lastRenderFrame;
      globalThis.__frames.push({ kept: frame.layers.get('osm').kept, held: frame.held });
    });
  });

  const point = await locToPage(page, road.loc);
  await page.mouse.move(point.x - 40, point.y - 40);
  await page.mouse.move(point.x, point.y, { steps: 5 });

  await expect.poll(() => page.evaluate(() => [...rapidContext.systems.gfx.scene.getDataWithClass('hover')]))
    .toEqual([road.id]);
  await waitForIdle(page);

  // The way's features have the class, and its vertices are drawn above everything
  const state = () => page.evaluate(wayID => {
    const gfx = rapidContext.systems.gfx;
    const layer = gfx.scene.layers.get('osm');
    const shown = [...layer.features.values()].filter(feature => feature.visible);
    return {
      hovered: shown.filter(feature => feature.classes.has('hover')).map(feature => feature.data.id),
      verticesOnTop: shown.filter(feature => feature.container.parent.label === 'selected').length,
      dirty: shown.filter(feature => feature.dirty).length,
      shown: shown.map(feature => `${feature.id} in ${feature.container.parent.label} ${[...feature.classes]}`).sort()
    };
  }, road.id);

  const hovered = await state();
  expect(hovered.hovered).toEqual([road.id]);
  expect(hovered.verticesOnTop).toBe(road.nodes);
  expect(hovered.dirty).toBe(0);

  const frames = await page.evaluate(() => globalThis.__frames);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter(frame => !frame.kept)).toEqual([]);

  // A pass right after it finds nothing to change
  await page.evaluate(() => rapidContext.systems.gfx.immediateRedraw());
  await waitForIdle(page);
  expect((await state()).shown).toEqual(hovered.shown);

  // Moving off the road (maybe onto something else) takes that away again, and a pass agrees
  await page.mouse.move(point.x - 40, point.y - 40, { steps: 5 });
  await expect.poll(() => page.evaluate(wayID => rapidContext.systems.gfx.scene.getDataWithClass('hover').has(wayID), road.id)).toBe(false);
  await waitForIdle(page);
  const after = await state();
  expect(after.hovered).not.toContain(road.id);
  expect(after.dirty).toBe(0);
  expect(after.shown).not.toEqual(hovered.shown);

  await page.evaluate(() => rapidContext.systems.gfx.immediateRedraw());
  await waitForIdle(page);
  expect((await state()).shown).toEqual(after.shown);

  // Pixi isn't asked to tell every object about every pointer move
  const features = await page.evaluate(() => ({ ...rapidContext.systems.gfx.pixi.renderer.events.features }));
  expect(features).toEqual({ move: true, globalMove: false, click: true, wheel: false });

  expect(consoleErrors).toEqual([]);
});
