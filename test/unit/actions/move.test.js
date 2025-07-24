import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionMove', () => {
  const context = new Rapid.MockContext();

  // This was moved to operationMove.  We should test operations and move this test there.
  // it('#disabled', function() {
  //     it('returns falsy by default', function() {
  //         const node  = new Rapid.OsmNode(context, {loc: [0, 0]}),
  //             action = Rapid.actionMove([node.id], [0, 0], viewport),
  //             graph = new Rapid.Graph(context, [node]);
  //         expect(action.disabled(graph)).not.to.be.ok;
  //     });
  //     it('returns \'incomplete_relation\' for an incomplete relation', function() {
  //         const relation = new Rapid.OsmRelation(context, {members: [{id: 1}]}),
  //             action = Rapid.actionMove([relation.id], [0, 0], viewport),
  //             graph = new Rapid.Graph(context, [relation]);
  //         expect(action.disabled(graph)).to.equal('incomplete_relation');
  //     });
  //     it('returns falsy for a complete relation', function() {
  //         const node  = new Rapid.OsmNode(context, {loc: [0, 0]}),
  //             relation = new Rapid.OsmRelation(context, {members: [{id: node.id}]}),
  //             action = Rapid.actionMove([relation.id], [0, 0], viewport),
  //             graph = new Rapid.Graph(context, [node, relation]);
  //         expect(action.disabled(graph)).not.to.be.ok;
  //     });
  // });

  const viewport = {
    project:   val => val,
    unproject: val => val
  };

  it('moves all nodes in a way by the given amount', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [5, 10] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const graph = new Rapid.Graph(context, [n1, n2, w1]);

    const delta = [2, 3];
    const result = Rapid.actionMove(['w1'], delta, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('n1').loc, [2, 3]);
    assert.deepEqual(result.entity('n2').loc, [7, 13]);
  });


  it('moves repeated nodes only once', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n1'] });
    const graph = new Rapid.Graph(context, [n1, w1]);

    const delta = [2, 3];
    const result = Rapid.actionMove(['w1'], delta, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('n1').loc, [2, 3]);
  });


  it('moves multiple ways', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1'] });
    const graph = new Rapid.Graph(context, [n1, w1, w2]);

    const delta = [2, 3];
    const result = Rapid.actionMove(['w1', 'w2'], delta, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('n1').loc, [2, 3]);
  });


  it('moves leaf nodes of a relation', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{id: 'w1'}] });
    const graph = new Rapid.Graph(context, [n1, w1, r1]);

    const delta = [2, 3];
    const result = Rapid.actionMove(['r1'], delta, viewport)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('n1').loc, [2, 3]);
  });
});
