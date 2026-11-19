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

    it('keeps its features in a held frame, even dirty ones or with another cull box, and does the pass after', () => {
      const a = addFeature('a');
      const b = addFeature('b');
      runFrame(makeFrame(), [a, b]);

      layer.dirtyFeatures('a');
      const otherBox = new Rapid.sdk.Extent([50, 50], [150, 150]);
      assert.isTrue(runFrame(makeFrame({ held: true }), [a]));                       // marked dirty
      assert.isTrue(runFrame(makeFrame({ held: true, cullBox: otherBox }), [a]));    // (GraphicsSystem keeps the box, but still)
      assert.isTrue(b.visible);   // nothing was culled

      assert.isFalse(runFrame(makeFrame(), [a]));   // the pass it still owed
      assert.isFalse(b.visible);
    });

    it('does a pass in a held frame when the layer itself asked to be drawn now', () => {
      const a = addFeature('a');
      runFrame(makeFrame(), [a]);

      const changedLayerIDs = new Set(['osm']);
      assert.isFalse(runFrame(makeFrame({ held: true, changedLayerIDs: changedLayerIDs }), [a]));
      assert.isTrue(runFrame(makeFrame({ held: true, changedLayerIDs: new Set(['labels']) }), [a]));
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

    // Features that are dirty can be drawn again in a later frame, if this one is out of time or
    // they're outside the view (see "A deadline on the frame" in `design/graphics-system.md`).
    describe('features that wait', () => {
      const viewport = {};
      let drawn;

      // A stand-in feature at the given world coordinate, that's dirty until it's drawn
      function addDirtyFeature(id, x, props = {}) {
        const feature = addFeature(id);
        Object.assign(feature, {
          dirty: true,
          onlyTransformDirty: false,
          geometry: { world: { extent: new Rapid.sdk.Extent([x, 0], [x + 1, 1]) } },
          update: () => {
            feature.dirty = false;
            drawn.push(id);
          }
        }, props);
        return feature;
      }

      // A frame whose view is the left half of the cull box, with or without time left
      function makeTimedFrame(hasTime, props = {}) {
        const frame = makeFrame(props);
        frame.viewBox = new Rapid.sdk.Extent([0, 0], [50, 50]);
        frame.deadline = hasTime ? Infinity : -Infinity;
        return frame;
      }

      // A pass over the given features, as a layer's `render()` and the scene do it
      function runPass(frame, features) {
        layer.keepFeatures(frame);
        for (const feature of features) {
          layer.updateFeature(feature, frame, viewport);
          layer.retainFeature(feature, frame);
        }
        layer.cull(frame);
      }

      beforeEach(() => {
        drawn = [];
      });

      it('draws a dirty feature in view at once while the frame has time, and leaves a clean one alone', () => {
        const a = addDirtyFeature('a', 10);
        const b = addDirtyFeature('b', 20, { dirty: false });
        runPass(makeTimedFrame(true), [a, b]);
        assert.deepEqual(drawn, ['a']);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('puts a dirty feature in view off when the frame is out of time, and draws it in a later frame', () => {
        const a = addDirtyFeature('a', 10);
        runPass(makeTimedFrame(false, { contentChanged: true }), [a]);
        assert.deepEqual(drawn, []);
        assert.strictEqual(layer.numWaiting, 1);
        assert.strictEqual(layer.numWaitingInView, 1);

        layer.continueWaiting(makeTimedFrame(true), viewport);
        assert.deepEqual(drawn, ['a']);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('always puts off a feature outside the view, and draws it only when asked to go on to those', () => {
        const far = addDirtyFeature('far', 80);
        runPass(makeTimedFrame(true, { contentChanged: true }), [far]);
        assert.deepEqual(drawn, []);
        assert.strictEqual(layer.numWaiting, 1);
        assert.strictEqual(layer.numWaitingInView, 0);

        layer.continueWaiting(makeTimedFrame(true), viewport);   // the layer's own call: the view only
        assert.deepEqual(drawn, []);

        layer.continueWaiting(makeTimedFrame(true), viewport, true);   // the scene's, after every layer
        assert.deepEqual(drawn, ['far']);
      });

      it('in a frame the user asked for, draws what changed at once, and still puts off what only the zoom changed', () => {
        const hovered = addDirtyFeature('hovered', 10);
        const zoomed = addDirtyFeature('zoomed', 20, { onlyTransformDirty: true });
        const far = addDirtyFeature('far', 80);
        runPass(makeTimedFrame(false, { contentChanged: true, urgent: true }), [hovered, zoomed, far]);
        assert.deepEqual(drawn, ['hovered']);
        assert.strictEqual(layer.numWaitingInView, 1);
        assert.strictEqual(layer.numWaiting, 2);
      });

      it('draws at least a few each time, even with no time, so the work gets done', () => {
        const features = [];
        for (let i = 0; i < 100; i++) {
          features.push(addDirtyFeature(`f${i}`, 10));
        }
        runPass(makeTimedFrame(false, { contentChanged: true }), features);
        assert.strictEqual(layer.numWaiting, 100);

        let calls = 0;
        while (layer.numWaiting && calls < 100) {
          layer.continueWaiting(makeTimedFrame(false), viewport);
          calls++;
        }
        assert.strictEqual(drawn.length, 100);
        assert.isAbove(calls, 1);     // not all at once
        assert.isBelow(calls, 10);    // 32 at a time
      });

      it('takes a feature first once the view has moved over it', () => {
        const far = addDirtyFeature('far', 80);
        const near = addDirtyFeature('near', 10);
        runPass(makeTimedFrame(false, { contentChanged: true }), [far, near]);

        const frame = makeTimedFrame(true);
        frame.viewBox = new Rapid.sdk.Extent([60, 0], [100, 50]);   // the view moved to the right half
        frame.deadline = -Infinity;
        layer.continueWaiting(frame, viewport);
        assert.include(drawn, 'far');
      });

      it('forgets a feature that was destroyed, or that the last pass no longer saw', () => {
        const a = addDirtyFeature('a', 10);
        const b = addDirtyFeature('b', 20);
        runPass(makeTimedFrame(false, { contentChanged: true }), [a, b]);
        assert.strictEqual(layer.numWaiting, 2);

        a.destroy();
        assert.strictEqual(layer.numWaiting, 1);

        runPass(makeTimedFrame(false, { contentChanged: true }), []);   // `b` has scrolled away
        layer.continueWaiting(makeTimedFrame(true), viewport, true);
        assert.deepEqual(drawn, []);
        assert.strictEqual(layer.numWaiting, 0);
        assert.isTrue(b.dirty);   // if it comes back, it's drawn then
      });
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
