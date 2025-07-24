import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionCircularize', () => {
  const context = new Rapid.MockContext();
  const viewport = context.viewport;


  function isCircular(id, graph) {
    const points = graph.childNodes(graph.entity(id)).map(node => viewport.project(node.loc));
    const centroid = Rapid.d3.polygonCentroid(points);
    const radius = Rapid.sdk.vecLength(centroid, points[0]);
    const estArea = Math.PI * radius * radius;
    const trueArea = Math.abs(Rapid.d3.polygonArea(points));
    const pctDiff = (estArea - trueArea) / estArea;
    return (pctDiff < 0.025);   // within 2.5% of circular area..
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

    return 180 / Math.PI * Math.acos(vector1[0] * vector2[0] + vector1[1] * vector2[1]);
  }


  function area(id, graph) {
    const coords = graph.childNodes(graph.entity(id)).map(node => node.loc);
    return Rapid.d3.polygonArea(coords);
  }


  function closeTo(a, b, epsilon = 1e-2) {
    return Math.abs(a - b) < epsilon;
  }


  it('creates nodes if necessary', () => {
    //    d ---- c
    //    |      |
    //    a ---- b
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
    ]);

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));
    assert.lengthOf(result.entity('-').nodes, 20);
  });


  it('reuses existing nodes', () => {
    //    d,e -- c
    //    |      |
    //    a ---- b
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
      new Rapid.OsmNode(context, {id: 'e', loc: [0, 2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a']})
    ]);

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));

    const nodes = result.entity('-').nodes;
    assert.includeMembers(nodes, ['a', 'b', 'c', 'd', 'e']);
  });


  it('limits movement of nodes that are members of other ways', () => {
    //    b ---- a
    //    |      |
    //    c ---- d
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [2, 2]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [-2, 2]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [-2, -2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [2, -2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['d']})
    ]);

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));
    const dist = Rapid.sdk.vecLength(result.entity('d').loc, [2, -2]);
    assert.isOk(dist < 0.5);
  });


  it('creates circle respecting min-angle limit', () => {
    //    d ---- c
    //    |      |
    //    a ---- b
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
    ]);

    const result = Rapid.actionCircularize('-', viewport, 20)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));

    const points = result.childNodes(result.entity('-')).map(node => viewport.project(node.loc));
    const centroid = Rapid.d3.polygonCentroid(points);

    for (let i = 0; i < points.length - 1; i++) {
      assert.isOk(angle(points.at(i), points.at(i+1), centroid) <= 20);
    }
    assert.isOk(angle(points.at(-2), points.at(0), centroid) <= 20);
  });


  it('leaves clockwise ways clockwise', () => {
    //    d ---- c
    //    |      |
    //    a ---- b
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
      new Rapid.OsmWay(context, {id: '+', nodes: ['a', 'd', 'c', 'b', 'a']})
    ]);

    assert.isOk(area('+', graph) > 0);

    const result = Rapid.actionCircularize('+', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('+', result));
    assert.isOk(area('+', result) > 0);
  });


  it('leaves counter-clockwise ways counter-clockwise', () => {
    //    d ---- c
    //    |      |
    //    a ---- b
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
    ]);

    assert.isOk(area('-', graph) < 0);

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));
    assert.isOk(area('-', result) < 0);
  });


  it('adds new nodes on shared way wound in opposite direction', () => {
    //    c ---- b ---- f
    //    |     /       |
    //    |    a        |
    //    |     \       |
    //    d ---- e ---- g
    //
    //  a-b-c-d-e-a is counterclockwise
    //  a-b-f-g-e-a is clockwise
    //
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [ 0,  0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [ 1,  2]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [-2,  2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [-2, -2]}),
      new Rapid.OsmNode(context, {id: 'e', loc: [ 1, -2]}),
      new Rapid.OsmNode(context, {id: 'f', loc: [ 3,  2]}),
      new Rapid.OsmNode(context, {id: 'g', loc: [ 3, -2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['a', 'b', 'f', 'g', 'e', 'a']})
    ]);

    const intersect1 = intersection(graph.entity('-').nodes, graph.entity('=').nodes);
    assert.lengthOf(intersect1, 3);
    assert.isFalse(graph.entity('-').isConvex(graph));
    assert.isTrue(graph.entity('=').isConvex(graph));

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));

    const intersect2 = intersection(result.entity('-').nodes, result.entity('=').nodes);
    assert.isAbove(intersect2.size, 3);
    assert.isTrue(result.entity('-').isConvex(result));
    assert.isFalse(result.entity('=').isConvex(result));
  });


  it('adds new nodes on shared way wound in similar direction', () => {
    //    c ---- b ---- f
    //    |     /       |
    //    |    a        |
    //    |     \       |
    //    d ---- e ---- g
    //
    //  a-b-c-d-e-a is counterclockwise
    //  a-e-g-f-b-a is counterclockwise
    //
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [ 0,  0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [ 1,  2]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [-2,  2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [-2, -2]}),
      new Rapid.OsmNode(context, {id: 'e', loc: [ 1, -2]}),
      new Rapid.OsmNode(context, {id: 'f', loc: [ 3,  2]}),
      new Rapid.OsmNode(context, {id: 'g', loc: [ 3, -2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['a', 'e', 'g', 'f', 'b', 'a']})
    ]);

    const intersect1 = intersection(graph.entity('-').nodes, graph.entity('=').nodes);
    assert.lengthOf(intersect1, 3);
    assert.isFalse(graph.entity('-').isConvex(graph));
    assert.isTrue(graph.entity('=').isConvex(graph));

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));

    const intersect2 = intersection(result.entity('-').nodes, result.entity('=').nodes);
    assert.isAbove(intersect2.size, 3);
    assert.isTrue(result.entity('-').isConvex(result));
    assert.isFalse(result.entity('=').isConvex(result));
  });


  it('circularizes extremely concave ways with a key node on the wrong side of the centroid', () => {
    //    c ------------ b -- f
    //    |       ___---      |
    //    |  a ===            |
    //    |       ---___      |
    //    d ------------ e -- g
    //
    //  a-b-c-d-e-a is extremely concave and 'a' is to the left of centoid..
    //
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [ 0,  0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [10,  2]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [-2,  2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [-2, -2]}),
      new Rapid.OsmNode(context, {id: 'e', loc: [10, -2]}),
      new Rapid.OsmNode(context, {id: 'f', loc: [15,  2]}),
      new Rapid.OsmNode(context, {id: 'g', loc: [15, -2]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['a', 'b', 'f', 'g', 'e', 'a']})
    ]);

    assert.isFalse(graph.entity('-').isConvex(graph));

    const result = Rapid.actionCircularize('-', viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(isCircular('-', result));
    assert.isTrue(result.entity('-').isConvex(result));
    assert.lengthOf(result.entity('-').nodes, 20);
  });


  describe('#disabled', () => {
    it('not disable circularize when its not circular', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
      ]);

      const disabled = Rapid.actionCircularize('-', viewport).disabled(graph);
      assert.isFalse(disabled);
    });


    it('disable circularize twice', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
      ]);

      const result = Rapid.actionCircularize('-', viewport)(graph);
      const disabled = Rapid.actionCircularize('-', viewport).disabled(result);
      assert.strictEqual(disabled, 'already_circular');
    });
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isOk(Rapid.actionCircularize().transitionable);
    });

    it('circularize at t = 0', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
      ]);
      const result = Rapid.actionCircularize('-', viewport)(graph, 0);
      assert.isFalse(isCircular('-', result));
      assert.lengthOf(result.entity('-').nodes, 20);
      assert.isOk(closeTo(area('-', result), -4));
    });

    it('circularize at t = 0.5', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
      ]);
      const result = Rapid.actionCircularize('-', viewport)(graph, 0.5);
      assert.isFalse(isCircular('-', result));
      assert.lengthOf(result.entity('-').nodes, 20);
      assert.isOk(closeTo(area('-', result), -4.812));
    });

    it('circularize at t = 1', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [2, 2]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd', 'a']})
      ]);
      const result = Rapid.actionCircularize('-', viewport)(graph, 1);
      assert.isOk(isCircular('-', result));
      assert.lengthOf(result.entity('-').nodes, 20);
      assert.isOk(closeTo(area('-', result), -6.168));
    });
  });

});
