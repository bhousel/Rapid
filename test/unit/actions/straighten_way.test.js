import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionStraightenWay', () => {
  const context = new Rapid.MockContext();

  it('deletes empty nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: {} }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-'])(graph);
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
    const result = Rapid.actionStraightenWay(['-'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);

    const b = result.entity('b').loc;
    assert.closeTo(b[0], 1, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
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
    const result = Rapid.actionStraightenWay(['-'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);

    const b = result.entity('b').loc;
    assert.closeTo(b[0], 1, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
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
    const result = Rapid.actionStraightenWay(['-', '--'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
    assert.deepEqual(result.entity('--').nodes, ['d', 'f', 'h']);

    const b = result.entity('b').loc;
    assert.closeTo(b[0], 1, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
    assert.isUndefined(result.hasEntity('c'));

    const f = result.entity('f').loc;
    assert.closeTo(f[0], 5, 1e-9);
    assert.closeTo(f[1], 0, 1e-9);
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
    const result = Rapid.actionStraightenWay(['-', '--'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);
    assert.deepEqual(result.entity('--').nodes, ['h', 'f', 'd']);

    const b = result.entity('b').loc;
    assert.closeTo(b[0], 1, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
    assert.isUndefined(result.hasEntity('c'));

    const f = result.entity('f').loc;
    assert.closeTo(f[0], 5, 1e-9);
    assert.closeTo(f[1], 0, 1e-9);
    assert.isUndefined(result.hasEntity('g'));
  });

  it('if child nodes included in selection, straightens only between those nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
      new Rapid.OsmNode(context, { id: 'e', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [5, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'g', loc: [6, -0.01] }),
      new Rapid.OsmNode(context, { id: 'h', loc: [7, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-', 'a', 'd'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd', 'e', 'f', 'g', 'h']);

    // b and c straightened
    const b = result.entity('b').loc;
    assert.closeTo(b[0], 1, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
    assert.isUndefined(result.hasEntity('c'));

    // f and g unaffected
    assert.deepEqual(result.entity('f').loc, [5, 0.01]);
    assert.deepEqual(result.entity('g').loc, [6, -0.01]);
  });

  it('if unrelated nodes included in selection, ignores them', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
      new Rapid.OsmNode(context, { id: 'd2', loc: [3, 0] }),   // not a member of the way
      new Rapid.OsmNode(context, { id: 'e', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'f', loc: [5, 0.01], tags: { foo: 'bar' } }),
      new Rapid.OsmNode(context, { id: 'g', loc: [6, -0.01] }),
      new Rapid.OsmNode(context, { id: 'h', loc: [7, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenWay(['-', 'a', 'd2'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'f', 'h']);

    const b = result.entity('b').loc;
    assert.closeTo(b[0], 1, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
    assert.isUndefined(result.hasEntity('c'));
    assert.isUndefined(result.hasEntity('d'));
    assert.isUndefined(result.hasEntity('e'));
    const f = result.entity('f').loc;
    assert.closeTo(f[0], 5, 1e-9);
    assert.closeTo(f[1], 0, 1e-9);
    assert.isUndefined(result.hasEntity('g'));
  });

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
      assert.isNotOk(Rapid.actionStraightenWay(['-']).disabled(graph));
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
      assert.strictEqual(Rapid.actionStraightenWay(['-']).disabled(graph), 'too_bendy');
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
      assert.strictEqual(Rapid.actionStraightenWay(['-']).disabled(graph), 'too_bendy');
    });
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
      const result = Rapid.actionStraightenWay(['-'])(graph, 0);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd']);

      const b = result.entity('b').loc;
      assert.closeTo(b[0], 1, 1e-9);
      assert.closeTo(b[1], 0.01, 1e-9);

      const c = result.entity('c').loc;
      assert.closeTo(c[0], 2, 1e-9);
      assert.closeTo(c[1], -0.01, 1e-9);
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
      const result = Rapid.actionStraightenWay(['-'])(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd']);

      const b = result.entity('b').loc;
      assert.closeTo(b[0], 1, 1e-9);
      assert.closeTo(b[1], 0.005, 1e-9);

      const c = result.entity('c').loc;
      assert.closeTo(c[0], 2, 1e-9);
      assert.closeTo(c[1], -0.005, 1e-9);
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
      const result = Rapid.actionStraightenWay(['-'])(graph, 1);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd']);

      const b = result.entity('b').loc;
      assert.closeTo(b[0], 1, 1e-9);
      assert.closeTo(b[1], 0, 1e-9);

      assert.isUndefined(result.hasEntity('c'));
    });
  });
});
