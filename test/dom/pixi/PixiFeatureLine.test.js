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
  // A layer that draws many lines gives each a `LineBatch`. The line's casing and stroke are
  // runs of vertices in the batch then, and a zoom changes nothing in it.
  describe('in a batch', () => {
    const style = { casing: { width: 5, color: 0x444444 }, stroke: { width: 3, color: 0xffffff } };
    let batch, calls;

    // Counts what the feature asks of the batch
    function watch(target) {
      ['add', 'remove', 'setStroke', 'setStyle'].forEach(name => {
        const original = target[name].bind(target);
        target[name] = (...args) => {
          calls.push(name);
          return original(...args);
        };
      });
    }

    beforeEach(() => {
      batch = new LineBatch();
      batch.position.set(8388608, 8388608);    // the world's middle, where the line is
      calls = [];
      watch(batch);
      feature.batch = batch;
    });
    afterEach(() => {
      if (!batch.destroyed) batch.destroy();
    });

    it('draws the casing and the stroke there, the stroke after the casing, and has no meshes', () => {
      feature.container.zIndex = 4.25;
      drawAt(17, style);
      assert.isNull(feature.casing);
      assert.isNull(feature.stroke);
      assert.lengthOf(feature.container.children, 0);
      assert.strictEqual(batch.size, 2);
      assert.deepEqual(calls, ['add', 'add']);

      const { casingItem, strokeItem } = feature;
      assert.strictEqual(casingItem.batch, batch);
      assert.strictEqual(strokeItem.batch, batch);
      assert.strictEqual(casingItem.order, 4.25);
      assert.isAbove(strokeItem.order, 4.25);
      assert.isBelow(strokeItem.order, 4.25 + 1e-6);
      assert.strictEqual(casingItem.indices, strokeItem.indices, 'one stroke mesh for both');

      // widths in pixels, as the style has them: the batch's shader narrows them at lower zooms
      const widthOf = item => Array.from(batch._floats.subarray(item.first * 12 + 10, item.first * 12 + 12));
      assert.deepEqual(widthOf(casingItem), [5, -3]);
      assert.deepEqual(widthOf(strokeItem), [3, 2]);
    });

    it('writes its vertices near the batch\'s origin', () => {
      drawAt(17, style);
      const item = feature.strokeItem;
      const [x, y] = feature.geometry.world.origin;
      const local = feature.geometry.local.flat[0];
      assert.closeTo(batch._floats[item.first * 12], local[0] + x - 8388608, 1e-3);
      assert.closeTo(batch._floats[item.first * 12 + 1], local[1] + y - 8388608, 1e-3);
      assert.isBelow(Math.abs(batch._floats[item.first * 12]), 100);
    });

    it('does nothing to the batch for a zoom, also across the zooms where widths and casings change', () => {
      drawAt(17, style);
      calls = [];
      for (const zoom of [18, 16.5, 15, 19]) {
        feature.dirtyTransform();
        effectiveZoom = zoom;
        feature.update(viewportAt(zoom));
      }
      assert.deepEqual(calls, []);
      assert.strictEqual(batch.size, 2, 'the casing stays in the batch below zoom 16, where the shader leaves it out');
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
      assert.deepEqual(calls, ['setStroke', 'setStyle', 'setStroke', 'setStyle']);
      assert.strictEqual(batch.size, 2);
    });

    it('builds a stroke mesh for each part when their caps differ, and again when a cap changes', () => {
      drawAt(17, { casing: { width: 5, cap: 'butt' }, stroke: { width: 3, cap: 'round' } });
      assert.notStrictEqual(feature.casingItem.indices, feature.strokeItem.indices);

      const before = feature.strokeItem.indices;
      calls = [];
      drawAt(17, { casing: { width: 5, cap: 'butt' }, stroke: { width: 3, cap: 'square' } });
      assert.notStrictEqual(feature.strokeItem.indices, before);
      assert.deepEqual(calls, ['setStyle', 'setStroke', 'setStyle'], 'only the stroke is built again');
    });

    it('takes the casing out when the style has none anymore, and leaves out a stroke that can\'t be seen', () => {
      drawAt(17, style);
      drawAt(17, { casing: { opacity: 0 }, stroke: { width: 3 } });
      assert.isNull(feature.casingItem);
      assert.isOk(feature.strokeItem);
      assert.strictEqual(batch.size, 1);

      drawAt(17, { casing: { width: 5 }, stroke: { width: 3, opacity: 0 } });
      assert.isOk(feature.casingItem);
      assert.isNull(feature.strokeItem);
      assert.strictEqual(batch.size, 1);
    });

    it('is hidden and shown in the batch with the feature', () => {
      drawAt(17, style);
      feature.visible = false;
      assert.isFalse(feature.casingItem.visible);
      assert.isFalse(feature.strokeItem.visible);
      batch.flush();
      assert.isFalse(batch.renderable);

      feature.visible = true;
      assert.isTrue(feature.strokeItem.visible);
      batch.flush();
      assert.isTrue(batch.renderable);
    });

    it('moves to another batch when the layer gives it one', () => {
      drawAt(17, style);
      const other = new LineBatch();
      feature.batch = other;
      drawAt(17);
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(other.size, 2);
      assert.strictEqual(feature.strokeItem.batch, other);
      other.destroy();
    });

    it('draws with meshes of its own again without a batch, or with dashes that a batch can\'t draw', () => {
      drawAt(17, style);
      feature.batch = null;
      drawAt(17);
      assert.strictEqual(batch.size, 0);
      assert.isNull(feature.strokeItem);
      assert.isOk(feature.casing);
      assert.isOk(feature.stroke);
      assert.deepEqual(feature.container.children.map(child => child.label), ['casing', 'stroke']);

      feature.batch = batch;
      drawAt(17);
      assert.strictEqual(batch.size, 2);
      assert.isNull(feature.stroke);
      assert.lengthOf(feature.container.children, 0);

      drawAt(17, { stroke: { width: 3, dash: [1, 2, 3, 4, 5, 6] } });
      assert.strictEqual(batch.size, 0);
      assert.isOk(feature.stroke);
    });

    it('leaves the batch when it\'s destroyed', () => {
      drawAt(17, style);
      feature.destroy();
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(batch.users, 0);
    });

    it('tells the batch that it will draw in it, from when the layer gives it the batch', () => {
      assert.strictEqual(batch.users, 1);    // not drawn yet: the batch is empty, and has to be kept
      assert.strictEqual(batch.size, 0);

      const other = new LineBatch();
      feature.batch = other;
      assert.strictEqual(batch.users, 0);
      assert.strictEqual(other.users, 1);
      feature.batch = other;
      assert.strictEqual(other.users, 1);
      feature.batch = null;
      assert.strictEqual(other.users, 0);
      other.destroy();
    });

    it('draws with meshes of its own if its batch was destroyed', () => {
      batch.destroy();
      drawAt(17, style);
      assert.isOk(feature.stroke);
      assert.isNull(feature.strokeItem);
    });

    it('is still hit, and gets its halo, as without a batch', () => {
      feature.setClass('select');
      drawAt(17, style);
      const [x, y] = feature.geometry.local.flat[0];
      assert.isTrue(feature.container.hitArea.contains(x + 1, y + 3.5));
      assert.strictEqual(feature.hitReach, 7.5);
      assert.isOk(feature.halo);
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
