import * as PIXI from 'pixi.js';
import 'pixi.js/events';   // gives containers `eventMode` and `interactiveChildren`, as a renderer does in the app
import { GlowFilter } from 'pixi-filters';
import { LineBatch } from '../../../modules/pixi/lib/LineBatch.ts';
import { LineMesh } from '../../../modules/pixi/lib/LineMesh.ts';
import {
  containerHit, drawHalo, drawOrder, drawRings, featureOrder, glowColor, ringsContain, setGlowFilter, triangulate,
  HIGHLIGHT_COLOR, HOVER_COLOR
} from '../../../modules/pixi/helpers.ts';


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

  // A halo is lines in a batch (the map UI layer's): for each ring a dark line, and yellow
  // dashes over it. A vertex there is 12 floats (0, 1 the point on the line; 10, 11 its width
  // and least width, the width negative for a line whose dashes march) and 8 bytes (color,
  // opacity, dashes).
  describe('drawHalo', () => {
    const FLOATS = 12;
    const BYTES = 8;
    let batch;

    beforeEach(() => {
      batch = new LineBatch();
    });
    afterEach(() => {
      if (!batch.destroyed) batch.destroy();
    });

    const floatsOf = (item, i = 0) => Array.from(item.batch._floats.subarray((item.first + i) * FLOATS, (item.first + i + 1) * FLOATS));
    const bytesOf = (item, i = 0) => Array.from(item.batch._bytes.subarray((item.first + i) * BYTES, (item.first + i + 1) * BYTES));
    // The box of the points on the line that an item's vertices belong to: [minX, minY, maxX, maxY]
    const boxOf = item => {
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < item.count; i++) {
        const [x, y] = floatsOf(item, i);
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
      return box;
    };

    it('draws each ring as two lines: a dark one, and yellow dashes over it', () => {
      const items = [];
      drawHalo(batch, items, [square, triangle], 0, 0);
      assert.lengthOf(items, 4);
      assert.strictEqual(batch.size, 4);

      for (const ring of [0, 1]) {
        const [under, dashes] = [items[ring * 2], items[ring * 2 + 1]];
        assert.strictEqual(under.batch, batch);
        assert.strictEqual(under.count, dashes.count, 'along the same line');
        assert.isBelow(under.order, dashes.order, 'the dashes are drawn over the dark line');
        for (let i = 0; i < under.count; i++) {
          assert.deepEqual(floatsOf(under, i).slice(10), [-4, 4], 'the dark line is 4 pixels wide');
          assert.deepEqual(bytesOf(under, i), [0, 0, 0, Math.round(0.55 * 255), 0, 0, 0, 0]);
          assert.deepEqual(floatsOf(dashes, i).slice(10), [-2, 2], 'the dashes are 2 pixels wide');
          assert.deepEqual(bytesOf(dashes, i), [255, 255, 0, 255, 6, 3, 0, 0]);
        }
      }
      assert.deepEqual(boxOf(items[1]), [0, 0, 10, 10]);
      assert.deepEqual(boxOf(items[3]), [20, 0, 30, 8]);
    });

    it('makes both lines march: their width is written as negative, which the shader reads so', () => {
      const items = [];
      drawHalo(batch, items, [square], 0, 0);
      for (const item of items) {
        assert.isBelow(floatsOf(item)[10], 0);
      }
    });

    it('puts the rings where they are in the world, in the batch\'s coordinates', () => {
      batch.position.set(1000, 2000);
      const items = [];
      drawHalo(batch, items, [square], 1100, 2050);
      assert.deepEqual(boxOf(items[0]), [100, 50, 110, 60]);
      assert.deepEqual(boxOf(items[1]), [100, 50, 110, 60]);
    });

    it('closes each ring, whether or not its last point repeats its first', () => {
      const repeated = [];
      const open = [];
      drawHalo(batch, repeated, [square], 0, 0);
      drawHalo(batch, open, [square.slice(0, 8)], 0, 0);
      assert.strictEqual(open[0].count, repeated[0].count);
      assert.strictEqual(open[0].indices.length, repeated[0].indices.length);
    });

    it('writes a ring that changed where the old one was, if it has as many points', () => {
      const items = [];
      drawHalo(batch, items, [square], 0, 0);
      const [under, dashes] = items;
      const first = [under.first, dashes.first];

      const moved = square.map(v => v + 5);
      drawHalo(batch, items, [moved], 0, 0);
      assert.deepEqual(items, [under, dashes], 'the same items');
      assert.deepEqual([under.first, dashes.first], first, 'in the same place');
      assert.strictEqual(batch.size, 2);
      assert.deepEqual(boxOf(dashes), [5, 5, 15, 15]);
      assert.deepEqual(floatsOf(dashes).slice(10), [-2, 2]);
      assert.deepEqual(bytesOf(under).slice(0, 4), [0, 0, 0, Math.round(0.55 * 255)]);
    });

    it('keeps a hidden halo hidden when its rings change', () => {
      const items = [];
      drawHalo(batch, items, [square], 0, 0);
      for (const item of items) batch.setVisible(item, false);

      drawHalo(batch, items, [triangle], 0, 0);     // another number of points
      for (const item of items) {
        assert.isFalse(item.visible);
        assert.strictEqual(bytesOf(item)[3], 0);
      }
    });

    it('takes away the lines of a ring that\'s gone, and all of them for no rings', () => {
      const items = [];
      drawHalo(batch, items, [square, triangle], 0, 0);
      const kept = items.slice(0, 2);

      drawHalo(batch, items, [square], 0, 0);
      assert.deepEqual(items, kept);
      assert.strictEqual(batch.size, 2);

      drawHalo(batch, items, [], 0, 0);
      assert.lengthOf(items, 0);
      assert.strictEqual(batch.size, 0);
    });

    it('moves a halo that was in another batch into this one', () => {
      const other = new LineBatch();
      const items = [];
      drawHalo(other, items, [square], 0, 0);
      assert.strictEqual(other.size, 2);

      drawHalo(batch, items, [square], 0, 0);
      assert.strictEqual(other.size, 0);
      assert.strictEqual(batch.size, 2);
      assert.lengthOf(items, 2);
      for (const item of items) {
        assert.strictEqual(item.batch, batch);
      }
      other.destroy();
    });
  });

  describe('glowColor', () => {
    it('is yellow for a hover, blue for a highlight, and nothing otherwise', () => {
      assert.strictEqual(glowColor(new Set(['hover'])), 0xffff00);
      assert.strictEqual(glowColor(new Set(['highlight'])), 0x7092ff);
      assert.isNull(glowColor(new Set()));
      assert.isNull(glowColor(new Set(['select', 'drawing'])));
      assert.strictEqual(HOVER_COLOR, 0xffff00);
      assert.strictEqual(HIGHLIGHT_COLOR, 0x7092ff);
    });

    it('is the hover\'s for what is both hovered and highlighted', () => {
      assert.strictEqual(glowColor(new Set(['highlight', 'select', 'hover'])), HOVER_COLOR);
    });
  });

  // For a feature that draws itself: one that batches draw has its glow drawn there.
  describe('setGlowFilter', () => {
    it('gives a container one glow filter in the color, and keeps it when asked again', () => {
      const container = new PIXI.Container();
      setGlowFilter(container, HOVER_COLOR);
      assert.lengthOf(container.filters, 1);
      const filter = container.filters[0];
      assert.instanceOf(filter, GlowFilter);
      assert.strictEqual(new PIXI.Color(filter.color).toNumber(), 0xffff00);

      setGlowFilter(container, HOVER_COLOR);
      assert.lengthOf(container.filters, 1);
      assert.strictEqual(container.filters[0], filter);
    });

    it('gives the filter it has another color, when a hover comes over a highlight', () => {
      const container = new PIXI.Container();
      setGlowFilter(container, HIGHLIGHT_COLOR);
      const filter = container.filters[0];
      setGlowFilter(container, HOVER_COLOR);
      assert.strictEqual(container.filters[0], filter);
      assert.strictEqual(new PIXI.Color(filter.color).toNumber(), 0xffff00);
      setGlowFilter(container, HIGHLIGHT_COLOR);
      assert.strictEqual(new PIXI.Color(filter.color).toNumber(), 0x7092ff);
    });

    it('takes the filter away for no color, and does nothing to a container without one', () => {
      const container = new PIXI.Container();
      setGlowFilter(container, null);
      assert.isNotOk(container.filters?.length);

      setGlowFilter(container, HIGHLIGHT_COLOR);
      setGlowFilter(container, null);
      assert.isNotOk(container.filters?.length);
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

    // A feature is drawn by its own container, or by a mesh that draws several (lines in a batch)
    describe('featureOrder', () => {
      const feature = (sceneContainer, sceneOrder = 0) => ({ sceneContainer: sceneContainer, sceneOrder: sceneOrder });

      it('puts features in the order of where they\'re drawn in the scene', () => {
        assert.isAbove(featureOrder(feature(b11), feature(a2)), 0);
        assert.isBelow(featureOrder(feature(a1), feature(a2)), 0);
      });

      it('puts two features that one mesh draws in their order there', () => {
        assert.isAbove(featureOrder(feature(a1, 5.5), feature(a1, 5.25)), 0);
        assert.isBelow(featureOrder(feature(a1, -3), feature(a1, 2)), 0);
        assert.strictEqual(featureOrder(feature(a1, 2), feature(a1, 2)), 0);
      });

      it('goes by the scene first, whatever the orders are', () => {
        assert.isAbove(featureOrder(feature(a2, 0), feature(a1, 100)), 0);
      });
    });
  });

  // The triangles that fill polygons, for a `FillBatch`
  describe('triangulate', () => {
    // The area that triangles cover
    function areaOf({ positions, indices }) {
      let area = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
        area += Math.abs((positions[b * 2] - positions[a * 2]) * (positions[c * 2 + 1] - positions[a * 2 + 1]) -
          (positions[c * 2] - positions[a * 2]) * (positions[b * 2 + 1] - positions[a * 2 + 1])) / 2;
      }
      return area;
    }

    const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const hole = [4, 4, 6, 4, 6, 6, 4, 6, 4, 4];

    it('fills a polygon with triangles between its own points', () => {
      const result = triangulate([{ outer: square, holes: [] }]);
      assert.deepEqual(Array.from(result.positions), square);
      assert.strictEqual(result.indices.length % 3, 0);
      assert.closeTo(areaOf(result), 100, 1e-9);
      assert.isBelow(Math.max(...result.indices), 5);
    });

    it('leaves the holes out', () => {
      const result = triangulate([{ outer: square, holes: [hole] }]);
      assert.lengthOf(result.positions, 20);
      assert.closeTo(areaOf(result), 96, 1e-9);
    });

    it('fills several polygons, each with its own corners', () => {
      const other = square.map((n, i) => (i % 2 === 0) ? n + 100 : n);
      const result = triangulate([{ outer: square, holes: [hole] }, { outer: other, holes: [] }]);
      assert.lengthOf(result.positions, 30);
      assert.closeTo(areaOf(result), 196, 1e-9);
      const second = Array.from(result.indices).filter(index => index >= 10);
      assert.isAbove(second.length, 0);
      assert.strictEqual(result.positions[10 * 2], 100);
    });

    it('returns no triangles for a polygon that has no area', () => {
      const result = triangulate([{ outer: [0, 0, 10, 0, 0, 0], holes: [] }]);
      assert.lengthOf(result.indices, 0);
    });
  });


  describe('ringsContain', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const hole = [4, 4, 6, 4, 6, 6, 4, 6, 4, 4];

    it('is true inside a ring, and false outside it', () => {
      assert.isTrue(ringsContain([square], 5, 5));
      assert.isTrue(ringsContain([square], 0.1, 9.9));
      assert.isFalse(ringsContain([square], 11, 5));
      assert.isFalse(ringsContain([square], 5, -1));
    });

    it('is false in a hole, whichever way the rings go around', () => {
      assert.isFalse(ringsContain([square, hole], 5, 5));
      assert.isTrue(ringsContain([square, hole], 2, 2));
      const reversed = [];
      for (let i = hole.length - 2; i >= 0; i -= 2) reversed.push(hole[i], hole[i + 1]);
      assert.isFalse(ringsContain([square, reversed], 5, 5));
    });

    it('is false for no rings', () => {
      assert.isFalse(ringsContain([], 5, 5));
    });
  });
});
