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
