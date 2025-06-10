import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
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
    // Define your nodes and graph
    const nodeA = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
    const nodeB = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
    const graph = new Rapid.Graph([nodeA, nodeB]);
    const pivot = [0, 0];
    const angle = Math.PI / 2;  // 90 degrees in radians

    const result = Rapid.actionRotate([nodeA.id, nodeB.id], pivot, angle, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.ok(result.hasEntity(nodeA.id));
    assert.ok(result.hasEntity(nodeB.id));
    assert.ok(closeTo(result.entity(nodeA.id).loc[0], 0));
    assert.ok(closeTo(result.entity(nodeA.id).loc[1], 0));
    assert.ok(closeTo(result.entity(nodeB.id).loc[0], 0));
    assert.ok(closeTo(result.entity(nodeB.id).loc[1], 1));
  });
});
