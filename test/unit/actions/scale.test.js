import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionScale', () => {
  const context = new Rapid.MockContext();
  const viewport = {
    project:   val => val,
    unproject: val => val
  };

  it('scales nodes around a pivot point', () => {
    const nodeA = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
    const nodeB = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
    const base = new Rapid.Graph(context, [nodeA, nodeB]);
    const graph = new Rapid.Graph(base);
    const pivot = [0, 0];
    const scale = 2;

    const result = Rapid.actionScale(['a', 'b'], pivot, scale, viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);
    const resultA = result.hasEntity('a');
    const resultB = result.hasEntity('b');
    assert.instanceOf(resultA, Rapid.OsmNode);
    assert.instanceOf(resultB, Rapid.OsmNode);
    assert.deepEqual(resultA.loc, [0, 0]);
    assert.deepEqual(resultB.loc, [2, 0]);
  });
});
