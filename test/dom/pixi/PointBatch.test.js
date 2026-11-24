import * as PIXI from 'pixi.js';
import { PointBatch } from '../../../modules/pixi/lib/PointBatch.ts';


// A batch draws many points as one mesh. A point is a few pictures (a marker, an icon,
// viewfields), each four vertices: 6 floats (where the point is, where the corner is in pixels
// from it, where the corner is in the texture) and 8 bytes (color, opacity, whether the
// picture turns with the map, whether the point is shown). What a batch does with its
// buffers is `VertexBatch`'s, which `LineBatch.test.js` covers.
describe('PointBatch', () => {
  const FLOATS = 6;
  const BYTES = 8;

  // A texture of 64 x 32 texels, and two pictures in it
  const source = new PIXI.TextureSource({ width: 64, height: 32 });
  const pin = new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(0, 0, 16, 32) });
  const cafe = new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(32, 8, 8, 8) });

  const quad = props => ({
    texture: pin, x: 0, y: 0, width: 16, height: 32, anchorX: 0.5, anchorY: 0.5,
    rotation: 0, color: 0xffffff, alpha: 1, turns: false, ...props
  });

  let batch;
  beforeEach(() => {
    PointBatch.setTexture(source);
    batch = new PointBatch();
  });
  afterEach(() => {
    if (!batch.destroyed) batch.destroy();
    PointBatch.setTexture(null);
  });

  // The corners of one of a point's pictures: [x, y] of each, in pixels from the point
  const cornersOf = (item, picture = 0) => {
    const corners = [];
    for (let i = 0; i < 4; i++) {
      const o = (item.first + picture * 4 + i) * FLOATS;
      corners.push([batch._floats[o + 2], batch._floats[o + 3]]);
    }
    return corners;
  };
  const floatsOf = (item, vertex) => Array.from(batch._floats.subarray((item.first + vertex) * FLOATS, (item.first + vertex + 1) * FLOATS));
  const bytesOf = (item, vertex) => Array.from(batch._bytes.subarray((item.first + vertex) * BYTES, (item.first + vertex + 1) * BYTES));
  const drawn = () => Array.from(batch._indices.subarray(0, batch.geometry.indexCount));
  const closeTo = (actual, expected) => {
    assert.strictEqual(actual.length, expected.length);
    actual.forEach((corner, i) => {
      assert.closeTo(corner[0], expected[i][0], 1e-5, `corner ${i}, x`);
      assert.closeTo(corner[1], expected[i][1], 1e-5, `corner ${i}, y`);
    });
  };


  it('draws only what\'s in the texture it was given', () => {
    const elsewhere = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 8, height: 8 }) });
    assert.isTrue(PointBatch.canDraw(pin));
    assert.isTrue(PointBatch.canDraw(cafe));
    assert.isFalse(PointBatch.canDraw(elsewhere));
    assert.isFalse(PointBatch.canDraw(PIXI.Texture.EMPTY));
    assert.strictEqual(batch.shader.resources.uTexture, source);

    PointBatch.setTexture(null);
    assert.isFalse(PointBatch.canDraw(pin));
  });

  it('writes four vertices for each picture, all at the point\'s place', () => {
    const item = batch.add([quad(), quad({ texture: cafe, width: 8, height: 8 })], 2, 100, -50);
    assert.strictEqual(batch.size, 1);
    assert.strictEqual(item.count, 8);
    for (let i = 0; i < 8; i++) {
      assert.deepEqual(floatsOf(item, i).slice(0, 2), [100, -50]);
    }
  });

  it('uses as many of the pictures as it\'s told to', () => {
    const item = batch.add([quad(), quad(), quad()], 1, 0, 0);
    assert.strictEqual(item.count, 4);
  });

  it('puts a picture\'s corners around its anchor, in pixels from the point', () => {
    const centered = batch.add([quad()], 1, 0, 0);
    closeTo(cornersOf(centered), [[-8, -16], [8, -16], [8, 16], [-8, 16]]);    // top left, top right, bottom right, bottom left

    const pinned = batch.add([quad({ anchorY: 1 })], 1, 0, 0);                 // a pin: its tip at the point
    closeTo(cornersOf(pinned), [[-8, -32], [8, -32], [8, 0], [-8, 0]]);

    const raised = batch.add([quad({ texture: cafe, width: 8, height: 8, x: 3, y: -14 })], 1, 0, 0);    // an icon in a pin's head
    closeTo(cornersOf(raised), [[-1, -18], [7, -18], [7, -10], [-1, -10]]);

    const fromItsCorner = batch.add([quad({ anchorX: 0, anchorY: 0.25 })], 1, 0, 0);
    closeTo(cornersOf(fromItsCorner), [[0, -8], [16, -8], [16, 24], [0, 24]]);
  });

  it('turns a picture around its anchor', () => {
    const item = batch.add([quad({ anchorY: 1, rotation: Math.PI / 2 })], 1, 0, 0);    // pointing right, clockwise from up
    closeTo(cornersOf(item), [[32, -8], [32, 8], [0, 8], [0, -8]]);
  });

  it('draws everything larger or smaller by the scale', () => {
    const item = batch.add([quad({ texture: cafe, width: 10, height: 10, x: 0, y: -10 })], 1, 0, 0, 0.8);
    closeTo(cornersOf(item), [[-4, -12], [4, -12], [4, -4], [-4, -4]]);
  });

  it('gives each corner its place in the texture', () => {
    const item = batch.add([quad({ texture: cafe, width: 8, height: 8 })], 1, 0, 0);
    const uvs = [0, 1, 2, 3].map(i => floatsOf(item, i).slice(4, 6));
    closeTo(uvs, [[32 / 64, 8 / 32], [40 / 64, 8 / 32], [40 / 64, 16 / 32], [32 / 64, 16 / 32]]);
  });

  it('writes each picture\'s color and opacity, and whether it turns with the map', () => {
    const item = batch.add([
      quad({ color: 0x333333, alpha: 0.5, turns: true }),      // a viewfield
      quad({ color: 0x336699, alpha: 1 })                      // a marker
    ], 2, 0, 0);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(bytesOf(item, i).slice(0, 6), [0x33, 0x33, 0x33, 128, 255, 255]);
      assert.deepEqual(bytesOf(item, 4 + i).slice(0, 6), [0x33, 0x66, 0x99, 255, 0, 255]);
    }
  });

  it('writes which pictures pulse: a glow does, behind a marker that doesn\'t', () => {
    const item = batch.add([
      quad({ color: 0xffff00, alpha: 0.9, pulses: true }),     // the glow of a hover
      quad({ color: 0x336699 })                                // the marker
    ], 2, 0, 0);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(bytesOf(item, i).slice(0, 7), [255, 255, 0, 230, 0, 255, 255]);
      assert.deepEqual(bytesOf(item, 4 + i).slice(0, 7), [0x33, 0x66, 0x99, 255, 0, 255, 0]);
    }

    // Written again without the glow, where it was: nothing pulses there anymore
    batch.set(item, [quad({ color: 0x336699 }), quad({ color: 0x336699 })], 2, 0, 0);
    for (let i = 0; i < 8; i++) {
      assert.strictEqual(bytesOf(item, i)[6], 0, `vertex ${i}`);
    }
  });

  it('writes pictures from further along the list, when it\'s told where to start', () => {
    const quads = [quad({ color: 0xffff00, pulses: true }), quad({ color: 0x336699, width: 20, height: 20 }), quad({ texture: cafe, width: 8, height: 8 })];
    const own = batch.add(quads, 2, 5, 5, 1, 0, 1);      // the marker and the icon, not the glow before them
    assert.strictEqual(own.count, 8);
    assert.deepEqual(bytesOf(own, 0).slice(0, 3), [0x33, 0x66, 0x99]);
    closeTo(cornersOf(own, 0), [[-10, -10], [10, -10], [10, 10], [-10, 10]]);
    closeTo(cornersOf(own, 1), [[-4, -4], [4, -4], [4, 4], [-4, 4]]);
    assert.strictEqual(bytesOf(own, 0)[6], 0);

    batch.set(own, quads, 1, 5, 5, 1, 2);                // the icon alone
    assert.strictEqual(own.count, 4);
    closeTo(cornersOf(own, 0), [[-4, -4], [4, -4], [4, 4], [-4, 4]]);

    const first = batch.add(quads, 1, 0, 0);             // from the first, unless told
    assert.deepEqual(bytesOf(first, 0).slice(0, 3), [255, 255, 0]);
  });

  it('has no batch for its points\' glows until it\'s given one, and destroys the one it has with it', () => {
    assert.isNull(batch.glows);
    const glows = new PointBatch();
    batch.glows = glows;
    batch.destroy();
    assert.isTrue(glows.destroyed);
    assert.isNull(batch.glows);

    // ..unless that one is gone already, as when their container destroyed both
    const other = new PointBatch();
    other.glows = new PointBatch();
    other.glows.destroy();
    assert.doesNotThrow(() => other.destroy());
  });

  it('tells every batch\'s shader how bright the pictures that pulse are now', () => {
    const other = new PointBatch();
    assert.strictEqual(other.shader, batch.shader);
    other.destroy();

    const uniforms = batch.shader.resources.pointUniforms.uniforms;
    PointBatch.setTime(0.6);
    assert.strictEqual(uniforms.uPulse, 0.6);
    PointBatch.setTime(1);
    assert.strictEqual(uniforms.uPulse, 1);
  });

  it('hides a point by one byte of each vertex, and leaves its pictures\' opacity alone', () => {
    const item = batch.add([quad({ alpha: 0.5 }), quad({ alpha: 0 })], 2, 0, 0);
    batch.setVisible(item, false);
    assert.deepEqual(bytesOf(item, 0).slice(3, 6), [128, 0, 0]);
    assert.deepEqual(bytesOf(item, 4).slice(3, 6), [0, 0, 0]);

    batch.setVisible(item, true);
    assert.deepEqual(bytesOf(item, 0).slice(3, 6), [128, 0, 255]);
    assert.deepEqual(bytesOf(item, 4).slice(3, 6), [0, 0, 255], 'a picture that can\'t be seen is still a shown point\'s');
  });

  it('keeps a hidden point hidden when its pictures are written again', () => {
    const item = batch.add([quad()], 1, 0, 0);
    batch.setVisible(item, false);
    batch.set(item, [quad({ color: 0xff0000 })], 1, 5, 5);
    assert.deepEqual(bytesOf(item, 0).slice(0, 6), [255, 0, 0, 255, 0, 0]);
  });

  it('draws two triangles for each picture, the pictures in the order they were given', () => {
    const item = batch.add([quad(), quad()], 2, 0, 0);
    batch.flush();
    assert.isTrue(batch.renderable);
    assert.deepEqual(drawn(), [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7].map(index => index + item.first));
  });

  it('draws the points in the order of their order', () => {
    const south = batch.add([quad()], 1, 0, 200, 1, 200);
    const north = batch.add([quad()], 1, 0, 100, 1, 100);
    batch.flush();
    assert.deepEqual(drawn(), [
      ...[0, 1, 2, 0, 2, 3].map(index => index + north.first),    // the northern one first, under the southern
      ...[0, 1, 2, 0, 2, 3].map(index => index + south.first)
    ]);
  });

  it('writes a point that changed where it was, if it has as many pictures', () => {
    const a = batch.add([quad()], 1, 0, 0);
    batch.add([quad()], 1, 10, 10);
    const first = a.first;
    batch.set(a, [quad({ width: 20, height: 20 })], 1, 3, 4);     // moved, with another marker
    assert.strictEqual(a.first, first);
    assert.deepEqual(floatsOf(a, 2).slice(0, 4), [3, 4, 10, 10]);
  });

  it('writes a point that has more pictures at the end, drawn as before', () => {
    const a = batch.add([quad()], 1, 0, 0, 1, 1);
    const b = batch.add([quad()], 1, 0, 0, 1, 2);
    batch.set(a, [quad(), quad({ texture: cafe, width: 8, height: 8 })], 2, 0, 0);    // its icon arrived
    batch.flush();

    assert.strictEqual(a.first, b.first + b.count);
    assert.strictEqual(a.count, 8);
    assert.deepEqual(drawn().slice(0, 12), [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7].map(index => index + a.first));    // still under b
    assert.strictEqual(batch.geometry.indexCount, 18);
  });

  it('ignores a point of another batch', () => {
    const other = new PointBatch();
    const item = other.add([quad()], 1, 0, 0);
    batch.set(item, [quad(), quad()], 2, 0, 0);
    assert.strictEqual(item.count, 4);
    assert.strictEqual(batch.size, 0);
    other.destroy();
  });

  it('moves every vertex of its points with its place in the world', () => {
    const item = batch.add([quad(), quad()], 2, 100, 50);
    batch.position.set(1000, 2000);
    batch.moveOrigin(1100, 2040);
    for (let i = 0; i < 8; i++) {
      assert.deepEqual(floatsOf(item, i).slice(0, 2), [0, 10]);
    }
    closeTo(cornersOf(item, 1), [[-8, -16], [8, -16], [8, 16], [-8, 16]]);    // the corners are where they were
  });
});
