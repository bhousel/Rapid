import * as PIXI from 'pixi.js';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { PixiLayerMapUI } from '../../../modules/pixi/PixiLayerMapUI.ts';
import { BatchShaders } from '../../../modules/pixi/lib/BatchShaders.ts';


// The layer needs a scene with Pixi's groups, so these call the methods that don't.
describe('PixiLayerMapUI', () => {
  // What the methods use of a layer
  let layer;
  beforeEach(() => {
    layer = { scene: { batchShaders: new BatchShaders() }, halo: new PIXI.Container(), _haloBatch: null };
  });
  afterEach(() => {
    layer.halo?.destroy({ children: true });
  });

  const haloBatchAt = (x, y) => PixiLayerMapUI.prototype.haloBatchAt.call(layer, x, y);


  // Every layer's features draw the halos of what's selected in one batch of lines, above
  // everything on the map.
  describe('haloBatchAt', () => {
    it('makes one batch in the halo container, where the first halo is', () => {
      const batch = haloBatchAt(10000, 20000);
      assert.instanceOf(batch, LineBatchMesh);
      assert.strictEqual(batch.shader, layer.scene.batchShaders.lines);
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
});
