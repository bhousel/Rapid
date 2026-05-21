import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionReflect', () => {
  const context = new Rapid.MockContext();

  it('does not create or remove nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionReflect(['-'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.lengthOf(result.entity('-').nodes, 5);
  });

  it('reflects across long axis', () => {
    //    d -- c      a ---- b
    //   /     |  ->   \     |
    //  a ---- b        d -- c
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionReflect(['-']).useLongAxis(true)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const a = result.entity('a').loc; // [0, 2]
    const b = result.entity('b').loc; // [4, 2]
    const c = result.entity('c').loc; // [4, 0]
    const d = result.entity('d').loc; // [1, 0]

    assert.closeTo(a[0], 0, 1e-9);
    assert.closeTo(a[1], 2, 1e-9);
    assert.closeTo(b[0], 4, 1e-9);
    assert.closeTo(b[1], 2, 1e-9);
    assert.closeTo(c[0], 4, 1e-9);
    assert.closeTo(c[1], 0, 1e-9);
    assert.closeTo(d[0], 1, 1e-9);
    assert.closeTo(d[1], 0, 1e-9);
  });

  it('reflects across short axis', () => {
    //    d -- c      c -- d
    //   /     |  ->  |     \
    //  a ---- b      b ---- a
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionReflect(['-']).useLongAxis(false)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const a = result.entity('a').loc; // [4, 0]
    const b = result.entity('b').loc; // [0, 0]
    const c = result.entity('c').loc; // [0, 2]
    const d = result.entity('d').loc; // [3, 2]

    assert.closeTo(a[0], 4, 1e-9);
    assert.closeTo(a[1], 0, 1e-9);
    assert.closeTo(b[0], 0, 1e-9);
    assert.closeTo(b[1], 0, 1e-9);
    assert.closeTo(c[0], 0, 1e-9);
    assert.closeTo(c[1], 2, 1e-9);
    assert.closeTo(d[0], 3, 1e-9);
    assert.closeTo(d[1], 2, 1e-9);
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionReflect().transitionable);
    });

    it('reflect long at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionReflect(['-'])(graph, 0);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc;
      const b = result.entity('b').loc;
      const c = result.entity('c').loc;
      const d = result.entity('d').loc;

      assert.deepEqual(a, [0, 0]);
      assert.deepEqual(b, [4, 0]);
      assert.deepEqual(c, [4, 2]);
      assert.deepEqual(d, [1, 2]);
    });

    it('reflect long at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionReflect(['-'])(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc; // [0, 1]
      const b = result.entity('b').loc; // [4, 1]
      const c = result.entity('c').loc; // [4, 1]
      const d = result.entity('d').loc; // [1, 1]

      assert.closeTo(a[0], 0, 1e-9);
      assert.closeTo(a[1], 1, 1e-9);
      assert.closeTo(b[0], 4, 1e-9);
      assert.closeTo(b[1], 1, 1e-9);
      assert.closeTo(c[0], 4, 1e-9);
      assert.closeTo(c[1], 1, 1e-9);
      assert.closeTo(d[0], 1, 1e-9);
      assert.closeTo(d[1], 1, 1e-9);
    });

    it('reflect long at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionReflect(['-'])(graph, 1);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc; // [0, 2]
      const b = result.entity('b').loc; // [4, 2]
      const c = result.entity('c').loc; // [4, 0]
      const d = result.entity('d').loc; // [1, 0]

      assert.closeTo(a[0], 0, 1e-9);
      assert.closeTo(a[1], 2, 1e-9);
      assert.closeTo(b[0], 4, 1e-9);
      assert.closeTo(b[1], 2, 1e-9);
      assert.closeTo(c[0], 4, 1e-9);
      assert.closeTo(c[1], 0, 1e-9);
      assert.closeTo(d[0], 1, 1e-9);
      assert.closeTo(d[1], 0, 1e-9);
    });
  });
});
