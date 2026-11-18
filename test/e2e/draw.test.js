import { test, expect, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';


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
  const nodeCount = id => page.evaluate(id => rapidContext.systems.editor.staging.graph.hasEntity(id)?.nodes.length ?? 0, id);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => nodeCount(line.id)).toBe(2);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => nodeCount(line.id)).toBe(0);
  expect(await page.evaluate(() => rapidContext.systems.editor.hasChanges())).toBe(false);

  expect(consoleErrors).toEqual([]);
});
