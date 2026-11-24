import * as PIXI from 'pixi.js';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { findChangedRenderGroups, readInstructionStats } from '../../../modules/pixi/lib/RenderStats.ts';
import { geomStrokeMesh } from '../../../modules/geo/stroke.ts';


describe('RenderStats', () => {

  // Pixi rebuilds a render group's instruction list when something in it was added, removed, shown
  // or hidden. Without a renderer nothing clears the flags, so the test clears them as a render would.
  describe('readInstructionStats', () => {
    // A render group as Pixi built it, with these instructions
    const rootWith = instructions => ({
      renderGroup: { renderGroupChildren: [], instructionSet: { instructionSize: instructions.length, instructions: instructions } }
    });

    it('counts the triangles that a mesh draws: all of its index buffer, or the part it says', () => {
      const mesh = new PIXI.Mesh({
        geometry: new PIXI.MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array(6) })
      });
      const batch = new LineBatchMesh();    // has room for more than it draws
      batch.add(geomStrokeMesh([0, 0, 10, 0]), 0, 0, { width: 3, minWidth: 2, color: 0xffffff, alpha: 1 });
      batch.flush();
      const drawn = batch.geometry.indexCount;
      assert.isAbove(drawn, 0);
      assert.isAbove(batch.geometry.indexBuffer.data.length, drawn);

      const stats = readInstructionStats({}, rootWith([mesh, batch]), new Set());
      assert.strictEqual(stats.instructions.mesh, 2);
      assert.strictEqual(stats.triangles, 2 + drawn / 3);
      batch.destroy();
    });
  });


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
