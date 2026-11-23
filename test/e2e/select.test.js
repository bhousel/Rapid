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
    // (A line that its batches draw isn't in the scene: it has no parent.)
    const parentOf = feature => feature.container.parent?.label ?? 'not in the scene';
    const line = layer.features.get(`osm-${wayID}-0`);
    return {
      hovered: shown.filter(feature => feature.classes.has('hover')).map(feature => feature.data.id),
      verticesOnTop: shown.filter(feature => parentOf(feature) === 'selected').length,
      // A vertex that's drawn above everything draws itself there, with sprites; the batch draws the others
      verticesOnTopInBatch: shown.filter(feature => parentOf(feature) === 'selected' && (feature.item || !feature.marker)).length,
      pointsDrawnTwice: shown.filter(feature => feature.type === 'Point' && feature.item?.visible && feature.marker).length,
      pointsDrawnNowhere: shown.filter(feature => feature.type === 'Point' && !feature.item?.visible && !(feature.marker && feature.container.parent)).length,
      dirty: shown.filter(feature => feature.dirty).length,
      shown: shown.map(feature => `${feature.id} in ${parentOf(feature)} ${[...feature.classes]}`).sort(),
      // The line's glow is a filter on its container, so the line is drawn there while it glows
      // (by meshes of its own, in the scene), and by its batches the rest of the time.
      line: {
        glows: (line.container.filters?.length ?? 0) > 0,
        drawsItself: !!line.stroke?.strokeMesh?.vertexCount,
        inScene: !!line.container.parent,
        shownInBatch: !!line.strokeItem?.visible
      }
    };
  }, road.id);

  const hovered = await state();
  expect(hovered.hovered).toEqual([road.id]);
  expect(hovered.verticesOnTop).toBe(road.nodes);
  expect(hovered.verticesOnTopInBatch).toBe(0);
  expect(hovered.pointsDrawnTwice).toBe(0);
  expect(hovered.pointsDrawnNowhere).toBe(0);
  expect(hovered.dirty).toBe(0);
  expect(hovered.line).toEqual({ glows: true, drawsItself: true, inScene: true, shownInBatch: false });

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
  expect(after.pointsDrawnTwice).toBe(0);
  expect(after.pointsDrawnNowhere).toBe(0);
  expect(after.shown).not.toEqual(hovered.shown);
  expect(after.line).toEqual({ glows: false, drawsItself: false, inScene: false, shownInBatch: true });

  await page.evaluate(() => rapidContext.systems.gfx.immediateRedraw());
  await waitForIdle(page);
  expect((await state()).shown).toEqual(after.shown);

  // Pixi isn't asked to tell every object about every pointer move
  const features = await page.evaluate(() => ({ ...rapidContext.systems.gfx.pixi.renderer.events.features }));
  expect(features).toEqual({ move: true, globalMove: false, click: true, wheel: false });

  // ..and none of Pixi's tickers runs a loop of its own. Its events ticker (which sends pointer
  // moves again for objects that move under a still pointer) is gone, and its scheduler, which
  // frees GPU resources that went unused, gets its turns from Rapid's frame loop.
  const tickers = await page.evaluate(async () => {
    const listeners = ticker => {
      const names = [];
      for (let listener = ticker._head.next; listener; listener = listener.next) {
        names.push(listener._context?.constructor?.name ?? 'unknown');
      }
      return names;
    };
    const scheduler = rapidContext.systems.gfx.pixi.renderer.scheduler;
    let task;
    const turns = await new Promise(resolve => {
      task = scheduler.repeat(() => resolve(1), 0, false);
      setTimeout(() => resolve(0), 5000);
    });
    scheduler.cancel(task);
    return {
      systemStarted: PIXI.Ticker.system.started,
      sharedStarted: PIXI.Ticker.shared.started,
      systemListeners: listeners(PIXI.Ticker.system),
      schedulerGotATurn: turns > 0
    };
  });
  expect(tickers.systemStarted).toBe(false);
  expect(tickers.sharedStarted).toBe(false);
  expect(tickers.systemListeners).not.toContain('EventsTickerClass');
  expect(tickers.systemListeners.length).toBeGreaterThan(0);    // Pixi's scheduler
  expect(tickers.schedulerGotATurn).toBe(true);

  expect(consoleErrors).toEqual([]);
});


