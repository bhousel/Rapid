import { LineBatchMesh, LINE_GLOW, LINE_MARKERS } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { geomStrokeMesh } from '../../../modules/geo/stroke.ts';
import { BatchShaders } from '../../../modules/pixi/lib/BatchShaders.ts';

// The shaders that a scene's batches draw with (every batch of a kind shares its kind's shader)
const batchShaders = new BatchShaders();


// A batch draws many lines as one mesh. Each vertex is 12 floats (the point on the line, its
// offset for a half width of 1, the distance along the line, the second place it can have, and
// the line's width) and 8 bytes (color, opacity, dashes).
describe('LineBatchMesh', () => {
  const FLOATS = 12;
  const BYTES = 8;
  const STYLE = { width: 5, minWidth: 2, color: 0x336699, alpha: 0.5 };

  // A line from [0,0] to [10,0] to [10,10], and a longer one
  const corner = geomStrokeMesh([0, 0, 10, 0, 10, 10]);
  const straight = geomStrokeMesh([0, 0, 10, 0]);
  const zigzag = geomStrokeMesh(Array.from({ length: 40 }, (_, i) => (i % 2) ? (i >> 1) % 2 : (i >> 1)), { join: 'round' });

  let batch;
  beforeEach(() => {
    batch = new LineBatchMesh(batchShaders.lines);
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

  it('says where a line is in the order it draws in, before that order is built', () => {
    const top = batch.add(straight, 0, 0, STYLE, 2);
    const bottom = batch.add(straight, 0, 0, STYLE, 1);
    const alsoTop = batch.add(straight, 0, 0, STYLE, 2);
    assert.deepEqual([bottom, top, alsoTop].map(item => batch.drawIndex(item)), [0, 1, 2]);

    batch.setOrder(bottom, 3);
    assert.strictEqual(batch.drawIndex(bottom), 2);

    batch.remove(top);
    assert.strictEqual(batch.drawIndex(top), -1);
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

  it('keeps the buffers it has when lines come and go, as long as what\'s in use fits in three quarters of them', () => {
    const items = [];
    for (let i = 0; i < 40; i++) {
      items.push(batch.add(zigzag, i, 0, STYLE));
    }
    batch.flush();
    const capacity = batch.vertexUse[1];
    const floats = batch._floats;

    // Take a few out and put as many in, again and again: more than the buffers could hold
    // if nothing were packed. (Half as many in use as there's room for, give or take.)
    const turns = Math.ceil(3 * capacity / (4 * zigzag.vertexCount));
    for (let turn = 0; turn < turns; turn++) {
      for (let i = 0; i < 4; i++) {
        batch.remove(items.shift());
        items.push(batch.add(zigzag, 100 + turn, i, STYLE));
      }
      batch.flush();
    }
    assert.strictEqual(batch.vertexUse[0], 40 * zigzag.vertexCount);
    assert.strictEqual(batch.vertexUse[1], capacity, 'no more room than before');
    assert.strictEqual(batch._floats, floats, 'the same arrays');
    assert.closeTo(floatsOf(items[39])[0], zigzag.vertices[0] + 100 + turns - 1, 1e-4);
    assert.strictEqual(batch.geometry.indexCount, 40 * zigzag.indices.length);
  });

  it('gets smaller buffers when less than a third of them is in use, and keeps what it has', () => {
    const items = [];
    for (let i = 0; i < 60; i++) {
      items.push(batch.add(zigzag, i, 0, { ...STYLE, width: i + 1 }));
    }
    batch.flush();
    const capacity = batch.vertexUse[1];

    for (let i = 0; i < 50; i++) {
      batch.remove(items[i]);
    }
    batch.flush();
    const [used, smaller] = batch.vertexUse;
    assert.strictEqual(used, 10 * zigzag.vertexCount);
    assert.isBelow(smaller, capacity / 2);
    assert.isAtLeast(smaller, used * 1.4, 'with room to grow');
    assert.lengthOf(batch._floats, smaller * FLOATS);
    assert.lengthOf(batch._bytes, smaller * BYTES);
    assert.strictEqual(batch._floatBuffer.data, batch._floats, 'the GPU gets the smaller array');

    const kept = items.slice(50);
    kept.forEach((item, i) => {
      assert.strictEqual(item.first, i * zigzag.vertexCount);
      assert.closeTo(floatsOf(item)[0], zigzag.vertices[0] + 50 + i, 1e-4);
      assert.strictEqual(floatsOf(item)[10], 51 + i);
    });
    assert.strictEqual(batch.geometry.indexCount, 10 * zigzag.indices.length);

    // ..and never smaller than a batch starts
    for (const item of kept) {
      batch.remove(item);
    }
    batch.flush();
    assert.strictEqual(batch.vertexUse[1], 256);
    assert.isFalse(batch.renderable);
  });

  it('moves its origin, and keeps every line where it is in the world', () => {
    batch.position.set(1000, 2000);
    const a = batch.add(corner, 10, 20, STYLE);
    const b = batch.add(straight, -5, 0, STYLE);
    batch.flush();
    const worldOf = (item, i) => [floatsOf(item, i)[0] + batch.position.x, floatsOf(item, i)[1] + batch.position.y];
    const before = [worldOf(a, 0), worldOf(a, 3), worldOf(b, 1)];
    const offsets = floatsOf(a, 3).slice(2);

    const sent = [];
    batch._floatBuffer.update = (size, offset) => sent.push([size, offset]);
    batch.moveOrigin(1500, 1800);
    batch.flush();

    assert.deepEqual([batch.position.x, batch.position.y], [1500, 1800]);
    assert.deepEqual([worldOf(a, 0), worldOf(a, 3), worldOf(b, 1)], before);
    assert.strictEqual(floatsOf(a)[0], corner.vertices[0] + 10 - 500);
    assert.deepEqual(floatsOf(a, 3).slice(2), offsets, 'nothing else in a vertex changes');
    assert.deepEqual(sent, [[(corner.vertexCount + straight.vertexCount) * FLOATS * 4, 0]], 'all of the vertices go to the GPU again');

    // a line added afterwards is written relative to the new place by its caller; one moved to where it is changes nothing
    sent.length = 0;
    batch.moveOrigin(1500, 1800);
    batch.flush();
    assert.deepEqual(sent, []);
  });

  it('says which dashes it can draw', () => {
    assert.isTrue(LineBatchMesh.canDraw(null));
    assert.isTrue(LineBatchMesh.canDraw(undefined));
    assert.isTrue(LineBatchMesh.canDraw([]));
    assert.isTrue(LineBatchMesh.canDraw([6, 3]));
    assert.isTrue(LineBatchMesh.canDraw([20, 5, 5, 5]));
    assert.isFalse(LineBatchMesh.canDraw([6]));
    assert.isFalse(LineBatchMesh.canDraw([6, 3, 2, 3, 2, 3]));
    assert.isFalse(LineBatchMesh.canDraw([6.5, 3]));
    assert.isFalse(LineBatchMesh.canDraw([300, 3]));
  });

  it('draws every batch with one shader, which gets the view\'s numbers', () => {
    const other = new LineBatchMesh(batchShaders.lines);
    assert.strictEqual(other.shader, batch.shader);
    other.destroy();

    batchShaders.lines.setView({ pixel: 0.25, narrow: 2, wireframe: true, casing: false, markers: true });
    const uniforms = batch.shader.resources.lineUniforms.uniforms;
    assert.deepEqual([uniforms.uPixel, uniforms.uNarrow, uniforms.uWireframe, uniforms.uCasing, uniforms.uMarkers], [0.25, 2, 1, 0, 1]);
    batchShaders.lines.setView({ pixel: 1, narrow: 0, wireframe: false, casing: true, markers: false });
    assert.deepEqual([uniforms.uPixel, uniforms.uNarrow, uniforms.uWireframe, uniforms.uCasing, uniforms.uMarkers], [1, 0, 0, 1, 0]);
    batchShaders.lines.setView({ pixel: 1, narrow: 0, wireframe: false, casing: true, markers: true });
  });

  // The markers along a line (oneway arrows, the triangles of a line with sides) are a strip
  // along the line, in the batch like any line. The shader draws the markers in the strip, from
  // the distance along the line and the distance to its side.
  describe('markers', () => {
    const ARROWS = { kind: 'oneway', color: 0x112233, alpha: 1 };

    it('are the line\'s vertices, with a width of their own and a least width of 0, which says what they are', () => {
      const item = batch.addMarkers(corner, 100, -50, ARROWS, 7);
      assert.strictEqual(batch.size, 1);
      assert.strictEqual(item.count, corner.vertexCount);
      assert.strictEqual(item.indices, corner.indices);
      assert.strictEqual(item.order, 7);

      for (let i = 0; i < corner.vertexCount; i++) {
        const v = corner.vertices.subarray(i * 7, i * 7 + 7);
        const f = floatsOf(item, i);
        assert.closeTo(f[0], v[0] + 100, 1e-4, 'x');
        assert.closeTo(f[1], v[1] - 50, 1e-4, 'y');
        assert.deepEqual(f.slice(2, 6), [v[2], v[3], v[4], v[5]], 'offset, distance, further along');
        assert.deepEqual(f.slice(10, 12), [LINE_MARKERS.oneway.width, 0]);
      }
    });

    it('have their color, their kind and their spacing in each vertex', () => {
      const arrows = batch.addMarkers(straight, 0, 0, ARROWS);
      const both = batch.addMarkers(straight, 0, 0, { kind: 'twoway', color: 0xff0000, alpha: 0.5 });
      const sided = batch.addMarkers(straight, 0, 0, { kind: 'sided', color: 0xcccccc, alpha: 1 });
      for (let i = 0; i < straight.vertexCount; i++) {
        assert.deepEqual(bytesOf(arrows, i).slice(0, 6), [0x11, 0x22, 0x33, 255, 1, 35]);
        assert.deepEqual(bytesOf(both, i).slice(0, 6), [255, 0, 0, 128, 2, 35]);
        assert.deepEqual(bytesOf(sided, i).slice(0, 6), [0xcc, 0xcc, 0xcc, 255, 3, 30]);
      }
      assert.deepEqual(floatsOf(sided).slice(10, 12), [LINE_MARKERS.sided.width, 0]);
      assert.isAtLeast(LINE_MARKERS.oneway.width, 5 + 1, 'an arrow is 5 across');
      assert.isAtLeast(LINE_MARKERS.sided.width, 2 * 9.5 + 1, 'a sided marker reaches 9.5 from the line');
    });

    it('have a number of their own for a oneway arrow that points back along the line', () => {
      const back = batch.addMarkers(straight, 0, 0, { ...ARROWS, reversed: true });
      assert.deepEqual(bytesOf(back).slice(4, 6), [4, 35]);
      batch.setMarkerStyle(back, ARROWS);
      assert.deepEqual(bytesOf(back).slice(4, 6), [1, 35]);

      // (An arrow with two heads, or a marker on the side, has no other way around.)
      const both = batch.addMarkers(straight, 0, 0, { kind: 'twoway', color: 0, alpha: 1, reversed: true });
      assert.strictEqual(bytesOf(both)[4], 2);
    });

    it('know which side of the line each vertex is on, at its place and at its second place', () => {
      const item = batch.addMarkers(corner, 0, 0, ARROWS);
      const seconds = new Map();
      for (let f = 0; f < corner.fallbacks.length; f += 6) {
        seconds.set(corner.fallbacks[f], corner.fallbacks[f + 5]);
      }
      assert.isAbove(seconds.size, 0);

      const sides = new Set();
      for (let i = 0; i < corner.vertexCount; i++) {
        const side = corner.vertices[i * 7 + 6];
        sides.add(side);
        const bytes = bytesOf(item, i);
        assert.strictEqual(bytes[6], side + 1, `vertex ${i}`);
        assert.strictEqual(bytes[7], (seconds.get(i) ?? side) + 1, `vertex ${i}, at its second place`);
      }
      assert.includeMembers([...sides], [-1, 1]);

      // With a round corner, a vertex's second place is on the line, not on the side it was on
      const round = geomStrokeMesh([0, 0, 10, 0, 10, 10], { join: 'round' });
      const strip = batch.addMarkers(round, 0, 0, ARROWS);
      let moved = 0;
      for (let f = 0; f < round.fallbacks.length; f += 6) {
        const i = round.fallbacks[f];
        const bytes = bytesOf(strip, i);
        assert.strictEqual(bytes[7], round.fallbacks[f + 5] + 1, `vertex ${i}, at its second place`);
        if (bytes[7] !== bytes[6]) moved++;
      }
      assert.isAbove(moved, 0);
    });

    it('change their kind and color where they are, and keep their sides', () => {
      const item = batch.addMarkers(corner, 0, 0, ARROWS);
      const sides = Array.from({ length: corner.vertexCount }, (_, i) => bytesOf(item, i).slice(6, 8));
      const first = item.first;
      batch.setMarkerStyle(item, { kind: 'sided', color: 0x445566, alpha: 1 });
      assert.strictEqual(item.first, first);
      for (let i = 0; i < corner.vertexCount; i++) {
        assert.deepEqual(bytesOf(item, i), [0x44, 0x55, 0x66, 255, 3, 30, ...sides[i]]);
        assert.deepEqual(floatsOf(item, i).slice(10, 12), [LINE_MARKERS.sided.width, 0]);
      }
    });

    it('go along another line: where they were if it has as many vertices, otherwise at the end', () => {
      const item = batch.addMarkers(corner, 0, 0, ARROWS);
      batch.add(straight, 0, 0, STYLE);
      const first = item.first;

      const other = geomStrokeMesh([0, 0, 20, 0, 20, 30]);     // the same corners, somewhere else
      assert.strictEqual(other.vertexCount, corner.vertexCount);
      batch.setMarkers(item, other, 5, 5, ARROWS);
      assert.strictEqual(item.first, first);
      assert.closeTo(floatsOf(item, 0)[0], other.vertices[0] + 5, 1e-4);
      assert.strictEqual(item.indices, other.indices);

      batch.setMarkers(item, zigzag, 0, 0, { kind: 'twoway', color: 0x112233, alpha: 1 });
      assert.strictEqual(item.count, zigzag.vertexCount);
      assert.isAbove(item.first, first);
      for (let i = 0; i < zigzag.vertexCount; i += 7) {
        const bytes = bytesOf(item, i);
        assert.deepEqual(bytes.slice(0, 6), [0x11, 0x22, 0x33, 255, 2, 35]);
        assert.strictEqual(bytes[6], zigzag.vertices[i * 7 + 6] + 1);
      }
    });

    it('are hidden like a line, and stay hidden when they change', () => {
      const item = batch.addMarkers(corner, 0, 0, ARROWS);
      batch.setVisible(item, false);
      assert.strictEqual(bytesOf(item, 2)[3], 0);
      batch.setMarkerStyle(item, { kind: 'oneway', color: 0xffffff, alpha: 1 });
      assert.strictEqual(bytesOf(item, 2)[3], 0);
      batch.setMarkers(item, corner, 1, 1, ARROWS);
      assert.strictEqual(bytesOf(item, 2)[3], 0);
      batch.setVisible(item, true);
      assert.strictEqual(bytesOf(item, 2)[3], 255);
    });

    it('are drawn in their order among the lines', () => {
      const markers = batch.addMarkers(straight, 0, 0, ARROWS, 1000);
      const line = batch.add(corner, 0, 0, STYLE, 5);
      batch.flush();
      assert.deepEqual(drawn(), [
        ...Array.from(corner.indices, index => index + line.first),
        ...Array.from(straight.indices, index => index + markers.first)     // over the line, though they were added first
      ]);
    });

    it('ignore the markers of another batch', () => {
      const other = new LineBatchMesh(batchShaders.lines);
      const item = other.addMarkers(straight, 0, 0, ARROWS);
      batch.setMarkers(item, corner, 0, 0, ARROWS);
      batch.setMarkerStyle(item, { kind: 'sided', color: 0, alpha: 1 });
      assert.strictEqual(item.count, straight.vertexCount);
      assert.strictEqual(other._bytes[item.first * BYTES + 4], 1);
      assert.strictEqual(batch._bytes[item.first * BYTES + 4], 0, 'nothing was written in this one');
      assert.strictEqual(batch.size, 0);
      other.destroy();
    });
  });

  // The glow of a hovered or highlighted line is a strip along the line too, wider than the
  // line by `LINE_GLOW` pixels on each side. The shader fades it with the distance from the
  // line, which it gets from where each vertex is from the nearest point of the line.
  describe('a glow', () => {
    const GLOW = { width: 8, minWidth: 3, color: 0xffff00, alpha: 1 };
    const round = geomStrokeMesh([0, 0, 10, 0, 10, 10], { cap: 'round', join: 'round' });

    it('is the line\'s vertices, with the line\'s width and a least width of 0, which says it\'s a strip', () => {
      const item = batch.addGlow(round, 100, -50, GLOW, 7);
      assert.strictEqual(batch.size, 1);
      assert.strictEqual(item.count, round.vertexCount);
      assert.strictEqual(item.indices, round.indices);
      assert.strictEqual(item.order, 7);

      for (let i = 0; i < round.vertexCount; i++) {
        const v = round.vertices.subarray(i * 7, i * 7 + 7);
        const f = floatsOf(item, i);
        assert.closeTo(f[0], v[0] + 100, 1e-4, 'x');
        assert.closeTo(f[1], v[1] - 50, 1e-4, 'y');
        assert.deepEqual(f.slice(2, 4), [v[2], v[3]], 'offset');
        assert.deepEqual(f.slice(10, 12), [8, 0]);
      }
      assert.isAbove(LINE_GLOW, 0);
    });

    it('has its color in each vertex, the number that says it\'s a glow, and the line\'s least width in sixteenths', () => {
      const item = batch.addGlow(round, 0, 0, GLOW);
      const blue = batch.addGlow(straight, 0, 0, { width: 3, minWidth: 1.5, color: 0x7092ff, alpha: 0.5 });
      for (let i = 0; i < round.vertexCount; i++) {
        assert.deepEqual(bytesOf(item, i).slice(0, 6), [255, 255, 0, 255, 5, 48]);
      }
      for (let i = 0; i < straight.vertexCount; i++) {
        assert.deepEqual(bytesOf(blue, i).slice(0, 6), [0x70, 0x92, 0xff, 128, 5, 24]);
      }
      // (5 is above every kind of marker: the shaders tell them apart by it)
      for (const layout of Object.values(LINE_MARKERS)) {
        assert.isBelow(layout.code, 5);
      }
    });

    it('never has a least width that doesn\'t fit in a byte', () => {
      const item = batch.addGlow(straight, 0, 0, { ...GLOW, minWidth: 40 });
      assert.strictEqual(bytesOf(item)[5], 255);
    });

    it('knows where each vertex is from the line: its normal on a segment\'s side, in half widths', () => {
      // A straight line that goes right: its sides are up and down from it
      const item = batch.addGlow(straight, 0, 0, GLOW);
      const seen = new Set();
      for (let i = 0; i < straight.vertexCount; i++) {
        const side = straight.vertices[i * 7 + 6];
        const [gx, gy] = floatsOf(item, i).slice(4, 6);
        assert.closeTo(gx, 0, 1e-6, `vertex ${i}, x`);
        assert.closeTo(Math.abs(gy), 1, 1e-6, `vertex ${i}, y`);
        seen.add(`${side},${Math.sign(gy)}`);
      }
      assert.strictEqual(seen.size, 2, 'one way on one side, the other way on the other: 0 on the line between them');
    });

    it('leaves out what a vertex is along the line: the tip of a miter is as far from the line as any edge', () => {
      const sharp = geomStrokeMesh([0, 0, 10, 0, 10, 10], { join: 'miter', miterLimit: 10 });
      const item = batch.addGlow(sharp, 0, 0, GLOW);
      let tips = 0;
      for (let i = 0; i < sharp.vertexCount; i++) {
        const v = sharp.vertices.subarray(i * 7, i * 7 + 7);
        const [gx, gy] = floatsOf(item, i).slice(4, 6);
        if (v[6] === 0) continue;
        assert.closeTo(Math.hypot(gx, gy), 1, 1e-5, `vertex ${i} is one half width from its segment`);
        assert.closeTo(gx * v[2] + gy * v[3], 1, 1e-5, `vertex ${i}: the part of its offset that's across the line`);
        if (v[5] !== 0) {
          tips++;
          assert.isAbove(Math.hypot(v[2], v[3]), 1.3, 'the vertex itself is further from the corner');
        }
      }
      assert.isAbove(tips, 0);
    });

    it('goes around a round end or corner: the vertices on the circle are a half width away, the middle is on the line', () => {
      const item = batch.addGlow(round, 0, 0, GLOW);
      let around = 0;
      let middles = 0;
      for (let i = 0; i < round.vertexCount; i++) {
        const v = round.vertices.subarray(i * 7, i * 7 + 7);
        if (v[6] !== 0) continue;
        const [gx, gy] = floatsOf(item, i).slice(4, 6);
        if (v[2] === 0 && v[3] === 0) {
          middles++;
          assert.deepEqual([gx, gy], [0, 0]);
        } else {
          around++;
          assert.closeTo(gx, v[2], 1e-6);
          assert.closeTo(gy, v[3], 1e-6);
          assert.closeTo(Math.hypot(gx, gy), 1, 1e-5);
        }
      }
      assert.isAbove(around, 4, 'two ends and a corner');
      assert.isAbove(middles, 1);
    });

    it('keeps a vertex\'s second place as the stroke mesh has it: beside its segment, or on the line', () => {
      const item = batch.addGlow(round, 0, 0, GLOW);
      assert.isAbove(round.fallbacks.length, 0);
      for (let f = 0; f < round.fallbacks.length; f += 6) {
        const i = round.fallbacks[f];
        const floats = floatsOf(item, i);
        assert.deepEqual(floats.slice(6, 8), [round.fallbacks[f + 2], round.fallbacks[f + 3]]);
        assert.include([0, 1], Math.round(Math.hypot(floats[6], floats[7]) * 1e5) / 1e5);
      }
    });

    it('changes its color and the line\'s width where it is, and keeps where its vertices are from the line', () => {
      const item = batch.addGlow(round, 0, 0, GLOW);
      const before = Array.from({ length: round.vertexCount }, (_, i) => floatsOf(item, i).slice(0, 10));
      batch.setGlowStyle(item, { width: 12, minWidth: 4, color: 0x7092ff, alpha: 1 });
      for (let i = 0; i < round.vertexCount; i++) {
        assert.deepEqual(floatsOf(item, i).slice(0, 10), before[i]);
        assert.deepEqual(floatsOf(item, i).slice(10, 12), [12, 0]);
        assert.deepEqual(bytesOf(item, i).slice(0, 6), [0x70, 0x92, 0xff, 255, 5, 64]);
      }
    });

    it('goes around another line: where it was if it has as many vertices, otherwise at the end', () => {
      const item = batch.addGlow(round, 0, 0, GLOW);
      batch.add(straight, 0, 0, STYLE);
      const first = item.first;

      const moved = geomStrokeMesh([0, 0, 10, 0, 10, 20], { cap: 'round', join: 'round' });
      assert.strictEqual(moved.vertexCount, round.vertexCount);
      batch.setGlow(item, moved, 5, 5, GLOW);
      assert.strictEqual(item.first, first);
      assert.closeTo(floatsOf(item, 0)[0], moved.vertices[0] + 5, 1e-4);
      assert.deepEqual(bytesOf(item, 0).slice(4, 6), [5, 48]);

      const longer = geomStrokeMesh([0, 0, 10, 0, 10, 10, 20, 10], { cap: 'round', join: 'round' });
      batch.setGlow(item, longer, 0, 0, GLOW);
      assert.notStrictEqual(item.first, first);
      assert.strictEqual(item.count, longer.vertexCount);
      for (let i = 0; i < longer.vertexCount; i++) {
        assert.deepEqual(floatsOf(item, i).slice(10, 12), [8, 0], `vertex ${i}`);
        assert.deepEqual(bytesOf(item, i).slice(0, 6), [255, 255, 0, 255, 5, 48], `vertex ${i}`);
        const v = longer.vertices.subarray(i * 7, i * 7 + 7);
        if (v[6] === 0) assert.deepEqual(floatsOf(item, i).slice(4, 6), [v[2], v[3]], `vertex ${i}`);
      }
    });

    it('is hidden like a line, and stays hidden when it changes', () => {
      const item = batch.addGlow(round, 0, 0, GLOW);
      batch.setVisible(item, false);
      assert.strictEqual(bytesOf(item, 2)[3], 0);
      batch.setGlowStyle(item, { ...GLOW, color: 0xffffff });
      assert.strictEqual(bytesOf(item, 2)[3], 0);
      batch.setGlow(item, round, 1, 1, GLOW);
      assert.strictEqual(bytesOf(item, 2)[3], 0);
      batch.setVisible(item, true);
      assert.strictEqual(bytesOf(item, 2)[3], 255);
    });

    it('is never as transparent as a hidden one', () => {
      const item = batch.addGlow(straight, 0, 0, { ...GLOW, alpha: 0 });
      assert.strictEqual(bytesOf(item)[3], 1);
    });

    it('ignores the glow of another batch', () => {
      const other = new LineBatchMesh(batchShaders.lines);
      const item = other.addGlow(straight, 0, 0, GLOW);
      batch.setGlow(item, round, 0, 0, GLOW);
      batch.setGlowStyle(item, { ...GLOW, color: 0 });
      assert.strictEqual(item.count, straight.vertexCount);
      assert.strictEqual(other._bytes[item.first * BYTES], 255);
      assert.strictEqual(batch.size, 0);
      other.destroy();
    });
  });

  // A line that marches is as wide as it says at every zoom, and its dashes move along it
  // with the clock: the halo around what's selected.
  describe('a line that marches', () => {
    const HALO = { width: 2, minWidth: 2, color: 0xffff00, alpha: 1, dash: [6, 3], marches: true };

    it('says so by a negative width in each vertex', () => {
      const item = batch.add(corner, 0, 0, HALO);
      const still = batch.add(corner, 0, 0, { ...HALO, marches: false });
      for (let i = 0; i < corner.vertexCount; i++) {
        assert.deepEqual(floatsOf(item, i).slice(10, 12), [-2, 2]);
        assert.deepEqual(bytesOf(item, i), [255, 255, 0, 255, 6, 3, 0, 0]);
        assert.deepEqual(floatsOf(still, i).slice(10, 12), [2, 2]);
      }
      batch.setStyle(item, { ...HALO, marches: false });
      assert.deepEqual(floatsOf(item).slice(10, 12), [2, 2]);
    });

    it('still marches when its shape changes and it moves to the end', () => {
      const item = batch.add(straight, 0, 0, HALO);
      batch.add(straight, 0, 0, STYLE);
      batch.setStroke(item, corner, 0, 0);
      assert.strictEqual(item.count, corner.vertexCount);
      for (let i = 0; i < corner.vertexCount; i++) {
        assert.deepEqual(floatsOf(item, i).slice(10, 12), [-2, 2], `vertex ${i}`);
        assert.deepEqual(bytesOf(item, i), [255, 255, 0, 255, 6, 3, 0, 0], `vertex ${i}`);
      }
    });
  });

  it('tells every batch\'s shader what the clock says: how bright the glows are, how far the dashes have marched', () => {
    const uniforms = batch.shader.resources.lineUniforms.uniforms;
    batchShaders.lines.setTime({ pulse: 0.75, shift: 120.5 });
    assert.deepEqual([uniforms.uGlow, uniforms.uShift], [0.75, 120.5]);
    batchShaders.lines.setView({ pixel: 0.5, narrow: 0, wireframe: false, casing: true, markers: true });
    assert.deepEqual([uniforms.uGlow, uniforms.uShift, uniforms.uPixel], [0.75, 120.5, 0.5], 'the view\'s numbers are others');
    batchShaders.lines.setTime({ pulse: 1, shift: 0 });
    assert.deepEqual([uniforms.uGlow, uniforms.uShift], [1, 0]);
    batchShaders.lines.setView({ pixel: 1, narrow: 0, wireframe: false, casing: true, markers: true });
  });

  it('has no batch for its lines\' glows until it\'s given one, and destroys the one it has with it', () => {
    assert.isNull(batch.glows);
    const glows = new LineBatchMesh(batchShaders.lines);
    batch.glows = glows;
    batch.destroy();
    assert.isTrue(glows.destroyed);
    assert.isNull(batch.glows);

    // ..unless that one is gone already, as when their container destroyed both
    const other = new LineBatchMesh(batchShaders.lines);
    other.glows = new LineBatchMesh(batchShaders.lines);
    other.glows.destroy();
    assert.doesNotThrow(() => other.destroy());
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


  // A batch's coordinates are 32-bit floats from the batch's place in the world. The place
  // follows the view when the view has gone far, so that what's in it stays fine enough to draw.
  describe('followView', () => {
    const HALO = { width: 2, minWidth: 2, color: 0xffff00, alpha: 1, dash: [6, 3], marches: true };
    const square = geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10], { closed: true });

    // A viewport whose middle is at a place in the world
    const viewportAt = (zoom, x, y) => ({
      transform: { zoom: zoom },
      center: () => [400, 300],
      screenToWorld: () => [x, y]
    });

    it('leaves the batch where it is while the view is near', () => {
      batch.position.set(10000, 20000);
      const item = batch.add(square, 0, 0, HALO);
      const x = batch._floats[item.first * 12];

      batch.followView(viewportAt(16, 10000 + 200000, 20000 - 200000));     // a quarter of a million pixels away, at zoom 16
      assert.deepEqual([batch.position.x, batch.position.y], [10000, 20000]);
      assert.strictEqual(batch._floats[item.first * 12], x);
    });

    it('moves the batch to the view when the view has gone far, and keeps what\'s in it where it is in the world', () => {
      batch.position.set(10000, 20000);
      const item = batch.add(square, 100, 50, HALO);     // at 10100, 20050 in the world
      const worldX = i => batch.position.x + batch._floats[(item.first + i) * 12];
      const worldY = i => batch.position.y + batch._floats[(item.first + i) * 12 + 1];
      const before = Array.from({ length: item.count }, (_, i) => [worldX(i), worldY(i)]);

      batch.followView(viewportAt(16, 10000 + 300000.4, 20000));
      assert.deepEqual([batch.position.x, batch.position.y], [310000, 20000], 'whole numbers, at the middle of the view');
      for (let i = 0; i < item.count; i++) {
        assert.closeTo(worldX(i), before[i][0], 0.05);
        assert.closeTo(worldY(i), before[i][1], 0.05);
      }
    });

    it('moves it sooner the further the view is zoomed in: a pixel is less of the world there', () => {
      batch.followView(viewportAt(16, 0, 100000));
      assert.strictEqual(batch.position.y, 0, 'at zoom 16, not yet');
      batch.followView(viewportAt(20, 0, 100000));
      assert.strictEqual(batch.position.y, 100000, 'at zoom 20, where a pixel is a sixteenth of a unit');
    });

    it('does nothing to a batch that was destroyed', () => {
      const other = new LineBatchMesh(batchShaders.lines);
      other.destroy();
      assert.doesNotThrow(() => other.followView(viewportAt(16, 1e7, 1e7)));
    });
  });
});
