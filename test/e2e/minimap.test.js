import { test, expect, startRapid, waitForIdle, TEST_MAP } from './fixtures.js';


// The minimap draws the background imagery into a canvas of its own, with the same Pixi renderer
// as the main map. Its tiles are drawn in world coordinates, like the main map's, under an origin
// that maps them to its canvas (see `UiMinimap._updateOrigin`).
test('draws the minimap\'s imagery where its canvas shows it', async ({ page, consoleErrors }) => {
  await startRapid(page, TEST_MAP);
  await waitForIdle(page);

  await page.evaluate(() => rapidContext.systems.ui.Minimap.toggle());

  // The tests' imagery is a transparent pixel, so look at where the tiles are, not at the canvas:
  // some tile covers the middle of the canvas, where the main map's view is.
  const coveringMiddle = () => page.evaluate(() => {
    const minimap = rapidContext.systems.ui.Minimap;
    const canvas = minimap.$surface.node();
    const [x, y] = [canvas.clientWidth / 2, canvas.clientHeight / 2];
    const sprites = [];
    minimap.stage.children.forEach(function walk(child) {
      if (child.texture) sprites.push(child);
      child.children?.forEach(walk);
    });
    return sprites.filter(sprite => {
      const b = sprite.getBounds();
      return b.minX <= x && x <= b.maxX && b.minY <= y && y <= b.maxY;
    }).length;
  });
  await expect.poll(coveringMiddle).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
