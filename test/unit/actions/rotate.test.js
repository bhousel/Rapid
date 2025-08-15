import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


function closeTo(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

describe('actionRotate', () => {
  const context = new Rapid.MockContext();
  const viewport = {
    project:   val => val,
    unproject: val => val
  };

  it('rotates nodes around a pivot point', () => {
    const nodeA = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
    const nodeB = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
    const base = new Rapid.Graph(context, [nodeA, nodeB]);
    const graph = new Rapid.Graph(base);
    const pivot = [0, 0];
    const angle = Math.PI / 2;  // 90 degrees in radians

    const result = Rapid.actionRotate(['a', 'b'], pivot, angle, viewport)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const resultA = result.hasEntity('a');
    const resultB = result.hasEntity('b');
    assert.instanceOf(resultA, Rapid.OsmNode);
    assert.instanceOf(resultB, Rapid.OsmNode);
    assert.isTrue(closeTo(resultA.loc[0], 0));
    assert.isTrue(closeTo(resultA.loc[1], 0));
    assert.isTrue(closeTo(resultB.loc[0], 0));
    assert.isTrue(closeTo(resultB.loc[1], 1));
  });
});
