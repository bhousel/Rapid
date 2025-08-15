import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionDeleteWay', () => {
  const context = new Rapid.MockContext();

  it('removes the way from the graph', () => {
    const w1 = new Rapid.OsmWay(context, {id: 'w1'});
    const base = new Rapid.Graph(context, [w1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
  });

  it('removes a way from parent relations', () => {
    const w1 = new Rapid.OsmWay(context, {id: 'w1'});
    const w2 = new Rapid.OsmWay(context, {id: 'w2'});
    const r1 = new Rapid.OsmRelation(context, {id: 'r1', members: [{ id: 'w1' }, { id: 'w2' }]});
    const base = new Rapid.Graph(context, [w1, w2, r1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.deepEqual(result.entity('r1').members, [{ id: 'w2' }]);
  });

  it('deletes child nodes not referenced by another parent', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1']});
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isNotOk(result.hasEntity('n1'));
  });

  it('does not delete child nodes referenced by another parent', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1']});
    const w2 = new Rapid.OsmWay(context, {id: 'w2', nodes: ['n1']});
    const base = new Rapid.Graph(context, [n1, w1, w2]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isOk(result.hasEntity('w2'));
    assert.isOk(result.hasEntity('n1'));
  });

  it('deletes uninteresting child nodes', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const n2 = new Rapid.OsmNode(context, {id: 'n2'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1', 'n2']});
    const base = new Rapid.Graph(context, [n1, n2, w1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isNotOk(result.hasEntity('n1'));
    assert.isNotOk(result.hasEntity('n2'));
  });

  it('deletes a circular way, including the start/end node', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const n2 = new Rapid.OsmNode(context, {id: 'n2'});
    const n3 = new Rapid.OsmNode(context, {id: 'n3'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1', 'n2', 'n3', 'n1']});
    const base = new Rapid.Graph(context, [n1, n2, n3, w1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isNotOk(result.hasEntity('n1'));
    assert.isNotOk(result.hasEntity('n2'));
    assert.isNotOk(result.hasEntity('n3'));
  });

  it('does not delete child nodes with interesting tags', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1', tags: { highway: 'traffic_signals' }});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1']});
    const base = new Rapid.Graph(context, [n1, w1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isOk(result.hasEntity('n1'));
  });

  it('deletes parent relations that become empty', () => {
    const w1 = new Rapid.OsmWay(context, {id: 'w1'});
    const r1 = new Rapid.OsmRelation(context, {id: 'r1', members: [{ id: 'w1' }]});
    const base = new Rapid.Graph(context, [w1, r1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDeleteWay('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('w1'));
    assert.isNotOk(result.hasEntity('r1'));
  });

//  // This was moved to operationDelete.  We should test operations and move this test there.
//  describe('#disabled', () => {
//    it('returns \'part_of_relation\' for members of route and boundary relations', () => {
//      const w1 = new Rapid.OsmWay(context, {id: 'w1'});
//      const w2 = new Rapid.OsmWay(context, {id: 'w2'});
//      const r1 = new Rapid.OsmRelation(context, {id: 'r1', members: [{id: 'w1'}], tags: {type: 'route'}});      // route
//      const r2 = new Rapid.OsmRelation(context, {id: 'r2', members: [{id: 'w2'}], tags: {type: 'boundary'}});   // boundary
//      const base = new Rapid.Graph(context, [w1, w2, r1, r2]);
//      const graph = new Rapid.Graph(base);
//      expect(Rapid.actionDeleteWay('r1').disabled(graph)).to.equal('part_of_relation');
//      expect(Rapid.actionDeleteWay('r2').disabled(graph)).to.equal('part_of_relation');
//    });
//
//    it('returns \'part_of_relation\' for outer members of multipolygons', () => {
//      const w1 = new Rapid.OsmWay(context, {id: 'w1'});
//      const r1 = new Rapid.OsmRelation(context, {id: r1, members: [{id: 'w1', role: 'outer'}], tags: {type: 'multipolygon'}});
//      const base = new Rapid.Graph(context, [w1, r1]);
//      const graph = new Rapid.Graph(base);
//      const action = Rapid.actionDeleteWay('w1');
//      expect(action.disabled(graph)).to.equal('part_of_relation');
//    });
//
//    it('returns falsy for inner members of multipolygons', () => {
//      const w1 = new Rapid.OsmWay(context, {id: 'w1'});
//      const r1 = new Rapid.OsmRelation(context, {id: 'r1', members: [{id: 'w1', role: 'inner'}], tags: {type: 'multipolygon'}});
//      const base = new Rapid.Graph(context, [w1, r1]);
//      const graph = new Rapid.Graph(base);
//      const action = Rapid.actionDeleteWay('w1');
//      expect(action.disabled(graph)).not.ok;
//    });
//  });
});
