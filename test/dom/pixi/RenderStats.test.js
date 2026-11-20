import * as PIXI from 'pixi.js';
import { findChangedRenderGroups } from '../../../modules/pixi/lib/RenderStats.ts';


describe('RenderStats', () => {

  // Pixi rebuilds a render group's instruction list when something in it was added, removed, shown
  // or hidden. Without a renderer nothing clears the flags, so the test clears them as a render would.
  describe('findChangedRenderGroups', () => {
    let stage, lines, polygons;

    const settle = () => {
      for (const container of [stage, lines, polygons]) {
        container.renderGroup.structureDidChange = false;
      }
    };

    beforeEach(() => {
      stage = new PIXI.Container({ isRenderGroup: true });
      lines = new PIXI.Container({ isRenderGroup: true });
      polygons = new PIXI.Container({ isRenderGroup: true });
      stage.addChild(lines, polygons);
      lines.addChild(new PIXI.Container(), new PIXI.Container());
      polygons.addChild(new PIXI.Container());
      settle();
    });

    it('finds nothing when nothing changed', () => {
      assert.strictEqual(findChangedRenderGroups(stage).size, 0);
    });

    it('finds only the render group of a child that was hidden', () => {
      lines.children[0].visible = false;
      assert.deepEqual([...findChangedRenderGroups(stage)], [lines.renderGroup]);
    });

    it('finds the render group that got a new child', () => {
      polygons.addChild(new PIXI.Container());
      assert.deepEqual([...findChangedRenderGroups(stage)], [polygons.renderGroup]);
    });

    it('finds nothing under a container that isn\'t a render group', () => {
      assert.strictEqual(findChangedRenderGroups(new PIXI.Container()).size, 0);
    });
  });
});
