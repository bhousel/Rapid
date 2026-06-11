import { describe, it } from 'bun:test';
import { strict as assert } from 'bun:assert';
import * as Rapid from '../../../modules/headless.js';

const context = new Rapid.MockContext();


describe('geoHasSelfIntersections', () => {
  it('returns false for a degenerate way (no nodes)', () => {
    assert.equal(Rapid.geoHasSelfIntersections([], ''), false);
  });

  it('returns false if no activeID', () => {
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const nodes = [a, b, c, d, a];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, ''), false);
  });

  it('returns false if there are no self intersections (closed way)', () => {
    //  a --- b
    //  |     |
    //  |     |
    //  d --- c
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const nodes = [a, b, c, d, a];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'a'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'b'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'c'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'd'), false);
  });

  it('returns true if there are self intersections without a junction (closed way)', () => {
    //  a     c
    //  | \ / |
    //  |  /  |
    //  | / \ |
    //  d     b
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 2]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 0]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const nodes = [a, b, c, d, a];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'a'), true);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'b'), true);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'c'), true);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'd'), true);
  });

  it('returns false if there are self intersections with a junction (closed way)', () => {
    //  a     c
    //  | \ / |
    //  |  x  |
    //  | / \ |
    //  d     b
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 2]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 0]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const x = new Rapid.OsmNode(context, {id: 'x', loc: [1, 1]});
    const nodes = [a, x, b, c, x, d, a];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'a'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'b'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'c'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'd'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'x'), false);
  });

  it('returns false if there are no self intersections (open way)', () => {
    //  a --- b
    //        |
    //        |
    //  d --- c
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const nodes = [a, b, c, d];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'a'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'b'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'c'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'd'), false);
  });

  it('returns true if there are self intersections without a junction (open way)', () => {
    //  a     c
    //    \ / |
    //     /  |
    //    / \ |
    //  d     b
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 2]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 0]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const nodes = [a, b, c, d];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'a'), true);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'b'), true);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'c'), true);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'd'), true);
  });

  it('returns false if there are self intersections with a junction (open way)', () => {
    //  a     c
    //    \ / |
    //     x  |
    //    / \ |
    //  d     b
    const a = new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]});
    const b = new Rapid.OsmNode(context, {id: 'b', loc: [2, 2]});
    const c = new Rapid.OsmNode(context, {id: 'c', loc: [2, 0]});
    const d = new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]});
    const x = new Rapid.OsmNode(context, {id: 'x', loc: [1, 1]});
    const nodes = [a, x, b, c, x, d];
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'a'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'b'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'c'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'd'), false);
    assert.equal(Rapid.geoHasSelfIntersections(nodes, 'x'), false);
  });
});


