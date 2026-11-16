import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('actionDeleteWay', () => {
  const context = new Rapid.MockContext();
  context.systems.schema = new Rapid.SchemaSystem(context);

  beforeAll(() => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    return schema.initAsync()
      .then(() => schema.merge(osmRulesets));
  });

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
  it('deletes parent relations that become degenerate, whatever order the parents come in', () => {
    // w1 is in r1 and r2, and r1 is a member of r2: deleting w1 empties r1, which empties r2.
    const n1 = new Rapid.OsmNode(context, { id: 'n1' });
    const n2 = new Rapid.OsmNode(context, { id: 'n2' });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'w1', type: 'way' }] });
    const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'w1', type: 'way' }, { id: 'r1', type: 'relation' }] });
    const base = new Rapid.Graph(context, [n1, n2, w1, r1, r2]);

    for (const order of [['r1', 'r2'], ['r2', 'r1']]) {
      const graph = new Rapid.Graph(base);
      if (order[0] === 'r2') {   // editing r2's tags put it first in base, last in the graph before step 3
        graph.replace(r1.update({ tags: { name: 'x' } }));
      }
      const result = Rapid.actionDeleteWay('w1')(graph);
      assert.isUndefined(result.hasEntity('r1'), `order ${order}`);
      assert.isUndefined(result.hasEntity('r2'), `order ${order}`);
    }
  });

//  describe('disabled', () => {
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
