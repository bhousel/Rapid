import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
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

  describe('#disabled', () => {
    it('returns falsy for ways with internal nodes near centerline', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);
      assert.ok(!Rapid.actionStraightenWay(['-'], viewport).disabled(graph));
    });

    it('returns \'too_bendy\' for ways with internal nodes far off centerline', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);
      assert.equal(Rapid.actionStraightenWay(['-'], viewport).disabled(graph), 'too_bendy');
    });

    it('returns \'too_bendy\' for ways with coincident start/end nodes', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);
      assert.equal(Rapid.actionStraightenWay(['-'], viewport).disabled(graph), 'too_bendy');
    });
  });


  it('deletes empty nodes', () => {
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: {} }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
    ]);

    const result = Rapid.actionStraightenWay(['-'], viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'c']);
    assert.equal(result.hasEntity('b'), undefined);
  });


  it('does not delete tagged nodes', () => {
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
    ]);

    const result = Rapid.actionStraightenWay(['-'], viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.ok(closeTo(result.entity('b').loc[0], 1));
    assert.ok(closeTo(result.entity('b').loc[1], 0));
  });


  it('does not delete nodes connected to other ways', () => {
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['b'] })
    ]);

    const result = Rapid.actionStraightenWay(['-'], viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.ok(closeTo(result.entity('b').loc[0], 1));
    assert.ok(closeTo(result.entity('b').loc[1], 0));
  });


  it('straightens multiple, connected ways', () => {
    const graph = new Rapid.Graph(context, [
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

    const result = Rapid.actionStraightenWay(['-', '--'], viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
    assert.deepEqual(result.entity('--').nodes, ['d', 'f', 'h']);
    assert.ok(closeTo(result.entity('f').loc[0], 5));
    assert.ok(closeTo(result.entity('f').loc[1], 0));
    assert.equal(result.hasEntity('g'), undefined);
  });


  it('straightens multiple, connected ways going in different directions', () => {
    const graph = new Rapid.Graph(context, [
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

    const result = Rapid.actionStraightenWay(['-', '--'], viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
    assert.deepEqual(result.entity('--').nodes, ['h', 'f', 'd']);
    assert.ok(closeTo(result.entity('f').loc[0], 5));
    assert.ok(closeTo(result.entity('f').loc[1], 0));
    assert.equal(result.hasEntity('g'), undefined);
  });


  describe('transitions', () => {

    it('is transitionable', () => {
      assert.equal(Rapid.actionStraightenWay().transitionable, true);
    });


    it('straighten at t = 0', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const result = Rapid.actionStraightenWay(['-'], viewport)(graph, 0);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd']);
      assert.ok(closeTo(result.entity('b').loc[0], 1));
      assert.ok(closeTo(result.entity('b').loc[1], 0.01));
      assert.ok(closeTo(result.entity('c').loc[0], 2));
      assert.ok(closeTo(result.entity('c').loc[1], -0.01));
    });


    it('straighten at t = 0.5', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const result = Rapid.actionStraightenWay(['-'], viewport)(graph, 0.5);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd']);
      assert.ok(closeTo(result.entity('b').loc[0], 1));
      assert.ok(closeTo(result.entity('b').loc[1], 0.005));
      assert.ok(closeTo(result.entity('c').loc[0], 2));
      assert.ok(closeTo(result.entity('c').loc[1], -0.005));
    });


    it('straighten at t = 1', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const result = Rapid.actionStraightenWay(['-'], viewport)(graph, 1);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
      assert.ok(closeTo(result.entity('b').loc[0], 1));
      assert.ok(closeTo(result.entity('b').loc[1], 0));
      assert.equal(result.hasEntity('c'), undefined);
    });
  });
});