describe('geomCoverageBoxes', () => {
  it('returns an empty array for empty coords', () => {
    assert.deepEqual(Rapid.geomCoverageBoxes([], 1), []);
  });

  it('returns an empty array for a non-positive radius', () => {
    assert.deepEqual(Rapid.geomCoverageBoxes([[0, 0], [10, 0]], 0), []);
    assert.deepEqual(Rapid.geomCoverageBoxes([[0, 0], [10, 0]], -1), []);
  });

  it('covers a single point with one box centered on it', () => {
    const boxes = Rapid.geomCoverageBoxes([[5, 7]], 2);
    assert.equal(boxes.length, 1);
    const box = boxes[0];
    assert.deepEqual(box.coord, [5, 7]);
    assert.equal(box.angle, 0);
    assert.deepEqual([box.minX, box.minY, box.maxX, box.maxY], [3, 5, 7, 9]);
  });

  it('does not alias the input coordinate in the returned box', () => {
    const input = [3, 4];
    const boxes = Rapid.geomCoverageBoxes([input], 1);
    assert.notStrictEqual(boxes[0].coord, input);   // fresh array
    assert.deepEqual(boxes[0].coord, input);        // same values
  });

  it('covers a horizontal line with boxes spaced `step` apart, endpoints included', () => {
    // length 10, step 5 -> samples at 0, 5, 10
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0]], 1, 5);
    assert.equal(boxes.length, 3);
    assert.deepEqual(boxes.map(b => b.coord), [[0, 0], [5, 0], [10, 0]]);
    for (const box of boxes) {
      assert.equal(box.angle, 0);   // horizontal heading
    }
  });

  it('every box has half-size `radius`', () => {
    const radius = 3;
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0]], radius, 5);
    for (const box of boxes) {
      assert.equal(box.maxX - box.minX, 2 * radius);
      assert.equal(box.maxY - box.minY, 2 * radius);
      assert.equal((box.minX + box.maxX) / 2, box.coord[0]);
      assert.equal((box.minY + box.maxY) / 2, box.coord[1]);
    }
  });

  it('rounds the sample count up so the whole line is covered', () => {
    // length 10, step 4 -> ceil(10/4) = 3 intervals -> 4 samples at 0, 3.33, 6.67, 10
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0]], 1, 4);
    assert.equal(boxes.length, 4);
    assert.deepEqual(boxes[0].coord, [0, 0]);
    assert.deepEqual(boxes[boxes.length - 1].coord, [10, 0]);
  });

  it('records the heading angle of each segment', () => {
    // first segment goes east (angle 0), second goes north (angle +PI/2 in y-up math space)
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0], [10, 10]], 1, 5);
    const eastBoxes = boxes.filter(b => b.angle === 0);
    const northBoxes = boxes.filter(b => Math.abs(b.angle - Math.PI / 2) < 1e-9);
    assert.ok(eastBoxes.length > 0);
    assert.ok(northBoxes.length > 0);
  });

  it('does not double-cover shared vertices between segments', () => {
    // corner at [10,0] is shared; it should appear exactly once
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0], [10, 10]], 1, 5);
    const atCorner = boxes.filter(b => b.coord[0] === 10 && b.coord[1] === 0);
    assert.equal(atCorner.length, 1);
  });

  it('defaults `step` to `radius` when not provided', () => {
    // length 10, radius 5 -> step 5 -> samples at 0, 5, 10
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0]], 5);
    assert.equal(boxes.length, 3);
    assert.deepEqual(boxes.map(b => b.coord), [[0, 0], [5, 0], [10, 0]]);
  });

  it('skips zero-length segments', () => {
    // duplicate middle point should not add extra boxes or NaN angles
    const boxes = Rapid.geomCoverageBoxes([[0, 0], [10, 0], [10, 0], [20, 0]], 1, 10);
    assert.deepEqual(boxes.map(b => b.coord), [[0, 0], [10, 0], [20, 0]]);
    for (const box of boxes) {
      assert.ok(!Number.isNaN(box.angle));
    }
  });

  it('falls back to a single box for a fully degenerate polyline', () => {
    const boxes = Rapid.geomCoverageBoxes([[5, 5], [5, 5], [5, 5]], 2);
    assert.equal(boxes.length, 1);
    assert.deepEqual(boxes[0].coord, [5, 5]);
  });

  it('covers a closed ring (first vertex == last vertex)', () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const boxes = Rapid.geomCoverageBoxes(ring, 1, 10);
    assert.ok(boxes.length > 0);
    // every box center is within the ring's extent
    for (const box of boxes) {
      assert.ok(box.coord[0] >= 0 && box.coord[0] <= 10);
      assert.ok(box.coord[1] >= 0 && box.coord[1] <= 10);
    }
  });
});


