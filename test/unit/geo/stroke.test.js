import { describe, it } from 'bun:test';
import { strict as assert } from 'bun:assert';
import * as Rapid from '../../../modules/headless.js';

// The seeded tests draw random lines and check every one against the definition of a stroke:
// a round line of half width `hw` covers the points within `hw` of the line, and no others.
// Run more of them with `STROKE_SEEDS=5000 bun test test/unit/geo/stroke.test.js`.
// A failure names its seed: rerun just that one with `STROKE_SEED0=<seed> STROKE_SEEDS=1`.
const FIRST_SEED = Number(process.env.STROKE_SEED0 ?? 1);
const SEEDS = Number(process.env.STROKE_SEEDS ?? 200);

const V = Rapid.STROKE_VERTEX_SIZE;
const F = Rapid.STROKE_FALLBACK_SIZE;


// A small seeded random number generator (mulberry32), so a failure can be replayed.
function makeRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The distance from a point to a line `[x, y, x, y, …]`.
function distanceToLine(px, py, coords, closed) {
  const n = coords.length / 2;
  const numSegments = closed ? n : n - 1;
  let best = Infinity;
  for (let i = 0; i < numSegments; i++) {
    const ax = coords[i * 2];
    const ay = coords[i * 2 + 1];
    const bx = coords[((i + 1) % n) * 2];
    const by = coords[((i + 1) % n) * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

// How many of a mesh's triangles cover a point. (A triangle with no area covers nothing: a miter
// corner has one, until the line is too wide for its inside miter.)
function coverage(px, py, positions, indices) {
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ax = positions[indices[i] * 2];
    const ay = positions[indices[i] * 2 + 1];
    const bx = positions[indices[i + 1] * 2];
    const by = positions[indices[i + 1] * 2 + 1];
    const cx = positions[indices[i + 2] * 2];
    const cy = positions[indices[i + 2] * 2 + 1];
    if ((bx - ax) * (cy - ay) === (cx - ax) * (by - ay)) continue;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    if (!(hasNeg && hasPos)) count++;
  }
  return count;
}

// The sum of the areas of a mesh's triangles.
function triangleArea(positions, indices) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ax = positions[indices[i] * 2];
    const ay = positions[indices[i] * 2 + 1];
    const bx = positions[indices[i + 1] * 2];
    const by = positions[indices[i + 1] * 2 + 1];
    const cx = positions[indices[i + 2] * 2];
    const cy = positions[indices[i + 2] * 2 + 1];
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  return area;
}

// Checks that a mesh is well formed: indices in range, every number finite.
function assertWellFormed(mesh, message) {
  assert.equal(mesh.vertices.length, mesh.vertexCount * V, message);
  assert.equal(mesh.indices.length % 3, 0, message);
  assert.equal(mesh.fallbacks.length % F, 0, message);
  for (const index of mesh.indices) {
    assert.ok(index < mesh.vertexCount, `${message}: index ${index} of ${mesh.vertexCount}`);
  }
  for (const value of mesh.vertices) {
    assert.ok(Number.isFinite(value), `${message}: a vertex has ${value}`);
  }
  for (let f = 0; f < mesh.fallbacks.length; f += F) {
    assert.ok(mesh.fallbacks[f] < mesh.vertexCount, `${message}: fallback for vertex ${mesh.fallbacks[f]}`);
    for (let k = 1; k < F; k++) {
      assert.ok(Number.isFinite(mesh.fallbacks[f + k]), `${message}: a fallback has ${mesh.fallbacks[f + k]}`);
    }
  }
}

// The box around a mesh's positions, as [minX, minY, maxX, maxY].
function boxOf(positions) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 2) {
    box[0] = Math.min(box[0], positions[i]);
    box[1] = Math.min(box[1], positions[i + 1]);
    box[2] = Math.max(box[2], positions[i]);
    box[3] = Math.max(box[3], positions[i + 1]);
  }
  return box;
}

