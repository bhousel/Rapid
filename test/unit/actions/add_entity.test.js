import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

describe('actionAddEntity', () => {
  const context = new Rapid.MockContext();

  it('adds an entity to the graph', t => {
    const entity = new Rapid.OsmNode(context);
    const result = Rapid.actionAddEntity(entity)(new Rapid.Graph());
    assert.ok(result instanceof Rapid.Graph);
    assert.equal(result.entity(entity.id), entity);
  });
});
