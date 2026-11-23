import * as PIXI from 'pixi.js';
import { LineMesh } from '../../../modules/pixi/lib/LineMesh.ts';
import { drawHalo, drawRings } from '../../../modules/pixi/helpers.ts';


describe('pixi helpers', () => {
  const dashTexture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 64, height: 1 }) });
  const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
  const triangle = [20, 0, 30, 0, 25, 8];

  // How wide a mesh draws its line: the square's first segment runs along x, so it's what the
  // vertices of that segment are apart in y.
  function widthOf(mesh) {
    const ys = [];
    for (let i = 1; i < mesh.geometry.positions.length; i += 2) ys.push(mesh.geometry.positions[i]);
    return -2 * Math.min(...ys);    // the bottom edge is at y = 0, so the line goes half its width below
  }

  describe('drawRings', () => {
    it('draws each ring as a closed LineMesh that can\'t be hit', () => {
      const parent = new PIXI.Container();
      drawRings(parent, [square, triangle], 2);
      assert.strictEqual(parent.children.length, 2);
      for (const mesh of parent.children) {
        assert.instanceOf(mesh, LineMesh);
        assert.strictEqual(mesh.eventMode, 'none');
        assert.isTrue(mesh.strokeMesh.closed);
        assert.strictEqual(mesh.texture, PIXI.Texture.WHITE);
      }
      assert.closeTo(widthOf(parent.children[0]), 2, 1e-4);
      assert.strictEqual(parent.children[0].strokeMesh.length, 40);
    });

    it('draws dashes from a texture', () => {
      const parent = new PIXI.Container();
      drawRings(parent, [square], 2, dashTexture, 9);
      const mesh = parent.children[0];
      assert.strictEqual(mesh.texture, dashTexture);
      const us = [];
      for (let i = 0; i < mesh.geometry.uvs.length; i += 2) us.push(mesh.geometry.uvs[i]);
      assert.closeTo(Math.max(...us), 40 / 9, 0.3);    // the ring is 40 long, a repeat is 9
    });

    it('keeps the meshes it has, and destroys the ones of rings that are gone', () => {
      const parent = new PIXI.Container();
      drawRings(parent, [square, triangle], 2);
      const [first, second] = parent.children;

      drawRings(parent, [triangle], 4);
      assert.strictEqual(parent.children.length, 1);
      assert.strictEqual(parent.children[0], first);
      assert.closeTo(first.strokeMesh.length, 10 + 2 * Math.hypot(5, 8), 1e-9);
      assert.isTrue(second.destroyed);

      drawRings(parent, [], 4);
      assert.strictEqual(parent.children.length, 0);
      assert.isTrue(first.destroyed);
    });
  });

  describe('drawHalo', () => {
    it('draws yellow dashes 2 pixels wide, whatever a pixel is in the container\'s coordinates', () => {
      const asked = [];
      const textures = { getDashTexture: dash => { asked.push(dash); return dashTexture; } };
      const halo = new PIXI.Container();

      drawHalo(halo, [square], 1, textures);
      assert.strictEqual(halo.tint, 0xffff00);
      assert.closeTo(halo.alpha, 0.9, 1e-6);
      assert.deepEqual(asked, [[6, 3]]);
      assert.strictEqual(halo.children[0].texture, dashTexture);
      assert.closeTo(widthOf(halo.children[0]), 2, 1e-4);

      drawHalo(halo, [square], 0.25, textures);    // zoomed in by 4: a pixel is a quarter of a unit
      assert.closeTo(widthOf(halo.children[0]), 0.5, 1e-4);
    });
  });
});
