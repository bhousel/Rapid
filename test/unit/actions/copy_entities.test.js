import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionCopyEntities', () => {
  const context = new Rapid.MockContext();

  it('copies a node', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const base = new Rapid.Graph(context, [n1]);
    const graph = new Rapid.Graph(base);

    const result = Rapid.actionCopyEntities(['n1'], graph)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('n1'));

    const diff = new Rapid.Difference(base, result);
    const created = diff.created();
    assert.strictEqual(created.length, 1);
  });


  it('copies a way', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const n2 = new Rapid.OsmNode(context, {id: 'n2'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1', 'n2']});
    const base = new Rapid.Graph(context, [n1, n2, w1]);
    const graph = new Rapid.Graph(base);

    const result = Rapid.actionCopyEntities(['w1'], graph)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('w1'));

    const diff = new Rapid.Difference(base, result);
    const created = diff.created();
    assert.strictEqual(created.length, 3);
  });


  it('copies multiple nodes', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'n1'}),
      new Rapid.OsmNode(context, {id: 'n2'})
    ]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionCopyEntities(['n1', 'n2'], graph)(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('n1'));
    assert.isOk(result.hasEntity('n2'));

    const diff = new Rapid.Difference(base, result);
    const created = diff.created();
    assert.strictEqual(created.length, 2);
  });


  it('copies multiple ways, keeping the same connections', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'n1'}),
      new Rapid.OsmNode(context, {id: 'n2'}),
      new Rapid.OsmNode(context, {id: 'n3'}),
      new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1', 'n2']}),
      new Rapid.OsmWay(context, {id: 'w2', nodes: ['n2', 'n3']})
    ]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionCopyEntities(['w1', 'w2'], graph);
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);

    const diff = new Rapid.Difference(base, result);
    const created = diff.created();
    assert.strictEqual(created.length, 5);

    // "copies" is a map of oldID -> newEntity
    // The new entities will not have the same ids, but the copy of 'n2'
    // should appear in the same spot in the nodelists of the new ways.
    const copies = action.copies();
    assert.isObject(copies);
    assert.deepEqual(copies.w1.nodes[1], copies.w2.nodes[0]);
  });


  it('obtains source entities from an alternate graph', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const other = new Rapid.Graph(context, [n1]);
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionCopyEntities(['n1'], other);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('n1'));

    const copies = action.copies();
    assert.isObject(copies);
    assert.strictEqual(Object.keys(copies).length, 1);
  });
});