describe('geomLineSegments', () => {
  const EPSILON = 1e-9;

  it('returns an empty array for empty points', () => {
    assert.deepEqual(Rapid.geomLineSegments([], 2), []);
  });

  it('returns an empty array for a single point', () => {
    assert.deepEqual(Rapid.geomLineSegments([[0, 0]], 2), []);
  });

  it('returns no segment when spacing exceeds the line length', () => {
    // length 5, spacing 10 -> span = 5 - 10 < 0, so nothing is emitted
    assert.deepEqual(Rapid.geomLineSegments([[0, 0], [5, 0]], 10), []);
  });

  it('places positions every `spacing` units along a horizontal line', () => {
    // length 10, spacing 2 -> positions at 2,4,6,8,10 (the last coincides with the endpoint)
    const segments = Rapid.geomLineSegments([[0, 0], [10, 0]], 2);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0].coords, [[2, 0], [4, 0], [6, 0], [8, 0], [10, 0]]);
    assert.equal(segments[0].angle, 0);
  });

  it('positions are evenly spaced by `spacing`', () => {
    const segments = Rapid.geomLineSegments([[0, 0], [12, 0]], 3);
    const coords = segments[0].coords;
    for (let i = 1; i < coords.length; i++) {
      assert.ok(Math.abs(Rapid.sdk.vecLength(coords[i - 1], coords[i]) - 3) < EPSILON);
    }
  });

  it('records the heading angle of the segment (vertical line)', () => {
    // straight up: heading is +PI/2 in y-up math space
    const segments = Rapid.geomLineSegments([[0, 0], [0, 10]], 2);
    assert.equal(segments.length, 1);
    assert.ok(Math.abs(segments[0].angle - Math.PI / 2) < EPSILON);
    for (const c of segments[0].coords) {
      assert.ok(Math.abs(c[0]) < EPSILON);   // x stays ~0
    }
  });

  it('emits a separate segment per line segment, each with its own heading', () => {
    // east then north
    const segments = Rapid.geomLineSegments([[0, 0], [10, 0], [10, 10]], 2);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].angle, 0);
    assert.ok(Math.abs(segments[1].angle - Math.PI / 2) < EPSILON);
  });

  it('carries the leftover offset across vertices to keep spacing continuous', () => {
    // seg1 length 5, spacing 2 -> positions at 2,4; leftover so next starts 1 unit in
    const segments = Rapid.geomLineSegments([[0, 0], [5, 0], [5, 5]], 2);
    assert.equal(segments.length, 2);
    assert.deepEqual(segments[0].coords, [[2, 0], [4, 0]]);
    // first position on the vertical segment is 1 unit past the corner [5,0]
    Rapid.sdk.vecEqual(segments[1].coords[0], [5, 1], EPSILON);
  });

  it('offsets positions perpendicular and rotates the angle for sided lines', () => {
    // horizontal line, sided offset 7 -> positions shift +7 in +y (heading+PI/2 direction)
    const segments = Rapid.geomLineSegments([[0, 0], [10, 0]], 2, true, false, 7);
    assert.equal(segments.length, 1);
    assert.ok(Math.abs(segments[0].angle - Math.PI / 2) < EPSILON);
    for (const c of segments[0].coords) {
      assert.ok(Math.abs(c[1] - 7) < EPSILON);   // shifted up by the sided offset
    }
  });

  it('uses the default sided offset of 7 when not specified', () => {
    const segments = Rapid.geomLineSegments([[0, 0], [10, 0]], 2, true);
    for (const c of segments[0].coords) {
      assert.ok(Math.abs(c[1] - 7) < EPSILON);
    }
  });

  it('does not limit position count when `isLimited` is false', () => {
    // length 1000, spacing 2 -> hundreds of positions
    const segments = Rapid.geomLineSegments([[0, 0], [1000, 0]], 2, false, false);
    assert.ok(segments[0].coords.length > 200);
  });

  it('caps a very long segment to ~100 positions when `isLimited` is true', () => {
    // length 1000, spacing 2 -> span 998 >= 200, so spacing widens to fit ~100
    const limited = Rapid.geomLineSegments([[0, 0], [1000, 0]], 2, false, true);
    const unlimited = Rapid.geomLineSegments([[0, 0], [1000, 0]], 2, false, false);
    assert.ok(limited[0].coords.length <= 101);
    assert.ok(limited[0].coords.length >= 99);
    assert.ok(unlimited[0].coords.length > limited[0].coords.length);
  });

  it('does not widen spacing for segments below the limit threshold', () => {
    // length 50, spacing 2 -> span 48 < 200, so isLimited has no effect
    const limited = Rapid.geomLineSegments([[0, 0], [50, 0]], 2, false, true);
    const unlimited = Rapid.geomLineSegments([[0, 0], [50, 0]], 2, false, false);
    assert.deepEqual(limited[0].coords, unlimited[0].coords);
  });

  it('skips segments shorter than the carried offset but continues the line', () => {
    // tiny middle hop shouldn't crash; later long segment still produces positions
    const segments = Rapid.geomLineSegments([[0, 0], [1, 0], [1, 20]], 5);
    // first hop (length 1) is too short for spacing 5 -> no segment from it
    // the vertical hop (length 20) should produce positions
    assert.ok(segments.length >= 1);
    const last = segments[segments.length - 1];
    assert.ok(last.coords.length > 0);
  });
});


