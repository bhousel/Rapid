import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { LineBatch } from '../../../modules/pixi/lib/LineBatch.ts';
import { PixiFeatureLine } from '../../../modules/pixi/PixiFeatureLine.ts';


// A line always has a stroke. Its casing is drawn from zoom 16, if the style has one that can
// be seen, and the mesh for it exists only then. A line that its layer gave a batch has no
// meshes: its casing and stroke are drawn there, with the other lines.
describe('PixiFeatureLine', () => {
  let feature, effectiveZoom, context, haloParent;
  const dashTexture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 16, height: 1 }) });
  const viewportAt = zoom => ({ transform: { zoom: zoom, rotation: 0 } });

  function drawAt(zoom, style) {
    effectiveZoom = zoom;
    if (style) {
      feature.style = style;
    } else {
      feature.dirty = true;
    }
    feature.update(viewportAt(zoom));
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    effectiveZoom = 17;
    context.systems.map = { effectiveZoom: () => effectiveZoom, wireframeMode: false };
    const gfx = { textureManager: { getTexture: () => null, getDashTexture: () => dashTexture } };
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, featureChanged: () => {}, avoidFreed: () => {} };
    haloParent = new PIXI.Container();
    scene.layers.set('map-ui', { halo: haloParent });
    const layer = new AbstractPixiLayer(scene);

    const part = new Rapid.GeometryPart(context);
    part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]] });
    feature = new PixiFeatureLine(layer, 'w1');
    feature.geometry = part;
  });

  it('makes no meshes until it is drawn', () => {
    assert.isNull(feature.casing);
    assert.isNull(feature.stroke);

    drawAt(17, { casing: { opacity: 0 }, stroke: { width: 3, color: 0xffffff } });
    assert.isOk(feature.stroke);
    assert.deepEqual(feature.container.children.map(child => child.label), ['stroke']);
  });

  it('makes the casing from zoom 16, below the stroke', () => {
    drawAt(17, { casing: { width: 5, color: 0x444444 }, stroke: { width: 3, color: 0xffffff } });
    assert.strictEqual(feature.lod, 2);
    assert.isOk(feature.casing);
    assert.deepEqual(feature.container.children.map(child => child.label), ['casing', 'stroke']);
    assert.isFalse(feature.dirty);
  });

  it('destroys the casing below zoom 16, and makes it again above', () => {
    drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
    const casing = feature.casing;

    drawAt(15.5);
    assert.strictEqual(feature.lod, 1);
    assert.isTrue(casing.destroyed);
    assert.isNull(feature.casing);
    assert.deepEqual(feature.container.children.map(child => child.label), ['stroke']);

    drawAt(16.5);
    assert.isOk(feature.casing);
    assert.deepEqual(feature.container.children.map(child => child.label), ['casing', 'stroke']);
  });

  it('makes no casing for a style whose casing can\'t be seen', () => {
    drawAt(17, { casing: { opacity: 0 }, stroke: { width: 4 } });
    assert.isNull(feature.casing);
  });

  describe('the stroke mesh', () => {
    // How wide a mesh draws the line, in the units of its coordinates: the line's first segment runs
    // along x, so it's what the first two vertices are apart in y.
    const widthOf = mesh => Math.abs(mesh.geometry.positions[1] - mesh.geometry.positions[3]);

    it('draws the casing and the stroke from one stroke mesh when they have the same cap and join', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });   // round caps and joins, by default
      const strokeMesh = feature.stroke.strokeMesh;
      assert.isOk(strokeMesh);
      assert.strictEqual(strokeMesh.cap, 'round');
      assert.strictEqual(strokeMesh.join, 'round');
      assert.strictEqual(feature.casing.strokeMesh, strokeMesh);
      assert.strictEqual(feature.casing.geometry.indices, feature.stroke.geometry.indices);
      assert.notStrictEqual(feature.casing.geometry.positions, feature.stroke.geometry.positions);
    });

    it('builds one for each when their caps differ', () => {
      drawAt(17, { casing: { width: 5, cap: 'butt' }, stroke: { width: 3 } });
      assert.strictEqual(feature.casing.strokeMesh.cap, 'butt');
      assert.strictEqual(feature.stroke.strokeMesh.cap, 'round');
    });

    it('keeps the stroke mesh through a zoom, and moves the vertices it has', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
      const strokeMesh = feature.stroke.strokeMesh;
      const positions = feature.stroke.geometry.positions;
      const casingPositions = feature.casing.geometry.positions;
      assert.closeTo(widthOf(feature.stroke), 3 / 2, 1e-4);   // 3 px, where a pixel is half a unit
      assert.closeTo(widthOf(feature.casing), 5 / 2, 1e-4);

      effectiveZoom = 18;
      feature.dirtyTransform();
      feature.update(viewportAt(18));
      assert.strictEqual(feature.stroke.strokeMesh, strokeMesh);
      assert.strictEqual(feature.casing.strokeMesh, strokeMesh);
      assert.strictEqual(feature.stroke.geometry.positions, positions, 'the same array');
      assert.strictEqual(feature.casing.geometry.positions, casingPositions);
      assert.closeTo(widthOf(feature.stroke), 3 / 4, 1e-4);
      assert.closeTo(widthOf(feature.casing), 5 / 4, 1e-4);
    });

    it('draws narrower below zoom 17, and no narrower than 2 px', () => {
      drawAt(16.5, { casing: { width: 5 }, stroke: { width: 3 } });
      const pixel = 2 ** (16 - 16.5);
      assert.closeTo(widthOf(feature.casing), 3 * pixel, 1e-4);   // 5 - 2
      assert.closeTo(widthOf(feature.stroke), 2 * pixel, 1e-4);   // 3 - 2 is under the least
    });

    it('builds a new stroke mesh when the line changes', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
      const strokeMesh = feature.stroke.strokeMesh;

      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001], [0.002, 0.001]] });
      feature.geometry = part;
      feature.update(viewportAt(17));

      assert.notStrictEqual(feature.stroke.strokeMesh, strokeMesh);
      assert.strictEqual(feature.casing.strokeMesh, feature.stroke.strokeMesh);
      assert.isAbove(feature.stroke.strokeMesh.vertexCount, strokeMesh.vertexCount);
    });

    it('builds a new stroke mesh when the join changes', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
      const strokeMesh = feature.stroke.strokeMesh;
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3, join: 'bevel' } });
      assert.strictEqual(feature.casing.strokeMesh, strokeMesh);
      assert.strictEqual(feature.stroke.strokeMesh.join, 'bevel');
    });

    it('gives a line that ends where it starts a join there, not two caps', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]] });
      feature.geometry = part;
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
      assert.isTrue(feature.stroke.strokeMesh.closed);
    });

    it('colors the meshes from the style', () => {
      drawAt(17, { casing: { width: 5, color: 0x444444 }, stroke: { width: 3, color: 0xff8800, opacity: 0.5 } });
      assert.strictEqual(feature.casing.tint, 0x444444);
      assert.strictEqual(feature.casing.alpha, 1);
      assert.strictEqual(feature.stroke.tint, 0xff8800);
      assert.strictEqual(feature.stroke.alpha, 0.5);
      assert.strictEqual(feature.stroke.texture, PIXI.Texture.WHITE);
    });

    it('draws dashes with a texture that repeats along the line', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3, dash: [6, 3], cap: 'butt' } });
      assert.strictEqual(feature.stroke.texture, dashTexture);
      assert.strictEqual(feature.casing.texture, PIXI.Texture.WHITE);

      // The pattern is 9 px long, and a pixel is half a unit at zoom 17
      const strokeMesh = feature.stroke.strokeMesh;
      const uvs = feature.stroke.geometry.uvs;
      let maxU = -Infinity;
      for (let i = 0; i < uvs.length; i += 2) maxU = Math.max(maxU, uvs[i]);
      assert.closeTo(maxU, strokeMesh.length / 4.5, 1e-3);
    });

    it('hides a stroke that can\'t be seen, and lets go of its line', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3, opacity: 0 } });
      assert.isFalse(feature.stroke.visible);
      assert.isNull(feature.stroke.strokeMesh);
      assert.isOk(feature.casing.strokeMesh);

      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
      assert.isTrue(feature.stroke.visible);
      assert.strictEqual(feature.stroke.strokeMesh, feature.casing.strokeMesh);
    });

    it('destroys its meshes with it', () => {
      drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
      const casing = feature.casing;
      const stroke = feature.stroke;
      feature.destroy();
      assert.isTrue(casing.destroyed);
      assert.isTrue(stroke.destroyed);
    });
  });

  // The line's first segment runs along x from its first point, and nothing else is near that point.
  // The casing is 5 pixels wide, and a hit is good 5 pixels around it: 7.5 pixels from the line.
  // A layer that draws many lines gives each two `LineBatch`es, one for its casing and one for
  // its stroke. Each is a run of vertices in its batch then, and a zoom changes nothing there.
  describe('in batches', () => {
    const style = { casing: { width: 5, color: 0x444444 }, stroke: { width: 3, color: 0xffffff } };
    let batch, casingBatch, calls;

    // Counts what the feature asks of a batch
    function watch(target, name) {
      ['add', 'remove', 'setStroke', 'setStyle'].forEach(method => {
        const original = target[method].bind(target);
        target[method] = (...args) => {
          calls.push(`${name}.${method}`);
          return original(...args);
        };
      });
    }

    beforeEach(() => {
      batch = new LineBatch();
      casingBatch = new LineBatch();
      for (const each of [batch, casingBatch]) {
        each.position.set(8388608, 8388608);    // the world's middle, where the line is
      }
      calls = [];
      watch(batch, 'strokes');
      watch(casingBatch, 'casings');
      feature.batch = batch;
      feature.casingBatch = casingBatch;
    });
    afterEach(() => {
      for (const each of [batch, casingBatch]) {
        if (!each.destroyed) each.destroy();
      }
    });

    it('draws the casing in one and the stroke in the other, and has no meshes', () => {
      feature.container.zIndex = 4.25;
      drawAt(17, style);
      assert.isNull(feature.casing);
      assert.isNull(feature.stroke);
      assert.lengthOf(feature.container.children, 0);
      assert.strictEqual(casingBatch.size, 1);
      assert.strictEqual(batch.size, 1);
      assert.deepEqual(calls, ['casings.add', 'strokes.add']);

      const { casingItem, strokeItem } = feature;
      assert.strictEqual(casingItem.batch, casingBatch);
      assert.strictEqual(strokeItem.batch, batch);
      assert.strictEqual(casingItem.order, 4.25);
      assert.strictEqual(strokeItem.order, 4.25);
      assert.strictEqual(casingItem.indices, strokeItem.indices, 'one stroke mesh for both');

      // widths in pixels, as the style has them: the batch's shader narrows them at lower zooms
      const widthOf = item => Array.from(item.batch._floats.subarray(item.first * 12 + 10, item.first * 12 + 12));
      assert.deepEqual(widthOf(casingItem), [5, -3]);
      assert.deepEqual(widthOf(strokeItem), [3, 2]);
    });

    it('writes its vertices relative to each batch\'s own place in the world', () => {
      casingBatch.position.set(8388608 - 50, 8388608 + 20);    // the two batches needn't be in one place
      drawAt(17, style);
      const [x, y] = feature.geometry.world.origin;
      const local = feature.geometry.local.flat[0];

      const item = feature.strokeItem;
      assert.closeTo(batch._floats[item.first * 12], local[0] + x - 8388608, 1e-3);
      assert.closeTo(batch._floats[item.first * 12 + 1], local[1] + y - 8388608, 1e-3);
      assert.isBelow(Math.abs(batch._floats[item.first * 12]), 100);

      const casing = feature.casingItem;
      assert.closeTo(casingBatch._floats[casing.first * 12], local[0] + x - 8388608 + 50, 1e-3);
      assert.closeTo(casingBatch._floats[casing.first * 12 + 1], local[1] + y - 8388608 - 20, 1e-3);
    });

    it('does nothing to the batches for a zoom, also across the zooms where widths and casings change', () => {
      drawAt(17, style);
      calls = [];
      for (const zoom of [18, 16.5, 15, 19]) {
        feature.dirtyTransform();
        effectiveZoom = zoom;
        feature.update(viewportAt(zoom));
      }
      assert.deepEqual(calls, []);
      assert.strictEqual(casingBatch.size, 1, 'the casing stays in its batch below zoom 16, where the shader leaves it out');
      assert.isFalse(feature.dirty);
    });

    it('writes a line that changed where it was', () => {
      drawAt(17, style);
      const { casingItem, strokeItem } = feature;
      const first = strokeItem.first;
      calls = [];

      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.002]] });    // its last point moved
      feature.geometry = part;
      drawAt(17);
      assert.strictEqual(feature.casingItem, casingItem);
      assert.strictEqual(feature.strokeItem, strokeItem);
      assert.strictEqual(strokeItem.first, first);
      assert.deepEqual(calls, ['casings.setStroke', 'casings.setStyle', 'strokes.setStroke', 'strokes.setStyle']);
    });

    it('builds a stroke mesh for each part when their caps differ, and again when a cap changes', () => {
      drawAt(17, { casing: { width: 5, cap: 'butt' }, stroke: { width: 3, cap: 'round' } });
      assert.notStrictEqual(feature.casingItem.indices, feature.strokeItem.indices);

      const before = feature.strokeItem.indices;
      calls = [];
      drawAt(17, { casing: { width: 5, cap: 'butt' }, stroke: { width: 3, cap: 'square' } });
      assert.notStrictEqual(feature.strokeItem.indices, before);
      assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStroke', 'strokes.setStyle'], 'only the stroke is built again');
    });

    it('takes the casing out when the style has none anymore, and leaves out a stroke that can\'t be seen', () => {
      drawAt(17, style);
      drawAt(17, { casing: { opacity: 0 }, stroke: { width: 3 } });
      assert.isNull(feature.casingItem);
      assert.isOk(feature.strokeItem);
      assert.strictEqual(casingBatch.size, 0);

      drawAt(17, { casing: { width: 5 }, stroke: { width: 3, opacity: 0 } });
      assert.isOk(feature.casingItem);
      assert.isNull(feature.strokeItem);
      assert.strictEqual(batch.size, 0);
    });

    it('is hidden and shown in the batches with the feature', () => {
      drawAt(17, style);
      feature.visible = false;
      assert.isFalse(feature.casingItem.visible);
      assert.isFalse(feature.strokeItem.visible);
      batch.flush();
      assert.isFalse(batch.renderable);

      feature.visible = true;
      assert.isTrue(feature.strokeItem.visible);
      assert.isTrue(feature.casingItem.visible);
      batch.flush();
      assert.isTrue(batch.renderable);
    });

    it('moves to other batches when the layer gives it others', () => {
      drawAt(17, style);
      const other = new LineBatch();
      const otherCasings = new LineBatch();
      feature.batch = other;
      feature.casingBatch = otherCasings;
      drawAt(17);
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(casingBatch.size, 0);
      assert.strictEqual(feature.strokeItem.batch, other);
      assert.strictEqual(feature.casingItem.batch, otherCasings);
      other.destroy();
      otherCasings.destroy();
    });

    it('draws with meshes of its own again without batches, or with dashes that a batch can\'t draw', () => {
      drawAt(17, style);
      feature.batch = null;
      feature.casingBatch = null;
      drawAt(17);
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(casingBatch.size, 0);
      assert.isNull(feature.strokeItem);
      assert.isOk(feature.casing);
      assert.isOk(feature.stroke);
      assert.deepEqual(feature.container.children.map(child => child.label), ['casing', 'stroke']);

      feature.batch = batch;
      feature.casingBatch = casingBatch;
      drawAt(17);
      assert.strictEqual(batch.size, 1);
      assert.isNull(feature.stroke);
      assert.lengthOf(feature.container.children, 0);

      drawAt(17, { stroke: { width: 3, dash: [1, 2, 3, 4, 5, 6] } });
      assert.strictEqual(batch.size, 0);
      assert.isOk(feature.stroke);
    });

    it('leaves the batches when it\'s destroyed', () => {
      drawAt(17, style);
      feature.destroy();
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(casingBatch.size, 0);
      assert.strictEqual(batch.users, 0);
      assert.strictEqual(casingBatch.users, 0);
    });

    it('tells a batch that it will draw in it, from when the layer gives it the batch', () => {
      assert.strictEqual(batch.users, 1);    // not drawn yet: the batch is empty, and has to be kept
      assert.strictEqual(casingBatch.users, 1);
      assert.strictEqual(batch.size, 0);

      const other = new LineBatch();
      feature.batch = other;
      assert.strictEqual(batch.users, 0);
      assert.strictEqual(other.users, 1);
      feature.batch = other;
      assert.strictEqual(other.users, 1);
      feature.batch = null;
      assert.strictEqual(other.users, 0);
      feature.casingBatch = null;
      assert.strictEqual(casingBatch.users, 0);
      other.destroy();
    });

    it('draws with meshes of its own if a batch was destroyed', () => {
      casingBatch.destroy();
      drawAt(17, style);
      assert.isOk(feature.stroke);
      assert.isNull(feature.strokeItem);
      assert.strictEqual(batch.size, 0);
    });

    // The glow of a hovered or highlighted line is a filter on its container, so the line has to
    // be drawn there while it glows. It keeps its place in the batches, hidden.
    describe('a line that glows', () => {
      ['hover', 'highlight'].forEach(classID => {
        it(`draws itself while it has the ${classID} class, and goes back to its batches after`, () => {
          drawAt(17, style);
          const { casingItem, strokeItem } = feature;
          calls = [];

          feature.setClass(classID);
          feature.update(viewportAt(17));
          assert.isOk(feature.casing);
          assert.isOk(feature.stroke);
          assert.isAbove(feature.stroke.strokeMesh.vertexCount, 0);
          assert.lengthOf(feature.container.filters, 1);
          assert.strictEqual(feature.strokeItem, strokeItem, 'still in its batch');
          assert.isFalse(strokeItem.visible, '..hidden');
          assert.isFalse(casingItem.visible);
          assert.deepEqual(calls, []);

          feature.unsetClass(classID);
          feature.update(viewportAt(17));
          assert.isNull(feature.stroke);
          assert.isNull(feature.casing);
          assert.isNotOk(feature.container.filters?.length);
          assert.strictEqual(feature.strokeItem, strokeItem);
          assert.isTrue(strokeItem.visible);
          assert.isTrue(casingItem.visible);
          assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStyle']);
        });
      });

      it('isn\'t shown in its batches when the feature is hidden and shown while it glows', () => {
        drawAt(17, style);
        feature.setClass('hover');
        feature.update(viewportAt(17));
        feature.visible = false;
        feature.visible = true;
        assert.isFalse(feature.strokeItem.visible);
      });

      it('gets its new shape in the batches when it changed while it glowed', () => {
        drawAt(17, style);
        feature.setClass('hover');
        feature.update(viewportAt(17));

        const part = new Rapid.GeometryPart(context);
        part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.002]] });
        feature.geometry = part;
        drawAt(17);
        calls = [];

        feature.unsetClass('hover');
        feature.update(viewportAt(17));
        assert.deepEqual(calls, ['casings.setStroke', 'casings.setStyle', 'strokes.setStroke', 'strokes.setStyle']);
      });
    });

    // A line that its batches draw has nothing in its container, and its layer keeps it out of the scene.
    describe('drawsInContainer', () => {
      it('is false for a line that its batches draw, and true without batches', () => {
        feature.style = style;
        assert.isFalse(feature.drawsInContainer());
        feature.casingBatch = null;
        assert.isTrue(feature.drawsInContainer());
      });

      it('is true while the line glows', () => {
        feature.style = style;
        feature.setClass('hover');
        assert.isTrue(feature.drawsInContainer());
        feature.unsetClass('hover');
        feature.setClass('highlight');
        assert.isTrue(feature.drawsInContainer());
        feature.unsetClass('highlight');
        feature.setClass('select');    // a halo is drawn elsewhere
        assert.isFalse(feature.drawsInContainer());
      });

      it('is true for a line with markers along it', () => {
        feature.style = { ...style, lineMarker: { image: 'oneway' } };
        assert.isTrue(feature.drawsInContainer());
        feature.style = { ...style, sidedMarker: { image: 'sided' } };
        assert.isTrue(feature.drawsInContainer());
      });

      it('is true for a line with dashes that a batch can\'t draw', () => {
        feature.style = { stroke: { width: 3, dash: [1, 2, 3, 4, 5, 6] } };
        assert.isTrue(feature.drawsInContainer());
      });
    });

    it('says where it\'s drawn: its stroke\'s batch and its order there, or its own container', () => {
      feature.container.zIndex = -8.5;
      assert.strictEqual(feature.sceneContainer, feature.container);    // not drawn yet
      drawAt(17, style);
      assert.strictEqual(feature.sceneContainer, batch);
      assert.strictEqual(feature.sceneOrder, -8.5);

      feature.setClass('hover');
      feature.update(viewportAt(17));
      assert.strictEqual(feature.sceneContainer, feature.container);
      assert.strictEqual(feature.sceneOrder, 0);
    });

    it('is still hit, and gets its halo, as without batches', () => {
      feature.setClass('select');
      drawAt(17, style);
      const [x, y] = feature.geometry.local.flat[0];
      assert.isTrue(feature.container.hitArea.contains(x + 1, y + 3.5));
      assert.strictEqual(feature.hitReach, 7.5);
      assert.isOk(feature.halo);
    });
  });


  // A line is hit within a few pixels of it. The test is in world coordinates, with nothing of
  // Pixi's in it, so it's the same for a line whose container isn't in the scene.
  describe('hitTest', () => {
    const style = { casing: { width: 5 }, stroke: { width: 3 } };
    const STAGE = { x: 0, y: 0 };    // not looked at

    // A point in the world, by its place in the line's own coordinates
    function worldAt(dx, dy) {
      const [x, y] = feature.geometry.local.flat[0];
      const [ox, oy] = feature.geometry.world.origin;
      return { x: ox + x + dx, y: oy + y + dy };
    }

    it('hits within a few pixels of the line, wherever the feature\'s container is', () => {
      drawAt(17, style);    // a pixel is half a unit of the line's coordinates: 3.75 units
      assert.isNull(feature.container.parent);
      assert.isTrue(feature.hitTest(STAGE, worldAt(1, 0)), 'on the line');
      assert.isTrue(feature.hitTest(STAGE, worldAt(1, 3.5)), 'beside it');
      assert.isFalse(feature.hitTest(STAGE, worldAt(1, 4)), 'too far beside it');
      assert.isFalse(feature.hitTest(STAGE, { x: 0, y: 0 }));
    });

    it('never hits a line that\'s hidden, not allowed to be interactive, or being drawn', () => {
      drawAt(17, style);
      const on = worldAt(1, 0);
      feature.visible = false;
      assert.isFalse(feature.hitTest(STAGE, on));
      feature.visible = true;
      feature.allowInteraction = false;    // as while a node of it is dragged
      assert.isFalse(feature.hitTest(STAGE, on));
      feature.allowInteraction = true;
      assert.isTrue(feature.hitTest(STAGE, on));

      feature.setClass('drawing');
      drawAt(17);
      assert.isFalse(feature.hitTest(STAGE, on));
    });

    it('doesn\'t hit a line that was never drawn', () => {
      assert.isFalse(feature.hitTest(STAGE, { x: 8388608, y: 8388608 }));
    });
  });


  describe('the hit area', () => {
    const style = { casing: { width: 5 }, stroke: { width: 3 } };

    it('is the line with a few pixels around it', () => {
      drawAt(17, style);    // a pixel is half a unit of the line's coordinates: 3.75 units
      const [x, y] = feature.geometry.local.flat[0];
      const hitArea = feature.container.hitArea;
      assert.isTrue(hitArea.contains(x + 1, y), 'on the line');
      assert.isTrue(hitArea.contains(x + 1, y + 3.5), 'beside it');
      assert.isTrue(hitArea.contains(x + 1, y - 3.5), 'on its other side');
      assert.isTrue(hitArea.contains(x - 3.5, y), 'past its end');
      assert.isFalse(hitArea.contains(x + 1, y + 4), 'too far beside it');
      assert.isFalse(hitArea.contains(x - 4, y), 'too far past its end');
      assert.isFalse(hitArea.contains(1e6, 1e6));
      assert.strictEqual(feature.hitReach, 7.5);    // ..which is this many pixels from the line
    });

    it('is kept through a zoom, with the distance of the new zoom', () => {
      drawAt(17, style);
      const [x, y] = feature.geometry.local.flat[0];
      const hitArea = feature.container.hitArea;
      assert.isTrue(hitArea.contains(x + 1, y + 3.5));

      drawAt(18);    // a pixel is a quarter of a unit: 1.875 units
      assert.strictEqual(feature.container.hitArea, hitArea);
      assert.isFalse(hitArea.contains(x + 1, y + 3.5));
      assert.isTrue(hitArea.contains(x + 1, y + 1.8));
    });

    it('follows a line that changed', () => {
      drawAt(17, style);
      const hitArea = feature.container.hitArea;
      const length = Math.abs(feature.geometry.local.flat[0][2] - feature.geometry.local.flat[0][0]);

      // A line twice as long, along x only
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.002, 0]] });
      feature.geometry = part;
      drawAt(17);
      const [x, y] = part.local.flat[0];
      assert.strictEqual(feature.container.hitArea, hitArea);
      assert.isTrue(hitArea.contains(x + 1.9 * length, y), 'on the new line, past the end of the old one');
      assert.isFalse(hitArea.contains(x + length, y - length / 2), 'where the old line went');
    });

    it('is gone while the line is being drawn', () => {
      feature.setClass('drawing');
      drawAt(17, style);
      assert.isNull(feature.container.hitArea);
      assert.strictEqual(feature.hitReach, 0);
    });
  });

  describe('the select halo', () => {
    const style = { casing: { width: 5 }, stroke: { width: 3 } };

    it('is a dashed ring around the line, at the edge of its hit area', () => {
      feature.setClass('select');
      drawAt(17, style);
      const halo = feature.halo;
      assert.strictEqual(halo.parent, haloParent);
      assert.strictEqual(halo.children.length, 1);
      assert.strictEqual(halo.children[0].texture, dashTexture);
      assert.strictEqual(halo.tint, 0xffff00);
      assert.deepEqual([halo.position.x, halo.position.y], [feature.container.position.x, feature.container.position.y]);

      // The ring is 3.75 units from the line, and its own line is 1 unit wide (2 pixels).
      const coords = feature.geometry.local.flat[0];
      const positions = halo.children[0].geometry.positions;
      assert.isAbove(positions.length, 16);
      for (let i = 0; i < positions.length; i += 2) {
        assert.isTrue(Rapid.geomStrokeContains(coords, 3.75 + 1.1, positions[i], positions[i + 1]), `vertex ${i / 2} is too far from the line`);
        assert.isFalse(Rapid.geomStrokeContains(coords, 3.75 - 1.1, positions[i], positions[i + 1]), `vertex ${i / 2} is too near the line`);
      }
    });

    it('is two rings for a line that ends where it starts', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]] });
      feature.geometry = part;
      feature.setClass('select');
      drawAt(17, style);
      assert.strictEqual(feature.halo.children.length, 2);
    });

    it('keeps its meshes through a zoom, and is destroyed with them when the line isn\'t selected', () => {
      feature.setClass('select');
      drawAt(17, style);
      const halo = feature.halo;
      const ring = halo.children[0];

      drawAt(18);
      assert.strictEqual(feature.halo, halo);
      assert.strictEqual(halo.children[0], ring);

      feature.unsetClass('select');
      drawAt(18);
      assert.isNull(feature.halo);
      assert.isTrue(halo.destroyed);
      assert.isTrue(ring.destroyed);
    });

    it('is not drawn while the line is being drawn', () => {
      feature.setClass('select');
      feature.setClass('drawing');
      drawAt(17, style);
      assert.isNull(feature.halo);
    });
  });
});
