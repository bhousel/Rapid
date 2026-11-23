import 'pixi.js/events';   // gives containers `eventMode`, as a renderer does in the app
import { AbstractPixiFeature } from '../../../modules/pixi/AbstractPixiFeature.ts';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { LineBatch } from '../../../modules/pixi/lib/LineBatch.ts';


describe('AbstractPixiFeature', () => {
  let layer;

  // A feature as a layer makes it, drawn once
  function makeFeature(id = 'f1') {
    const feature = new AbstractPixiFeature(layer, id);
    feature.style = { stroke: { width: 2 } };
    feature.update();
    return feature;
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    const scene = { context: context, gfx: {}, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, featureChanged: () => {}, avoidFreed: () => {} };
    layer = new AbstractPixiLayer(scene);
  });


  describe('hitTest', () => {
    // Nothing is rendered here, so a feature's coordinates are the stage's.
    function hittable() {
      const feature = makeFeature();
      feature.container.hitArea = { contains: (x, y) => x >= 0 && x <= 10 && y >= 0 && y <= 10 };
      return feature;
    }

    it('hits inside the feature\'s hit area, and not outside it', () => {
      const feature = hittable();
      assert.isTrue(feature.hitTest({ x: 5, y: 5 }));
      assert.isFalse(feature.hitTest({ x: 15, y: 5 }));
    });

    it('never hits a feature that\'s hidden, or not allowed to be interactive', () => {
      const feature = hittable();
      feature.visible = false;
      assert.isFalse(feature.hitTest({ x: 5, y: 5 }));

      feature.visible = true;
      feature.allowInteraction = false;    // as a node is while it's dragged
      assert.isFalse(feature.hitTest({ x: 5, y: 5 }));

      feature.allowInteraction = true;
      assert.isTrue(feature.hitTest({ x: 5, y: 5 }));
    });

    it('doesn\'t hit a feature that has no hit area and draws nothing', () => {
      assert.isFalse(makeFeature().hitTest({ x: 5, y: 5 }));
    });
  });


  // A selected feature's halo is lines in a batch that the map UI layer has, above everything
  // on the map: two for each ring (a dark line, and the dashes that march over it). A subclass
  // works out the rings, in its container's coordinates.
  describe('the halo', () => {
    const FLOATS = 12;
    const BYTES = 8;
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    const triangle = [20, 0, 30, 0, 25, 8];
    let batch, asked;

    // The box of the points on the line that an item's vertices belong to: [minX, minY, maxX, maxY]
    const boxOf = item => {
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < item.count; i++) {
        const o = (item.first + i) * FLOATS;
        box[0] = Math.min(box[0], batch._floats[o]);
        box[1] = Math.min(box[1], batch._floats[o + 1]);
        box[2] = Math.max(box[2], batch._floats[o]);
        box[3] = Math.max(box[3], batch._floats[o + 1]);
      }
      return box;
    };
    const closeTo = (actual, expected) => {
      actual.forEach((v, i) => assert.closeTo(v, expected[i], 1e-3, `[${i}]`));
    };
    const alphaOf = item => batch._bytes[item.first * BYTES + 3];

    beforeEach(() => {
      batch = new LineBatch();
      asked = [];
      layer.scene.layers.set('map-ui', { haloBatchAt: (x, y) => { asked.push([x, y]); return batch; } });
    });
    afterEach(() => {
      if (!batch.destroyed) batch.destroy();
    });

    it('has none until it is drawn', () => {
      const feature = makeFeature();
      assert.deepEqual(feature.haloItems, []);
      feature._drawHalo(null);     // none, and none to take away
      feature._drawHalo([]);
      assert.deepEqual(asked, [], 'the map UI layer isn\'t asked for a batch that nothing needs');
      assert.strictEqual(batch.size, 0);
    });

    it('is two lines for each ring, in the map UI layer\'s batch, around the feature\'s place in the world', () => {
      const feature = makeFeature();
      feature.container.position.set(1000, 2000);
      batch.position.set(900, 2100);
      feature._drawHalo([square, triangle]);

      assert.deepEqual(asked, [[1000, 2000]], 'the batch is asked for where the feature is');
      assert.lengthOf(feature.haloItems, 4);
      assert.strictEqual(batch.size, 4);
      for (const item of feature.haloItems) {
        assert.strictEqual(item.batch, batch);
        assert.isTrue(item.visible);
      }
      closeTo(boxOf(feature.haloItems[0]), [100, -100, 110, -90]);
      closeTo(boxOf(feature.haloItems[1]), [100, -100, 110, -90]);
      closeTo(boxOf(feature.haloItems[2]), [120, -100, 130, -92]);
    });

    it('is as large and turned as its container is: the rings are in the container\'s coordinates', () => {
      const feature = makeFeature();
      feature.container.scale.set(0.5, 0.5);      // (a point's container, at zoom 17)
      feature._drawHalo([square]);
      closeTo(boxOf(feature.haloItems[0]), [0, 0, 5, 5]);

      feature.container.scale.set(2, 2);
      feature.container.rotation = Math.PI / 2;   // x goes down, y goes left
      feature._drawHalo([square]);
      closeTo(boxOf(feature.haloItems[0]), [-20, 0, 0, 20]);
      assert.lengthOf(feature.haloItems, 2, 'the lines it had, drawn again');
      assert.strictEqual(batch.size, 2);
    });

    it('is taken away for no rings', () => {
      const feature = makeFeature();
      feature._drawHalo([square]);
      feature._drawHalo(null);
      assert.deepEqual(feature.haloItems, []);
      assert.strictEqual(batch.size, 0);

      feature._drawHalo([square]);
      feature._drawHalo([]);
      assert.deepEqual(feature.haloItems, []);
      assert.strictEqual(batch.size, 0);
    });

    it('is hidden and shown with the feature', () => {
      const feature = makeFeature();
      feature._drawHalo([square]);
      const items = [...feature.haloItems];

      feature.visible = false;
      for (const item of items) {
        assert.isFalse(item.visible);
        assert.strictEqual(alphaOf(item), 0);
      }
      assert.strictEqual(batch.size, 2, 'it keeps its place in the batch');

      feature.visible = true;
      for (const item of items) {
        assert.isTrue(item.visible);
        assert.isAbove(alphaOf(item), 0);
      }
    });

    it('is hidden when it is drawn for a feature that is hidden', () => {
      const feature = makeFeature();
      feature.visible = false;
      feature._drawHalo([square]);
      assert.lengthOf(feature.haloItems, 2);
      for (const item of feature.haloItems) {
        assert.isFalse(item.visible);
      }

      feature.visible = true;
      for (const item of feature.haloItems) {
        assert.isTrue(item.visible);
      }
    });

    it('leaves the batch when the feature is destroyed', () => {
      const feature = makeFeature();
      feature._drawHalo([square, triangle]);
      assert.strictEqual(batch.size, 4);
      feature.destroy();
      assert.strictEqual(batch.size, 0);
      assert.deepEqual(feature.haloItems, []);
    });

    it('is not drawn, and nothing throws, where there is no map UI layer', () => {
      const feature = makeFeature();
      layer.scene.layers.delete('map-ui');
      feature._drawHalo([square]);
      assert.deepEqual(feature.haloItems, []);
      feature.visible = false;
      feature.visible = true;
      feature.destroy();
    });

    it('is taken away when the map UI layer has no batch to give anymore', () => {
      const feature = makeFeature();
      feature._drawHalo([square]);
      layer.scene.layers.set('map-ui', { haloBatchAt: () => null });
      feature._drawHalo([square]);
      assert.deepEqual(feature.haloItems, []);
      assert.strictEqual(batch.size, 0);
    });
  });


  // Working out a feature's style from its data costs several times what drawing it does,
  // so a layer does it only when `needsStyle` says the style may be out of date.
  describe('needsStyle', () => {
    it('is true for a new feature, until a style is assigned', () => {
      const feature = new AbstractPixiFeature(layer, 'f1');
      assert.isTrue(feature.needsStyle);
      assert.isTrue(feature.dirty);

      feature.style = { stroke: { width: 2 } };
      assert.isFalse(feature.needsStyle);
      assert.isTrue(feature.dirty);   // it still has to be drawn
    });

    it('is true again when the feature is marked dirty, or its data is bound', () => {
      const feature = makeFeature();
      assert.isFalse(feature.needsStyle);

      feature.dirty = true;
      assert.isTrue(feature.needsStyle);

      feature.style = {};
      feature.update();
      feature.data = { dataID: 'w1' };
      assert.isTrue(feature.needsStyle);
    });

    it('is true again when the layer marks its features dirty, one or all', () => {
      const a = makeFeature('a');
      const b = makeFeature('b');

      layer.dirtyFeatures('a');
      assert.isTrue(a.needsStyle);
      assert.isFalse(b.needsStyle);

      layer.dirtyLayer();
      assert.isTrue(b.needsStyle);
    });

    it('stays false through a change of zoom, though the feature has to be drawn again', () => {
      const feature = makeFeature();
      layer.dirtyTransform();
      assert.isTrue(feature.dirty);
      assert.isFalse(feature.needsStyle);
    });

    it('stays false when a class is set or unset (hover, select)', () => {
      const feature = makeFeature();
      feature.setClass('hover');
      assert.isTrue(feature.dirty);
      assert.isFalse(feature.needsStyle);

      feature.update();
      feature.unsetClass('hover');
      assert.isTrue(feature.dirty);
      assert.isFalse(feature.needsStyle);
    });
  });


  // A label is placed again when its feature's shape, text or visibility changed, and the labels
  // layer hears which features to look at from the scene.
  describe('labelDirty', () => {
    it('is true for a new feature, and false once the labels layer has looked at it', () => {
      const feature = makeFeature();
      assert.isTrue(feature.labelDirty);
      feature.labelPlaced();
      assert.isFalse(feature.labelDirty);
    });

    it('stays false when a class is set or unset: a hover leaves the label where it is', () => {
      const feature = makeFeature();
      feature.labelPlaced();
      feature.setClass('hover');
      assert.isFalse(feature.labelDirty);
      feature.update();
      feature.unsetClass('hover');
      assert.isFalse(feature.labelDirty);
    });

    it('is true again when the label text changes, the feature is hidden, or it is marked dirty', () => {
      const feature = makeFeature();
      feature.labelPlaced();
      feature.label = 'Main Street';
      assert.isTrue(feature.labelDirty);

      feature.labelPlaced();
      feature.visible = false;
      assert.isTrue(feature.labelDirty);

      feature.labelPlaced();
      feature.dirty = true;
      assert.isTrue(feature.labelDirty);
    });

    it('tells the scene when it is drawn, hidden, relabeled or destroyed', () => {
      const told = [];
      layer.scene.featureChanged = feature => told.push(feature.id);
      const feature = makeFeature('f1');
      assert.deepEqual(told, ['f1']);                 // drawn

      feature.update();                               // nothing to draw: nothing to tell
      assert.lengthOf(told, 1);
      feature.setClass('hover');
      feature.update();                               // drawn again
      assert.lengthOf(told, 2);
      feature.label = 'Main Street';
      assert.lengthOf(told, 3);
      feature.visible = false;
      assert.lengthOf(told, 4);
      feature.destroy();
      assert.lengthOf(told, 5);
    });
  });


  it('tells its layer when it is hidden, shown or destroyed, so the layer knows how many are visible', () => {
    const a = makeFeature('a');
    const b = makeFeature('b');
    assert.strictEqual(layer.numVisible, 2);

    a.visible = false;
    a.visible = false;   // no change
    assert.strictEqual(layer.numVisible, 1);
    a.visible = true;
    assert.strictEqual(layer.numVisible, 2);

    b.visible = false;
    b.destroy();
    assert.strictEqual(layer.numVisible, 1);
    a.destroy();
    assert.strictEqual(layer.numVisible, 0);
  });


  // A feature that's dirty only because the view's zoom or rotation changed can be drawn as it
  // was for a few frames. One that changed itself can't, in a frame the user asked for.
  describe('onlyTransformDirty', () => {
    it('is false for a new feature and for a clean one', () => {
      const feature = new AbstractPixiFeature(layer, 'f1');
      assert.isFalse(feature.onlyTransformDirty);
      feature.style = {};
      feature.update();
      assert.isFalse(feature.onlyTransformDirty);
    });

    it('is true after a change of zoom, until the feature is drawn again', () => {
      const feature = makeFeature();
      feature.dirtyTransform();
      assert.isTrue(feature.onlyTransformDirty);

      feature.update();
      assert.isFalse(feature.onlyTransformDirty);
    });

    it('is false once something about the feature changes too', () => {
      for (const change of [
        feature => feature.setClass('hover'),
        feature => { feature.dirty = true; },
        feature => { feature.style = {}; },
        feature => { feature.geometry = {}; },
        feature => { feature.data = { dataID: 'w1' }; }
      ]) {
        const feature = makeFeature(`f${Math.random()}`);
        feature.dirtyTransform();
        change(feature);
        assert.isFalse(feature.onlyTransformDirty);
      }
    });

    it('is false when the feature was dirty already, for another reason', () => {
      const feature = makeFeature();
      feature.setClass('select');
      feature.dirtyTransform();
      assert.isFalse(feature.onlyTransformDirty);

      feature.update();
      feature.dirtyTransform();   // and a later zoom, on its own, counts again
      assert.isTrue(feature.onlyTransformDirty);
    });
  });
});
