import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as PIXI from 'pixi.js';
import * as Rapid from '../../../modules/headless.js';
import { AbstractBehavior } from '../../../modules/behaviors/AbstractBehavior.ts';


describe('AbstractBehavior', () => {
  let behavior;

  // A stand-in feature with a container, as a layer makes them
  function makeFeature(id, dataID) {
    const container = new PIXI.Container();
    const feature = { id: id, container: container, layer: { id: 'osm' }, data: { dataID: dataID } };
    container.__feature__ = feature;
    return feature;
  }

  function pointerEvent(props = {}) {
    return { pointerId: 1, global: { x: 10, y: 20 }, originalEvent: {}, timeStamp: 5, target: null, ...props };
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    context.viewport.dimensions = [800, 600];
    behavior = new AbstractBehavior(context);
  });


  describe('_getEventData', () => {
    it('targets the feature that the scene found under the pointer, whatever Pixi\'s target is', () => {
      const way = makeFeature('osm-w1-0', 'w1');
      const stage = new PIXI.Container();
      const data = behavior._getEventData(pointerEvent({ target: stage, _feature: way }));

      assert.strictEqual(data.target.feature, way);
      assert.strictEqual(data.target.container, way.container);
      assert.strictEqual(data.target.featureID, 'osm-w1-0');
      assert.strictEqual(data.target.layerID, 'osm');
      assert.strictEqual(data.target.dataID, 'w1');
      assert.deepEqual(data.coord.screen, [10, 20]);
    });

    it('looks up from Pixi\'s target for a feature when the event carries none', () => {
      const note = makeFeature('osm-notes-1', 'osm-notes:1');
      const marker = new PIXI.Container();
      note.container.addChild(marker);

      const data = behavior._getEventData(pointerEvent({ target: marker }));
      assert.strictEqual(data.target.feature, note);
      assert.strictEqual(data.target.container, note.container);
      assert.strictEqual(data.target.dataID, 'osm-notes:1');
    });

    it('targets the container alone when there\'s no feature there, and nothing when Pixi found nothing', () => {
      const stage = new PIXI.Container();
      const data = behavior._getEventData(pointerEvent({ target: stage, _feature: null }));
      assert.strictEqual(data.target.container, stage);
      assert.isNull(data.target.feature);
      assert.isNull(data.target.dataID);

      assert.isNull(behavior._getEventData(pointerEvent()).target);
    });
  });
});
