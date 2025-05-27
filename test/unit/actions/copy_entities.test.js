import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionCopyEntities', () => {
  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();

  it('copies a node', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const base = new Rapid.Graph([n1]);

    const head = Rapid.actionCopyEntities(['n1'], base)(base);
    assert.ok(head instanceof Rapid.Graph);
    assert.ok(head.hasEntity('n1'));

    const diff = new Rapid.Difference(base, head);
    const created = diff.created();
    assert.equal(created.length, 1);
  });


  it('copies a way', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const n2 = new Rapid.OsmNode(context, {id: 'n2'});
    const w1 = new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1', 'n2']});
    const base = new Rapid.Graph([n1, n2, w1]);

    const head = Rapid.actionCopyEntities(['w1'], base)(base);
    assert.ok(head instanceof Rapid.Graph);
    assert.ok(head.hasEntity('w1'));

    const diff = new Rapid.Difference(base, head);
    const created = diff.created();
    assert.equal(created.length, 3);
  });


  it('copies multiple nodes', () => {
    const base = new Rapid.Graph([
      new Rapid.OsmNode(context, {id: 'n1'}),
      new Rapid.OsmNode(context, {id: 'n2'})
    ]);
    const head = Rapid.actionCopyEntities(['n1', 'n2'], base)(base);
    assert.ok(head instanceof Rapid.Graph);
    assert.ok(head.hasEntity('n1'));
    assert.ok(head.hasEntity('n2'));

    const diff = new Rapid.Difference(base, head);
    const created = diff.created();
    assert.equal(created.length, 2);
  });


  it('copies multiple ways, keeping the same connections', () => {
    const base = new Rapid.Graph([
      new Rapid.OsmNode(context, {id: 'n1'}),
      new Rapid.OsmNode(context, {id: 'n2'}),
      new Rapid.OsmNode(context, {id: 'n3'}),
      new Rapid.OsmWay(context, {id: 'w1', nodes: ['n1', 'n2']}),
      new Rapid.OsmWay(context, {id: 'w2', nodes: ['n2', 'n3']})
    ]);
    const action = Rapid.actionCopyEntities(['w1', 'w2'], base);
    const head = action(base);
    assert.ok(head instanceof Rapid.Graph);

    const diff = new Rapid.Difference(base, head);
    const created = diff.created();
    assert.equal(created.length, 5);

    // "copies" is a map of oldID -> newEntity
    // The new entities will not have the same ids, but the copy of 'n2'
    // should appear in the same spot in the nodelists of the new ways.
    const copies = action.copies();
    assert.ok(copies instanceof Object);
    assert.deepEqual(copies.w1.nodes[1], copies.w2.nodes[0]);
  });


  it('obtains source entities from an alternate graph', () => {
    const n1 = new Rapid.OsmNode(context, {id: 'n1'});
    const old = new Rapid.Graph([n1]);
    const base = new Rapid.Graph();
    const action = Rapid.actionCopyEntities(['n1'], old);
    const head = action(base);

    assert.ok(head instanceof Rapid.Graph);
    assert.ok(!head.hasEntity('n1'));

    const copies = action.copies();
    assert.ok(copies instanceof Object);
    assert.equal(Object.keys(copies).length, 1);
  });
});
