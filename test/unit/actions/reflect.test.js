import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


function closeTo(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

describe('actionReflect', () => {
  const context = new Rapid.MockContext();

  const viewport = {
    project:   val => val,
    unproject: val => val
  };

  it('does not create or remove nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [4, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionReflect(['-'], viewport)(graph);
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
    const result = Rapid.actionReflect(['-'], viewport).useLongAxis(true)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const a = result.entity('a').loc; // [0, 2]
    const b = result.entity('b').loc; // [4, 2]
    const c = result.entity('c').loc; // [4, 0]
    const d = result.entity('d').loc; // [1, 0]

    assert.isTrue(closeTo(a[0], 0));
    assert.isTrue(closeTo(a[1], 2));
    assert.isTrue(closeTo(b[0], 4));
    assert.isTrue(closeTo(b[1], 2));
    assert.isTrue(closeTo(c[0], 4));
    assert.isTrue(closeTo(c[1], 0));
    assert.isTrue(closeTo(d[0], 1));
    assert.isTrue(closeTo(d[1], 0));
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
    const result = Rapid.actionReflect(['-'], viewport).useLongAxis(false)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const a = result.entity('a').loc; // [4, 0]
    const b = result.entity('b').loc; // [0, 0]
    const c = result.entity('c').loc; // [0, 2]
    const d = result.entity('d').loc; // [3, 2]

    assert.isTrue(closeTo(a[0], 4));
    assert.isTrue(closeTo(a[1], 0));
    assert.isTrue(closeTo(b[0], 0));
    assert.isTrue(closeTo(b[1], 0));
    assert.isTrue(closeTo(c[0], 0));
    assert.isTrue(closeTo(c[1], 2));
    assert.isTrue(closeTo(d[0], 3));
    assert.isTrue(closeTo(d[1], 2));
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
      const result = Rapid.actionReflect(['-'], viewport)(graph, 0);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc; // [0, 0]
      const b = result.entity('b').loc; // [4, 0]
      const c = result.entity('c').loc; // [4, 2]
      const d = result.entity('d').loc; // [1, 2]

      assert.isTrue(closeTo(a[0], 0));
      assert.isTrue(closeTo(a[1], 0));
      assert.isTrue(closeTo(b[0], 4));
      assert.isTrue(closeTo(b[1], 0));
      assert.isTrue(closeTo(c[0], 4));
      assert.isTrue(closeTo(c[1], 2));
      assert.isTrue(closeTo(d[0], 1));
      assert.isTrue(closeTo(d[1], 2));
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
      const result = Rapid.actionReflect(['-'], viewport)(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc; // [0, 1]
      const b = result.entity('b').loc; // [4, 1]
      const c = result.entity('c').loc; // [4, 1]
      const d = result.entity('d').loc; // [1, 1]

      assert.isTrue(closeTo(a[0], 0));
      assert.isTrue(closeTo(a[1], 1));
      assert.isTrue(closeTo(b[0], 4));
      assert.isTrue(closeTo(b[1], 1));
      assert.isTrue(closeTo(c[0], 4));
      assert.isTrue(closeTo(c[1], 1));
      assert.isTrue(closeTo(d[0], 1));
      assert.isTrue(closeTo(d[1], 1));
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
      const result = Rapid.actionReflect(['-'], viewport)(graph, 1);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc; // [0, 2]
      const b = result.entity('b').loc; // [4, 2]
      const c = result.entity('c').loc; // [4, 0]
      const d = result.entity('d').loc; // [1, 0]

      assert.isTrue(closeTo(a[0], 0));
      assert.isTrue(closeTo(a[1], 2));
      assert.isTrue(closeTo(b[0], 4));
      assert.isTrue(closeTo(b[1], 2));
      assert.isTrue(closeTo(c[0], 4));
      assert.isTrue(closeTo(c[1], 0));
      assert.isTrue(closeTo(d[0], 1));
      assert.isTrue(closeTo(d[1], 0));
    });
  });
});
