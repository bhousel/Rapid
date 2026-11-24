import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { PixiFeatureLine } from '../../../modules/pixi/PixiFeatureLine.ts';
import { BatchShaders } from '../../../modules/pixi/lib/BatchShaders.ts';
import { LayerBatches } from '../../../modules/pixi/lib/LayerBatches.ts';

// The shaders that a scene's batches draw with (every batch of a kind shares its kind's shader)
const batchShaders = new BatchShaders();


// A line always has a stroke. Its casing is drawn from zoom 16, if the style has one that can
// be seen, and the mesh for it exists only then. A line that its layer gave a batch has no
// meshes: its casing and stroke are drawn there, with the other lines.
// The halo of a selected line is in a batch too, the map UI layer's, whatever draws the line.
describe('PixiFeatureLine', () => {
  let feature, effectiveZoom, context, scene, haloBatch;
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
    scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, labelSpace: { featureChanged: () => {}, avoidFreed: () => {} } };

    // The map UI layer makes its batch of halos where the first halo is, as the real one does.
    haloBatch = null;
    scene.layers.set('map-ui', {
      haloBatchAt: (x, y) => {
        if (!haloBatch) {
          haloBatch = new LineBatchMesh(batchShaders.lines);
          haloBatch.position.set(x, y);
        }
        return haloBatch;
      }
    });
    const layer = new AbstractPixiLayer(scene);

    const part = new Rapid.GeometryPart(context);
    part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]] });
    feature = new PixiFeatureLine(layer, 'w1');
    feature.geometry = part;
  });
  afterEach(() => {
    if (haloBatch && !haloBatch.destroyed) haloBatch.destroy();
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
  // A layer that draws many lines gives each two `LineBatchMesh`es, one for its casing and one for
  // its stroke. Each is a run of vertices in its batch then, and a zoom changes nothing there.
  describe('in batches', () => {
    const style = { casing: { width: 5, color: 0x444444 }, stroke: { width: 3, color: 0xffffff } };
    let batch, casingBatch, calls;

    // Counts what the feature asks of a batch
    function watch(target, name) {
      ['add', 'remove', 'setStroke', 'setStyle', 'addMarkers', 'setMarkers', 'setMarkerStyle', 'addGlow', 'setGlow', 'setGlowStyle'].forEach(method => {
        const original = target[method].bind(target);
        target[method] = (...args) => {
          calls.push(`${name}.${method}`);
          return original(...args);
        };
      });
    }

    beforeEach(() => {
      batch = new LineBatchMesh(batchShaders.lines);
      casingBatch = new LineBatchMesh(batchShaders.lines);
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
      const other = new LineBatchMesh(batchShaders.lines);
      const otherCasings = new LineBatchMesh(batchShaders.lines);
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

      const other = new LineBatchMesh(batchShaders.lines);
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

    // The glow of a hovered or highlighted line is in the strokes' batch too: a strip around the
    // line, over everything of its level, in which the batch's shader draws the glow. The line
    // stays in its batches and out of the scene, and has no filter.
    describe('a line that glows', () => {
      const bytesOf = item => Array.from(batch._bytes.subarray(item.first * 8, item.first * 8 + 8));
      const widthOf = item => Array.from(batch._floats.subarray(item.first * 12 + 10, item.first * 12 + 12));
      const roundMesh = () => Rapid.geomStrokeMesh(feature.geometry.local.flat[0], { cap: 'round', join: 'round', closed: false });

      function glow(classID = 'hover') {
        feature.setClass(classID);
        feature.update(viewportAt(effectiveZoom));
      }

      // A layer with many lines gives the strokes' batch a small batch for the glows: one that
      // comes or goes doesn't have the strokes' index buffer built again.
      it('has its glow in the batch that the strokes\' batch has for glows, and leaves the strokes\' batch as it is', () => {
        const glows = new LineBatchMesh(batchShaders.lines);
        batch.glows = glows;
        feature.container.zIndex = 4.25;
        drawAt(17, style);
        calls = [];

        glow();
        assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStyle']);
        const item = feature.glowItem;
        assert.strictEqual(item.batch, glows);
        assert.isTrue(item.visible);
        assert.strictEqual(glows.size, 1);
        assert.strictEqual(batch.size, 1, 'the stroke alone');
        assert.deepEqual(Array.from(glows._bytes.subarray(item.first * 8, item.first * 8 + 6)), [255, 255, 0, 255, 5, 48]);

        // A zoom leaves it alone there
        calls = [];
        feature.dirtyTransform();
        feature.update(viewportAt(effectiveZoom));
        assert.deepEqual(calls, [], 'nothing is written again');
        assert.strictEqual(feature.glowItem, item);
        assert.strictEqual(glows.size, 1);

        // Hidden and shown with the line, and gone with the class
        feature.visible = false;
        assert.isFalse(item.visible);
        feature.visible = true;
        assert.isTrue(item.visible);
        feature.unsetClass('hover');
        feature.update(viewportAt(effectiveZoom));
        assert.isNull(feature.glowItem);
        assert.strictEqual(glows.size, 0);
        assert.strictEqual(batch.size, 1);

        batch.glows = null;
        glows.destroy();
      });

      [['hover', [0xff, 0xff, 0x00]], ['highlight', [0x70, 0x92, 0xff]]].forEach(([classID, rgb]) => {
        it(`gets a glow in the strokes' batch while it has the ${classID} class, and draws nothing itself`, () => {
          feature.container.zIndex = 4.25;
          drawAt(17, style);
          const { casingItem, strokeItem } = feature;
          assert.isNull(feature.glowItem);
          calls = [];

          glow(classID);
          assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStyle', 'strokes.addGlow']);
          assert.isNull(feature.casing);
          assert.isNull(feature.stroke);
          assert.lengthOf(feature.container.children, 0);
          assert.isNotOk(feature.container.filters?.length);
          assert.isFalse(feature.drawsInContainer());
          assert.strictEqual(feature.strokeItem, strokeItem);
          assert.isTrue(strokeItem.visible);
          assert.isTrue(casingItem.visible);

          // In the glow's color, around the casing (5 pixels wide, and never under 3): the
          // number 5 says it's a glow, and the least width is in sixteenths of a pixel.
          const item = feature.glowItem;
          assert.strictEqual(item.batch, batch);
          assert.isTrue(item.visible);
          assert.deepEqual(bytesOf(item), [...rgb, 255, 5, 48, 0, 0]);
          assert.deepEqual(widthOf(item), [5, 0]);
          assert.strictEqual(batch.size, 2);
          assert.strictEqual(casingBatch.size, 1, 'nothing of it in the casings\' batch');

          // ..over every stroke and every marker of the level
          assert.strictEqual(item.order, 2e6 + 4.25);
          assert.isAbove(item.order, 1e6 + 1000);

          // When the class goes, so does the glow.
          calls = [];
          feature.unsetClass(classID);
          feature.update(viewportAt(17));
          assert.isNull(feature.glowItem);
          assert.isNull(item.batch);
          assert.strictEqual(batch.size, 1);
          assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStyle', 'strokes.remove']);
          assert.strictEqual(feature.strokeItem, strokeItem);
          assert.isTrue(strokeItem.visible);
        });
      });

      it('goes around the line\'s ends and corners, whatever the line\'s own caps and joins are', () => {
        drawAt(17, { casing: { width: 5, cap: 'butt', join: 'miter' }, stroke: { width: 3, cap: 'butt', join: 'miter' } });
        glow();
        const item = feature.glowItem;
        const mesh = roundMesh();
        assert.strictEqual(item.count, mesh.vertexCount);
        assert.deepEqual(Array.from(item.indices), Array.from(mesh.indices));
        assert.isAbove(item.count, feature.strokeItem.count);

        // ..at the line's place in the batch
        const [x, y] = feature.geometry.world.origin;
        const local = feature.geometry.local.flat[0];
        assert.closeTo(batch._floats[item.first * 12], local[0] + x - 8388608, 1e-3);
        assert.closeTo(batch._floats[item.first * 12 + 1], local[1] + y - 8388608, 1e-3);
      });

      it('is made from the stroke\'s mesh when that was just built with round ends and corners', () => {
        feature.setClass('hover');
        drawAt(17, { casing: { width: 5, cap: 'round', join: 'round' }, stroke: { width: 3, cap: 'round', join: 'round' } });
        assert.strictEqual(feature.glowItem.indices, feature.strokeItem.indices);
        assert.strictEqual(feature.glowItem.count, feature.strokeItem.count);

        // ..and from one of its own when the line was in the batches already
        feature.unsetClass('hover');
        feature.update(viewportAt(17));
        glow();
        assert.notStrictEqual(feature.glowItem.indices, feature.strokeItem.indices);
        assert.deepEqual(Array.from(feature.glowItem.indices), Array.from(feature.strokeItem.indices));
      });

      it('is around the stroke, and never under 2 pixels, for a line without a casing', () => {
        feature.setClass('hover');
        drawAt(17, { casing: { opacity: 0 }, stroke: { width: 4, color: 0xffffff } });
        assert.deepEqual(widthOf(feature.glowItem), [4, 0]);
        assert.strictEqual(bytesOf(feature.glowItem)[5], 32);
      });

      it('changes color and width where it is, for another class or another style', () => {
        drawAt(17, style);
        glow();
        const item = feature.glowItem;
        const first = item.first;
        calls = [];

        feature.unsetClass('hover');
        glow('highlight');
        assert.strictEqual(feature.glowItem, item);
        assert.strictEqual(item.first, first);
        assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStyle', 'strokes.setGlowStyle']);
        assert.deepEqual(bytesOf(item).slice(0, 5), [0x70, 0x92, 0xff, 255, 5]);

        drawAt(17, { casing: { width: 9, color: 0x444444 }, stroke: { width: 3, color: 0xffffff } });
        assert.strictEqual(feature.glowItem, item);
        assert.deepEqual(widthOf(item), [9, 0]);
      });

      it('glows in the hover\'s color when it\'s highlighted too', () => {
        drawAt(17, style);
        feature.setClass('highlight');
        glow('hover');
        assert.deepEqual(bytesOf(feature.glowItem).slice(0, 3), [0xff, 0xff, 0x00]);
      });

      it('is hidden and shown in the batch with the feature, the line with it', () => {
        drawAt(17, style);
        glow();
        feature.visible = false;
        assert.isFalse(feature.glowItem.visible);
        assert.isFalse(feature.strokeItem.visible);
        feature.visible = true;
        assert.isTrue(feature.glowItem.visible);
        assert.isTrue(feature.strokeItem.visible);
        assert.isTrue(feature.casingItem.visible);
      });

      it('follows a line that changed while it glowed', () => {
        drawAt(17, style);
        glow();
        const item = feature.glowItem;
        calls = [];

        const part = new Rapid.GeometryPart(context);
        part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.002]] });
        feature.geometry = part;
        drawAt(17);
        assert.deepEqual(calls, ['casings.setStroke', 'casings.setStyle', 'strokes.setStroke', 'strokes.setStyle', 'strokes.setGlow']);
        assert.strictEqual(feature.glowItem, item);
        assert.strictEqual(item.count, roundMesh().vertexCount);

        // Some of its vertices are at the line's new end
        const [x, y] = feature.geometry.world.origin;
        const local = feature.geometry.local.flat[0];
        let reached = false;
        for (let i = 0; i < item.count; i++) {
          const o = (item.first + i) * 12;
          if (Math.abs(batch._floats[o] - (local[4] + x - 8388608)) < 1e-2 && Math.abs(batch._floats[o + 1] - (local[5] + y - 8388608)) < 1e-2) reached = true;
        }
        assert.isTrue(reached);

        // ..and the line itself is as it changed, with nothing more to do when the glow goes
        calls = [];
        feature.unsetClass('hover');
        feature.update(viewportAt(17));
        assert.deepEqual(calls, ['casings.setStyle', 'strokes.setStyle', 'strokes.remove']);
      });

      it('is left alone by a zoom, like the line', () => {
        drawAt(17, style);
        glow();
        const item = feature.glowItem;
        calls = [];
        for (const zoom of [18, 15, 16.5, 19]) {
          feature.dirtyTransform();
          effectiveZoom = zoom;
          feature.update(viewportAt(zoom));
        }
        assert.deepEqual(calls, []);
        assert.strictEqual(feature.glowItem, item);
        assert.isTrue(item.visible);
      });

      it('is put back if the batch has lost it, though only the zoom changed', () => {
        drawAt(17, style);
        glow();
        const item = feature.glowItem;
        batch.remove(item);

        feature.dirtyTransform();
        feature.update(viewportAt(17.5));
        assert.notStrictEqual(feature.glowItem, item);
        assert.strictEqual(feature.glowItem.batch, batch);
        assert.isTrue(feature.glowItem.visible);
      });

      it('goes with the line to other batches, and leaves the batch when the line is destroyed', () => {
        drawAt(17, style);
        glow();
        const item = feature.glowItem;
        const other = new LineBatchMesh(batchShaders.lines);
        const otherCasings = new LineBatchMesh(batchShaders.lines);
        feature.batch = other;
        feature.casingBatch = otherCasings;
        drawAt(17);
        assert.isNull(item.batch);
        assert.strictEqual(batch.size, 0);
        assert.strictEqual(feature.glowItem.batch, other);
        assert.strictEqual(other.size, 2);

        feature.destroy();
        assert.strictEqual(other.size, 0);
        other.destroy();
        otherCasings.destroy();
      });

      it('leaves the markers along the line in the batch, under it', () => {
        drawAt(17, { ...style, lineMarker: { image: 'oneway' }, sidedMarker: { image: 'sided' } });
        const { arrowItem, sidedItem } = feature;
        glow();
        assert.strictEqual(feature.arrowItem, arrowItem);
        assert.strictEqual(feature.sidedItem, sidedItem);
        assert.isTrue(arrowItem.visible);
        assert.isTrue(sidedItem.visible);
        assert.isAbove(feature.glowItem.order, arrowItem.order);
        assert.lengthOf(feature.container.children, 0, 'no sprites');
        assert.isFalse(feature.drawsInContainer());
      });

      it('is a filter on the container of a line that draws itself, and nothing in a batch', () => {
        feature.batch = null;
        feature.casingBatch = null;
        drawAt(17, style);
        assert.isNotOk(feature.container.filters?.length);

        glow();
        assert.isNull(feature.glowItem);
        assert.strictEqual(batch.size, 0);
        assert.lengthOf(feature.container.filters, 1);
        assert.strictEqual(new PIXI.Color(feature.container.filters[0].color).toNumber(), 0xffff00);
        assert.isOk(feature.stroke);

        feature.unsetClass('hover');
        feature.update(viewportAt(17));
        assert.isNotOk(feature.container.filters?.length);
      });

      it('moves from the filter to the batch, and back, as the line does', () => {
        feature.batch = null;
        feature.casingBatch = null;
        feature.setClass('hover');
        drawAt(17, style);
        assert.lengthOf(feature.container.filters, 1);

        feature.batch = batch;
        feature.casingBatch = casingBatch;
        drawAt(17);
        assert.isNotOk(feature.container.filters?.length);
        assert.strictEqual(feature.glowItem.batch, batch);

        drawAt(17, { stroke: { width: 3, dash: [1, 2, 3, 4, 5, 6] } });    // dashes that a batch can't draw
        assert.isNull(feature.glowItem);
        assert.strictEqual(batch.size, 0);
        assert.lengthOf(feature.container.filters, 1);
      });
    });

    // Oneway arrows and the triangles of a line with sides are a strip in the strokes' batch,
    // which the batch's shader draws them in. Without a batch they're sprites, made at every zoom.
    describe('markers along the line', () => {
      const oneway = { ...style, lineMarker: { image: 'oneway', color: 0x123456 } };
      const markerBytes = item => Array.from(batch._bytes.subarray(item.first * 8, item.first * 8 + 6));
      const sprites = () => feature.container.getChildByLabel('lineMarkers')?.children ?? [];

      it('are a strip in the strokes\' batch, over every stroke, and no sprites', () => {
        feature.container.zIndex = 4.25;
        drawAt(17, oneway);
        assert.deepEqual(calls, ['casings.add', 'strokes.add', 'strokes.addMarkers']);
        assert.lengthOf(feature.container.children, 0);
        assert.isFalse(feature.drawsInContainer());

        const { arrowItem, strokeItem } = feature;
        assert.strictEqual(arrowItem.batch, batch);
        assert.strictEqual(arrowItem.order, 1e6 + 4.25);
        assert.isAbove(arrowItem.order, strokeItem.order + 1000);
        assert.deepEqual(markerBytes(arrowItem), [0x12, 0x34, 0x56, 255, 1, 35]);
        assert.isNull(feature.sidedItem);

        // ..at the line's place in the batch
        const [x, y] = feature.geometry.world.origin;
        const local = feature.geometry.local.flat[0];
        assert.closeTo(batch._floats[arrowItem.first * 12], local[0] + x - 8388608, 1e-3);
        assert.closeTo(batch._floats[arrowItem.first * 12 + 1], local[1] + y - 8388608, 1e-3);
      });

      it('get a mesh of their own, without caps, when the stroke has round ones', () => {
        drawAt(17, { ...oneway, stroke: { width: 3, color: 0xffffff, cap: 'round', join: 'round' }, casing: { width: 5, cap: 'round', join: 'round' } });
        const { arrowItem, strokeItem } = feature;
        assert.notStrictEqual(arrowItem.indices, strokeItem.indices);
        assert.isBelow(arrowItem.count, strokeItem.count);
      });

      it('are made from the stroke\'s mesh when that has no caps either', () => {
        drawAt(17, { ...oneway, stroke: { width: 3, color: 0xffffff, cap: 'butt', join: 'miter' }, casing: { width: 5, cap: 'butt', join: 'miter' } });
        assert.strictEqual(feature.arrowItem.indices, feature.strokeItem.indices);
      });

      it('are arrows with two heads for a way that alternates, and triangles in the stroke\'s color for one with sides', () => {
        drawAt(17, { ...style, lineMarker: { image: 'twoway' }, sidedMarker: { image: 'sided' } });
        assert.deepEqual(markerBytes(feature.arrowItem).slice(4), [2, 35]);
        assert.deepEqual(markerBytes(feature.sidedItem), [255, 255, 255, 255, 3, 30]);
        assert.strictEqual(batch.size, 3);
        assert.strictEqual(feature.sidedItem.indices, feature.arrowItem.indices, 'one strip mesh for both');
      });

      it('point back along a line whose style turns them around (a way tagged oneway=-1)', () => {
        drawAt(17, { ...style, lineMarker: { image: 'oneway', scale: [-1, 1] } });
        assert.strictEqual(markerBytes(feature.arrowItem)[4], 4);

        drawAt(17, { ...style, lineMarker: { image: 'oneway' } });
        assert.strictEqual(markerBytes(feature.arrowItem)[4], 1);

        // ..and as sprites, when the line draws itself
        feature.batch = null;
        feature.casingBatch = null;
        drawAt(17, { ...style, lineMarker: { image: 'oneway', scale: [-1, 1] } });
        const [first] = sprites();
        assert.isBelow(first.scale.x, 0);
        assert.isAbove(first.scale.y, 0);
      });

      it('are left alone by a zoom, also below zoom 16 where the shader leaves them out', () => {
        drawAt(17, oneway);
        const item = feature.arrowItem;
        calls = [];
        for (const zoom of [18, 15, 16.5, 19]) {
          feature.dirtyTransform();
          effectiveZoom = zoom;
          feature.update(viewportAt(zoom));
        }
        assert.deepEqual(calls, []);
        assert.strictEqual(feature.arrowItem, item);
        assert.isTrue(item.visible);
        assert.lengthOf(sprites(), 0);
      });

      it('change color where they are, and go when the style has none anymore', () => {
        drawAt(17, oneway);
        const item = feature.arrowItem;
        const first = item.first;
        calls = [];

        drawAt(17, { ...oneway, lineMarker: { image: 'oneway', color: 0xff0000 } });
        assert.strictEqual(feature.arrowItem, item);
        assert.strictEqual(item.first, first);
        assert.deepEqual(markerBytes(item).slice(0, 3), [255, 0, 0]);
        assert.notInclude(calls, 'strokes.addMarkers');
        assert.notInclude(calls, 'strokes.setMarkers');

        drawAt(17, style);
        assert.isNull(feature.arrowItem);
        assert.isNull(item.batch);
        assert.strictEqual(batch.size, 1);
      });

      it('follow a line that changed', () => {
        drawAt(17, oneway);
        const item = feature.arrowItem;
        calls = [];
        const part = new Rapid.GeometryPart(context);
        part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.002]] });
        feature.geometry = part;
        drawAt(17);
        assert.strictEqual(feature.arrowItem, item);
        assert.include(calls, 'strokes.setMarkers');
        assert.notInclude(calls, 'strokes.addMarkers');

        // Its last vertices are at the line's new end
        const [x, y] = feature.geometry.world.origin;
        const local = feature.geometry.local.flat[0];
        let reached = false;
        for (let i = 0; i < item.count; i++) {
          const o = (item.first + i) * 12;
          if (Math.abs(batch._floats[o + 1] - (local[5] + y - 8388608)) < 1e-2 && Math.abs(batch._floats[o] - (local[4] + x - 8388608)) < 1e-2) reached = true;
        }
        assert.isTrue(reached);
      });

      it('are hidden and shown with the feature, and leave the batch with it', () => {
        drawAt(17, { ...oneway, sidedMarker: { image: 'sided' } });
        const { arrowItem, sidedItem } = feature;
        feature.visible = false;
        assert.isFalse(arrowItem.visible);
        assert.isFalse(sidedItem.visible);
        feature.visible = true;
        assert.isTrue(arrowItem.visible);
        assert.isTrue(sidedItem.visible);

        feature.destroy();
        assert.isNull(arrowItem.batch);
        assert.isNull(sidedItem.batch);
        assert.strictEqual(batch.size, 0);
      });

      it('are sprites while the line draws itself, and the batch\'s again after', () => {
        drawAt(17, { ...oneway, sidedMarker: { image: 'sided' } });
        const item = feature.arrowItem;

        feature.batch = null;
        feature.casingBatch = null;
        drawAt(17);
        assert.isNull(feature.arrowItem);
        assert.isNull(feature.sidedItem);
        assert.isNull(item.batch);
        assert.isAbove(sprites().length, 0);

        feature.batch = batch;
        feature.casingBatch = casingBatch;
        drawAt(17);
        assert.strictEqual(feature.arrowItem.batch, batch);
        assert.strictEqual(feature.sidedItem.batch, batch);
        assert.isTrue(feature.arrowItem.visible);
        assert.lengthOf(sprites(), 0);
        assert.lengthOf(feature.container.children, 0);
      });

      it('are put back if the batch has lost them, though only the zoom changed', () => {
        drawAt(17, oneway);
        const item = feature.arrowItem;
        batch.remove(item);

        feature.dirtyTransform();
        feature.update(viewportAt(17.5));
        assert.notStrictEqual(feature.arrowItem, item);
        assert.strictEqual(feature.arrowItem.batch, batch);
        assert.isTrue(feature.arrowItem.visible);
      });

      it('go to the batch that the line was given since, though only the zoom changed', () => {
        drawAt(17, oneway);
        const item = feature.arrowItem;
        const other = new LineBatchMesh(batchShaders.lines);
        const otherCasings = new LineBatchMesh(batchShaders.lines);
        other.position.set(8388608, 8388608);
        otherCasings.position.set(8388608, 8388608);

        feature.dirtyTransform();
        feature.batch = other;              // (its level's batches were destroyed and made again)
        feature.casingBatch = otherCasings;
        feature.update(viewportAt(17.5));
        assert.isNull(item.batch);
        assert.strictEqual(feature.arrowItem.batch, other);
        assert.strictEqual(feature.strokeItem.batch, other);
        assert.strictEqual(batch.size, 0);

        feature.destroy();
        other.destroy();
        otherCasings.destroy();
      });

      it('are sprites, in the scene, when a batch has no shape for them', () => {
        drawAt(17, { ...style, lineMarker: { image: 'maki-star' } });
        assert.isNull(feature.arrowItem);
        assert.isOk(feature.strokeItem, 'the stroke is still the batch\'s');
        assert.isAbove(sprites().length, 0);
        assert.isTrue(feature.drawsInContainer());
      });

      it('are all sprites when a batch has a shape for some of them only: none is drawn twice', () => {
        drawAt(17, { ...oneway, sidedMarker: { image: 'maki-star' } });
        assert.isNull(feature.arrowItem);
        assert.isNull(feature.sidedItem);
        assert.strictEqual(batch.size, 1);
        assert.isAbove(sprites().length, 0);
      });

      it('are sprites 35 pixels apart without batches, from zoom 16', () => {
        feature.batch = null;
        feature.casingBatch = null;
        drawAt(17, oneway);
        const markers = sprites();
        assert.isAbove(markers.length, 2);
        const gap = Math.hypot(markers[1].x - markers[0].x, markers[1].y - markers[0].y) * 2;    // world units to pixels, at zoom 17
        assert.closeTo(gap, 35, 0.01);
        assert.strictEqual(markers[0].tint, 0x123456);

        drawAt(15.5);
        assert.lengthOf(sprites(), 0);
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

      it('is false while the line glows or is selected: batches draw the glow and the halo too', () => {
        feature.style = style;
        for (const classID of ['hover', 'highlight', 'select']) {
          feature.setClass(classID);
          assert.isFalse(feature.drawsInContainer(), classID);
          feature.unsetClass(classID);
        }
      });

      it('is false for a line with markers along it that the batch draws', () => {
        feature.style = { ...style, lineMarker: { image: 'oneway' } };
        assert.isFalse(feature.drawsInContainer());
        feature.style = { ...style, lineMarker: { image: 'twoway' }, sidedMarker: { image: 'sided' } };
        assert.isFalse(feature.drawsInContainer());
      });

      it('is true for a line with markers that a batch has no shape for', () => {
        feature.style = { ...style, lineMarker: { image: 'maki-star' } };
        assert.isTrue(feature.drawsInContainer());
        feature.style = { ...style, sidedMarker: { image: 'maki-star' } };
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

      feature.setClass('hover');    // a glow changes nothing about it
      feature.update(viewportAt(17));
      assert.strictEqual(feature.sceneContainer, batch);
      assert.strictEqual(feature.sceneOrder, -8.5);

      feature.visible = false;
      assert.strictEqual(feature.sceneContainer, feature.container);
      assert.strictEqual(feature.sceneOrder, 0);
      feature.visible = true;

      drawAt(17, { stroke: { width: 3, dash: [1, 2, 3, 4, 5, 6] } });    // dashes that a batch can't draw
      assert.strictEqual(feature.sceneContainer, feature.container);
      assert.strictEqual(feature.sceneOrder, 0);
    });

    it('is still hit, and gets its halo, as without batches', () => {
      feature.setClass('select');
      drawAt(17, style);
      const [x, y] = feature.geometry.local.flat[0];
      assert.isTrue(feature.container.hitArea.contains(x + 1, y + 3.5));
      assert.strictEqual(feature.hitReach, 7.5);

      // The halo is in the map UI's batch, not in the line's.
      assert.lengthOf(feature.haloItems, 2);
      assert.strictEqual(feature.haloItems[0].batch, haloBatch);
      assert.strictEqual(haloBatch.size, 2);
      assert.strictEqual(batch.size, 1);
      assert.strictEqual(casingBatch.size, 1);
      assert.isFalse(feature.drawsInContainer());
    });

    it('moves its halo with the zoom, though the batches have nothing to do', () => {
      feature.setClass('select');
      drawAt(17, style);
      const items = [...feature.haloItems];
      const coords = feature.geometry.local.flat[0];
      const at = item => [haloBatch._floats[item.first * 12], haloBatch._floats[item.first * 12 + 1]];
      assert.isFalse(Rapid.geomStrokeContains(coords, 3.7, ...at(items[1])));    // 7.5 pixels from the line: 3.75 units
      calls = [];

      feature.dirtyTransform();
      effectiveZoom = 18;
      feature.update(viewportAt(18));
      assert.deepEqual(calls, []);
      assert.deepEqual(feature.haloItems, items);
      assert.isTrue(Rapid.geomStrokeContains(coords, 1.9, ...at(items[1])));     // ..and now 1.875
      assert.isFalse(Rapid.geomStrokeContains(coords, 1.85, ...at(items[1])));
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

  // The halo of a selected line is two lines for each ring around it, in the map UI layer's
  // batch: a dark one, and yellow dashes over it. Both march (the batch's shader moves their
  // dashes, and keeps them their width in pixels), so a halo is written only when its rings change.
  describe('the select halo', () => {
    const style = { casing: { width: 5 }, stroke: { width: 3 } };
    const bytesOf = item => Array.from(haloBatch._bytes.subarray(item.first * 8, item.first * 8 + 8));
    const widthOf = item => Array.from(haloBatch._floats.subarray(item.first * 12 + 10, item.first * 12 + 12));

    // Where an item's vertices are on their line, in the feature's own coordinates
    function pointsOf(item) {
      const dx = haloBatch.position.x - feature.container.position.x;
      const dy = haloBatch.position.y - feature.container.position.y;
      const points = [];
      for (let i = 0; i < item.count; i++) {
        const o = (item.first + i) * 12;
        points.push([haloBatch._floats[o] + dx, haloBatch._floats[o + 1] + dy]);
      }
      return points;
    }

    // Whether every vertex of an item is a distance from the feature's line, in its coordinates
    function assertAround(item, distance, message = '') {
      const coords = feature.geometry.local.flat[0];
      const points = pointsOf(item);
      assert.isAbove(points.length, 8);
      points.forEach(([x, y], i) => {
        assert.isTrue(Rapid.geomStrokeContains(coords, distance + 0.01, x, y), `vertex ${i} is too far from the line ${message}`);
        assert.isFalse(Rapid.geomStrokeContains(coords, distance - 0.01, x, y), `vertex ${i} is too near the line ${message}`);
      });
    }

    it('is a dark line and yellow dashes over it around the line, at the edge of its hit area', () => {
      assert.lengthOf(feature.haloItems, 0);
      feature.setClass('select');
      drawAt(17, style);
      const [under, dashes] = feature.haloItems;
      assert.lengthOf(feature.haloItems, 2);
      assert.strictEqual(under.batch, haloBatch);
      assert.strictEqual(dashes.batch, haloBatch);
      assert.strictEqual(haloBatch.size, 2);
      assert.isAbove(dashes.order, under.order);
      assert.deepEqual([haloBatch.position.x, haloBatch.position.y], [feature.container.position.x, feature.container.position.y]);

      // Dashes of 6 pixels, 3 apart, 2 wide, over a line 4 wide. (A negative width: they march.)
      assert.deepEqual(bytesOf(dashes), [0xff, 0xff, 0x00, 255, 6, 3, 0, 0]);
      assert.deepEqual(widthOf(dashes), [-2, 2]);
      assert.deepEqual(bytesOf(under).slice(0, 3), [0, 0, 0]);
      assert.isAbove(bytesOf(under)[3], 0);
      assert.isBelow(bytesOf(under)[3], 255);
      assert.deepEqual(bytesOf(under).slice(4), [0, 0, 0, 0], 'no dashes');
      assert.deepEqual(widthOf(under), [-4, 4]);

      // The ring is 7.5 pixels from the line: 3.75 units. It ends where it starts.
      assertAround(dashes, 3.75);
      assertAround(under, 3.75);
      assert.strictEqual(dashes.indices, under.indices, 'one stroke mesh for both');
      assert.lengthOf(feature.container.children.filter(child => child.label !== 'casing' && child.label !== 'stroke'), 0, 'nothing of it in the line\'s container');
    });

    it('is written relative to the batch\'s place in the world, wherever that is', () => {
      const [x, y] = feature.geometry.world.origin;
      scene.layers.get('map-ui').haloBatchAt(x - 50, y + 20);    // another feature's halo was first
      feature.setClass('select');
      drawAt(17, style);
      assert.deepEqual([haloBatch.position.x, haloBatch.position.y], [x - 50, y + 20]);
      assertAround(feature.haloItems[1], 3.75);

      const item = feature.haloItems[1];
      const local = feature.geometry.local.flat[0];
      let minX = Infinity;
      for (let i = 0; i < item.count; i++) {
        minX = Math.min(minX, haloBatch._floats[(item.first + i) * 12]);
      }
      assert.closeTo(minX, local[0] - 3.75 + 50, 1e-3);    // the line starts at its left end
    });

    it('is two rings for a line that ends where it starts, one on each side', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]] });
      feature.geometry = part;
      feature.setClass('select');
      drawAt(17, style);
      assert.lengthOf(feature.haloItems, 4);
      assert.strictEqual(haloBatch.size, 4);
      assert.deepEqual(feature.haloItems.map(item => bytesOf(item)[4]), [0, 6, 0, 6]);
      assertAround(feature.haloItems[1], 3.75, '(outer)');
      assertAround(feature.haloItems[3], 3.75, '(inner)');

      // The second ring is inside the first
      const xs = item => pointsOf(item).map(point => point[0]);
      assert.isAbove(Math.min(...xs(feature.haloItems[3])), Math.min(...xs(feature.haloItems[1])));
      assert.isBelow(Math.max(...xs(feature.haloItems[3])), Math.max(...xs(feature.haloItems[1])));
    });

    it('keeps its lines through a zoom, at the new zoom\'s distance, and takes them out when the line isn\'t selected', () => {
      feature.setClass('select');
      drawAt(17, style);
      const [under, dashes] = feature.haloItems;
      const first = dashes.first;

      drawAt(18);
      assert.lengthOf(feature.haloItems, 2);
      assert.strictEqual(feature.haloItems[0], under);
      assert.strictEqual(feature.haloItems[1], dashes);
      assert.strictEqual(dashes.first, first);
      assert.strictEqual(haloBatch.size, 2);
      assertAround(dashes, 1.875);    // a pixel is a quarter of a unit now
      assert.deepEqual(widthOf(dashes), [-2, 2], 'the same width in pixels: the shader keeps it');

      feature.unsetClass('select');
      drawAt(18);
      assert.lengthOf(feature.haloItems, 0);
      assert.isNull(under.batch);
      assert.isNull(dashes.batch);
      assert.strictEqual(haloBatch.size, 0);
    });

    it('follows a line that changed', () => {
      feature.setClass('select');
      drawAt(17, style);
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.002, 0]] });
      feature.geometry = part;
      drawAt(17);
      assert.lengthOf(feature.haloItems, 2);
      assert.strictEqual(haloBatch.size, 2);
      assertAround(feature.haloItems[0], 3.75);
      assertAround(feature.haloItems[1], 3.75);
    });

    it('is hidden and shown with the line', () => {
      feature.setClass('select');
      drawAt(17, style);
      const items = [...feature.haloItems];
      feature.visible = false;
      assert.deepEqual(items.map(item => item.visible), [false, false]);
      feature.visible = true;
      assert.deepEqual(items.map(item => item.visible), [true, true]);
    });

    it('leaves the batch when the line is destroyed', () => {
      feature.setClass('select');
      drawAt(17, style);
      const items = [...feature.haloItems];
      feature.destroy();
      assert.strictEqual(haloBatch.size, 0);
      assert.deepEqual(items.map(item => item.batch), [null, null]);
    });

    it('is not drawn while the line is being drawn', () => {
      feature.setClass('select');
      feature.setClass('drawing');
      drawAt(17, style);
      assert.lengthOf(feature.haloItems, 0);
      assert.isNull(haloBatch);
    });

    it('is not drawn for a line that\'s only hovered or highlighted', () => {
      feature.setClass('hover');
      feature.setClass('highlight');
      drawAt(17, style);
      assert.lengthOf(feature.haloItems, 0);
      assert.isNull(haloBatch);
    });

    it('is left out, and nothing breaks, where there\'s no map UI layer or it has no batch to give', () => {
      scene.layers.delete('map-ui');
      feature.setClass('select');
      drawAt(17, style);
      assert.lengthOf(feature.haloItems, 0);
      assert.isFalse(feature.dirty);

      scene.layers.set('map-ui', { haloBatchAt: () => null });    // before the layer has its containers
      drawAt(17);
      assert.lengthOf(feature.haloItems, 0);
      feature.unsetClass('select');
      drawAt(17);
      assert.lengthOf(feature.haloItems, 0);
    });
  });


  // A layer gives a line the batches of the container it's drawn for (`AbstractPixiLayer._drawInBatches`)
  describe('placeInBatches', () => {
    let batches, parent, other;
    beforeEach(() => {
      batches = new LayerBatches(batchShaders);
      parent = new PIXI.Container();
      other = new PIXI.Container();
    });
    afterEach(() => {
      parent.destroy({ children: true });
      other.destroy({ children: true });
    });

    it('takes the container\'s batches for casings and strokes, and keeps them', () => {
      feature.placeInBatches(batches, parent);
      assert.strictEqual(feature.batch, batches.lineBatch(parent, false, [0, 0]));
      assert.strictEqual(feature.casingBatch, batches.lineBatch(parent, true, [0, 0]));

      const batch = feature.batch;
      feature.placeInBatches(batches, parent);
      assert.strictEqual(feature.batch, batch);
      assert.strictEqual(batch.users, 1);
      assert.isFalse(feature.drawsInContainer());
    });

    it('takes another container\'s when it\'s drawn for that one', () => {
      feature.placeInBatches(batches, parent);
      const old = feature.batch;
      feature.placeInBatches(batches, other);
      assert.strictEqual(feature.batch.parent, other);
      assert.strictEqual(feature.casingBatch.parent, other);
      assert.strictEqual(old.users, 0);
    });

    it('takes new ones when the old were destroyed', () => {
      feature.placeInBatches(batches, parent);
      feature.batch.destroy();
      batches.removeEmpty();
      feature.placeInBatches(batches, parent);
      assert.isFalse(feature.batch.destroyed);
      assert.strictEqual(feature.batch.parent, parent);
    });

    it('gives them back, and draws itself, without the layer\'s batches', () => {
      feature.placeInBatches(batches, parent);
      feature.placeInBatches(null, parent);
      assert.isNull(feature.batch);
      assert.isNull(feature.casingBatch);
      assert.isTrue(feature.drawsInContainer());
    });
  });
});
