import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionDeleteMultiple', () => {
  const context = new Rapid.MockContext();

  it('deletes multiple entities of heterogeneous types', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1'});
    const r1 = new Rapid.OsmRelation(context, {id: 'r1'});
    const base = new Rapid.Graph(context, [n1, w1, r1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteMultiple(['n1', 'w1', 'r1'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('n1'));
    assert.isNotOk(result.hasEntity('w1'));
    assert.isNotOk(result.hasEntity('r1'));
  });

  it('deletes a way and one of its nodes', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1']});
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteMultiple(['w1', 'n1'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isNotOk(result.hasEntity('n1'));
  });


  // This was moved to operationDelete.  We should test operations and move this test there.
  // describe('disabled', () => {
  //   it('returns the result of the first action that is disabled', () => {
  //     const n1 = new Rapid.OsmNode(context, {id: 'n1'});
  //     const r1 = new Rapid.OsmRelation(context, {id: 'r1', members: [{id: 'w1'}]});  // 'w1' not downloaded
  //     const graph = new Rapid.Graph(context, [n1, r1]);
  //     const action = Rapid.actionDeleteMultiple(['n1', 'r1']);
  //     expect(action.disabled(graph)).to.equal('incomplete_relation');
  //   });
  // });
});