// How many different points a line has, counting a ring's last point if it repeats the first.
// (A ring of fewer than three is built as a line.)
function countDistinct(coords) {
  let count = 0;
  for (let i = 0; i < coords.length; i += 2) {
    if (i === 0 || coords[i] !== coords[i - 2] || coords[i + 1] !== coords[i - 1]) count++;
  }
  const last = coords.length - 2;
  if (count > 1 && coords[0] === coords[last] && coords[1] === coords[last + 1]) count--;
  return count;
}

function closeTo(actual, expected, message, epsilon = 1e-4) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message ?? ''} expected ${expected}, got ${actual}`);
}


describe('geomStrokeMesh', () => {

  describe('lines with nothing to draw', () => {
    it('returns an empty mesh for no points', () => {
      const mesh = Rapid.geomStrokeMesh([]);
      assert.equal(mesh.vertexCount, 0);
      assert.equal(mesh.indices.length, 0);
      assert.equal(mesh.length, 0);
    });

    it('returns an empty mesh for one point', () => {
      assert.equal(Rapid.geomStrokeMesh([5, 5]).vertexCount, 0);
    });

    it('returns an empty mesh for one point repeated', () => {
      assert.equal(Rapid.geomStrokeMesh([5, 5, 5, 5, 5, 5], { cap: 'round', join: 'round' }).vertexCount, 0);
      assert.equal(Rapid.geomStrokeMesh([5, 5, 5, 5, 5, 5], { closed: true }).vertexCount, 0);
    });

    it('leaves out points that aren\'t numbers', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, NaN, 3, 10, 0]);
      assertWellFormed(mesh, 'NaN');
      assert.equal(mesh.vertexCount, 4);
    });
  });


  describe('a single segment', () => {
    it('is a rectangle with butt caps', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0]);
      assertWellFormed(mesh, 'segment');
      assert.equal(mesh.vertexCount, 4);
      assert.equal(mesh.indices.length, 6);
      assert.equal(mesh.fallbacks.length, 0);
      assert.equal(mesh.length, 10);

      const positions = Rapid.geomStrokePositions(mesh, 2);
      assert.deepEqual(boxOf(positions), [0, -2, 10, 2]);
      closeTo(triangleArea(positions, mesh.indices), 40);
    });

    it('is the same mesh at any width', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0]);
      assert.deepEqual(boxOf(Rapid.geomStrokePositions(mesh, 0.5)), [0, -0.5, 10, 0.5]);
      assert.deepEqual(boxOf(Rapid.geomStrokePositions(mesh, 8)), [0, -8, 10, 8]);
    });

    it('goes half a width past its ends with square caps', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0], { cap: 'square' });
      const positions = Rapid.geomStrokePositions(mesh, 2);
      assert.equal(mesh.vertexCount, 4);
      assert.deepEqual(boxOf(positions), [-2, -2, 12, 2]);
    });

    it('ends in half circles with round caps', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0], { cap: 'round', roundSlices: 10 });
      assertWellFormed(mesh, 'round caps');
      // 4 corners, and for each cap a center and 9 vertices on the half circle between two corners
      assert.equal(mesh.vertexCount, 4 + 2 * 10);
      assert.equal(mesh.indices.length / 3, 2 + 2 * 10);

      const positions = Rapid.geomStrokePositions(mesh, 2);
      const box = boxOf(positions);
      closeTo(box[0], -2);
      closeTo(box[2], 12);
      // the area of a rectangle and a circle, less what 20 slices leave out
      const area = triangleArea(positions, mesh.indices);
      assert.ok(area > 40 + Math.PI * 4 * 0.98 && area < 40 + Math.PI * 4, `area ${area}`);
    });

    it('writes into the array it is given', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0]);
      const out = new Float32Array(8);
      assert.equal(Rapid.geomStrokePositions(mesh, 1, out), out);
      assert.deepEqual(boxOf(out), [0, -1, 10, 1]);
      Rapid.geomStrokePositions(mesh, 3, out);
      assert.deepEqual(boxOf(out), [0, -3, 10, 3]);
    });

    it('counts vertices in 16 bits when it can', () => {
      const short = Rapid.geomStrokeMesh([0, 0, 10, 0]);
      assert.ok(short.indices instanceof Uint16Array);

      const coords = [];
      for (let i = 0; i < 20000; i++) coords.push(i, (i % 2) * 5);   // 20,000 sharp corners
      const long = Rapid.geomStrokeMesh(coords, { join: 'bevel' });
      assertWellFormed(long, 'long');
      assert.ok(long.vertexCount > 0x10000);
      assert.ok(long.indices instanceof Uint32Array);
      assert.equal(Math.max(...long.indices.subarray(long.indices.length - 6)), long.vertexCount - 1);
    });

    it('returns arrays of its own', () => {
      const a = Rapid.geomStrokeMesh([0, 0, 10, 0]);
      const copy = Array.from(a.vertices);
      Rapid.geomStrokeMesh([3, 3, 7, 9, 12, 1], { cap: 'round', join: 'round' });
      assert.deepEqual(Array.from(a.vertices), copy);
    });
  });


  describe('repeated points', () => {
    it('builds the same mesh with or without them', () => {
      const options = { cap: 'round', join: 'round' };
      const plain = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10], options);
      const repeats = Rapid.geomStrokeMesh([0, 0, 0, 0, 10, 0, 10, 0, 10, 0, 10, 10, 10, 10], options);
      assert.deepEqual(Array.from(repeats.vertices), Array.from(plain.vertices));
      assert.deepEqual(Array.from(repeats.indices), Array.from(plain.indices));
    });

    it('builds the same ring whether or not the last point repeats the first', () => {
      const options = { closed: true, join: 'bevel' };
      const plain = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10], options);
      const repeats = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10, 0, 0], options);
      assert.deepEqual(Array.from(repeats.vertices), Array.from(plain.vertices));
      assert.equal(plain.length, 40);
    });
  });


  describe('corners', () => {
    //  a ------ b
    //           |
    //           c
    const corner = [0, 0, 10, 0, 10, 10];

    it('fills a bevel with one triangle', () => {
      const mesh = Rapid.geomStrokeMesh(corner, { join: 'bevel' });
      assertWellFormed(mesh, 'bevel');
      assert.equal(mesh.indices.length / 3, 2 + 2 + 1);
      const positions = Rapid.geomStrokePositions(mesh, 1);
      // two rectangles of 10 × 2 that end at the inside miter, and half the square at the corner
      closeTo(triangleArea(positions, mesh.indices), 2 * 20 - 1 - 1 + 1.5);
    });

    it('fills a miter to its tip', () => {
      const mesh = Rapid.geomStrokeMesh(corner, { join: 'miter' });
      const positions = Rapid.geomStrokePositions(mesh, 1);
      assert.deepEqual(boxOf(positions), [0, -1, 11, 10]);
      closeTo(triangleArea(positions, mesh.indices), 2 * 20 - 1 - 1 + 2);
      assert.equal(coverage(10.9, -0.9, positions, mesh.indices), 1, 'the tip');
    });

    it('makes a miter of two vertices on each side', () => {
      const mesh = Rapid.geomStrokeMesh(corner, { join: 'miter' });
      assertWellFormed(mesh, 'miter');
      assert.equal(mesh.vertexCount, 2 + 4 + 2);
      assert.equal(mesh.indices.length / 3, 2 + 2 + 1);
      assert.equal(mesh.fallbacks.length / F, 2);
    });

    it('fills a miter whose line is too wide for the inside of its corner', () => {
      // A half width of 12 at segments of 10: each segment keeps its square end on the inside,
      // and the stroke is the two rectangles, with the corner filled out to the tip.
      const mesh = Rapid.geomStrokeMesh(corner, { join: 'miter' });
      const positions = Rapid.geomStrokePositions(mesh, 12);
      assert.deepEqual(boxOf(positions), [-2, -12, 22, 12]);
      for (let x = -1.9; x < 22; x += 0.71) {
        for (let y = -11.9; y < 12; y += 0.73) {
          const inFirst = (x >= 0 && x <= 10 && y >= -12 && y <= 12);
          const inSecond = (x >= -2 && x <= 22 && y >= 0 && y <= 10);
          const inCorner = (x >= 10 && x <= 22 && y >= -12 && y <= 0);
          if (inFirst || inSecond || inCorner) {
            assert.ok(coverage(x, y, positions, mesh.indices) >= 1, `${x},${y} isn't covered`);
          }
        }
      }
    });

    it('draws a miter that is too long as a bevel', () => {
      //  a ------ b
      //  c -----´       a turn of 163°: the miter would be 6.9 half widths long
      const hairpin = [0, 0, 10, 0, 0, 3];
      const limited = Rapid.geomStrokeMesh(hairpin, { join: 'miter', miterLimit: 4 });
      assertWellFormed(limited, 'hairpin');
      const bevel = boxOf(Rapid.geomStrokePositions(limited, 1));
      assert.ok(bevel[2] < 10 + 1.5, `the bevel reaches ${bevel[2]}`);

      const allowed = Rapid.geomStrokeMesh(hairpin, { join: 'miter', miterLimit: 10 });
      const miter = boxOf(Rapid.geomStrokePositions(allowed, 1));
      assert.ok(miter[2] > 10 + 6, `the miter reaches ${miter[2]}`);
    });

    it('fills a round join with slices in proportion to the turn', () => {
      const quarter = Rapid.geomStrokeMesh(corner, { join: 'round', roundSlices: 10 });
      assert.equal(quarter.indices.length / 3, 2 + 2 + 5);   // a turn of 90° is half of a half circle
      const positions = Rapid.geomStrokePositions(quarter, 1);
      assert.equal(coverage(10.69, -0.69, positions, quarter.indices), 1, 'inside the round corner');
      assert.equal(coverage(10.8, -0.8, positions, quarter.indices), 0, 'outside it');
    });

    it('covers nothing twice while the line is narrower than its corners allow', () => {
      for (const join of ['bevel', 'miter', 'round']) {
        const mesh = Rapid.geomStrokeMesh(corner, { join: join });
        const positions = Rapid.geomStrokePositions(mesh, 1);
        for (let x = -0.45; x < 12; x += 0.31) {
          for (let y = -1.45; y < 11; y += 0.29) {
            assert.ok(coverage(x, y, positions, mesh.indices) <= 1, `${join}: ${x},${y} is covered twice`);
          }
        }
      }
    });

    it('gives the vertices on the inside of a corner a second place, for wider lines', () => {
      const mesh = Rapid.geomStrokeMesh(corner, { join: 'bevel' });
      assert.equal(mesh.fallbacks.length / F, 3);
      for (let f = 0; f < mesh.fallbacks.length; f += F) {
        closeTo(mesh.fallbacks[f + 1], 10, 'a segment of 10, at a turn of 90°:');
      }

      // Narrow: the inside edges meet at (9, 1).
      const narrow = Rapid.geomStrokePositions(mesh, 1);
      // Wide: the miter would be at (-2, 12), past the ends of both segments.
      const wide = Rapid.geomStrokePositions(mesh, 12);
      const box = boxOf(wide);
      assert.deepEqual(box, [-2, -12, 22, 12]);
      let moved = 0;
      for (let f = 0; f < mesh.fallbacks.length; f += F) {
        const i = mesh.fallbacks[f];
        closeTo(narrow[i * 2], 9);
        closeTo(narrow[i * 2 + 1], 1);
        if (wide[i * 2] !== 10 || wide[i * 2 + 1] !== 0) moved++;   // the fan's center goes to the point itself
      }
      assert.equal(moved, 2);
    });

    it('turns back on itself without a miter', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 0, 0], { join: 'round', cap: 'round' });
      assertWellFormed(mesh, 'there and back');
      const positions = Rapid.geomStrokePositions(mesh, 1);
      const box = boxOf(positions);
      closeTo(box[0], -1);
      closeTo(box[2], 11);
      assert.ok(coverage(10.9, 0.05, positions, mesh.indices) >= 1, 'the far end is round');
    });

    it('shares two vertices between segments that are nearly in line', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 20, 1, 30, 3], { join: 'round' });
      assert.equal(mesh.vertexCount, 8);
      assert.equal(mesh.indices.length / 3, 6);
      assert.equal(mesh.fallbacks.length, 0);
    });
  });


  describe('rings', () => {
    it('joins the last point to the first, with no caps', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10], { closed: true, join: 'miter', cap: 'round' });
      assertWellFormed(mesh, 'ring');
      const positions = Rapid.geomStrokePositions(mesh, 1);
      assert.deepEqual(boxOf(positions), [-1, -1, 11, 11]);
      closeTo(triangleArea(positions, mesh.indices), 12 * 12 - 8 * 8);
      assert.equal(coverage(-0.5, -0.3, positions, mesh.indices), 1, 'the first corner');
      assert.equal(coverage(5, 5, positions, mesh.indices), 0, 'the middle');
    });

    it('treats a ring of two points as a line', () => {
      const ring = Rapid.geomStrokeMesh([0, 0, 10, 0], { closed: true });
      assert.equal(ring.vertexCount, 4);
      assert.equal(ring.length, 10);
      assert.equal(ring.closed, false);
    });

    it('says how it was built', () => {
      const ring = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10], { closed: true, join: 'round', cap: 'square' });
      assert.equal(ring.closed, true);
      assert.equal(ring.cap, 'square');
      assert.equal(ring.join, 'round');

      const line = Rapid.geomStrokeMesh([0, 0, 10, 0]);
      assert.equal(line.closed, false);
      assert.equal(line.cap, 'butt');
      assert.equal(line.join, 'miter');

      const nothing = Rapid.geomStrokeMesh([], { cap: 'round' });
      assert.equal(nothing.cap, 'round');
    });
  });


  describe('distance along the line', () => {
    it('gives each vertex the distance to its point', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10], { join: 'bevel' });
      assert.equal(mesh.length, 20);
      const distances = new Set();
      for (let i = 0; i < mesh.vertexCount; i++) distances.add(mesh.vertices[i * V + 4]);
      assert.deepEqual([...distances].sort((a, b) => a - b), [0, 10, 20]);
    });

    it('gives a texture coordinate that follows each edge of a segment', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10], { join: 'bevel', cap: 'square' });
      const positions = Rapid.geomStrokePositions(mesh, 1);
      const uvs = Rapid.geomStrokeUVs(mesh, 1, 0.1);   // a pattern 10 long

      // The first segment runs along x, so on its triangles `u` is x / 10.
      for (let t = 0; t < 2; t++) {
        const quad = mesh.indices.length - 12 + t * 3;   // the segments' triangles come after their joins
        for (let k = 0; k < 3; k++) {
          const i = mesh.indices[quad + k];
          closeTo(uvs[i * 2], positions[i * 2] / 10, `vertex ${i}:`);
        }
      }
      // The square cap starts before the line does.
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < mesh.vertexCount; i++) {
        min = Math.min(min, uvs[i * 2]);
        max = Math.max(max, uvs[i * 2]);
        assert.ok(uvs[i * 2 + 1] === 0 || uvs[i * 2 + 1] === 1 || uvs[i * 2 + 1] === 0.5);
      }
      closeTo(min, -0.1);
      closeTo(max, 2.1);
    });

    it('gives a miter\'s vertices each segment\'s own distance along the line', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10], { join: 'miter' });
      const positions = Rapid.geomStrokePositions(mesh, 1);
      const uvs = Rapid.geomStrokeUVs(mesh, 1, 0.1);   // a pattern 10 long

      // On the first segment's triangles `u` is x / 10, out to the tip at x = 11.
      // On the second's it's (10 + y) / 10, from the tip at y = -1.
      let max = -Infinity;
      let min = Infinity;
      for (let k = 0; k < 6; k++) {
        const first = mesh.indices[mesh.indices.length - 12 + k];
        closeTo(uvs[first * 2], positions[first * 2] / 10, `vertex ${first} of the first segment:`);
        max = Math.max(max, uvs[first * 2]);
        const second = mesh.indices[mesh.indices.length - 6 + k];
        closeTo(uvs[second * 2], (10 + positions[second * 2 + 1]) / 10, `vertex ${second} of the second segment:`);
        min = Math.min(min, uvs[second * 2]);
      }
      closeTo(max, 1.1);
      closeTo(min, 0.9);
    });

    it('starts a ring at 0 and ends it at its length', () => {
      const mesh = Rapid.geomStrokeMesh([0, 0, 10, 0, 10, 10, 0, 10], { closed: true, join: 'bevel' });
      let max = 0;
      for (let i = 0; i < mesh.vertexCount; i++) max = Math.max(max, mesh.vertices[i * V + 4]);
      assert.equal(max, 40);
      assert.equal(mesh.length, 40);
    });
  });


  // A line that keeps going right, so it never comes near itself: x grows by 12 to 30 a step.
  function gentleLine(random) {
    const coords = [];
    const n = 2 + Math.floor(random() * 10);
    let x = 0;
    for (let i = 0; i < n; i++) {
      coords.push(x, (random() - 0.5) * 40);
      x += 12 + random() * 18;
    }
    return coords;
  }

  // A line that wanders in a small box: short segments, sharp turns, points that repeat, steps back the way it came.
  function roughLine(random) {
    const coords = [0, 0];
    const n = 2 + Math.floor(random() * 14);
    let x = 0;
    let y = 0;
    let angle = random() * 2 * Math.PI;
    for (let i = 0; i < n; i++) {
      const pick = random();
      if (pick < 0.1) {                    // the same point again
        coords.push(x, y);
        continue;
      } else if (pick < 0.2) {             // straight back
        angle += Math.PI;
      } else if (pick < 0.5) {             // a slight bend
        angle += (random() - 0.5) * 0.4;
      } else {                             // anywhere
        angle = random() * 2 * Math.PI;
      }
      const step = 1 + random() * 5;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      coords.push(x, y);
    }
    return coords;
  }

  // Points to test: on a grid over the box of the stroke, moved off the grid so none is on an edge.
  function* samples(coords, pad, random, perSide = 24) {
    const box = boxOf(coords);
    const w = box[2] - box[0] + 2 * pad;
    const h = box[3] - box[1] + 2 * pad;
    for (let i = 0; i < perSide; i++) {
      for (let j = 0; j < perSide; j++) {
        yield [box[0] - pad + (i + random()) * w / perSide, box[1] - pad + (j + random()) * h / perSide];
      }
    }
  }


  describe(`${SEEDS} random lines, from seed ${FIRST_SEED}`, () => {

    it('a round stroke covers what is within half a width of a gentle line, once, and nothing else', () => {
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const random = makeRandom(seed);
        const coords = gentleLine(random);
        const hw = 0.5 + random() * 2;
        const mesh = Rapid.geomStrokeMesh(coords, { cap: 'round', join: 'round' });
        assertWellFormed(mesh, `seed ${seed}`);
        const positions = Rapid.geomStrokePositions(mesh, hw);

        for (const [x, y] of samples(coords, hw * 1.5, random)) {
          const distance = distanceToLine(x, y, coords, false);
          const count = coverage(x, y, positions, mesh.indices);
          if (distance < hw * 0.985) {
            assert.equal(count, 1, `seed ${seed}: ${x},${y} is ${distance} from the line (hw ${hw}), covered ${count} times`);
          } else if (distance > hw * 1.011) {
            assert.equal(count, 0, `seed ${seed}: ${x},${y} is ${distance} from the line (hw ${hw}), but covered`);
          }
        }
      }
    });

    it('a round stroke covers what is within half a width of a rough line, and nothing else', () => {
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const random = makeRandom(seed);
        const coords = roughLine(random);
        const closed = random() < 0.3;
        const hw = 0.2 + random() * 3;   // from much narrower than a segment to wider than most
        const mesh = Rapid.geomStrokeMesh(coords, { cap: 'round', join: 'round', closed: closed });
        assertWellFormed(mesh, `seed ${seed}`);
        if (!mesh.vertexCount) continue;
        const positions = Rapid.geomStrokePositions(mesh, hw);
        const isRing = closed && countDistinct(coords) >= 3;

        for (const [x, y] of samples(coords, hw * 1.5, random)) {
          const distance = distanceToLine(x, y, coords, isRing);
          const count = coverage(x, y, positions, mesh.indices);
          if (distance < hw * 0.985) {
            assert.ok(count >= 1, `seed ${seed}: ${x},${y} is ${distance} from the line (hw ${hw}), not covered`);
          } else if (distance > hw * 1.011) {
            assert.equal(count, 0, `seed ${seed}: ${x},${y} is ${distance} from the line (hw ${hw}), but covered`);
          }
        }
      }
    });

    it('a stroke of any cap and join stays within reach of the line', () => {
      const caps = ['butt', 'round', 'square'];
      const joins = ['bevel', 'miter', 'round'];
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const random = makeRandom(seed);
        const coords = roughLine(random);
        const cap = caps[Math.floor(random() * 3)];
        const join = joins[Math.floor(random() * 3)];
        const closed = random() < 0.3;
        const miterLimit = 1 + random() * 9;
        const hw = 0.2 + random() * 3;
        const mesh = Rapid.geomStrokeMesh(coords, { cap: cap, join: join, closed: closed, miterLimit: miterLimit });
        assertWellFormed(mesh, `seed ${seed} (${cap}, ${join})`);
        if (!mesh.vertexCount) continue;

        const isRing = closed && countDistinct(coords) >= 3;

        // No vertex is further from the line than the join or the cap allows.
        const reach = hw * Math.max(1.011, (join === 'miter') ? miterLimit : 0, (cap === 'square') ? Math.SQRT2 : 0) + 1e-3;
        const positions = Rapid.geomStrokePositions(mesh, hw);
        for (let i = 0; i < mesh.vertexCount; i++) {
          const distance = distanceToLine(positions[i * 2], positions[i * 2 + 1], coords, isRing);
          assert.ok(distance <= reach, `seed ${seed} (${cap}, ${join}, hw ${hw}): vertex ${i} is ${distance} from the line`);
        }
        // The middle of every segment is covered.
        const n = coords.length / 2;
        for (let i = 0; i + 1 < n; i++) {
          if (coords[i * 2] === coords[i * 2 + 2] && coords[i * 2 + 1] === coords[i * 2 + 3]) continue;   // a repeated point
          const x = (coords[i * 2] + coords[i * 2 + 2]) / 2 + 1e-4;
          const y = (coords[i * 2 + 1] + coords[i * 2 + 3]) / 2 + 1e-4;
          assert.ok(coverage(x, y, positions, mesh.indices) >= 1, `seed ${seed} (${cap}, ${join}): segment ${i} isn't covered`);
        }
      }
    });
  });

});

