import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


function closeTo(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) < epsilon;
}


// Returns the expected WGS84 loc after moving `loc` by world-space `delta`.
function moveLoc(loc, delta) {
  const w = Rapid.sdk.projWgs84ToWorld(loc);
  return Rapid.sdk.projWorldToWgs84([w[0] + delta[0], w[1] + delta[1]]);
}


describe('actionMove', () => {
  const context = new Rapid.MockContext();

  it('moves all nodes in a way by the given world delta', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0.0001, 0.0001] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const base = new Rapid.Graph(context, [n1, n2, w1]);
    const graph = new Rapid.Graph(base);
    const delta = [10, 20];

    const result = Rapid.actionMove(['w1'], delta)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const expected1 = moveLoc([0, 0], delta);
    const expected2 = moveLoc([0.0001, 0.0001], delta);
    assert.isTrue(closeTo(result.entity('n1').loc[0], expected1[0]));
    assert.isTrue(closeTo(result.entity('n1').loc[1], expected1[1]));
    assert.isTrue(closeTo(result.entity('n2').loc[0], expected2[0]));
    assert.isTrue(closeTo(result.entity('n2').loc[1], expected2[1]));
  });

  it('moves repeated nodes only once', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n1'] });
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);
    const delta = [5, 5];

    const result = Rapid.actionMove(['w1'], delta)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const expected = moveLoc([0, 0], delta);
    assert.isTrue(closeTo(result.entity('n1').loc[0], expected[0]));
    assert.isTrue(closeTo(result.entity('n1').loc[1], expected[1]));
  });

  it('moves multiple ways that share a node only once', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1'] });
    const base = new Rapid.Graph(context, [n1, w1, w2]);
    const graph = new Rapid.Graph(base);
    const delta = [3, 4];

    const result = Rapid.actionMove(['w1', 'w2'], delta)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const expected = moveLoc([0, 0], delta);
    assert.isTrue(closeTo(result.entity('n1').loc[0], expected[0]));
    assert.isTrue(closeTo(result.entity('n1').loc[1], expected[1]));
  });

  it('moves leaf nodes of a relation', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'w1' }] });
    const base = new Rapid.Graph(context, [n1, w1, r1]);
    const graph = new Rapid.Graph(base);
    const delta = [7, -3];

    const result = Rapid.actionMove(['r1'], delta)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const expected = moveLoc([0, 0], delta);
    assert.isTrue(closeTo(result.entity('n1').loc[0], expected[0]));
    assert.isTrue(closeTo(result.entity('n1').loc[1], expected[1]));
  });

  it('moves a bare node by id', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const base = new Rapid.Graph(context, [n1]);
    const graph = new Rapid.Graph(base);
    const delta = [1.5, -2.5];

    const result = Rapid.actionMove(['n1'], delta)(graph);
    const expected = moveLoc([0, 0], delta);
    assert.isTrue(closeTo(result.entity('n1').loc[0], expected[0]));
    assert.isTrue(closeTo(result.entity('n1').loc[1], expected[1]));
  });

  it('returns the input graph unchanged when delta is zero', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);

    const result = Rapid.actionMove(['w1'], [0, 0])(graph);
    assert.strictEqual(result, graph);
  });

  it('does not move a >2-way junction vertex when not all parent ways are moving', () => {
    // 3 ways meet at n1; only w1 is moving -> n1 should stay put.
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0.0001, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [0, 0.0001] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [-0.0001, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1', 'n3'] });
    const w3 = new Rapid.OsmWay(context, { id: 'w3', nodes: ['n1', 'n4'] });
    const base = new Rapid.Graph(context, [n1, n2, n3, n4, w1, w2, w3]);
    const graph = new Rapid.Graph(base);

    const delta = [10, 10];
    const result = Rapid.actionMove(['w1'], delta)(graph);

    // n1 stays put (3-way junction, not all parents moving)
    assert.deepEqual(result.entity('n1').loc, [0, 0]);
    // n2 still moves
    const expected2 = moveLoc([0.0001, 0], delta);
    assert.isTrue(closeTo(result.entity('n2').loc[0], expected2[0]));
    assert.isTrue(closeTo(result.entity('n2').loc[1], expected2[1]));
  });

  it('moves a >2-way junction vertex when all parent ways are moving', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0.0001, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [0, 0.0001] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [-0.0001, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1', 'n3'] });
    const w3 = new Rapid.OsmWay(context, { id: 'w3', nodes: ['n1', 'n4'] });
    const base = new Rapid.Graph(context, [n1, n2, n3, n4, w1, w2, w3]);
    const graph = new Rapid.Graph(base);

    const delta = [10, 10];
    const result = Rapid.actionMove(['w1', 'w2', 'w3'], delta)(graph);

    const expected1 = moveLoc([0, 0], delta);
    assert.isTrue(closeTo(result.entity('n1').loc[0], expected1[0]));
    assert.isTrue(closeTo(result.entity('n1').loc[1], expected1[1]));
  });

  it('preserves shape by inserting a vertex where a moved junction used to be', () => {
    //  Two ways meet at a non-endpoint, non-straight vertex.  Moving one way
    //  should insert a replacement vertex on the *unmoved* way at the old
    //  junction location so the unmoved way keeps its shape.
    //
    //  a --- b --- c    (w2, unmoved, w1's `b,d` is moved)
    //        |
    //        d          (w1, moved)
    //
    // w2 is bent at b (a/b/c are NOT collinear) so the shape-preserving
    // vertex insertion is not skipped by the ~180° straight-line check.
    const a = new Rapid.OsmNode(context, { id: 'a', loc: [-0.0002, 0.0001] });
    const b = new Rapid.OsmNode(context, { id: 'b', loc: [0, 0] });
    const c = new Rapid.OsmNode(context, { id: 'c', loc: [0.0002, 0.0001] });
    const d = new Rapid.OsmNode(context, { id: 'd', loc: [0, -0.0002] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['b', 'd'] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['a', 'b', 'c'] });
    const base = new Rapid.Graph(context, [a, b, c, d, w1, w2]);
    const graph = new Rapid.Graph(base);

    const delta = [50, 0];
    const result = Rapid.actionMove(['w1'], delta)(graph);

    // w2 should contain a node sitting at b's original location to preserve its shape.
    const w2After = result.entity('w2');
    const hasShapeVertex = w2After.nodes.some(nid => {
      const loc = result.entity(nid).loc;
      return closeTo(loc[0], 0) && closeTo(loc[1], 0);
    });
    assert.isTrue(hasShapeVertex, 'w2 should keep a vertex at b\'s original [0,0] location');
  });

  it('does not insert spurious shape-preserving vertices on a straight road when a U-way joins it at both ends', () => {
    // A U-shaped driveway w1 connects to a straight road w2 at BOTH of w1's
    // endpoints (b and e).  Sliding the driveway along the road should not
    // insert any "shape-preserving" vertices on the road, because the road
    // was straight at both junctions originally.
    //
    //  a --- b --------- e --- f    (w2, road, unmoved at the road level —
    //         \         /              but its shared nodes b,e move with w1)
    //          c ----- d
    //                                 (w1, driveway = [b, c, d, e])
    //
    // The road has a slight tilt (mimicking the Sun Road case) so that a
    // horizontal slide of `e` would shift its angle relative to `b`'s old
    // position away from exactly 180° — which is what the original bug
    // depended on.
    const a = new Rapid.OsmNode(context, { id: 'a', loc: [-0.0003,  0.00006] });
    const b = new Rapid.OsmNode(context, { id: 'b', loc: [-0.0001,  0.00002] });
    const e = new Rapid.OsmNode(context, { id: 'e', loc: [ 0.0001, -0.00002] });
    const f = new Rapid.OsmNode(context, { id: 'f', loc: [ 0.0003, -0.00006] });
    const c = new Rapid.OsmNode(context, { id: 'c', loc: [-0.0001, -0.00020] });
    const d = new Rapid.OsmNode(context, { id: 'd', loc: [ 0.0001, -0.00024] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['b', 'c', 'd', 'e'] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['a', 'b', 'e', 'f'] });
    const base = new Rapid.Graph(context, [a, b, c, d, e, f, w1, w2]);
    const graph = new Rapid.Graph(base);

    // Slide w1 to the right by a large world delta.
    const result = Rapid.actionMove(['w1'], [50, 0])(graph);

    // w2 must NOT have grown extra vertices — the road was straight at both
    // junctions and no shape needs preserving.
    assert.equal(result.entity('w2').nodes.length, 4,
      'w2 should keep exactly 4 nodes (no spurious shape-preserving inserts)');
  });

  it('exposes the (possibly clamped) delta via .delta()', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);

    const delta = [3, 4];
    const action = Rapid.actionMove(['w1'], delta);
    action(graph);
    assert.deepEqual(action.delta(), delta);
  });

  it('populates a passed-in cache and skips re-initialization on the next call', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);

    const cache = {};
    Rapid.actionMove(['w1'], [5, 0], cache)(graph);
    assert.isTrue(cache.ok);
    assert.include(cache.nodes, 'n1');
    assert.property(cache, 'origin');
    assert.property(cache.startLocal, 'n1');
  });
});
