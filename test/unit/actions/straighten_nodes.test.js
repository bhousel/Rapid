import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionStraightenNodes', () => {
  const context = new Rapid.MockContext();

  describe('disabled', () => {
    it('returns falsy for nodes that can be straightened', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0.01] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [6, -0.01] })
      ]);
      const graph = new Rapid.Graph(base);
      assert.isNotOk(Rapid.actionStraightenNodes(['a', 'b', 'c', 'd']).disabled(graph));
    });

    it('returns \'straight_enough\' for nodes already stright', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [6, 0] })
      ]);
      const graph = new Rapid.Graph(base);
      assert.strictEqual(Rapid.actionStraightenNodes(['a', 'b', 'c', 'd']).disabled(graph), 'straight_enough');
    });
  });

  it('does not delete nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0.01] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [2, -0.01] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [4, 0.01] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [6, -0.01] })
    ]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('a'));
    assert.isOk(result.hasEntity('b'));
    assert.isOk(result.hasEntity('c'));
    assert.isOk(result.hasEntity('d'));
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionStraightenWay().transitionable);
    });

    it('straighten at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0.01] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [6, -0.01] })
      ]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'])(graph, 0);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('a').loc, [0, 0.01]);
      assert.deepEqual(result.entity('b').loc, [2, -0.01]);
      assert.deepEqual(result.entity('c').loc, [4, 0.01]);
      assert.deepEqual(result.entity('d').loc, [6, -0.01]);
    });

    it('straighten at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0.01] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [6, -0.01] })
      ]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'])(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc;   // [0, 0.005]
      const b = result.entity('b').loc;   // [2, -0.005]
      const c = result.entity('c').loc;   // [4, 0.005]
      const d = result.entity('d').loc;   // [6, -0.005]
      assert.closeTo(a[0], 0, 1e-9);
      assert.closeTo(a[1], 0.005, 1e-9);
      assert.closeTo(b[0], 2, 1e-9);
      assert.closeTo(b[1], -0.005, 1e-9);
      assert.closeTo(c[0], 4, 1e-9);
      assert.closeTo(c[1], 0.005, 1e-9);
      assert.closeTo(d[0], 6, 1e-9);
      assert.closeTo(d[1], -0.005, 1e-9);
    });

    it('straighten at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0.01] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [6, -0.01] })
      ]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionStraightenNodes(['a', 'b', 'c', 'd'])(graph, 1);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc;   // [0, 0]
      const b = result.entity('b').loc;   // [2, 0]
      const c = result.entity('c').loc;   // [4, 0]
      const d = result.entity('d').loc;   // [6, 0]
      assert.closeTo(a[0], 0, 1e-9);
      assert.closeTo(a[1], 0, 1e-9);
      assert.closeTo(b[0], 2, 1e-9);
      assert.closeTo(b[1], 0, 1e-9);
      assert.closeTo(c[0], 4, 1e-9);
      assert.closeTo(c[1], 0, 1e-9);
      assert.closeTo(d[0], 6, 1e-9);
      assert.closeTo(d[1], 0, 1e-9);
    });
  });
});
