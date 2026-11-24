import { describe, it } from 'bun:test';
import { strict as assert } from 'bun:assert';
import * as Rapid from '../../../modules/headless.js';

// The seeded test draws random areas and checks every one against the definition of the band:
// the points inside the area that are within the band's width of its edge, and no others.
// Run more of them with `BAND_SEEDS=2000 bun test test/unit/geo/band.test.js`.
// A failure names its seed: rerun just that one with `BAND_SEED0=<seed> BAND_SEEDS=1`.
const FIRST_SEED = Number(process.env.BAND_SEED0 ?? 1);
const SEEDS = Number(process.env.BAND_SEEDS ?? 150);


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

// Whether a point is inside a ring `[x, y, x, y, …]`.
function insideRing(px, py, ring) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[i * 2];
    const ay = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const by = ring[j * 2 + 1];
    if ((ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay)) inside = !inside;
  }
  return inside;
}

// The distance from a point to the nearest edge of any of some rings.
function distanceToRings(px, py, rings) {
  let best = Infinity;
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[j * 2];
      const ay = ring[j * 2 + 1];
      const dx = ring[i * 2] - ax;
      const dy = ring[i * 2 + 1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
  }
  return best;
}

// The area inside a ring, positive whichever way it goes around.
function ringArea(ring) {
  let area = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
  }
  return Math.abs(area) / 2;
}

// How many of a band's polygons a point is in (in the outer ring, and in none of the holes).
function countIn(px, py, band) {
  let count = 0;
  for (const polygon of band) {
    if (!insideRing(px, py, polygon.outer)) continue;
    if (polygon.holes.some(hole => insideRing(px, py, hole))) continue;
    count++;
  }
  return count;
}

// The area of a band.
function bandArea(band) {
  let area = 0;
  for (const polygon of band) {
    area += ringArea(polygon.outer);
    for (const hole of polygon.holes) area -= ringArea(hole);
  }
  return area;
}

// The corners of a rectangle, as a ring.
function rect(minX, minY, maxX, maxY) {
  return [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
}

// The smallest and largest x and y of a ring, as [minX, minY, maxX, maxY].
function boxOf(ring) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ring.length; i += 2) {
    box[0] = Math.min(box[0], ring[i]);
    box[1] = Math.min(box[1], ring[i + 1]);
    box[2] = Math.max(box[2], ring[i]);
    box[3] = Math.max(box[3], ring[i + 1]);
  }
  return box;
}

