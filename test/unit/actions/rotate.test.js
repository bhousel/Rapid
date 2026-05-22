import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


function closeTo(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

describe('actionRotate', () => {
  const context = new Rapid.MockContext();

  it('rotates nodes around a pivot point', () => {
    const nodeA = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
    const nodeB = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
    const base = new Rapid.Graph(context, [nodeA, nodeB]);
    const graph = new Rapid.Graph(base);
    const pivot = Rapid.sdk.projWgs84ToWorld([0, 0]);
    const start = Rapid.sdk.projWgs84ToWorld(nodeB.loc);
    const dx = start[0] - pivot[0];
    const angle = Math.PI / 2;  // 90 degrees in radians

    const result = Rapid.actionRotate(['a', 'b'], pivot, angle)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const resultA = result.hasEntity('a');
    const resultB = result.hasEntity('b');
    assert.instanceOf(resultA, Rapid.OsmNode);
    assert.instanceOf(resultB, Rapid.OsmNode);
    const resultBWorld = Rapid.sdk.projWgs84ToWorld(resultB.loc);

    assert.isTrue(closeTo(resultA.loc[0], 0));
    assert.isTrue(closeTo(resultA.loc[1], 0));
    assert.isTrue(closeTo(resultBWorld[0], pivot[0]));
    assert.isTrue(closeTo(resultBWorld[1], pivot[1] + dx));
  });
});
