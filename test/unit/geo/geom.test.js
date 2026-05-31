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