// A point's marker and icon are rectangles in the layer's batch of points, and the point isn't
// in the scene. A glow is a filter on a container, so a hovered point draws itself, with
// sprites, in the scene, while it's hovered. A selected point's halo is drawn around the batch's point.
test('draws a hovered point itself, under a glow, and gives it back to the batch after', async ({ page, consoleErrors }) => {
  // The inspector asks taginfo what values a selected point's fields can have. Which keys
  // depends on the point, and the recording has the answers for a road's: none are needed here.
  await page.route(/^https:\/\/taginfo\.openstreetmap\.org\//, route => route.fulfill({ json: { data: [] } }));
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // A pin with nothing else within reach of the pointer
  const pin = await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    const layer = gfx.scene.layers.get('osm');
    const rect = gfx.surface.getBoundingClientRect();
    const onScreen = feature => gfx.origin.toGlobal({ x: feature.container.position.x, y: feature.container.position.y });
    const points = [...layer.features.values()].filter(feature => feature.type === 'Point' && feature.visible);
    const pins = points.filter(feature => feature.data.type === 'node' && feature.style.marker.image === 'pin' && feature.item?.count === 8);
    const alone = pins.find(feature => {
      const at = onScreen(feature);
      if (at.x < 100 || at.y < 150 || at.x > rect.width - 100 || at.y > rect.height - 100) return false;
      return points.every(other => other === feature || Math.hypot(onScreen(other).x - at.x, onScreen(other).y - at.y) > 45);
    });
    return alone && { id: alone.data.id, featureID: alone.id, loc: alone.data.loc };
  });
  expect(pin).toBeTruthy();

  const state = () => page.evaluate(featureID => {
    const gfx = rapidContext.systems.gfx;
    const feature = gfx.scene.layers.get('osm').features.get(featureID);
    return {
      classes: [...feature.classes].sort(),
      glows: (feature.container.filters?.length ?? 0) > 0,
      sprites: [feature.marker, feature.icon].filter(sprite => sprite?.visible && sprite.texture.source.pixelWidth > 1).length,
      inScene: !!feature.container.parent,
      shownInBatch: !!feature.item?.visible,
      halo: !!feature.halo?.parent,
      dirty: feature.dirty
    };
  }, pin.featureID);
  const IN_BATCH = { glows: false, sprites: 0, inScene: false, shownInBatch: true, dirty: false };
  const ITSELF = { glows: true, sprites: 2, inScene: true, shownInBatch: false, dirty: false };

  expect(await state()).toEqual({ classes: [], halo: false, ...IN_BATCH });

  // Hovered: the pointer is over the pin's head, above the point itself
  const point = await locToPage(page, pin.loc);
  await page.mouse.move(point.x - 60, point.y - 60);
  await page.mouse.move(point.x, point.y - 12, { steps: 5 });
  await expect.poll(() => page.evaluate(() => [...rapidContext.systems.gfx.scene.getDataWithClass('hover')])).toEqual([pin.id]);
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: ['hover'], halo: false, ...ITSELF });

  // Selected, and still hovered
  await page.mouse.click(point.x, point.y - 12);
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toEqual([pin.id]);
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: ['hover', 'select'], halo: true, ...ITSELF });

  // Selected, with the pointer somewhere else: the batch draws it, and the halo stays
  await page.mouse.move(point.x - 60, point.y - 60, { steps: 5 });
  await expect.poll(() => page.evaluate(id => rapidContext.systems.gfx.scene.getDataWithClass('hover').has(id), pin.id)).toBe(false);
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: ['select'], halo: true, ...IN_BATCH });

  // The halo follows a zoom, which changes nothing in the batch
  const haloScale = () => page.evaluate(featureID => {
    const feature = rapidContext.systems.gfx.scene.layers.get('osm').features.get(featureID);
    return feature.halo.scale.x * rapidContext.systems.gfx.origin.scale.x;
  }, pin.featureID);
  expect(await haloScale()).toBeCloseTo(1, 6);
  await page.evaluate(() => {
    rapidContext.systems.map.zoom(18.6);
  });
  await waitForIdle(page);
  expect(await haloScale()).toBeCloseTo(1, 6);
  expect(await state()).toEqual({ classes: ['select'], halo: true, ...IN_BATCH });

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('browse');
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: [], halo: false, ...IN_BATCH });

  expect(consoleErrors).toEqual([]);
});


