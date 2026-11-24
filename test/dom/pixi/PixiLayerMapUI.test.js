import * as PIXI from 'pixi.js';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { PixiLayerMapUI } from '../../../modules/pixi/PixiLayerMapUI.ts';
import { geomStrokeMesh } from '../../../modules/geo/stroke.ts';


// The layer needs a scene with Pixi's groups, so these call the methods that don't.
describe('PixiLayerMapUI', () => {
  const HALO = { width: 2, minWidth: 2, color: 0xffff00, alpha: 1, dash: [6, 3], marches: true };

  // What the methods use of a layer
  let layer;
  beforeEach(() => {
    layer = { halo: new PIXI.Container(), _haloBatch: null };
  });
  afterEach(() => {
    layer.halo?.destroy({ children: true });
  });

  const haloBatchAt = (x, y) => PixiLayerMapUI.prototype.haloBatchAt.call(layer, x, y);
  const moveHaloOrigin = viewport => PixiLayerMapUI.prototype._moveHaloOrigin.call(layer, viewport);

  // A viewport whose middle is at a place in the world
  const viewportAt = (zoom, x, y) => ({
    transform: { zoom: zoom },
    center: () => [400, 300],
    screenToWorld: () => [x, y]
  });


  // Every layer's features draw the halos of what's selected in one batch of lines, above
  // everything on the map.
  describe('haloBatchAt', () => {
    it('makes one batch in the halo container, where the first halo is', () => {
      const batch = haloBatchAt(10000, 20000);
      assert.instanceOf(batch, LineBatchMesh);
      assert.strictEqual(batch.parent, layer.halo);
      assert.deepEqual([batch.position.x, batch.position.y], [10000, 20000]);
      assert.strictEqual(layer._haloBatch, batch);
    });

    it('gives the same batch for every halo after that, where it is', () => {
      const batch = haloBatchAt(10000, 20000);
      assert.strictEqual(haloBatchAt(50000, 60000), batch);
      assert.deepEqual([batch.position.x, batch.position.y], [10000, 20000]);
      assert.strictEqual(layer.halo.children.length, 1);
    });

    it('makes another when the one it had was destroyed', () => {
      const batch = haloBatchAt(0, 0);
      batch.destroy();
      const next = haloBatchAt(5, 5);
      assert.notStrictEqual(next, batch);
      assert.isFalse(next.destroyed);
      assert.strictEqual(next.parent, layer.halo);
    });

    it('gives none before the layer has its containers', () => {
      layer.halo.destroy();
      layer.halo = null;
      assert.isNull(haloBatchAt(0, 0));
      assert.isNull(layer._haloBatch);
    });
  });


  // A batch's coordinates are 32-bit floats from the batch's place in the world. The place
  // follows the view when the view has gone far, so that the halos stay fine enough to draw.
  describe('_moveHaloOrigin', () => {
    const square = geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10], { closed: true });

    it('leaves the batch where it is while the view is near', () => {
      const batch = haloBatchAt(10000, 20000);
      const item = batch.add(square, 0, 0, HALO);
      const x = batch._floats[item.first * 12];

      moveHaloOrigin(viewportAt(16, 10000 + 200000, 20000 - 200000));     // a quarter of a million pixels away, at zoom 16
      assert.deepEqual([batch.position.x, batch.position.y], [10000, 20000]);
      assert.strictEqual(batch._floats[item.first * 12], x);
    });

    it('moves the batch to the view when the view has gone far, and keeps the halos where they are in the world', () => {
      const batch = haloBatchAt(10000, 20000);
      const item = batch.add(square, 100, 50, HALO);     // at 10100, 20050 in the world
      const worldX = i => batch.position.x + batch._floats[(item.first + i) * 12];
      const worldY = i => batch.position.y + batch._floats[(item.first + i) * 12 + 1];
      const before = Array.from({ length: item.count }, (_, i) => [worldX(i), worldY(i)]);

      moveHaloOrigin(viewportAt(16, 10000 + 300000.4, 20000));
      assert.deepEqual([batch.position.x, batch.position.y], [310000, 20000], 'whole numbers, at the middle of the view');
      for (let i = 0; i < item.count; i++) {
        assert.closeTo(worldX(i), before[i][0], 0.05);
        assert.closeTo(worldY(i), before[i][1], 0.05);
      }
    });

    it('moves it sooner the further the view is zoomed in: a pixel is less of the world there', () => {
      const batch = haloBatchAt(0, 0);
      moveHaloOrigin(viewportAt(16, 0, 100000));
      assert.strictEqual(batch.position.y, 0, 'at zoom 16, not yet');
      moveHaloOrigin(viewportAt(20, 0, 100000));
      assert.strictEqual(batch.position.y, 100000, 'at zoom 20, where a pixel is a sixteenth of a unit');
    });

    it('does nothing without a batch, or with one that was destroyed', () => {
      assert.doesNotThrow(() => moveHaloOrigin(viewportAt(16, 1e7, 1e7)));
      const batch = haloBatchAt(0, 0);
      batch.destroy();
      assert.doesNotThrow(() => moveHaloOrigin(viewportAt(16, 1e7, 1e7)));
    });
  });
});
