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


// The halo of a selection is a dashed outline at the edge of what a click on the feature hits:
// a `LineMesh` for each ring of `geomStrokeOutline()`, in the map UI layer. A line is hit within
// a distance of it (`LineHitArea`), so a click a few pixels beside a road selects it too.
test('selects a road by a click beside it, and draws a dashed halo as far out as a click reaches', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  const road = await page.evaluate(() => {
    const editor = rapidContext.systems.editor;
    const graph = editor.staging.graph;
    const way = editor.intersects().find(entity => entity.type === 'way' && entity.tags.name === 'East Bennett Street');
    const [a, b] = way.nodes.slice(0, 2).map(nodeID => graph.entity(nodeID).loc);
    return { id: way.id, a: a, b: b };
  });

  // A third of the way along its first segment, and 5 pixels to one side
  const a = await locToPage(page, road.a);
  const b = await locToPage(page, road.b);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  expect(length).toBeGreaterThan(30);
  const beside = {
    x: a.x + (b.x - a.x) / 3 - 5 * (b.y - a.y) / length,
    y: a.y + (b.y - a.y) / 3 + 5 * (b.x - a.x) / length
  };
  await page.mouse.click(beside.x, beside.y);
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toEqual([road.id]);
  await waitForIdle(page);

  const halo = await page.evaluate(wayID => {
    const gfx = rapidContext.systems.gfx;
    const feature = [...gfx.scene.layers.get('osm').features.values()].find(feature => feature.data?.id === wayID && feature.halo);
    if (!feature) return null;

    // How far each of the halo's vertices is from the road, in screen pixels
    const coords = feature.geometry.local.flat[0];
    const scale = 2 ** (16 - rapidContext.viewport.transform.zoom);
    let min = Infinity;
    let max = 0;
    let numVertices = 0;
    for (const mesh of feature.halo.children) {
      const positions = mesh.geometry.positions;
      numVertices += positions.length / 2;
      for (let i = 0; i < positions.length; i += 2) {
        let nearest = Infinity;
        for (let k = 0; k + 3 < coords.length; k += 2) {
          const dx = coords[k + 2] - coords[k];
          const dy = coords[k + 3] - coords[k + 1];
          const t = Math.max(0, Math.min(1, ((positions[i] - coords[k]) * dx + (positions[i + 1] - coords[k + 1]) * dy) / (dx * dx + dy * dy)));
          nearest = Math.min(nearest, Math.hypot(positions[i] - coords[k] - t * dx, positions[i + 1] - coords[k + 1] - t * dy));
        }
        min = Math.min(min, nearest / scale);
        max = Math.max(max, nearest / scale);
      }
    }
    return {
      parent: feature.halo.parent.label,
      rings: feature.halo.children.length,
      textures: feature.halo.children.map(mesh => mesh.texture.label),
      batchModes: feature.halo.children.map(mesh => mesh.geometry.batchMode),
      numVertices: numVertices,
      min: min,
      max: max,
      hitsBeside: feature.container.hitArea.contains(coords[0] + (coords[2] - coords[0]) / 3, coords[1] + (coords[3] - coords[1]) / 3)
    };
  }, road.id);

  expect(halo).not.toBeNull();
  expect(halo.parent).toBe('halo');
  expect(halo.rings).toBe(1);            // an open line has one ring around it
  expect(halo.textures).toEqual(['dash-6,3']);
  expect(halo.batchModes).toEqual(['batch']);
  expect(halo.numVertices).toBeGreaterThan(20);
  expect(halo.hitsBeside).toBe(true);
  // The halo's own line is 2 pixels wide, so its vertices are within a pixel or so of one distance
  // from the road, and that distance is more than the 5 pixels the click was away.
  expect(halo.min).toBeGreaterThan(5);
  expect(halo.max - halo.min).toBeLessThan(3);

  // Escape takes the halo away, and its meshes with it
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('browse');
  await waitForIdle(page);
  const left = await page.evaluate(() => rapidContext.systems.gfx.scene.layers.get('map-ui').halo.children.length);
  expect(left).toBe(0);
  expect(consoleErrors).toEqual([]);
});


// The lasso is drawn in the map UI layer while it's dragged: a fill, and a dashed outline that's
// a `LineMesh` (see `drawRings`).
test('draws the lasso as it is dragged, and selects the points inside it', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // A square of 120 pixels with a node in it (the lasso selects nodes), that starts where nothing
  // is under the pointer: a press on a feature may start a drag of one of its nodes.
  const target = await page.evaluate(() => {
    const { editor, gfx } = rapidContext.systems;
    const map = document.querySelector('.main-map').getBoundingClientRect();
    const canvas = document.querySelector('.main-map canvas').getBoundingClientRect();
    const boundary = gfx.pixi.renderer.events.rootBoundary;
    boundary.rootTarget = gfx.pixi.stage;
    const isEmpty = (x, y) => {
      for (let hit = boundary.hitTest(x - canvas.left, y - canvas.top); hit; hit = hit.parent) {
        if (hit.__feature__) return false;
      }
      return true;
    };

    const nodes = [];    // where each node is on the page
    for (const entity of editor.intersects()) {
      if (entity.type !== 'node') continue;
      const [x, y] = rapidContext.viewport.project(entity.loc);
      nodes.push({ id: entity.id, x: canvas.left + x, y: canvas.top + y });
    }
    for (let y = map.top + 150; y < map.bottom - 250; y += 20) {
      for (let x = map.left + 150; x < map.right - 250; x += 20) {
        if (!isEmpty(x, y)) continue;
        const inside = nodes.find(node => node.x > x + 20 && node.x < x + 100 && node.y > y + 20 && node.y < y + 100);
        if (inside) return { id: inside.id, x: x, y: y };
      }
    }
    return null;
  });
  expect(target).not.toBeNull();

  const lasso = () => page.evaluate(() => {
    const layer = rapidContext.systems.gfx.scene.layers.get('map-ui');
    const line = layer.lasso.children[0];
    const mesh = line?.children[0];
    return {
      visible: layer.lasso.visible,
      meshes: line?.children.length ?? 0,
      texture: mesh?.texture.label ?? null,
      closed: mesh?.strokeMesh?.closed ?? null,
      length: mesh?.strokeMesh?.length ?? 0
    };
  });
  expect((await lasso()).visible).toBe(false);

  // Shift-drag three sides of the square
  await page.keyboard.down('Shift');
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 120, target.y, { steps: 6 });
  await page.mouse.move(target.x + 120, target.y + 120, { steps: 6 });
  await page.mouse.move(target.x, target.y + 120, { steps: 6 });

  await expect.poll(async () => (await lasso()).visible).toBe(true);
  const dragged = await lasso();
  expect(dragged.meshes).toBe(1);
  expect(dragged.texture).toBe('dash-6,3');
  expect(dragged.closed).toBe(true);
  expect(dragged.length).toBeGreaterThan(0);

  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await lasso()).visible).toBe(false);
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toContain(target.id);
  await waitForIdle(page);
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
