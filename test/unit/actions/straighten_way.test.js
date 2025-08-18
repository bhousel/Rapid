import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


function closeTo(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

describe('actionStraightenWay', () => {
  const context = new Rapid.MockContext();
  const viewport = {
    project:   val => val,
    unproject: val => val
  };

  describe('disabled', () => {
    it('returns falsy for ways with internal nodes near centerline', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);
      const graph = new Rapid.Graph(base);
      assert.isNotOk(Rapid.actionStraightenWay(['-'], viewport).disabled(graph));
    });

    it('returns \'too_bendy\' for ways with internal nodes far off centerline', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);
      const graph = new Rapid.Graph(base);
      assert.strictEqual(Rapid.actionStraightenWay(['-'], viewport).disabled(graph), 'too_bendy');
    });

    it('returns \'too_bendy\' for ways with coincident start/end nodes', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);
      const graph = new Rapid.Graph(base);
      assert.strictEqual(Rapid.actionStraightenWay(['-'], viewport).disabled(graph), 'too_bendy');
    });
  });


  it('deletes empty nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: {} }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-'], viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'c']);
    assert.isUndefined(result.hasEntity('b'));
  });


  it('does not delete tagged nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-'], viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.isTrue(closeTo(result.entity('b').loc[0], 1));
    assert.isTrue(closeTo(result.entity('b').loc[1], 0));
  });


  it('does not delete nodes connected to other ways', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['b'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-'], viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.isTrue(closeTo(result.entity('b').loc[0], 1));
    assert.isTrue(closeTo(result.entity('b').loc[1], 0));
  });


  it('straightens multiple, connected ways', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] }),

      new Rapid.OsmNode(context, { id: 'e', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [5, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'g', loc: [6, -0.01] }),
      new Rapid.OsmNode(context, { id: 'h', loc: [7, 0] }),
      new Rapid.OsmWay(context, { id: '--', nodes: ['d', 'e', 'f', 'g', 'h'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-', '--'], viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
    assert.deepEqual(result.entity('--').nodes, ['d', 'f', 'h']);
    assert.isTrue(closeTo(result.entity('f').loc[0], 5));
    assert.isTrue(closeTo(result.entity('f').loc[1], 0));
    assert.isUndefined(result.hasEntity('g'));
  });


  it('straightens multiple, connected ways going in different directions', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] }),

      new Rapid.OsmNode(context, { id: 'e', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [5, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'g', loc: [6, -0.01] }),
      new Rapid.OsmNode(context, { id: 'h', loc: [7, 0] }),
      new Rapid.OsmWay(context, { id: '--', nodes: ['h', 'g', 'f', 'e', 'd'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-', '--'], viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
    assert.deepEqual(result.entity('--').nodes, ['h', 'f', 'd']);
    assert.isTrue(closeTo(result.entity('f').loc[0], 5));
    assert.isTrue(closeTo(result.entity('f').loc[1], 0));
    assert.isUndefined(result.hasEntity('g'));
  });


  describe('transitions', () => {

    it('is transitionable', () => {
      assert.isTrue(Rapid.actionStraightenWay().transitionable);
    });


    it('straighten at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenWay(['-'], viewport)(graph, 0);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd']);
      assert.isTrue(closeTo(result.entity('b').loc[0], 1));
      assert.isTrue(closeTo(result.entity('b').loc[1], 0.01));
      assert.isTrue(closeTo(result.entity('c').loc[0], 2));
      assert.isTrue(closeTo(result.entity('c').loc[1], -0.01));
    });


    it('straighten at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenWay(['-'], viewport)(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd']);
      assert.isTrue(closeTo(result.entity('b').loc[0], 1));
      assert.isTrue(closeTo(result.entity('b').loc[1], 0.005));
      assert.isTrue(closeTo(result.entity('c').loc[0], 2));
      assert.isTrue(closeTo(result.entity('c').loc[1], -0.005));
    });


    it('straighten at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenWay(['-'], viewport)(graph, 1);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
      assert.isTrue(closeTo(result.entity('b').loc[0], 1));
      assert.isTrue(closeTo(result.entity('b').loc[1], 0));
      assert.isUndefined(result.hasEntity('c'));
    });
  });
});
