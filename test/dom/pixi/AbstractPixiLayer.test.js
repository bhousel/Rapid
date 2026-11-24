import * as PIXI from 'pixi.js';
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
  // frame's cull box (see "The cull box" in `design/graphics-system.md`).
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

      it('remembers the furthest that a feature it drew can be hit from its geometry, until it\'s reset', () => {
        const pin = addDirtyFeature('pin', 10, { hitReach: 28 });
        const line = addDirtyFeature('line', 20, { hitReach: 7.5 });
        assert.strictEqual(layer._hitReach, 0);

        runPass(makeTimedFrame(true), [line]);
        assert.strictEqual(layer._hitReach, 7.5);
        runPass(makeTimedFrame(true), [line, pin]);
        assert.strictEqual(layer._hitReach, 28);

        layer.reset();
        assert.strictEqual(layer._hitReach, 0);
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

      it('looks again at what waited outside the view only once the view has moved, and then only now and then', () => {
        const far = addDirtyFeature('far', 80);
        const left = addDirtyFeature('left', 10);
        runPass(makeTimedFrame(true, { contentChanged: true }), [far]);   // the view is the left half
        assert.strictEqual(layer.numWaitingInView, 0);

        // Walking everything that waits costs something on every frame, so: not while the view is still
        const walked = [];
        const geometry = far.geometry;
        Object.defineProperty(far, 'geometry', {
          get: () => {
            walked.push('far');
            return geometry;
          }
        });
        assert.isFalse(layer._sortWaiting(makeTimedFrame(false, { time: 1000 })));
        assert.deepEqual(walked, []);

        const right = new Rapid.sdk.Extent([60, 0], [100, 50]);
        const movedFrame = (props) => Object.assign(makeTimedFrame(false, props), { viewBox: right });
        assert.isTrue(layer._sortWaiting(movedFrame({ time: 1000 })));
        assert.deepEqual(walked, ['far']);
        assert.strictEqual(layer.numWaitingInView, 1);

        // A pass with the view on the right puts `left` off, as outside it. Then the view moves back.
        runPass(movedFrame({ contentChanged: true, time: 1010 }), [far, left]);
        assert.strictEqual(layer.numWaitingInView, 1);
        assert.isFalse(layer._sortWaiting(makeTimedFrame(false, { time: 1050 })));   // moved, but it just looked
        assert.strictEqual(layer.numWaitingInView, 1);
        assert.isTrue(layer._sortWaiting(makeTimedFrame(false, { time: 1150 })));
        assert.strictEqual(layer.numWaitingInView, 2);
      });

      it('remembers a feature that is still dirty after it was drawn, and draws it again when a texture has loaded', () => {
        let loaded = false;
        const pin = addDirtyFeature('pin', 10);
        pin.update = () => {
          pin.dirty = !loaded;   // (as `PixiFeaturePoint` does while its icon is missing)
          drawn.push('pin');
        };
        const clean = addDirtyFeature('clean', 20);
        runPass(makeTimedFrame(true, { contentChanged: true }), [pin, clean]);
        assert.deepEqual(drawn, ['pin', 'clean']);
        assert.strictEqual(layer.numWaiting, 0);   // nothing to go on with until the texture is there

        layer.continueWaiting(makeTimedFrame(true), viewport, true);
        assert.deepEqual(drawn, ['pin', 'clean']);

        loaded = true;
        layer.texturesLoaded();
        assert.strictEqual(layer.numWaitingInView, 1);
        layer.continueWaiting(makeTimedFrame(true), viewport);
        assert.deepEqual(drawn, ['pin', 'clean', 'pin']);
        assert.strictEqual(layer.numWaiting, 0);

        layer.texturesLoaded();   // nothing is waiting for one now
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('forgets a feature that waited for a texture when it is destroyed', () => {
        const pin = addDirtyFeature('pin', 10, { update: () => {} });   // stays dirty
        runPass(makeTimedFrame(true, { contentChanged: true }), [pin]);
        pin.destroy();
        layer.texturesLoaded();
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('counts what each feature it draws will cost in the DRAW phase against the frame\'s time', () => {
        const changed = addDirtyFeature('changed', 10);
        const zoomed = addDirtyFeature('zoomed', 20, { onlyTransformDirty: true });
        const frame = makeTimedFrame(true, { contentChanged: true });

        layer.keepFeatures(frame);
        layer.updateFeature(zoomed, frame, viewport);
        const afterRedraw = frame.drawDebt;
        assert.isAbove(afterRedraw, 0);
        layer.updateFeature(changed, frame, viewport);
        assert.isAbove(frame.drawDebt - afterRedraw, afterRedraw);   // a new or changed one costs more

        // ..so a frame runs out of time sooner than its clock says
        frame.deadline = performance.now() + 60000;
        assert.isTrue(frame.hasTime());
        frame.drawDebt = 120000;
        assert.isFalse(frame.hasTime());
      });

      it('counts a feature made after the pass as seen by that pass', () => {
        const a = addDirtyFeature('a', 10);
        runPass(makeTimedFrame(true, { contentChanged: true }), [a]);

        // A layer catching up makes a feature in a later frame, where it keeps its features
        const late = addDirtyFeature('late', 20);
        const kept = makeTimedFrame(false);
        assert.isTrue(layer.keepFeatures(kept));
        layer._catchingUp = true;
        layer.updateFeature(late, kept, viewport);   // no time: it waits
        layer.retainFeature(late, kept);
        layer._catchingUp = false;
        layer.cull(kept);

        layer.continueWaiting(makeTimedFrame(true), viewport);   // ..and is drawn, not skipped as unseen
        assert.include(drawn, 'late');

        runPass(makeTimedFrame(true, { contentChanged: true }), [a]);   // the next pass doesn't see it
        assert.isFalse(late.visible);
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

    it('counts its visible features as they are made, hidden, shown and removed', () => {
      const a = addFeature('a');
      const b = addFeature('b');
      assert.strictEqual(layer.numVisible, 2);

      b.visible = false;
      layer.visibilityChanged(b, false);   // (a real feature's `visible` setter calls this)
      assert.strictEqual(layer.numVisible, 1);
      b.destroy();                      // it wasn't visible: no change
      assert.strictEqual(layer.numVisible, 1);
      a.destroy();
      assert.strictEqual(layer.numVisible, 0);

      const work = layer.takeWork();
      assert.include(work, { shown: 0, hidden: 1 });
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


  // A layer that draws in batches (`useBatches`) gives each feature the batches of the container it's
  // drawn for, puts it in the scene only if it draws something itself, and finds its features under
  // the pointer itself: Pixi can't see what a batch draws.
  describe('batches', () => {
    let layer, scene, spatial, child, testers, interactive;

    // A stand-in feature: what `_drawInBatches` and `hitTest` use of one
    function makeFeature(id, extent, { drawsItself = false, hit = true } = {}) {
      const feature = {
        id: id, dirty: true, visible: true, allowInteraction: true, hitReach: 0,
        geometry: { world: { extent: { min: extent.slice(0, 2), max: extent.slice(2) } } },
        container: new PIXI.Container(), placed: [], asked: 0,
        placeInBatches: (batches, parent) => feature.placed.push([batches, parent]),
        update: () => { feature.dirty = false; },
        drawsInContainer: () => drawsItself,
        hitTest: () => { feature.asked++; return hit; },
        sceneContainer: null, sceneOrder: 0, sceneItem: null
      };
      Object.defineProperty(feature, 'parentContainer', {
        get: () => feature.container.parent,
        set: val => {
          if (val) {
            val.addChild(feature.container);
          } else {
            feature.container.parent?.removeChild(feature.container);
          }
        }
      });
      feature.sceneContainer = feature.container;
      layer.features.set(id, feature);
      layer._numVisible++;
      return feature;
    }

    beforeEach(() => {
      const context = new Rapid.MockContext();
      context.viewport.transform = { x: 0, y: 0, z: 16 };    // a pixel is a world unit
      spatial = new PIXI.Container();
      child = new PIXI.Container();
      spatial.addChild(child);
      testers = new Map();
      interactive = new Set(['fbRoads']);
      scene = {
        context: context, gfx: {},
        getSpatialContainer: () => spatial,
        releaseSpatialContainers: () => {},
        setHitTester: (spatialID, l) => testers.set(spatialID, l),
        isInteractive: spatialID => interactive.has(spatialID)
      };
      layer = new AbstractPixiLayer(scene);
      layer.useBatches = true;
      layer._spatialContainer('basemap', 'fbRoads');
    });

    it('says it finds its own features, for each spatial ID it draws', () => {
      assert.strictEqual(testers.get('fbRoads'), layer);

      const other = new AbstractPixiLayer(scene);    // one that doesn't draw in batches
      other._spatialContainer('basemap', 'custom');
      assert.isFalse(testers.has('custom'));
    });

    it('gives a dirty feature the layer\'s batches in the container, and draws it', () => {
      const feature = makeFeature('a', [0, 0, 10, 10]);
      layer._drawInBatches(feature, child, {});
      assert.deepEqual(feature.placed, [[layer.batches, child]]);
      assert.isFalse(feature.dirty);
      assert.isNull(feature.parentContainer, 'its batches draw it: it isn\'t in the scene');

      layer._drawInBatches(feature, child, {});    // not dirty: nothing to do
      assert.lengthOf(feature.placed, 1);
    });

    it('puts a feature that draws something itself in the container', () => {
      const feature = makeFeature('a', [0, 0, 10, 10], { drawsItself: true });
      layer._drawInBatches(feature, child, {});
      assert.strictEqual(feature.parentContainer, child);
    });

    it('gives no batches without `useBatches`', () => {
      layer.useBatches = false;
      const feature = makeFeature('a', [0, 0, 10, 10], { drawsItself: true });
      layer._drawInBatches(feature, child, {});
      assert.deepEqual(feature.placed, [[null, child]]);
      assert.strictEqual(feature.parentContainer, child);
    });

    it('finds the features near the pointer through its index, the one drawn on top first', () => {
      const under = makeFeature('under', [0, 0, 10, 10]);
      const over = makeFeature('over', [5, 5, 15, 15]);
      const far = makeFeature('far', [500, 500, 510, 510]);
      for (const feature of [under, over, far]) {
        layer._drawInBatches(feature, child, {});
        child.addChild(feature.container);    // (where each is drawn, for `featureOrder`)
      }

      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 7, y: 7 }), over);
      assert.strictEqual(far.asked, 0, 'a feature far from the pointer isn\'t asked');
      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }), under);    // (more than the margin of 4 from `over`)
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 100, y: 100 }));
    });

    it('finds no feature that\'s hidden, not interactive, or of data the mode keeps from the pointer', () => {
      const feature = makeFeature('a', [0, 0, 10, 10]);
      layer._drawInBatches(feature, child, {});

      feature.visible = false;
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 5, y: 5 }));
      feature.visible = true;
      feature.allowInteraction = false;
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 5, y: 5 }));
      feature.allowInteraction = true;
      interactive.clear();
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 5, y: 5 }));
      interactive.add('fbRoads');
      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 5, y: 5 }), feature);
    });

    it('finds a feature that moved where it is now, and no feature that\'s gone', () => {
      const feature = makeFeature('a', [0, 0, 10, 10]);
      layer._drawInBatches(feature, child, {});

      feature.geometry = { world: { extent: { min: [100, 100], max: [110, 110] } } };
      feature.dirty = true;
      layer._drawInBatches(feature, child, {});
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 5, y: 5 }));
      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 105, y: 105 }), feature);

      layer.removeFeature(feature);
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 105, y: 105 }));
    });

    it('looks as far around the pointer as the furthest a feature it drew can be hit', () => {
      const feature = makeFeature('pin', [0, 0, 0, 0]);    // a point
      feature.hitReach = 30;                                // a pin, hit up to its top
      layer._drawInBatches(feature, child, {});
      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 0, y: -28 }), feature);
    });

    // (A layer that keeps its features does its pass when what it draws changed: see `keepFeatures`.)
    it('does its pass on the next frame when its own data changes class, and not for another layer\'s', () => {
      const box = {};
      layer.bindData('a', 'fbRoads:1');
      layer._currentBox = box;
      layer.classChanged('osm:w1');
      assert.strictEqual(layer._currentBox, box);
      layer.classChanged('fbRoads:1');
      assert.isNull(layer._currentBox);
    });

    it('does its pass again when a feature is still dirty after it\'s drawn (a texture it needs hasn\'t loaded)', () => {
      const feature = makeFeature('a', [0, 0, 10, 10]);
      feature.update = () => {};    // stays dirty, as a point without its icon does
      layer._currentBox = {};
      layer._drawInBatches(feature, child, {});
      assert.isNull(layer._currentBox);
    });

    it('forgets its batches and its index in a reset', () => {
      const feature = makeFeature('a', [0, 0, 10, 10]);
      layer._drawInBatches(feature, child, {});
      let forgot = 0;
      layer.batches.forget = () => forgot++;
      feature.destroy = () => layer.removeFeature(feature);
      layer.reset();
      assert.strictEqual(forgot, 1);
      assert.strictEqual(layer._featureIndex.all().length, 0);
    });
  });
});
