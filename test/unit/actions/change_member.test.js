import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

describe('actionChangeMember', () => {
  it('updates the member at the specified index', () => {
    const n1 = Rapid.osmNode({id: 'n1'});
    const r1 = Rapid.osmRelation({id: 'r1', members: [{id: 'n1'}]});
    const graph = new Rapid.Graph([n1, r1]);

    const result = Rapid.actionChangeMember('r1', {id: 'n1', role: 'node'}, 0)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('r1').members, [{id: 'n1', role: 'node'}]);
  });
});
