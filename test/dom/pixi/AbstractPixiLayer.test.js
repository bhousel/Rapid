import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { RenderFrame } from '../../../modules/pixi/RenderFrame.ts';


describe('AbstractPixiLayer', () => {
  function makeLayer() {
    const context = new Rapid.MockContext();
    return new AbstractPixiLayer({ context: context, gfx: {} });
  }

  it('binding a feature again to the same data keeps the data\'s parent and child links', () => {
    const layer = makeLayer();
    layer.bindData('r1-feature', 'r1');
    layer.bindData('w1-feature', 'w1');
    layer.addChildData('r1', 'w1');

    layer.bindData('r1-feature', 'r1');   // a redraw binds each feature again
    layer.bindData('w1-feature', 'w1');

    assert.sameMembers([...layer.getSelfAndDescendants('r1')], ['r1', 'w1']);
    assert.sameMembers([...layer.getSelfAndAncestors('w1')], ['w1', 'r1']);
  });

  it('clearing a parent\'s children removes their links back to it, and keeps their other parents', () => {
    const layer = makeLayer();
    layer.addChildData('w1', ['n1', 'n2']);
    layer.addChildData('w2', ['n2']);

    layer.clearChildData('w1');
    assert.sameMembers([...layer.getSelfAndDescendants('w1')], ['w1']);
    assert.sameMembers([...layer.getSelfAndAncestors('n1')], ['n1']);
    assert.sameMembers([...layer.getSelfAndAncestors('n2')], ['n2', 'w2']);
  });

  it('removing a child removes only that parent\'s link', () => {
    const layer = makeLayer();
    layer.addChildData('w1', ['n1']);
    layer.addChildData('w2', ['n1']);

    layer.removeChildData('w1', 'n1');
    assert.sameMembers([...layer.getSelfAndAncestors('n1')], ['n1', 'w2']);
  });

  it('unbinding the last feature of some data drops its links', () => {
    const layer = makeLayer();
    layer.bindData('r1-feature', 'r1');
    layer.addChildData('r1', 'w1');

    layer.unbindData('r1-feature');
    assert.sameMembers([...layer.getSelfAndDescendants('r1')], ['r1']);
  });


  // A layer's work for a frame is a pass: `render()` marks the features it sees, `cull()` hides the
  // rest. A layer that asks `keepFeatures()` skips the pass when only the view moved inside the
  // frame's cull box (see "A CULL pass" in `design/graphics-system.md`).
  describe('passes', () => {
    let layer, nextFrameID, box;

    // A stand-in feature with what `retainFeature()` and `cull()` use
    function addFeature(id) {
      const feature = {
        id: id,
        lod: 2,
        visible: true,
        dirty: false,
        destroyed: false,
        destroy: () => {
          feature.destroyed = true;
          layer.removeFeature(feature);
        }
      };
      layer.addFeature(feature);
      return feature;
    }

    // A frame as `GraphicsSystem` makes it: something changed, or (by default) only the view moved
    function makeFrame(props = {}) {
      const frame = new RenderFrame(nextFrameID++, 17);
      frame.contentChanged = false;
      frame.cullBox = box;
      return Object.assign(frame, props);
    }

    // What a layer's `render()` and the scene do with a frame; returns whether the layer kept its features
    function runFrame(frame, seen = []) {
      const kept = layer.keepFeatures(frame);
      if (!kept) {
        for (const feature of seen) {
          layer.retainFeature(feature, frame);
        }
      }
      layer.cull(frame);
      return kept;
    }

    beforeEach(() => {
      layer = makeLayer();
      layer.id = 'osm';
      nextFrameID = 1;
      box = new Rapid.sdk.Extent([0, 0], [100, 100]);
    });

    it('does a pass the first time, then keeps its features while only the view moves inside the box', () => {
      assert.isFalse(runFrame(makeFrame()));
      const frame = makeFrame();
      assert.isTrue(runFrame(frame));
      assert.isTrue(layer.keptFeatures(frame));
      assert.isTrue(runFrame(makeFrame()));
    });

    it('does a pass when the frame has another cull box', () => {
      runFrame(makeFrame());
      box = new Rapid.sdk.Extent([50, 0], [150, 100]);
      const frame = makeFrame();
      assert.isFalse(runFrame(frame));
      assert.isFalse(layer.keptFeatures(frame));
      assert.isTrue(runFrame(makeFrame()));   // and keeps them in the new one
    });

    it('does a pass when a redraw was requested for the scene or for this layer, not for another layer', () => {
      runFrame(makeFrame());
      assert.isFalse(runFrame(makeFrame({ contentChanged: true })));
      assert.isFalse(runFrame(makeFrame({ changedLayerIDs: new Set(['osm']) })));
      assert.isTrue(runFrame(makeFrame({ changedLayerIDs: new Set(['background']) })));
    });

    it('does a pass after its features were marked dirty, whatever the frame is for', () => {
      const feature = addFeature('a');
      runFrame(makeFrame(), [feature]);

      layer.dirtyFeatures('a');
      assert.isTrue(feature.dirty);
      assert.isFalse(runFrame(makeFrame(), [feature]));

      layer.dirtyLayer();
      assert.isFalse(runFrame(makeFrame(), [feature]));
      assert.isTrue(runFrame(makeFrame(), [feature]));
    });

    it('hides the features a pass didn\'t see, and leaves them alone on a frame it keeps them', () => {
      const a = addFeature('a');
      const b = addFeature('b');
      runFrame(makeFrame(), [a]);
      assert.isTrue(a.visible);
      assert.isFalse(b.visible);

      b.visible = true;   // (not something that happens: shows that a kept frame touches nothing)
      runFrame(makeFrame());
      assert.isTrue(a.visible);
      assert.isTrue(b.visible);
    });

    it('hides everything and needs a pass next, when `render()` returned before asking (the layer is off)', () => {
      const a = addFeature('a');
      runFrame(makeFrame(), [a]);

      layer.cull(makeFrame());   // `render()` returned early
      assert.isFalse(a.visible);
      assert.isFalse(runFrame(makeFrame(), [a]));   // only the view moved, but it has to do the pass
      assert.isTrue(a.visible);
    });

    it('destroys a feature that 20 passes haven\'t seen, not counting the frames it kept its features', () => {
      const a = addFeature('a');
      const b = addFeature('b');
      runFrame(makeFrame({ contentChanged: true }), [a, b]);

      for (let i = 0; i < 40; i++) {   // only the view moves
        runFrame(makeFrame(), [a]);
      }
      assert.isFalse(b.destroyed);

      for (let i = 0; i < 20; i++) {
        runFrame(makeFrame({ contentChanged: true }), [a]);
      }
      assert.isFalse(b.destroyed);
      runFrame(makeFrame({ contentChanged: true }), [a]);
      assert.isTrue(b.destroyed);
      assert.isFalse(a.destroyed);
      assert.isFalse(layer.features.has('b'));
    });

    it('counts the features made and destroyed, and hands the counts over once', () => {
      const a = addFeature('a');
      addFeature('b');
      a.destroy();
      layer._endStep('gather', performance.now() - 5);

      const work = layer.takeWork();
      assert.include(work, { created: 2, destroyed: 1, updated: 0 });
      assert.isAtLeast(work.steps.gather, 5);
      assert.deepEqual(layer.takeWork(), { created: 0, destroyed: 0, updated: 0, shown: 0, hidden: 0, steps: {} });
    });
  });
});
