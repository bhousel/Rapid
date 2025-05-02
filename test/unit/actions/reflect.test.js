import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

function closeTo(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

describe('actionReflect', () => {
  const viewport = {
    project:   val => val,
    unproject: val => val
  };

  it('does not create or remove nodes', () => {
    const graph = new Rapid.Graph([
      Rapid.osmNode({ id: 'a', loc: [0, 0] }),
      Rapid.osmNode({ id: 'b', loc: [4, 0] }),
      Rapid.osmNode({ id: 'c', loc: [4, 2] }),
      Rapid.osmNode({ id: 'd', loc: [1, 2] }),
      Rapid.osmWay({ id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const result = Rapid.actionReflect(['-'], viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes.length, 5);
  });


  it('reflects across long axis', () => {
    //    d -- c      a ---- b
    //   /     |  ->   \     |
    //  a ---- b        d -- c
    const graph = new Rapid.Graph([
      Rapid.osmNode({ id: 'a', loc: [0, 0] }),
      Rapid.osmNode({ id: 'b', loc: [4, 0] }),
      Rapid.osmNode({ id: 'c', loc: [4, 2] }),
      Rapid.osmNode({ id: 'd', loc: [1, 2] }),
      Rapid.osmWay({ id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const result = Rapid.actionReflect(['-'], viewport).useLongAxis(true)(graph);
    assert.ok(result instanceof Rapid.Graph);

    const a = result.entity('a').loc; // [0, 2]
    const b = result.entity('b').loc; // [4, 2]
    const c = result.entity('c').loc; // [4, 0]
    const d = result.entity('d').loc; // [1, 0]

    assert.ok(closeTo(a[0], 0));
    assert.ok(closeTo(a[1], 2));
    assert.ok(closeTo(b[0], 4));
    assert.ok(closeTo(b[1], 2));
    assert.ok(closeTo(c[0], 4));
    assert.ok(closeTo(c[1], 0));
    assert.ok(closeTo(d[0], 1));
    assert.ok(closeTo(d[1], 0));
  });


  it('reflects across short axis', () => {
    //    d -- c      c -- d
    //   /     |  ->  |     \
    //  a ---- b      b ---- a
    const graph = new Rapid.Graph([
      Rapid.osmNode({ id: 'a', loc: [0, 0] }),
      Rapid.osmNode({ id: 'b', loc: [4, 0] }),
      Rapid.osmNode({ id: 'c', loc: [4, 2] }),
      Rapid.osmNode({ id: 'd', loc: [1, 2] }),
      Rapid.osmWay({ id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
    ]);

    const result = Rapid.actionReflect(['-'], viewport).useLongAxis(false)(graph);
    assert.ok(result instanceof Rapid.Graph);

    const a = result.entity('a').loc; // [4, 0]
    const b = result.entity('b').loc; // [0, 0]
    const c = result.entity('c').loc; // [0, 2]
    const d = result.entity('d').loc; // [3, 2]

    assert.ok(closeTo(a[0], 4));
    assert.ok(closeTo(a[1], 0));
    assert.ok(closeTo(b[0], 0));
    assert.ok(closeTo(b[1], 0));
    assert.ok(closeTo(c[0], 0));
    assert.ok(closeTo(c[1], 2));
    assert.ok(closeTo(d[0], 3));
    assert.ok(closeTo(d[1], 2));
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.equal(Rapid.actionReflect().transitionable, true);
    });


    it('reflect long at t = 0', () => {
      const graph = new Rapid.Graph([
        Rapid.osmNode({ id: 'a', loc: [0, 0] }),
        Rapid.osmNode({ id: 'b', loc: [4, 0] }),
        Rapid.osmNode({ id: 'c', loc: [4, 2] }),
        Rapid.osmNode({ id: 'd', loc: [1, 2] }),
        Rapid.osmWay({ id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const result = Rapid.actionReflect(['-'], viewport)(graph, 0);
      assert.ok(result instanceof Rapid.Graph);

      const a = result.entity('a').loc; // [0, 0]
      const b = result.entity('b').loc; // [4, 0]
      const c = result.entity('c').loc; // [4, 2]
      const d = result.entity('d').loc; // [1, 2]

      assert.ok(closeTo(a[0], 0));
      assert.ok(closeTo(a[1], 0));
      assert.ok(closeTo(b[0], 4));
      assert.ok(closeTo(b[1], 0));
      assert.ok(closeTo(c[0], 4));
      assert.ok(closeTo(c[1], 2));
      assert.ok(closeTo(d[0], 1));
      assert.ok(closeTo(d[1], 2));
    });


    it('reflect long at t = 0.5', () => {
      const graph = new Rapid.Graph([
        Rapid.osmNode({ id: 'a', loc: [0, 0] }),
        Rapid.osmNode({ id: 'b', loc: [4, 0] }),
        Rapid.osmNode({ id: 'c', loc: [4, 2] }),
        Rapid.osmNode({ id: 'd', loc: [1, 2] }),
        Rapid.osmWay({ id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);
      const result = Rapid.actionReflect(['-'], viewport)(graph, 0.5);
      assert.ok(result instanceof Rapid.Graph);

      const a = result.entity('a').loc; // [0, 1]
      const b = result.entity('b').loc; // [4, 1]
      const c = result.entity('c').loc; // [4, 1]
      const d = result.entity('d').loc; // [1, 1]

      assert.ok(closeTo(a[0], 0));
      assert.ok(closeTo(a[1], 1));
      assert.ok(closeTo(b[0], 4));
      assert.ok(closeTo(b[1], 1));
      assert.ok(closeTo(c[0], 4));
      assert.ok(closeTo(c[1], 1));
      assert.ok(closeTo(d[0], 1));
      assert.ok(closeTo(d[1], 1));
    });


    it('reflect long at t = 1', () => {
      const graph = new Rapid.Graph([
        Rapid.osmNode({ id: 'a', loc: [0, 0] }),
        Rapid.osmNode({ id: 'b', loc: [4, 0] }),
        Rapid.osmNode({ id: 'c', loc: [4, 2] }),
        Rapid.osmNode({ id: 'd', loc: [1, 2] }),
        Rapid.osmWay({ id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);
      const result = Rapid.actionReflect(['-'], viewport)(graph, 1);
      assert.ok(result instanceof Rapid.Graph);

      const a = result.entity('a').loc; // [0, 2]
      const b = result.entity('b').loc; // [4, 2]
      const c = result.entity('c').loc; // [4, 0]
      const d = result.entity('d').loc; // [1, 0]

      assert.ok(closeTo(a[0], 0));
      assert.ok(closeTo(a[1], 2));
      assert.ok(closeTo(b[0], 4));
      assert.ok(closeTo(b[1], 2));
      assert.ok(closeTo(c[0], 4));
      assert.ok(closeTo(c[1], 0));
      assert.ok(closeTo(d[0], 1));
      assert.ok(closeTo(d[1], 0));
    });
  });
});
