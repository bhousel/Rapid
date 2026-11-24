import { FillBatchMesh } from '../../../modules/pixi/lib/FillBatchMesh.ts';
import { BatchShaders } from '../../../modules/pixi/lib/BatchShaders.ts';

// The shaders that a scene's batches draw with (every batch of a kind shares its kind's shader)
const batchShaders = new BatchShaders();


// A batch draws the fills of many areas as one mesh. Each vertex is 2 floats (where it is) and
// 8 bytes (color, opacity, pattern). What a batch does with its buffers is `BatchMesh`'s,
// which `LineBatchMesh.test.js` covers.
describe('FillBatchMesh', () => {
  const BYTES = 8;
  const STYLE = { color: 0x336699, alpha: 0.5 };

  // A square of two triangles, and a triangle
  const square = { positions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
  const triangle = { positions: new Float32Array([0, 0, 4, 0, 0, 4]), indices: new Uint16Array([0, 1, 2]) };
  const pentagon = { positions: new Float32Array([0, 0, 4, 0, 6, 3, 2, 6, -2, 3]), indices: new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4]) };

  let batch;
  beforeEach(() => {
    batch = new FillBatchMesh(batchShaders.fills);
  });
  afterEach(() => {
    if (!batch.destroyed) batch.destroy();
  });

  const positionsOf = item => Array.from(batch._floats.subarray(item.first * 2, (item.first + item.count) * 2));
  const bytesOf = (item, i = 0) => Array.from(batch._bytes.subarray((item.first + i) * BYTES, (item.first + i + 1) * BYTES));
  const drawn = () => Array.from(batch._indices.subarray(0, batch.geometry.indexCount));


  it('copies a fill\'s corners, at its place in the batch\'s coordinates', () => {
    const item = batch.add(square.positions, square.indices, 100, -50, STYLE);
    assert.strictEqual(batch.size, 1);
    assert.strictEqual(item.count, 4);
    assert.deepEqual(positionsOf(item), [100, -50, 110, -50, 110, -40, 100, -40]);
  });

  it('writes its color, opacity and pattern into each vertex', () => {
    const plain = batch.add(square.positions, square.indices, 0, 0, STYLE);
    const patterned = batch.add(triangle.positions, triangle.indices, 0, 0, { color: 0xff0000, alpha: 1, pattern: 11 });
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(bytesOf(plain, i).slice(0, 5), [0x33, 0x66, 0x99, 128, 0]);
    }
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(bytesOf(patterned, i).slice(0, 5), [255, 0, 0, 255, 11]);
    }

    batch.setStyle(plain, { color: 0x000001, alpha: 1, pattern: 3 });
    assert.deepEqual(bytesOf(plain, 3).slice(0, 5), [0, 0, 1, 255, 3]);
    assert.deepEqual(bytesOf(patterned).slice(0, 5), [255, 0, 0, 255, 11], 'the other fill is as it was');
  });

  it('draws the fills in the order of their order', () => {
    const small = batch.add(triangle.positions, triangle.indices, 0, 0, STYLE, -16);
    const large = batch.add(square.positions, square.indices, 0, 0, STYLE, -100);
    batch.flush();
    assert.isTrue(batch.renderable);
    assert.deepEqual(drawn(), [
      ...Array.from(square.indices, index => index + large.first),      // the largest first, under the smaller
      ...Array.from(triangle.indices, index => index + small.first)
    ]);
  });

  it('writes a fill that changed where it was, if it has as many corners', () => {
    const a = batch.add(square.positions, square.indices, 0, 0, STYLE);
    batch.add(triangle.positions, triangle.indices, 0, 0, STYLE);
    const first = a.first;
    const moved = new Float32Array([0, 0, 10, 0, 12, 12, 0, 10]);
    batch.setFill(a, moved, square.indices, 1, 1);
    assert.strictEqual(a.first, first);
    assert.deepEqual(positionsOf(a), [1, 1, 11, 1, 13, 13, 1, 11]);
    assert.deepEqual(bytesOf(a, 2).slice(0, 4), [0x33, 0x66, 0x99, 128]);
  });

  it('writes a fill that has more corners at the end, drawn as before', () => {
    const a = batch.add(triangle.positions, triangle.indices, 0, 0, { ...STYLE, pattern: 7 }, 1);
    const b = batch.add(square.positions, square.indices, 0, 0, STYLE, 2);
    batch.setFill(a, pentagon.positions, pentagon.indices, 0, 0);    // a band worked out for another zoom, say
    batch.flush();

    assert.strictEqual(a.first, b.first + b.count);
    assert.strictEqual(a.count, 5);
    assert.deepEqual(positionsOf(a), Array.from(pentagon.positions));
    assert.deepEqual(bytesOf(a, 4).slice(0, 5), [0x33, 0x66, 0x99, 128, 7]);
    assert.deepEqual(drawn().slice(0, 9), Array.from(pentagon.indices, index => index + a.first), 'still drawn first');
  });

  it('writes a fill that has fewer corners at the end too, with as many as it has now', () => {
    const a = batch.add(pentagon.positions, pentagon.indices, 0, 0, STYLE);
    const b = batch.add(square.positions, square.indices, 0, 0, STYLE);
    batch.setFill(a, triangle.positions, triangle.indices, 0, 0);
    batch.flush();

    assert.strictEqual(a.count, 3);
    assert.strictEqual(a.first, b.first + b.count);
    assert.deepEqual(positionsOf(a), Array.from(triangle.positions));
    assert.strictEqual(batch.vertexUse[0], 3 + 4, 'the room it had isn\'t counted as used');
    assert.strictEqual(batch.geometry.indexCount, 3 + 6);
  });

  it('hides a fill by the opacity in its vertices, and keeps it hidden when its style changes', () => {
    const a = batch.add(square.positions, square.indices, 0, 0, STYLE);
    batch.setVisible(a, false);
    assert.strictEqual(bytesOf(a, 3)[3], 0);
    batch.setStyle(a, { color: 0xffffff, alpha: 1 });
    assert.strictEqual(bytesOf(a, 3)[3], 0);
    batch.flush();
    assert.isFalse(batch.renderable);

    batch.setVisible(a, true);
    assert.strictEqual(bytesOf(a, 3)[3], 255);
  });

  it('draws every batch with one shader, which gets the view\'s numbers', () => {
    const other = new FillBatchMesh(batchShaders.fills);
    assert.strictEqual(other.shader, batch.shader);
    other.destroy();

    batchShaders.fills.setView({ pixel: 0.25, rotation: Math.PI / 2, wireframe: true });
    const uniforms = batch.shader.resources.fillUniforms.uniforms;
    assert.strictEqual(uniforms.uPixel, 0.25);
    assert.strictEqual(uniforms.uWireframe, 1);
    assert.closeTo(uniforms.uRotation[0], 0, 1e-6);    // the cosine and the sine of the map's rotation
    assert.closeTo(uniforms.uRotation[1], 1, 1e-6);

    batchShaders.fills.setView({ pixel: 1, rotation: 0, wireframe: false });
    assert.deepEqual([uniforms.uPixel, uniforms.uWireframe, uniforms.uRotation[0], uniforms.uRotation[1]], [1, 0, 1, 0]);
  });

  it('takes its patterns from one texture, and says how they\'re laid out in it', () => {
    const source = { pixelWidth: 272, pixelHeight: 136, style: { label: 'style' } };
    batchShaders.fills.setPatterns({ texture: { source: source }, columns: 8, cell: 34, tile: 32 });
    const resources = batch.shader.resources;
    assert.strictEqual(resources.uPatterns, source);
    assert.strictEqual(resources.uPatternsSampler, source.style);
    assert.deepEqual(Array.from(resources.fillUniforms.uniforms.uAtlas), [8, 34, 32, 0]);
    assert.deepEqual(Array.from(resources.fillUniforms.uniforms.uAtlasSize), [272, 136]);
  });
});