// The OSM layer finds its own features under the pointer, through the editor's spatial index
// (`PixiLayerOsm.hitTest`), and Pixi's hit test leaves the layer's containers out. Pixi's would
// ask every feature in the scene, and a feature that's drawn in batches isn't even in the
// scene. The index must find what asking every feature would. A point answers from where it is
// on screen, without Pixi: it must be hit where Pixi would hit it if it were drawn with sprites.
test('finds the feature under the pointer through the spatial index, as asking every feature would', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // What's under each point of a grid over the map, each way
  const compare = () => page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    const scene = gfx.scene;
    const osm = scene.layers.get('osm');
    const boundary = gfx.pixi.renderer.events.rootBoundary;
    boundary.rootTarget = gfx.pixi.stage;
    const rect = gfx.surface.getBoundingClientRect();

    const featureOf = container => {
      for (let c = container; c; c = c.parent) {
        if (c.__feature__) return c.__feature__;
      }
      return null;
    };

    // Where something is drawn: its place among its parent's children, from the stage down.
    // (A feature is drawn by its own container, or a line by its batch, in its order there.)
    const placeOf = feature => {
      const path = [];
      for (let c = feature.sceneContainer; c.parent; c = c.parent) {
        path.unshift(c.parent.children.indexOf(c));
      }
      path.push(feature.sceneOrder);
      return path;
    };
    const isLater = (a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined) return false;
        if (b[i] === undefined) return true;
        if (a[i] !== b[i]) return a[i] > b[i];
      }
      return false;
    };

    const points = [];
    for (let j = 0; j < 30; j++) {
      for (let i = 0; i < 40; i++) {
        points.push({ x: (i + 0.5) * rect.width / 40, y: (j + 0.5) * rect.height / 30 });
      }
    }

    const skipped = scene.getSpatialContainer('basemap', 'osm').eventMode;
    const found = points.map(point => scene.hitTest(point, boundary.hitTest(point.x, point.y)));

    // Asking every feature of the layer, and taking the one that's drawn last
    const features = [...osm.features.values()].filter(feature => feature.visible);
    const places = new Map(features.map(feature => [feature, placeOf(feature)]));
    const asked = points.map(point => {
      const world = gfx.origin.worldTransform.applyInverse(point);
      let best = null;
      for (const feature of features) {
        if (!feature.hitTest(point, world)) continue;
        if (!best || isLater(places.get(feature), places.get(best))) best = feature;
      }
      return best;
    });

    // On a finer grid: every point that's hit at each place, and what Pixi finds there among
    // the features that are in the scene (none, unless the layer draws with sprites: see below)
    const finer = [];
    for (let j = 0; j < 90; j++) {
      for (let i = 0; i < 120; i++) {
        finer.push({ x: (i + 0.5) * rect.width / 120, y: (j + 0.5) * rect.height / 90 });
      }
    }
    const pointFeatures = features.filter(feature => feature.type === 'Point');
    const pointsHit = finer.map(place => {
      const world = gfx.origin.worldTransform.applyInverse(place);
      return pointFeatures.filter(feature => feature.hitTest(place, world)).map(feature => feature.id);
    });
    scene.setHitTester('osm', null);
    const pixiFound = finer.map(place => featureOf(boundary.hitTest(place.x, place.y)));
    scene.setHitTester('osm', osm);

    const lines = features.filter(feature => feature.type === 'LineString');
    return {
      skipped: skipped,
      differences: found.flatMap((feature, i) => (feature === asked[i]) ? [] : [{ at: points[i], found: feature?.id, asked: asked[i]?.id }]),
      pointsHit: pointsHit,
      pixiPoints: pixiFound.map(feature => (feature?.type === 'Point') ? feature.id : null),
      pointsInScene: pointFeatures.filter(feature => feature.container.parent).length,
      pointsFound: new Set(found.filter(feature => feature?.type === 'Point')).size,
      numFound: found.filter(Boolean).length,
      kinds: [...new Set(found.filter(Boolean).map(feature => feature.type))].sort(),
      linesFound: new Set(found.filter(feature => feature?.type === 'LineString')).size,
      linesNotInScene: lines.filter(feature => !feature.container.parent).length,
      linesFoundNotInScene: new Set(found.filter(feature => feature?.type === 'LineString' && !feature.container.parent)).size
    };
  });

  const browsing = await compare();
  expect(browsing.skipped).toBe('none');
  expect(browsing.differences).toEqual([]);
  expect(browsing.pointsInScene).toBe(0);                                // the batch draws them all
  expect(browsing.pointsFound).toBeGreaterThan(20);
  expect(browsing.numFound).toBeGreaterThan(300);                        // of 1,200 points
  expect(browsing.kinds).toEqual(['LineString', 'Point', 'Polygon']);    // all three kinds were under some point
  expect(browsing.linesNotInScene).toBeGreaterThan(10);
  expect(browsing.linesFoundNotInScene).toBeGreaterThan(10);            // lines are found without being in the scene

  // Drawn with sprites and not by batches, the points are in the scene, and Pixi's hit test
  // finds the top one at each place. A point that the batch draws must be hit in the same
  // places: where Pixi finds a point, it's one of those hit there, and where Pixi finds none,
  // none is. (Which of several is on top can differ: sprites are ordered within a map tile.)
  const useBatches = async val => {
    await page.evaluate(val => {
      const gfx = rapidContext.systems.gfx;
      const osm = gfx.scene.layers.get('osm');
      osm.useBatches = val;
      osm.reset();
      gfx.immediateRedraw();
    }, val);
    await waitForIdle(page);
  };
  await useBatches(false);
  const sprites = await compare();
  expect(sprites.differences).toEqual([]);
  expect(sprites.pointsInScene).toBeGreaterThan(20);
  expect(sprites.pixiPoints.filter(Boolean).length).toBeGreaterThan(200);    // of 10,800 places
  const hitElsewhere = [];
  sprites.pixiPoints.forEach((pixiID, i) => {
    const hit = browsing.pointsHit[i];
    if (pixiID ? !hit.includes(pixiID) : hit.length > 0) hitElsewhere.push({ place: i, pixi: pixiID, batch: hit });
  });
  expect(hitElsewhere).toEqual([]);
  await useBatches(true);

  // With a road selected, its vertices and midpoints are drawn above everything, where Pixi finds them
  const roadID = await page.evaluate(() => {
    const editor = rapidContext.systems.editor;
    const way = editor.intersects().find(entity => entity.type === 'way' && entity.tags.name === 'East Bennett Street');
    rapidContext.enter('select', { selection: [way.dataID] });
    return way.id;
  });
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toEqual([roadID]);
  await waitForIdle(page);

  const selected = await compare();
  expect(selected.differences).toEqual([]);
  expect(selected.numFound).toBeGreaterThan(300);
  expect(consoleErrors).toEqual([]);
});