function closeTo(actual, expected, message, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message ?? ''} expected ${expected}, got ${actual}`);
}


describe('geomAreaBand', () => {

  describe('an area with a middle', () => {
    it('is the area with its middle cut out', () => {
      const band = Rapid.geomAreaBand([rect(0, 0, 100, 100)], 10);
      assert.equal(band.length, 1);
      assert.deepEqual(boxOf(band[0].outer), [0, 0, 100, 100]);
      assert.equal(band[0].outer.length, 8);
      assert.equal(band[0].holes.length, 1);
      assert.deepEqual(boxOf(band[0].holes[0]), [10, 10, 90, 90]);
      assert.equal(band[0].holes[0].length, 8);    // the corners of a middle are sharp where the area's are
    });

    it('is the same whichever way the ring goes around, and whether or not it ends where it starts', () => {
      const expected = bandArea(Rapid.geomAreaBand([rect(0, 0, 100, 100)], 10));
      assert.equal(expected, 10000 - 6400);
      const reversed = [0, 100, 100, 100, 100, 0, 0, 0];
      assert.equal(bandArea(Rapid.geomAreaBand([reversed], 10)), expected);
      assert.equal(bandArea(Rapid.geomAreaBand([[...reversed, 0, 100]], 10)), expected);
      assert.equal(bandArea(Rapid.geomAreaBand([new Float64Array(reversed)], 10)), expected);
    });

    it('goes around a corner that points into the area in an arc', () => {
      // An L: the corner at [40, 40] points into it.
      const area = [0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100];
      const band = Rapid.geomAreaBand([area], 10);
      assert.equal(band.length, 1);
      const middle = band[0].holes[0];
      assert.ok(middle.length / 2 > 8, 'the arc has points of its own');
      let nearCorner = 0;
      for (let i = 0; i < middle.length; i += 2) {
        const fromEdge = distanceToRings(middle[i], middle[i + 1], [area]);
        assert.ok(fromEdge > 10 - 0.1 && fromEdge < 10 + 0.1, `a point of the middle is ${fromEdge} from the edge`);
        if (Math.abs(Math.hypot(middle[i] - 40, middle[i + 1] - 40) - 10) < 0.1) nearCorner++;
      }
      assert.ok(nearCorner >= 4, 'points of the arc are 10 from the corner');
    });

    it('keeps the last sliver of a middle', () => {
      const band = Rapid.geomAreaBand([rect(0, 0, 100, 100)], 49);
      assert.deepEqual(boxOf(band[0].holes[0]), [49, 49, 51, 51]);
    });
  });

  describe('an area with no middle', () => {
    it('is null: the band is the whole area', () => {
      assert.equal(Rapid.geomAreaBand([rect(0, 0, 100, 100)], 50), null);
      assert.equal(Rapid.geomAreaBand([rect(0, 0, 100, 100)], 80), null);
      assert.equal(Rapid.geomAreaBand([rect(0, 0, 500, 15)], 10), null, 'long and narrow');
    });

    it('is null for an area that is wide across its box and narrow everywhere', () => {
      const cross = [40, 0, 60, 0, 60, 40, 100, 40, 100, 60, 60, 60, 60, 100, 40, 100, 40, 60, 0, 60, 0, 40, 40, 40];
      assert.equal(Rapid.geomAreaBand([cross], 15), null);
      assert.notEqual(Rapid.geomAreaBand([cross], 5), null);
    });
  });

  describe('nothing to work out', () => {
    it('has no polygons for no rings, a ring with no area, or no width', () => {
      assert.deepEqual(Rapid.geomAreaBand([], 10), []);
      assert.deepEqual(Rapid.geomAreaBand([[0, 0, 10, 10]], 10), []);
      assert.deepEqual(Rapid.geomAreaBand([[0, 0, 10, 10, 0, 0]], 10), []);
      assert.deepEqual(Rapid.geomAreaBand([rect(0, 0, 100, 100)], 0), []);
      assert.deepEqual(Rapid.geomAreaBand([rect(0, 0, 100, 100)], -5), []);
      assert.deepEqual(Rapid.geomAreaBand([rect(0, 0, 100, 100)], NaN), []);
      assert.deepEqual(Rapid.geomAreaBand([[0, 0, NaN, 0, 10, 10]], 5), []);
    });
  });

  describe('holes', () => {
    it('runs along a hole\'s edge too, as one piece where the hole is near the outer edge', () => {
      // The hole is 30 from two sides: with a band of 20 its own band meets the outer one.
      const hole = rect(30, 30, 50, 50);
      const band = Rapid.geomAreaBand([rect(0, 0, 200, 200), hole], 20);
      assert.equal(band.length, 1);
      assert.equal(band[0].holes.length, 2);    // the hole, and the middle
      assert.equal(countIn(40, 40, band), 0, 'in the hole');
      assert.equal(countIn(25, 25, band), 1, 'between the hole and the corner');
      assert.equal(countIn(60, 60, band), 1, 'beside the hole');
      assert.equal(countIn(120, 120, band), 0, 'in the middle');
    });

    it('is a piece of its own around a hole in the middle', () => {
      const hole = rect(190, 190, 210, 210);
      const band = Rapid.geomAreaBand([rect(0, 0, 400, 400), hole], 20);
      assert.equal(band.length, 2);
      assert.equal(countIn(10, 200, band), 1, 'along the outer edge');
      assert.equal(countIn(100, 200, band), 0, 'in the middle');
      assert.equal(countIn(180, 200, band), 1, 'beside the hole');
      assert.equal(countIn(200, 200, band), 0, 'in the hole');
      // the outer frame, and a square of 60 with round corners around a square of 20
      closeTo(bandArea(band), (400 * 400 - 360 * 360) + (60 * 60 - (4 - Math.PI) * 20 * 20 - 20 * 20), 'its area', 15);    // (the arcs are chords)
    });

    it('counts a hole only where it is inside the outer ring, whichever way it goes around', () => {
      const outside = rect(80, 40, 140, 60);     // sticks out of the right side
      for (const hole of [outside, [80, 60, 140, 60, 140, 40, 80, 40]]) {
        const band = Rapid.geomAreaBand([rect(0, 0, 100, 100), hole], 10);
        assert.equal(countIn(90, 50, band), 0, 'in the part of the hole that is inside');
        assert.equal(countIn(120, 50, band), 0, 'in the part that is outside');
        assert.equal(countIn(75, 50, band), 1, 'beside the hole');
        assert.equal(countIn(40, 50, band), 0, 'in the middle');
        assert.equal(countIn(95, 20, band), 1, 'along the outer edge');
      }
    });

    it('has no middle where the holes leave none', () => {
      const band = Rapid.geomAreaBand([rect(0, 0, 100, 100), rect(30, 30, 70, 70)], 20);
      assert.equal(band, null);
    });
  });

  describe('far from the origin', () => {
    it('works out the same band', () => {
      const near = Rapid.geomAreaBand([rect(0.25, 0.25, 100.25, 100.25)], 10);
      const far = Rapid.geomAreaBand([rect(1e7 + 0.25, 1e7 + 0.25, 1e7 + 100.25, 1e7 + 100.25)], 10);
      assert.equal(bandArea(far), bandArea(near));
      assert.deepEqual(boxOf(far[0].holes[0]), [1e7 + 10.25, 1e7 + 10.25, 1e7 + 90.25, 1e7 + 90.25]);
    });
  });

  describe(`${SEEDS} random areas, from seed ${FIRST_SEED}`, () => {
    // A ring around a point, as far from it as `radius()` says at each angle: it never crosses itself.
    function star(random, cx, cy, numPoints, radius) {
      const angles = [];
      for (let i = 0; i < numPoints; i++) angles.push(random() * 2 * Math.PI);
      angles.sort((a, b) => a - b);
      const ring = [];
      for (const angle of angles) {
        const r = radius();
        ring.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      }
      return ring;
    }

    it('the band is what is inside the area and within the width of its edge, once, and nothing else', () => {
      let withMiddle = 0;
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const random = makeRandom(seed);
        const rings = [star(random, 0, 0, 5 + Math.floor(random() * 30), () => 40 + random() * 60)];
        if (random() < 0.5) {     // a hole near the middle, which the outer ring is at least 40 from
          rings.push(star(random, (random() - 0.5) * 20, (random() - 0.5) * 20, 3 + Math.floor(random() * 8), () => 3 + random() * 12));
        }
        const width = 2 + random() * 40;
        const band = Rapid.geomAreaBand(rings, width);
        const message = `seed ${seed} (width ${width})`;
        if (band) {
          withMiddle++;
          assert.ok(band.length >= 1, message);
        }

        const tolerance = width * 0.02 + 0.02;
        for (let i = 0; i < 400; i++) {
          const x = (random() - 0.5) * 220;
          const y = (random() - 0.5) * 220;
          const inArea = insideRing(x, y, rings[0]) && !(rings[1] && insideRing(x, y, rings[1]));
          const fromEdge = distanceToRings(x, y, rings);
          if (fromEdge < tolerance) continue;     // on an edge
          const count = band ? countIn(x, y, band) : (inArea ? 1 : 0);
          assert.ok(count <= 1, `${message}: ${x},${y} is in ${count} pieces of the band`);
          if (!inArea) {
            assert.equal(count, 0, `${message}: ${x},${y} is outside the area, and in the band`);
          } else if (fromEdge < width - tolerance) {
            assert.equal(count, 1, `${message}: ${x},${y} is ${fromEdge} from the edge, and not in the band`);
          } else if (fromEdge > width + tolerance) {
            assert.equal(count, 0, `${message}: ${x},${y} is ${fromEdge} from the edge, and in the band`);
          }
        }
      }
      assert.ok(withMiddle > SEEDS / 10 || SEEDS < 20, `only ${withMiddle} of the areas had a middle`);
    });
  });

});
