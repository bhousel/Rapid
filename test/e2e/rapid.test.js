import { test, expect, locToPage, startRapid, waitForIdle, waitForOsmData, TEST_MAP } from './fixtures.js';

// A Rapid dataset with one sidewalk, in an empty spot near `TEST_MAP`.
// Its data comes from the dev server, which serves the whole repo.
const DATASET = {
  assetID: 'e2e_datasets',
  scopes: [{
    scope: '*',
    datasets: {
      e2e_paths: {
        label: 'E2E paths',
        color: '#ff00ff',
        sourceUrl: '/test/e2e/data/paths.geojson',   // made absolute in the page
        conflated: false,
        dictionary: {
          transforms: [
            { order: 0, function: 'ignore', source: 'id', isID: true },
            { order: 1, function: 'copy', source: 'highway', target: 'highway' },
            { order: 2, function: 'copy', source: 'footway', target: 'footway' }
          ]
        }
      }
    }
  }]
};
const SIDEWALK_MIDDLE = [-85.632635, 41.948896];


test('shows a Rapid dataset, and adds a feature from it to OSM', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForOsmData(page);

  await page.evaluate(dataset => {
    const rapid = rapidContext.systems.rapid;
    const ds = dataset.scopes[0].datasets.e2e_paths;
    ds.sourceUrl = new URL(ds.sourceUrl, location.origin).href;
    rapid.merge(dataset);
    rapid.enableDatasets('e2e_paths');
  }, DATASET);

  // The sidewalk is drawn on the map
  await expect.poll(() => page.evaluate(() => rapidContext.systems.gfx.scene.layers.get('rapid').features.size))
    .toBeGreaterThan(0);
  await waitForIdle(page);

  // It's drawn by the layer's batches, not in Pixi's scene: the layer finds it under the pointer itself
  const drawn = await page.evaluate(() => {
    const features = [...rapidContext.systems.gfx.scene.layers.get('rapid').features.values()].filter(f => f.visible);
    return features.map(f => ({ batched: f.sceneContainer !== f.container, inScene: !!f.container.parent }));
  });
  expect(drawn.length).toBeGreaterThan(0);
  expect(drawn.every(f => f.batched && !f.inScene)).toBe(true);

  // A frame that only moves the view a little, inside the cull box, leaves the layer's features as they are
  const kept = await page.evaluate(async () => {
    const { gfx, map } = rapidContext.systems;
    const before = gfx.lastRenderFrame.id;
    map.pan([20, 0]);
    while (gfx.lastRenderFrame.id === before) await new Promise(resolve => { requestAnimationFrame(resolve); });
    return gfx.lastRenderFrame.layers.get('rapid').kept;
  });
  expect(kept).toBe(true);
  await waitForIdle(page);

  // Clicking it selects it, and the sidebar offers to add it
  const point = await locToPage(page, SIDEWALK_MIDDLE);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => rapidContext.selectedIDs())).toEqual(['e2e_paths:1']);

  await page.locator('.sidebar').getByRole('button', { name: 'Add This Feature' }).click();

  // Now it's a new OSM way, with the tags from the dataset
  await expect.poll(() => page.evaluate(() => rapidContext.systems.rapid.isAcceptedOrIgnored('e2e_paths:1'))).toBe(true);
  const added = await page.evaluate(() => {
    const editor = rapidContext.systems.editor;
    const ways = editor.intersects().filter(entity => entity.type === 'way' && entity.isNew());
    return ways.map(way => ({ tags: way.tags, nodes: way.nodes.length }));
  });
  expect(added).toEqual([{ tags: { highway: 'footway', footway: 'sidewalk' }, nodes: 2 }]);

  // ..and the Rapid layer doesn't show it anymore, though it keeps its features while the view
  // doesn't change: accepting it asks the layer for a redraw
  await expect.poll(() => page.evaluate(() => {
    const layer = rapidContext.systems.gfx.scene.layers.get('rapid');
    return [...layer.features.values()].filter(f => f.visible && f.data?.dataID === 'e2e_paths:1').length;
  })).toBe(0);

  expect(consoleErrors).toEqual([]);
});
