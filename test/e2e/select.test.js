import { test, expect, locToPage, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


/**
 * What the glow of a hover draws: the pixels that change when the batches' shaders are told
 * that glows are dark, and where those are from a feature. (A glow that was in its batch and
 * drew nothing has happened, and every check of the scene's state passed.)
 * @param page - The page
 * @param featureID - The feature that glows
 * @param withPoints - Whether to count the glows of points too (an area's pin glows with it)
 * @return How many pixels changed (in CSS pixels), how many of them are yellower with the
 *   glow, how many are on each side of the feature's line, and how far from the feature
 *   (a line, a polygon's rings, or the middle of a pin's head) the furthest one is
 */
async function glowPixels(page, featureID, withPoints = true) {
  return page.evaluate(([featureID, withPoints]) => {
    const gfx = rapidContext.systems.gfx;
    const layer = gfx.scene.layers.get('osm');
    const feature = layer.features.get(featureID);
    const canvas = gfx.pixi.canvas;
    const lines = layer.batches.lines[0].shader.resources.lineUniforms.uniforms;
    const points = layer.batches.points[0].shader.resources.pointUniforms.uniforms;
    const pixels = glow => {
      lines.uGlow = glow;
      points.uPulse = withPoints ? glow : 1;
      gfx.pixi.renderer.render({ container: gfx.pixi.stage });
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      return context.getImageData(0, 0, copy.width, copy.height).data;
    };
    const lit = pixels(1);
    const dark = pixels(0);
    lines.uGlow = 1;
    points.uPulse = 1;

    // The feature on the canvas: the lines to measure from
    const k = canvas.width / gfx.surface.getBoundingClientRect().width;
    const position = feature.container.position;
    const onCanvas = (x, y) => {
      const at = gfx.origin.toGlobal({ x: x, y: y });
      return [at.x * k, at.y * k];
    };
    const paths = [];
    if (feature.type === 'Point') {
      const [x, y] = onCanvas(position.x, position.y);
      paths.push([[x, y - 14 * k], [x, y - 14 * k]]);       // a pin's head is above its point
    } else if (feature.type === 'LineString') {
      paths.push(feature.geometry.world.coords.map(coord => onCanvas(coord[0], coord[1])));
    } else {
      for (const ring of feature.geometry.local.flat) {
        const path = [];
        for (let i = 0; i < ring.length; i += 2) {
          path.push(onCanvas(position.x + ring[i], position.y + ring[i + 1]));
        }
        paths.push(path);
      }
    }

    let count = 0;
    let yellower = 0;
    let furthest = 0;
    const sides = [0, 0];
    for (let i = 0; i < lit.length; i += 4) {
      const change = Math.max(Math.abs(lit[i] - dark[i]), Math.abs(lit[i + 1] - dark[i + 1]), Math.abs(lit[i + 2] - dark[i + 2]));
      if (change < 40) continue;
      count++;
      if ((lit[i] + lit[i + 1] - 2 * lit[i + 2]) > (dark[i] + dark[i + 1] - 2 * dark[i + 2])) yellower++;
      const x = (i / 4) % canvas.width;
      const y = Math.floor(i / 4 / canvas.width);
      let nearest = Infinity;
      let side = 0;
      for (const path of paths) {
        for (let n = 0; n + 1 < path.length; n++) {
          const [ax, ay] = path[n];
          const dx = path[n + 1][0] - ax;
          const dy = path[n + 1][1] - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) || 1)));
          const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy);
          if (distance < nearest) {
            nearest = distance;
            side = (dx * (y - ay) - dy * (x - ax)) > 0 ? 1 : 0;
          }
        }
      }
      furthest = Math.max(furthest, nearest / k);
      sides[side]++;
    }
    return { count: count / (k * k), yellower: yellower / (k * k), sides: sides.map(n => n / (k * k)), furthest: furthest };
  }, [featureID, withPoints]);
}


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
    const feature = [...gfx.scene.layers.get('osm').features.values()].find(feature => feature.data?.id === wayID && feature.haloItems.length);
    if (!feature) return null;
    const batch = gfx.scene.layers.get('map-ui').haloBatch;

    // How far each of the halo's vertices is from the road, in screen pixels. (A vertex of a
    // line in a batch is 12 floats: first the point on the line that it's beside, from the
    // batch's place in the world.)
    const coords = feature.geometry.local.flat[0];
    const origin = feature.container.position;
    const scale = 2 ** (16 - rapidContext.viewport.transform.zoom);
    let min = Infinity;
    let max = 0;
    let numVertices = 0;
    const lines = [];
    for (const item of feature.haloItems) {
      const first = item.first * 12;
      lines.push({
        inHaloBatch: item.batch === batch,
        visible: item.visible,
        order: item.order,
        width: batch._floats[first + 10],
        color: Array.from(batch._bytes.subarray(item.first * 8, item.first * 8 + 3)),
        dash: Array.from(batch._bytes.subarray(item.first * 8 + 4, item.first * 8 + 8))
      });
      numVertices += item.count;
      for (let i = 0; i < item.count; i++) {
        const x = batch._floats[first + i * 12] + batch.position.x - origin.x;
        const y = batch._floats[first + i * 12 + 1] + batch.position.y - origin.y;
        let nearest = Infinity;
        for (let k = 0; k + 3 < coords.length; k += 2) {
          const dx = coords[k + 2] - coords[k];
          const dy = coords[k + 3] - coords[k + 1];
          const t = Math.max(0, Math.min(1, ((x - coords[k]) * dx + (y - coords[k + 1]) * dy) / (dx * dx + dy * dy)));
          nearest = Math.min(nearest, Math.hypot(x - coords[k] - t * dx, y - coords[k + 1] - t * dy));
        }
        min = Math.min(min, nearest / scale);
        max = Math.max(max, nearest / scale);
      }
    }
    return {
      parent: batch.parent.label,
      inScene: !!feature.container.parent,
      lines: lines,
      numVertices: numVertices,
      min: min,
      max: max,
      hitsBeside: feature.container.hitArea.contains(coords[0] + (coords[2] - coords[0]) / 3, coords[1] + (coords[3] - coords[1]) / 3)
    };
  }, road.id);

  expect(halo).not.toBeNull();
  expect(halo.parent).toBe('halo');
  expect(halo.inScene).toBe(false);      // the road is still its batches' to draw
  // An open line has one ring around it: a dark line, and yellow dashes over it. Both march:
  // a negative width says so to the batch's shader, which keeps them that many pixels wide.
  expect(halo.lines).toEqual([
    { inHaloBatch: true, visible: true, order: 0, width: -4, color: [0, 0, 0], dash: [0, 0, 0, 0] },
    { inHaloBatch: true, visible: true, order: 1, width: -2, color: [255, 255, 0], dash: [6, 3, 0, 0] }
  ]);
  expect(halo.numVertices).toBeGreaterThan(40);
  expect(halo.hitsBeside).toBe(true);
  // The ring that the halo's lines are along is one distance from the road, and that distance
  // is more than the 5 pixels the click was away.
  expect(halo.min).toBeGreaterThan(5);
  expect(halo.max - halo.min).toBeLessThan(1);

  // The dashes march: the scene is drawn again though nothing in it changes, and they've moved.
  await page.mouse.move(5, 5);     // (off the road: its hover would glow, and that moves too)
  await waitForIdle(page);
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const clip = { x: middle.x - 40, y: middle.y - 40, width: 80, height: 80 };
  const counts = () => page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    return { animated: gfx.scene.animated, animationDraws: gfx.animationDraws, frames: gfx.renderFrames.length, lastFrame: gfx.renderFrames.at(-1)?.frame };
  });
  const before = await counts();
  const shot1 = await page.screenshot({ clip: clip });
  await expect.poll(async () => (await counts()).animationDraws).toBeGreaterThan(before.animationDraws + 5);
  const shot2 = await page.screenshot({ clip: clip });
  const after = await counts();
  expect(before.animated).toBe(true);
  expect(after.lastFrame).toBe(before.lastFrame);      // no frame of the usual kind was drawn meanwhile
  expect(shot1.equals(shot2)).toBe(false);

  // ..unless the user asked their system for less motion: the halo is there, and holds still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await counts()).animated).toBe(false);
  const still = await counts();
  const shot3 = await page.screenshot({ clip: clip });
  const shot4 = await page.screenshot({ clip: clip });
  expect((await counts()).animationDraws).toBe(still.animationDraws);
  expect(shot3.equals(shot4)).toBe(true);

  // A halo's lines are as wide as they say whatever the map does to the lines of the roads:
  // in wireframe mode those are a pixel wide, and the halo has as many yellow pixels as before.
  const yellowPixels = () => page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    const canvas = gfx.pixi.canvas;
    gfx.pixi.renderer.render({ container: gfx.pixi.stage });
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] < 80) count++;
    }
    return count;
  });
  const yellow = await yellowPixels();
  expect(yellow).toBeGreaterThan(200);
  await page.evaluate(() => {
    rapidContext.systems.map.wireframeMode = true;
  });
  await waitForIdle(page);
  const yellowInWireframe = await yellowPixels();
  expect(yellowInWireframe).toBeGreaterThan(yellow * 0.8);
  expect(yellowInWireframe).toBeLessThan(yellow * 1.25);
  await page.evaluate(() => {
    rapidContext.systems.map.wireframeMode = false;
  });
  await waitForIdle(page);

  await page.emulateMedia({ reducedMotion: null });
  await expect.poll(async () => (await counts()).animationDraws).toBeGreaterThan(still.animationDraws);

  // Escape takes the halo away, its lines out of the batch, and the animation stops
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('browse');
  await waitForIdle(page);
  const left = await page.evaluate(() => rapidContext.systems.gfx.scene.layers.get('map-ui').haloBatch.size);
  expect(left).toBe(0);
  const idle = await counts();
  expect(idle.animated).toBe(false);
  const shot5 = await page.screenshot({ clip: clip });
  const shot6 = await page.screenshot({ clip: clip });
  expect((await counts()).animationDraws).toBe(idle.animationDraws);
  expect(shot5.equals(shot6)).toBe(true);
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
    return { id: way.id, nodes: way.nodes.length, loc: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ends: [a, b] };
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
      // The line's glow is a strip in a batch of its own, drawn after the level's strokes: the
      // line stays in its batches, out of the scene, and nothing has a filter.
      line: {
        glows: !!line.glowItem?.visible,
        glowOverStrokes: !!line.glowItem && line.glowItem.batch === line.batch.glows && line.batch.glows.parent === line.batch.parent && line.batch.glows.zIndex > line.batch.zIndex,
        strokes: line.batch.size,
        filters: line.container.filters?.length ?? 0,
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
  expect(hovered.line).toEqual({ glows: true, glowOverStrokes: true, strokes: expect.any(Number), filters: 0, drawsItself: false, inScene: false, shownInBatch: true });

  // The glow is drawn: yellow, on both sides of the road, and nowhere else
  const glow = await glowPixels(page, `osm-${road.id}-0`);
  expect(glow.count).toBeGreaterThan(300);
  expect(glow.yellower).toBeGreaterThan(glow.count * 0.95);
  expect(Math.min(...glow.sides)).toBeGreaterThan(glow.count * 0.3);
  expect(glow.furthest).toBeGreaterThan(8);      // it reaches 12 pixels from the road's edge
  expect(glow.furthest).toBeLessThan(25);

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
  expect(after.line).toEqual({ glows: false, glowOverStrokes: false, strokes: hovered.line.strokes, filters: 0, drawsItself: false, inScene: false, shownInBatch: true });

  await page.evaluate(() => rapidContext.systems.gfx.immediateRedraw());
  await waitForIdle(page);
  expect((await state()).shown).toEqual(after.shown);

  // For a user who asked their system for less motion, no frame follows the one that a hover
  // makes. So the glow has to be in that frame (the first thing in its batch, which drew
  // nothing until then), and gone in the one that the pointer's leaving makes.
  // These look at what's on the screen, and draw nothing themselves: a small square beside the
  // road, 9 pixels from its middle, on the side away from where the pointer goes to leave it.
  const [a, b] = await Promise.all(road.ends.map(loc => locToPage(page, loc)));
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  if (normal.x + normal.y < 0) normal = { x: -normal.x, y: -normal.y };
  const beside = { x: point.x + 9 * normal.x, y: point.y + 9 * normal.y };
  const yellowBeside = async () => {
    const png = (await page.screenshot({ clip: { x: beside.x - 4, y: beside.y - 4, width: 8, height: 8 } })).toString('base64');
    return page.evaluate(async png => {
      const image = new Image();
      await new Promise(resolve => {
        image.onload = resolve;
        image.src = `data:image/png;base64,${png}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 60 && data[i + 1] > 60 && data[i] - data[i + 2] > 50) count++;
      }
      return count;
    }, png);
  };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => rapidContext.systems.gfx.scene.animated)).toBe(false);
  const animationDraws = await page.evaluate(() => rapidContext.systems.gfx.animationDraws);
  expect(await yellowBeside()).toBe(0);

  // (The class is set here, not by the pointer: what follows a real hover asks for more
  // frames, and this is about there being one.)
  const framesAfter = change => page.evaluate(async ([wayID, change]) => {
    const gfx = rapidContext.systems.gfx;
    let frames = 0;
    const count = () => frames++;
    gfx.on('draw', count);
    if (change === 'set') {
      gfx.scene.setClass('hover', wayID);
    } else {
      gfx.scene.unsetClass('hover', wayID);
    }
    gfx.requestFrame();
    await new Promise(resolve => { setTimeout(resolve, 500); });
    gfx.off('draw', count);
    return frames;
  }, [road.id, change]);

  expect(await framesAfter('set')).toBe(1);
  expect(await yellowBeside()).toBeGreaterThan(40);     // of 64
  expect(await framesAfter('unset')).toBe(1);
  expect(await yellowBeside()).toBe(0);
  expect(await page.evaluate(() => rapidContext.systems.gfx.animationDraws)).toBe(animationDraws);
  await page.emulateMedia({ reducedMotion: null });

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


// A hovered area stays in its batches too. Its fill is tinted with the glow's color, and each
// of its rings has a glow in the batch that's drawn after the outlines'.
test('hovering an area tints its fill and draws a glow around its outline, in its batches', async ({ page, consoleErrors }) => {
  // The inspector shows what's hovered, and asks taginfo what values its fields can have. The
  // recording has the answers for a road's fields: none are needed here.
  await page.route(/^https:\/\/taginfo\.openstreetmap\.org\//, route => route.fulfill({ json: { data: [] } }));
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);
  await waitForIdle(page);

  // A building of some size, and the middle of one of its edges where nothing else is hit
  const area = await page.evaluate(() => {
    const gfx = rapidContext.systems.gfx;
    const scene = gfx.scene;
    const layer = scene.layers.get('osm');
    const rect = gfx.surface.getBoundingClientRect();
    const scale = 2 ** (rapidContext.viewport.transform.zoom - 16);
    for (const feature of layer.features.values()) {
      if (feature.type !== 'Polygon' || !feature.visible || !feature.fillBatch || !feature.data.tags?.building) continue;
      const [w, h] = feature.geometry.local.extent.dimensions();
      if (Math.max(w, h) * scale < 60 || Math.max(w, h) * scale > 300) continue;
      const ring = feature.geometry.local.flat[0];
      const position = feature.container.position;
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const at = gfx.origin.toGlobal({ x: position.x + (ring[i] + ring[i + 2]) / 2, y: position.y + (ring[i + 1] + ring[i + 3]) / 2 });
        if (at.x < 100 || at.y < 150 || at.x > rect.width - 100 || at.y > rect.height - 100) continue;
        if (scene.hitTest({ x: at.x, y: at.y }) !== feature) continue;
        return { id: feature.data.id, featureID: feature.id, rings: feature.geometry.local.flat.length, x: at.x + rect.left, y: at.y + rect.top };
      }
    }
    return null;
  });
  expect(area).not.toBeNull();

  const state = () => page.evaluate(featureID => {
    const layer = rapidContext.systems.gfx.scene.layers.get('osm');
    const feature = layer.features.get(featureID);
    const fill = feature.fillItem;
    // (A vertex of a fill is 8 bytes: its color first.)
    const color = fill ? Array.from(feature.fillBatch._bytes.subarray(fill.first * 8, fill.first * 8 + 3)) : null;
    return {
      classes: [...feature.classes],
      fillColor: color,
      glows: feature.glowItems.map(item => item.visible && item.batch === feature.strokeBatch.glows),
      outlines: feature.strokeBatch.size,
      filters: feature.container.filters?.length ?? 0,
      inScene: !!feature.container.parent,
      children: feature.container.children.length,
      dirty: feature.dirty
    };
  }, area.featureID);

  const before = await state();
  expect(before).toMatchObject({ classes: [], glows: [], filters: 0, inScene: false, children: 0, dirty: false });
  expect(before.fillColor).not.toBeNull();

  await page.mouse.move(area.x - 3, area.y - 3);
  await page.mouse.move(area.x, area.y);
  await expect.poll(() => page.evaluate(() => [...rapidContext.systems.gfx.scene.getDataWithClass('hover')])).toEqual([area.id]);
  await waitForIdle(page);

  const hovered = await state();
  expect(hovered).toMatchObject({ classes: ['hover'], glows: Array(area.rings).fill(true), filters: 0, inScene: false, children: 0, dirty: false });
  // The fill is halfway to the glow's yellow: more red and green, less blue (or as little)
  expect(hovered.fillColor[0]).toBeGreaterThan(before.fillColor[0]);
  expect(hovered.fillColor[1]).toBeGreaterThan(before.fillColor[1]);
  expect(hovered.fillColor[2]).toBeLessThanOrEqual(before.fillColor[2]);

  // The glow is drawn: yellow, on both sides of the outline, and nowhere else
  const glow = await glowPixels(page, area.featureID, false);
  expect(glow.count).toBeGreaterThan(1000);
  expect(glow.yellower).toBeGreaterThan(glow.count * 0.95);
  expect(Math.min(...glow.sides)).toBeGreaterThan(glow.count * 0.25);
  expect(glow.furthest).toBeGreaterThan(8);
  expect(glow.furthest).toBeLessThan(20);

  // Off the map: everything is as it was
  await page.evaluate(() => {
    const scene = rapidContext.systems.gfx.scene;
    scene.clearClass('hover');
    rapidContext.systems.gfx.requestFrame();
  });
  await waitForIdle(page);
  expect(await state()).toEqual(before);
  expect((await glowPixels(page, area.featureID)).count).toBe(0);

  expect(consoleErrors).toEqual([]);
});


// A point's marker and icon are rectangles in the layer's batch of points, and the point isn't
// in the scene. The glow of a hovered point is one more picture there, under the others, which
// the batch's shader makes brighter and darker with the clock. A selected point's halo is lines
// in the map UI's batch, around where the point is.
test('draws a hovered point in its batch, over a glow, and a selected one inside a halo', async ({ page, consoleErrors }) => {
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
    const layer = gfx.scene.layers.get('osm');
    const feature = layer.features.get(featureID);
    const item = feature.item;
    const batch = layer.batches.points[0];
    // (A vertex of a point in a batch is 8 bytes: the seventh says whether its picture pulses.)
    const glow = feature.glowItem;
    return {
      classes: [...feature.classes].sort(),
      filters: feature.container.filters?.length ?? 0,
      sprites: [feature.glow, feature.marker, feature.icon].filter(Boolean).length,
      inScene: !!feature.container.parent,
      shownInBatch: !!item?.visible,
      pictures: item ? item.count / 4 : 0,
      // The glow is in a batch of its own, drawn under the points: a picture that pulses
      glow: !!glow && glow.visible && glow.batch === batch.glows && glow.count === 4 && batch.glows._bytes[glow.first * 8 + 6] === 255,
      glowsUnderPoints: batch.glows.parent === batch.parent && batch.glows.zIndex < batch.zIndex,
      glows: batch.glows.size,
      halo: feature.haloItems.length,
      dirty: feature.dirty
    };
  }, pin.featureID);
  // In the batch: a pin and its icon, whatever its classes
  const IN_BATCH = { filters: 0, sprites: 0, inScene: false, shownInBatch: true, pictures: 2, glowsUnderPoints: true, dirty: false };
  const PLAIN = { glow: false, glows: 0 };
  const GLOWING = { glow: true, glows: 1 };

  // How large the halo is on screen: the box of its lines, in pixels
  const haloSize = () => page.evaluate(featureID => {
    const gfx = rapidContext.systems.gfx;
    const feature = gfx.scene.layers.get('osm').features.get(featureID);
    const batch = gfx.scene.layers.get('map-ui').haloBatch;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of feature.haloItems) {
      for (let i = 0; i < item.count; i++) {
        const at = gfx.origin.toGlobal({ x: batch._floats[(item.first + i) * 12] + batch.position.x, y: batch._floats[(item.first + i) * 12 + 1] + batch.position.y });
        minX = Math.min(minX, at.x);
        minY = Math.min(minY, at.y);
        maxX = Math.max(maxX, at.x);
        maxY = Math.max(maxY, at.y);
      }
    }
    const point = gfx.origin.toGlobal({ x: feature.container.position.x, y: feature.container.position.y });
    return { width: maxX - minX, height: maxY - minY, aroundPoint: minX < point.x && maxX > point.x && minY < point.y && maxY >= point.y - 0.01 };
  }, pin.featureID);

  expect(await state()).toEqual({ classes: [], halo: 0, ...PLAIN, ...IN_BATCH });
  expect((await glowPixels(page, pin.featureID)).count).toBe(0);

  // Hovered: the pointer is over the pin's head, above the point itself
  const point = await locToPage(page, pin.loc);
  await page.mouse.move(point.x - 60, point.y - 60);
  await page.mouse.move(point.x, point.y - 12, { steps: 5 });
  await expect.poll(() => page.evaluate(() => [...rapidContext.systems.gfx.scene.getDataWithClass('hover')])).toEqual([pin.id]);
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: ['hover'], halo: 0, ...GLOWING, ...IN_BATCH });

  // The glow is drawn: yellow, around the pin's head, and not over the pin
  const glow = await glowPixels(page, pin.featureID);
  expect(glow.count).toBeGreaterThan(300);
  expect(glow.yellower).toBeGreaterThan(glow.count * 0.95);
  expect(glow.furthest).toBeGreaterThan(14);
  expect(glow.furthest).toBeLessThan(30);

  // ..and it breathes: frames are drawn though nothing changes
  const animationDraws = () => page.evaluate(() => rapidContext.systems.gfx.animationDraws);
  const drawn = await animationDraws();
  await expect.poll(animationDraws).toBeGreaterThan(drawn + 5);

  // Selected, and still hovered
  await page.mouse.click(point.x, point.y - 12);
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toEqual([pin.id]);
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: ['hover', 'select'], halo: 2, ...GLOWING, ...IN_BATCH });

  // Selected, with the pointer somewhere else: the glow is gone, and the halo stays
  await page.mouse.move(point.x - 60, point.y - 60, { steps: 5 });
  await expect.poll(() => page.evaluate(id => rapidContext.systems.gfx.scene.getDataWithClass('hover').has(id), pin.id)).toBe(false);
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: ['select'], halo: 2, ...PLAIN, ...IN_BATCH });
  expect((await glowPixels(page, pin.featureID)).count).toBe(0);

  // The halo is around the pin, and as large on screen after a zoom, which changes nothing in
  // the points' batch
  const size = await haloSize();
  expect(size.aroundPoint).toBe(true);
  expect(size.width).toBeGreaterThan(15);
  expect(size.height).toBeGreaterThan(20);
  await page.evaluate(() => {
    rapidContext.systems.map.zoom(18.6);
  });
  await waitForIdle(page);
  const zoomed = await haloSize();
  expect(zoomed.width).toBeCloseTo(size.width, 1);
  expect(zoomed.height).toBeCloseTo(size.height, 1);
  expect(zoomed.aroundPoint).toBe(true);
  expect(await state()).toEqual({ classes: ['select'], halo: 2, ...PLAIN, ...IN_BATCH });

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => rapidContext.mode.id)).toBe('browse');
  await waitForIdle(page);
  expect(await state()).toEqual({ classes: [], halo: 0, ...PLAIN, ...IN_BATCH });

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
