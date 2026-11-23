import * as PIXI from 'pixi.js';
import 'pixi.js/events';   // gives containers `eventMode` and `interactiveChildren`, as a renderer does in the app
import { LineMesh } from '../../../modules/pixi/lib/LineMesh.ts';
import { containerHit, drawHalo, drawOrder, drawRings } from '../../../modules/pixi/helpers.ts';


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

  // The rules are Pixi's own (`EventBoundary.hitTestRecursive`), for one container and what's in it.
  // Nothing is rendered here, so a container's coordinates are the stage's.
  describe('containerHit', () => {
    const inside = { x: 5, y: 5 };
    const outside = { x: 50, y: 5 };

    function box(eventMode = 'static') {    // draws a square from 0,0 to 10,10
      const graphics = new PIXI.Graphics().rect(0, 0, 10, 10).fill(0xffffff);
      graphics.eventMode = eventMode;
      return graphics;
    }

    it('hits a container inside its hit area, and not outside it', () => {
      const container = new PIXI.Container();
      container.eventMode = 'static';
      container.hitArea = new PIXI.Rectangle(0, 0, 10, 10);
      assert.isTrue(containerHit(container, inside));
      assert.isFalse(containerHit(container, outside));
    });

    it('hits what a container draws, when it has no hit area', () => {
      assert.isTrue(containerHit(box(), inside));
      assert.isFalse(containerHit(box(), outside));
    });

    it('never hits a container that\'s hidden, or has eventMode none', () => {
      const hidden = box();
      hidden.visible = false;
      assert.isFalse(containerHit(hidden, inside));
      assert.isFalse(containerHit(box('none'), inside));
    });

    it('hits a container through a child', () => {
      const parent = new PIXI.Container();
      parent.eventMode = 'passive';
      parent.addChild(box());
      assert.isTrue(containerHit(parent, inside));
      assert.isFalse(containerHit(parent, outside));
    });

    it('leaves out a child with eventMode none, and the children of a container without interactive children', () => {
      const parent = new PIXI.Container();
      parent.eventMode = 'static';
      parent.addChild(box('none'));
      assert.isFalse(containerHit(parent, inside));

      for (const eventMode of ['passive', 'static']) {
        const closed = new PIXI.Container();
        closed.eventMode = eventMode;
        closed.interactiveChildren = false;
        closed.addChild(box());
        assert.isFalse(containerHit(closed, inside), eventMode);
      }

      // ..and a passive one of those isn't hit for what it draws either, under an interactive container
      const under = new PIXI.Container();
      under.eventMode = 'static';
      const drawing = box('passive');
      drawing.interactiveChildren = false;
      under.addChild(drawing);
      assert.isFalse(containerHit(under, inside));
    });

    it('makes what\'s under an interactive container interactive: a passive child is hit there, and not by itself', () => {
      assert.isFalse(containerHit(box('passive'), inside));

      const parent = new PIXI.Container();
      parent.eventMode = 'static';
      parent.addChild(box('passive'));
      assert.isTrue(containerHit(parent, inside));
    });

    it('doesn\'t look at the children of a container whose hit area is missed', () => {
      const parent = new PIXI.Container();
      parent.eventMode = 'static';
      parent.hitArea = new PIXI.Rectangle(100, 100, 10, 10);
      parent.addChild(box());
      assert.isFalse(containerHit(parent, inside));
    });

    it('doesn\'t hit a plain container that draws nothing and has no hit area', () => {
      const container = new PIXI.Container();
      container.eventMode = 'static';
      assert.isFalse(containerHit(container, inside));
    });
  });


  describe('drawOrder', () => {
    // root
    // ├ a
    // │  ├ a1
    // │  └ a2
    // └ b
    //    └ b1
    //       └ b11
    let root, a, a1, a2, b, b1, b11;
    beforeEach(() => {
      [root, a, a1, a2, b, b1, b11] = Array.from({ length: 7 }, () => new PIXI.Container());
      root.addChild(a, b);
      a.addChild(a1, a2);
      b.addChild(b1);
      b1.addChild(b11);
    });

    it('puts children of one parent in the order they\'re kept in', () => {
      assert.isAbove(drawOrder(a2, a1), 0);
      assert.isBelow(drawOrder(a1, a2), 0);
    });

    it('goes by the first containers that differ on the way down, at any depth', () => {
      assert.isAbove(drawOrder(b11, a2), 0);
      assert.isBelow(drawOrder(a2, b11), 0);
      assert.isAbove(drawOrder(b, a1), 0);
      assert.isBelow(drawOrder(a1, b), 0);
    });

    it('puts a container before what\'s in it', () => {
      assert.isBelow(drawOrder(b, b11), 0);
      assert.isAbove(drawOrder(b11, b), 0);
    });

    it('follows a new order of the children', () => {
      root.addChildAt(b, 0);
      assert.isAbove(drawOrder(a1, b11), 0);
    });

    it('returns 0 for a container and itself, and for two that aren\'t in one tree', () => {
      assert.strictEqual(drawOrder(a1, a1), 0);
      assert.strictEqual(drawOrder(a1, new PIXI.Container()), 0);
    });
  });
});
