import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionCircularize', () => {
  const context = new Rapid.MockContext();


  function isCircular(wayID, graph) {
    const way = graph.entity(wayID);
    const local = way.geoms.parts[0].local;
    const points = local.coords;
    const centroid = local.centroid;
    const radius = Rapid.sdk.vecLength(centroid, points[0]);
    const ideal = Math.PI * radius * radius;
    const pctDiff = (ideal - local.area) / ideal;
    return (pctDiff < 0.02);   // within 2% of circular area..
  }


  function intersection(a, b) {
    return (new Set(a)).intersection(new Set(b));
  }


  function angle(point1, point2, center) {
    let vector1 = [point1[0] - center[0], point1[1] - center[1]];
    let vector2 = [point2[0] - center[0], point2[1] - center[1]];
    let distance;

    distance = Rapid.sdk.vecLength(vector1, [0, 0]);
    vector1 = [vector1[0] / distance, vector1[1] / distance];

    distance = Rapid.sdk.vecLength(vector2, [0, 0]);
    vector2 = [vector2[0] / distance, vector2[1] / distance];

    return Math.acos(vector1[0] * vector2[0] + vector1[1] * vector2[1]) * Rapid.sdk.RAD2DEG;
  }


  function area(wayID, graph) {
    const way = graph.entity(wayID);
    return way.geoms.parts[0].local.area;
  }


  it('creates nodes if necessary', () => {
    //  d ---- c
    //  |      |
    //  a ---- b
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));
    assert.lengthOf(result.entity('-').nodes, 21);
  });


  it('reuses existing nodes', () => {
    //  d,e -- c
    //  |      |
    //  a ---- b
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
      new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));

    const nodes = result.entity('-').nodes;
    assert.includeMembers(nodes, ['a', 'b', 'c', 'd', 'e']);
  });


  it('limits movement of nodes that are members of other ways', () => {
    //  b ---- a
    //  |      |
    //  c ---- d
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [-2, 2] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [-2, -2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [2, -2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['d'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));
    const dist = Rapid.sdk.vecLength(result.entity('d').loc, [2, -2]);
    assert.closeTo(dist, 0, 1e-3, 'd did not move much');
  });


  it('creates circle respecting min-angle limit', () => {
    //  d ---- c
    //  |      |
    //  a ---- b
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCircularize('-', 20)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));

    const way = result.entity('-');
    const points = way.geoms.parts[0].world.coords;
    const centroid = way.geoms.parts[0].world.centroid;

    for (let i = 0; i < points.length - 1; i++) {
      assert.isAtMost(angle(points.at(i), points.at(i+1), centroid), 20);
    }
    assert.isAtMost(angle(points.at(-2), points.at(0), centroid), 20);
  });


  it('leaves clockwise ways clockwise', () => {
    //  d ---- c
    //  |      |    a-d-c-b-a is clockwise
    //  a ---- b
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
      new Rapid.OsmWay(context, { id: '+', nodes: ['a', 'd', 'c', 'b', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCircularize('+')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('+', result));

    const nodeIDs = result.entity('+').nodes.filter(nodeID => ['a', 'b', 'c', 'd'].includes(nodeID));
    assert.deepEqual(nodeIDs, ['a', 'd', 'c', 'b', 'a']);  // still in this order
  });


  it('leaves counterclockwise ways counterclockwise', () => {
    //  d ---- c
    //  |      |   a-b-c-d-a is counterclockwise
    //  a ---- b
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));

    const nodeIDs = result.entity('-').nodes.filter(nodeID => ['a', 'b', 'c', 'd'].includes(nodeID));
    assert.deepEqual(nodeIDs, ['a', 'b', 'c', 'd', 'a']);  // still in this order
  });


  it('adds new nodes on shared way wound in opposite direction', () => {
    //  c ---- b ---- f
    //  |     /       |
    //  |    a        |
    //  |     \       |
    //  d ---- e ---- g
    //
    //  a-b-c-d-e-a is counterclockwise
    //  a-b-f-g-e-a is clockwise
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [ 0,  0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [ 1,  2] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [-2,  2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [-2, -2] }),
      new Rapid.OsmNode(context, { id: 'e', loc: [ 1, -2] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [ 3,  2] }),
      new Rapid.OsmNode(context, { id: 'g', loc: [ 3, -2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['a', 'b', 'f', 'g', 'e', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const intersect1 = intersection(graph.entity('-').nodes, graph.entity('=').nodes);
    assert.lengthOf(intersect1, 3);
    assert.isFalse(graph.entity('-').isConvex(graph));
    assert.isTrue(graph.entity('=').isConvex(graph));

    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));

    const intersect2 = intersection(result.entity('-').nodes, result.entity('=').nodes);
    assert.isAbove(intersect2.size, 3);
    assert.isTrue(result.entity('-').isConvex(result));
    assert.isFalse(result.entity('=').isConvex(result));
  });


  it('adds new nodes on shared way wound in similar direction', () => {
    //  c ---- b ---- f
    //  |     /       |
    //  |    a        |
    //  |     \       |
    //  d ---- e ---- g
    //
    //  a-b-c-d-e-a is counterclockwise
    //  a-e-g-f-b-a is counterclockwise
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [ 0,  0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [ 1,  2] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [-2,  2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [-2, -2] }),
      new Rapid.OsmNode(context, { id: 'e', loc: [ 1, -2] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [ 3,  2] }),
      new Rapid.OsmNode(context, { id: 'g', loc: [ 3, -2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['a', 'e', 'g', 'f', 'b', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const intersect1 = intersection(graph.entity('-').nodes, graph.entity('=').nodes);
    assert.lengthOf(intersect1, 3);
    assert.isFalse(graph.entity('-').isConvex(graph));
    assert.isTrue(graph.entity('=').isConvex(graph));

    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));

    const intersect2 = intersection(result.entity('-').nodes, result.entity('=').nodes);
    assert.isAbove(intersect2.size, 3);
    assert.isTrue(result.entity('-').isConvex(result));
    assert.isFalse(result.entity('=').isConvex(result));
  });


  it('circularizes extremely concave ways with a key node on the wrong side of the centroid', () => {
    //  c ------------ b -- f
    //  |       ___---      |
    //  |  a ===            |
    //  |       ---___      |
    //  d ------------ e -- g
    //
    //  a-b-c-d-e-a is extremely concave and 'a' is to the left of centoid..
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [ 0,  0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [10,  2] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [-2,  2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [-2, -2] }),
      new Rapid.OsmNode(context, { id: 'e', loc: [10, -2] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [15,  2] }),
      new Rapid.OsmNode(context, { id: 'g', loc: [15, -2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['a', 'b', 'f', 'g', 'e', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    assert.isFalse(graph.entity('-').isConvex(graph));

    const result = Rapid.actionCircularize('-')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isTrue(isCircular('-', result));
    assert.isTrue(result.entity('-').isConvex(result));
  });


  describe('disabled', () => {
    it('not disable circularize when its not circular', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionCircularize('-').disabled(graph);
      assert.isFalse(disabled);
    });

    it('is disabled if not closed', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionCircularize('-').disabled(graph);
      assert.strictEqual(disabled, 'not_closed');
    });

    it('is disabled if already circular', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionCircularize('-')(graph);
      const disabled = Rapid.actionCircularize('-').disabled(result);
      assert.strictEqual(disabled, 'already_circular');
    });
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionCircularize().transitionable);
    });

    it('circularize at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionCircularize('-')(graph, 0);
      assert.isFalse(isCircular('-', result));
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd', 'a']);  // nothing done yet
    });

    it('circularize at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const a0 = area('-', Rapid.actionCircularize('-')(base.snapshot(), 0));
      const a1 = area('-', Rapid.actionCircularize('-')(base.snapshot(), 1));
      const result = Rapid.actionCircularize('-')(graph, 0.5);
      const aHalf = area('-', result);
      assert.isFalse(isCircular('-', result));          // not circular yet
      assert.lengthOf(result.entity('-').nodes, 21);    // all final nodes exist
      assert.isAbove(aHalf, a0);   // more area than at t=0
      assert.isBelow(aHalf, a1);   // less area than at t=1
    });

    it('circularize at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionCircularize('-')(graph, 1);
      assert.isTrue(isCircular('-', result));
      assert.lengthOf(result.entity('-').nodes, 21);
    });
  });

});
