import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionMoveMember', () => {
  const context = new Rapid.MockContext();

  it('moves a member from one index to another in the specified relation', () => {
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: '1' }, { id: '3' }] });
    const base = new Rapid.Graph(context, [r1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionMoveMember('r1', 1, 0)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('r1').members, [{ id: '3' }, { id: '1' }]);
  });
});
