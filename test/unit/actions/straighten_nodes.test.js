import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionStraightenNodes', () => {
  const context = new Rapid.MockContext();
  const viewport = {
    project: val => val,
    unproject: val => val
  };

  describe('#disabled', () => {
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
    assert.strictEqual(result.entity('b').loc[0], 1);
    assert.strictEqual(result.entity('b').loc[1], 0);
  });

  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionStraightenWay().transitionable);
    });

    it('straighten at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [5, 1], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [10, -1] }), // untagged
        new Rapid.OsmNode(context, { id: 'd', loc: [15, 1] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'], viewport)(graph, 0);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('a').loc, [0, -1]);
      assert.deepEqual(result.entity('b').loc, [5, 1]);
      assert.deepEqual(result.entity('c').loc, [10, -1]);
      assert.deepEqual(result.entity('d').loc, [15, 1]);
    });

    it('straighten at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [5, 1], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [10, -1] }), // untagged
        new Rapid.OsmNode(context, { id: 'd', loc: [15, 1] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'], viewport)(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('a').loc, [0, -0.5]);
      assert.deepEqual(result.entity('b').loc, [5, 0.5]);
      assert.deepEqual(result.entity('c').loc, [10, -0.5]);
      assert.deepEqual(result.entity('d').loc, [15, 0.5]);
    });

    it('straighten at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [5, 1], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [10, -1] }), // untagged
        new Rapid.OsmNode(context, { id: 'd', loc: [15, 1] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'], viewport)(graph, 1);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('a').loc, [0, 0]);
      assert.deepEqual(result.entity('b').loc, [5, 0]);
      assert.deepEqual(result.entity('c').loc, [10, 0]);
      assert.deepEqual(result.entity('d').loc, [15, 0]);
    });
  });
});
