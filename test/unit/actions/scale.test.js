import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
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
    const graph = new Rapid.Graph([nodeA, nodeB]);

    // Pivot point and scale factor
    const pivot = [0, 0];
    const scaleFactor = 2;
    const result = Rapid.actionScale([nodeA.id, nodeB.id], pivot, scaleFactor, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.ok(result.hasEntity(nodeA.id));
    assert.ok(result.hasEntity(nodeB.id));
    assert.deepEqual(result.entity(nodeA.id).loc, [0, 0]);
    assert.deepEqual(result.entity(nodeB.id).loc, [2, 0]);
  });
});
