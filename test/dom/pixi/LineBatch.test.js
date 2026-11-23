import { LineBatch } from '../../../modules/pixi/lib/LineBatch.ts';
import { geomStrokeMesh } from '../../../modules/geo/stroke.ts';


// A batch draws many lines as one mesh. Each vertex is 12 floats (the point on the line, its
// offset for a half width of 1, the distance along the line, the second place it can have, and
// the line's width) and 8 bytes (color, opacity, dashes).
describe('LineBatch', () => {
  const FLOATS = 12;
  const BYTES = 8;
  const STYLE = { width: 5, minWidth: 2, color: 0x336699, alpha: 0.5 };

  // A line from [0,0] to [10,0] to [10,10], and a longer one
  const corner = geomStrokeMesh([0, 0, 10, 0, 10, 10]);
  const straight = geomStrokeMesh([0, 0, 10, 0]);
  const zigzag = geomStrokeMesh(Array.from({ length: 40 }, (_, i) => (i % 2) ? (i >> 1) % 2 : (i >> 1)), { join: 'round' });

  let batch;
  beforeEach(() => {
    batch = new LineBatch();
  });
  afterEach(() => {
    if (!batch.destroyed) batch.destroy();
  });

  // The floats and bytes of a vertex of a line in the batch
  const floatsOf = (item, i = 0) => Array.from(batch._floats.subarray((item.first + i) * FLOATS, (item.first + i + 1) * FLOATS));
  const bytesOf = (item, i = 0) => Array.from(batch._bytes.subarray((item.first + i) * BYTES, (item.first + i + 1) * BYTES));
  // The indices that are drawn
  const drawn = () => Array.from(batch._indices.subarray(0, batch.geometry.indexCount));


  it('draws nothing until it has a line', () => {
    batch.flush();
    assert.strictEqual(batch.size, 0);
    assert.isFalse(batch.renderable);
    assert.strictEqual(batch.eventMode, 'none');
  });

  it('copies a line\'s vertices, at its place in the batch\'s coordinates', () => {
    const item = batch.add(corner, 100, -50, STYLE);
    assert.strictEqual(batch.size, 1);
    assert.strictEqual(item.batch, batch);
    assert.strictEqual(item.count, corner.vertexCount);

    for (let i = 0; i < corner.vertexCount; i++) {
      const v = corner.vertices.subarray(i * 7, i * 7 + 7);
      const f = floatsOf(item, i);
      assert.closeTo(f[0], v[0] + 100, 1e-4, 'x');
      assert.closeTo(f[1], v[1] - 50, 1e-4, 'y');
      assert.deepEqual(f.slice(2, 6), [v[2], v[3], v[4], v[5]], 'offset, distance, further along');
    }
  });

  it('gives a vertex its second place, and the half width it\'s for', () => {
    assert.isAbove(corner.fallbacks.length, 0);    // the vertex inside the corner has one
    const item = batch.add(corner, 0, 0, STYLE);

    const withSecond = new Map();
    for (let f = 0; f < corner.fallbacks.length; f += 6) {
      withSecond.set(corner.fallbacks[f], corner.fallbacks.subarray(f, f + 6));
    }
    for (let i = 0; i < corner.vertexCount; i++) {
      const f = floatsOf(item, i);
      const second = withSecond.get(i);
      if (second) {
        assert.deepEqual(f.slice(6, 10), [second[2], second[3], second[4], second[1]]);
      } else {
        assert.deepEqual(f.slice(6, 9), [f[2], f[3], f[5]], 'the same place again');
        assert.isAbove(f[9], 1e30, 'at a half width no line has');
      }
    }
  });

  it('writes how a line is drawn into each of its vertices', () => {
    const stroke = batch.add(corner, 0, 0, { ...STYLE, dash: [10, 5, 2, 5] });
    const casing = batch.add(corner, 0, 0, { width: 8, minWidth: 3, color: 0xff0000, alpha: 1, isCasing: true });
    for (let i = 0; i < corner.vertexCount; i++) {
      assert.deepEqual(floatsOf(stroke, i).slice(10), [5, 2]);
      assert.deepEqual(bytesOf(stroke, i), [0x33, 0x66, 0x99, 128, 10, 5, 2, 5]);
      assert.deepEqual(floatsOf(casing, i).slice(10), [8, -3], 'a casing\'s least width is negative');
      assert.deepEqual(bytesOf(casing, i), [255, 0, 0, 255, 0, 0, 0, 0]);
    }

    batch.setStyle(stroke, { width: 3, minWidth: 2, color: 0x000001, alpha: 1 });
    assert.deepEqual(floatsOf(stroke, 2).slice(10), [3, 2]);
    assert.deepEqual(bytesOf(stroke, 2), [0, 0, 1, 255, 0, 0, 0, 0]);
    assert.deepEqual(bytesOf(casing, 2), [255, 0, 0, 255, 0, 0, 0, 0], 'the other line is as it was');
  });

  it('draws the lines in the order of their order, and equal ones in the order they were added', () => {
    const top = batch.add(straight, 0, 0, STYLE, 2);
    const bottom = batch.add(straight, 0, 0, STYLE, 1);
    const alsoTop = batch.add(straight, 0, 0, STYLE, 2);
    batch.flush();

    const n = straight.indices.length;
    const expected = [];
    for (const item of [bottom, top, alsoTop]) {
      for (const index of straight.indices) expected.push(index + item.first);
    }
    assert.isTrue(batch.renderable);
    assert.strictEqual(batch.geometry.indexCount, 3 * n);
    assert.deepEqual(drawn(), expected);

    batch.setOrder(bottom, 3);
    batch.flush();
    assert.deepEqual(drawn().slice(2 * n), Array.from(straight.indices, index => index + bottom.first));
  });

  it('hides a line by the opacity in its vertices, and builds nothing', () => {
    const a = batch.add(straight, 0, 0, STYLE);
    const b = batch.add(corner, 0, 0, STYLE);
    batch.flush();
    const before = drawn();

    // What's sent to the GPU is that line's bytes
    const sentBytes = [];
    const sentFloats = [];
    const sentIndices = [];
    batch._byteBuffer.update = (size, offset) => sentBytes.push([size, offset]);
    batch._floatBuffer.update = (size, offset) => sentFloats.push([size, offset]);
    batch._indexBuffer.update = (size, offset) => sentIndices.push([size, offset]);

    batch.setVisible(a, false);
    batch.flush();
    for (let i = 0; i < straight.vertexCount; i++) {
      assert.strictEqual(bytesOf(a, i)[3], 0, 'the shader draws nothing for an opacity of 0');
    }
    assert.strictEqual(bytesOf(b)[3], 128, 'the other line is as it was');
    assert.deepEqual(drawn(), before, 'its triangles stay where they are');
    assert.strictEqual(batch.size, 2);
    assert.isTrue(batch.renderable);
    assert.deepEqual(sentBytes, [[straight.vertexCount * BYTES, a.first * BYTES]]);
    assert.deepEqual(sentFloats, []);
    assert.deepEqual(sentIndices, []);

    batch.setVisible(b, false);
    batch.flush();
    assert.isFalse(batch.renderable, 'nothing to draw');

    batch.setVisible(a, true);
    batch.flush();
    assert.isTrue(batch.renderable);
    assert.strictEqual(bytesOf(a, 1)[3], 128);
    assert.strictEqual(bytesOf(b, 1)[3], 0);
  });

  it('keeps a hidden line hidden when its style or its shape changes, and shows it as it should be', () => {
    const a = batch.add(straight, 0, 0, STYLE);
    batch.setVisible(a, false);
    batch.setStyle(a, { ...STYLE, alpha: 1 });
    assert.strictEqual(bytesOf(a)[3], 0);
    batch.setStroke(a, corner, 0, 0);    // more vertices: it moves, with its style
    assert.strictEqual(bytesOf(a, corner.vertexCount - 1)[3], 0);
    assert.deepEqual(floatsOf(a, corner.vertexCount - 1).slice(10), [5, 2]);

    batch.setVisible(a, true);
    assert.strictEqual(bytesOf(a, corner.vertexCount - 1)[3], 255);
  });

  it('draws a line that\'s nearly transparent, and not as a hidden one', () => {
    const a = batch.add(straight, 0, 0, { ...STYLE, alpha: 0.001 });
    assert.strictEqual(bytesOf(a)[3], 1);
  });

  it('writes a line that changed where it was, if it has as many vertices', () => {
    const a = batch.add(corner, 0, 0, STYLE);
    const b = batch.add(straight, 0, 0, STYLE);
    batch.flush();
    const first = a.first;
    const moved = geomStrokeMesh([0, 0, 10, 0, 10, 20]);    // its last point moved
    assert.strictEqual(moved.vertexCount, corner.vertexCount);

    // What's sent to the GPU is that line's part of the buffers
    const sent = [];
    batch._floatBuffer.update = (size, offset) => sent.push([size, offset]);
    batch.setStroke(a, moved, 0, 0);
    batch.flush();

    assert.strictEqual(a.first, first);
    assert.deepEqual(floatsOf(a, moved.vertexCount - 1).slice(0, 2), Array.from(moved.vertices.subarray((moved.vertexCount - 1) * 7, (moved.vertexCount - 1) * 7 + 2)));
    assert.deepEqual(floatsOf(a).slice(10), [5, 2], 'drawn as before');
    assert.deepEqual(sent, [[corner.vertexCount * FLOATS * 4, first * FLOATS * 4]]);
    assert.strictEqual(batch.vertexUse[0], corner.vertexCount + straight.vertexCount);
    assert.strictEqual(b.batch, batch);
  });

  it('writes a line that has more vertices at the end, drawn as before and in the same order', () => {
    const a = batch.add(straight, 0, 0, { ...STYLE, dash: [6, 3] }, 1);
    const b = batch.add(straight, 0, 0, STYLE, 2);
    batch.setStroke(a, corner, 5, 5);
    batch.flush();

    assert.strictEqual(a.first, b.first + b.count);
    assert.strictEqual(a.count, corner.vertexCount);
    assert.deepEqual(bytesOf(a, corner.vertexCount - 1), [0x33, 0x66, 0x99, 128, 6, 3, 0, 0]);
    assert.deepEqual(floatsOf(a, corner.vertexCount - 1).slice(10), [5, 2]);
    assert.closeTo(floatsOf(a)[0], corner.vertices[0] + 5, 1e-4);
    assert.deepEqual(drawn().slice(0, corner.indices.length), Array.from(corner.indices, index => index + a.first), 'still drawn first');
    assert.strictEqual(batch.vertexUse[0], corner.vertexCount + straight.vertexCount);
  });

  it('takes a line out, and draws the rest', () => {
    const a = batch.add(straight, 0, 0, STYLE);
    const b = batch.add(corner, 0, 0, STYLE);
    batch.remove(a);
    batch.flush();
    assert.isNull(a.batch);
    assert.strictEqual(batch.size, 1);
    assert.deepEqual(drawn(), Array.from(corner.indices, index => index + b.first));

    batch.setStyle(a, { ...STYLE, color: 0xffffff });    // a line that isn't in the batch: nothing happens
    batch.remove(a);
    assert.strictEqual(batch.size, 1);
  });

  it('makes room for more lines, and keeps the ones it has', () => {
    const items = [];
    for (let i = 0; i < 40; i++) {
      items.push(batch.add(zigzag, i, 0, { ...STYLE, width: i + 1 }));
    }
    batch.flush();
    const [used, capacity] = batch.vertexUse;
    assert.strictEqual(used, 40 * zigzag.vertexCount);
    assert.isAtLeast(capacity, used);
    assert.strictEqual(batch._floatBuffer.data, batch._floats, 'the GPU gets the larger array');
    assert.lengthOf(batch._floats, capacity * FLOATS);
    assert.lengthOf(batch._bytes, capacity * BYTES);

    items.forEach((item, i) => {
      assert.closeTo(floatsOf(item)[0], zigzag.vertices[0] + i, 1e-4);
      assert.strictEqual(floatsOf(item)[10], i + 1);
    });
    assert.strictEqual(batch.geometry.indexCount, 40 * zigzag.indices.length);
    assert.strictEqual(Math.max(...drawn()), used - 1);
  });

  it('packs itself when more than half of it is unused', () => {
    const items = [];
    for (let i = 0; i < 40; i++) {
      items.push(batch.add(zigzag, i, 0, { ...STYLE, width: i + 1 }));
    }
    for (let i = 0; i < 30; i++) {
      batch.remove(items[i]);
    }
    const kept = items.slice(30);
    assert.isAbove(kept[0].first, 0);
    batch.flush();

    assert.strictEqual(kept[0].first, 0, 'moved to the start');
    kept.forEach((item, i) => {
      assert.strictEqual(item.first, i * zigzag.vertexCount);
      assert.closeTo(floatsOf(item)[0], zigzag.vertices[0] + 30 + i, 1e-4);
      assert.strictEqual(floatsOf(item)[10], 31 + i);
    });
    assert.strictEqual(batch.geometry.indexCount, 10 * zigzag.indices.length);
    assert.strictEqual(Math.max(...drawn()), 10 * zigzag.vertexCount - 1);

    // ..and uses the room again
    const more = batch.add(zigzag, 0, 0, STYLE);
    assert.strictEqual(more.first, 10 * zigzag.vertexCount);
  });

  it('says which dashes it can draw', () => {
    assert.isTrue(LineBatch.canDraw(null));
    assert.isTrue(LineBatch.canDraw(undefined));
    assert.isTrue(LineBatch.canDraw([]));
    assert.isTrue(LineBatch.canDraw([6, 3]));
    assert.isTrue(LineBatch.canDraw([20, 5, 5, 5]));
    assert.isFalse(LineBatch.canDraw([6]));
    assert.isFalse(LineBatch.canDraw([6, 3, 2, 3, 2, 3]));
    assert.isFalse(LineBatch.canDraw([6.5, 3]));
    assert.isFalse(LineBatch.canDraw([300, 3]));
  });

  it('draws every batch with one shader, which gets the view\'s numbers', () => {
    const other = new LineBatch();
    assert.strictEqual(other.shader, batch.shader);
    other.destroy();

    LineBatch.setView({ pixel: 0.25, narrow: 2, wireframe: true, casing: false });
    const uniforms = batch.shader.resources.lineUniforms.uniforms;
    assert.deepEqual([uniforms.uPixel, uniforms.uNarrow, uniforms.uWireframe, uniforms.uCasing], [0.25, 2, 1, 0]);
    LineBatch.setView({ pixel: 1, narrow: 0, wireframe: false, casing: true });
    assert.deepEqual([uniforms.uPixel, uniforms.uNarrow, uniforms.uWireframe, uniforms.uCasing], [1, 0, 0, 1]);
  });

  it('brings itself up to date when Pixi is about to render it', () => {
    batch.add(straight, 0, 0, STYLE);
    assert.isFalse(batch.renderable);
    batch.onRender();
    assert.isTrue(batch.renderable);
  });

  it('destroys its buffers with it, and its lines are in no batch then', () => {
    const item = batch.add(straight, 0, 0, STYLE);
    const geometry = batch.geometry;
    const shader = batch.shader;
    batch.destroy();
    assert.isTrue(batch.destroyed);
    assert.isNull(geometry.buffers);
    assert.isNull(item.batch);
    assert.isOk(shader.glProgram, 'the shader is every batch\'s');
  });
});
