import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionDeleteMember', () => {
  const context = new Rapid.MockContext();

  it('removes the member at the specified index', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const n2 = new Rapid.OsmNode(context, {id: 'n2'});
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{id: 'n1'}, {id: 'n2'}] });
    const base = new Rapid.Graph(context, [n1, n2, r1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteMember('r1', 0)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('r1').members, [{id: 'n2'}]);
  });

  it('deletes relations that become empty', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{id: 'n1'}] });
    const base = new Rapid.Graph(context, [n1, r1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteMember('r1', 0)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('r1'));
  });
});
