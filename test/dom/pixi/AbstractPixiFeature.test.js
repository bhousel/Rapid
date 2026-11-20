import { AbstractPixiFeature } from '../../../modules/pixi/AbstractPixiFeature.ts';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';


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
    const scene = { context: context, gfx: {}, addFeature: () => {}, removeFeature: () => {} };
    layer = new AbstractPixiLayer(scene);
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
