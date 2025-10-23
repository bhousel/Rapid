import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionAddEntity', () => {
  const context = new Rapid.MockContext();

  it('adds an entity to the graph', () => {
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const entity = new Rapid.OsmNode(context);
    const result = Rapid.actionAddEntity(entity)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.strictEqual(result.entity(entity.id), entity);
  });
});
