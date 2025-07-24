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
    const graph = new Rapid.Graph(context, [nodeA, nodeB]);
    const pivot = [0, 0];
    const scale = 2;

    const result = Rapid.actionScale([nodeA.id, nodeB.id], pivot, scale, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    const resultA = result.hasEntity(nodeA.id);
    const resultB = result.hasEntity(nodeB.id);
    assert.ok(resultA instanceof Rapid.OsmNode);
    assert.ok(resultB instanceof Rapid.OsmNode);
    assert.deepEqual(resultA.loc, [0, 0]);
    assert.deepEqual(resultB.loc, [2, 0]);
  });
});
