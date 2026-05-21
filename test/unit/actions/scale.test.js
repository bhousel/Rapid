import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionScale', () => {
  const context = new Rapid.MockContext();

  it('scales nodes relative to a given origin point', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] })
    ]);
    const graph = new Rapid.Graph(base);
    const origin = [0, 0];
    const scale = 2;

    const result = Rapid.actionScale(['a', 'b'], origin, scale)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const resultA = result.hasEntity('a');
    const resultB = result.hasEntity('b');

    assert.instanceOf(resultA, Rapid.OsmNode);
    assert.instanceOf(resultB, Rapid.OsmNode);
    assert.deepEqual(resultA.loc, [0, 0]);
    assert.deepEqual(resultB.loc, [2, 0]);
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionScale().transitionable);
    });

    it('scale at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] })
      ]);
      const graph = new Rapid.Graph(base);
      const origin = [0, 0];
      const scale = 2;

      const result = Rapid.actionScale(['a', 'b'], origin, scale)(graph, 0);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc;
      const b = result.entity('b').loc;
      assert.deepEqual(a, [0, 0]);
      assert.deepEqual(b, [1, 0]);
    });

    it('scale at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] })
      ]);
      const graph = new Rapid.Graph(base);
      const origin = [0, 0];
      const scale = 2;

      const result = Rapid.actionScale(['a', 'b'], origin, scale)(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc;
      const b = result.entity('b').loc;
      assert.closeTo(a[0], 0, 1e-9);
      assert.closeTo(a[1], 0, 1e-9);
      assert.closeTo(b[0], 1.5, 1e-9);
      assert.closeTo(b[1], 0, 1e-9);
    });

    it('scale at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] })
      ]);
      const graph = new Rapid.Graph(base);
      const origin = [0, 0];
      const scale = 2;

      const result = Rapid.actionScale(['a', 'b'], origin, scale)(graph, 1);
      assert.instanceOf(result, Rapid.Graph);

      const a = result.entity('a').loc;
      const b = result.entity('b').loc;
      assert.closeTo(a[0], 0, 1e-9);
      assert.closeTo(a[1], 0, 1e-9);
      assert.closeTo(b[0], 2, 1e-9);
      assert.closeTo(b[1], 0, 1e-9);
    });
  });
});
