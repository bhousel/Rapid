import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

describe('actionAddMidpoint', () => {
  const context = new Rapid.MockContext();

  it('adds the node at the midpoint location', () => {
    const node = new Rapid.OsmNode(context);
    const a = new Rapid.OsmNode(context);
    const b = new Rapid.OsmNode(context);
    const midpoint = {loc: [1, 2], edge: [a.id, b.id]};
    const graph = new Rapid.Graph([a, b]);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity(node.id).loc, [1, 2]);
  });

  it('adds the node to a way that contains the given edge in forward order', () => {
    const node = new Rapid.OsmNode(context);
    const a = new Rapid.OsmNode(context);
    const b = new Rapid.OsmNode(context);
    const w1 = new Rapid.OsmWay(context);
    const w2 = new Rapid.OsmWay(context, {nodes: [a.id, b.id]});
    const midpoint = {loc: [1, 2], edge: [a.id, b.id]};
    const graph = new Rapid.Graph([a, b, w1, w2]);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity(w1.id).nodes, []);
    assert.deepEqual(result.entity(w2.id).nodes, [a.id, node.id, b.id]);
  });

  it('adds the node to a way that contains the given edge in reverse order', () => {
    const node = new Rapid.OsmNode(context);
    const a = new Rapid.OsmNode(context);
    const b = new Rapid.OsmNode(context);
    const w1 = new Rapid.OsmWay(context);
    const w2 = new Rapid.OsmWay(context, {nodes: [b.id, a.id]});
    const midpoint = {loc: [1, 2], edge: [a.id, b.id]};
    const graph = new Rapid.Graph([a, b, w1, w2]);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity(w1.id).nodes, []);
    assert.deepEqual(result.entity(w2.id).nodes, [b.id, node.id, a.id]);
  });

  it('turns an invalid double-back into a self-intersection', () => {
    // a====b (aba)
    // Expected result (converts to a valid loop):
    // a---b (acba)
    //  \ /
    //   c

    const a = new Rapid.OsmNode(context);
    const b = new Rapid.OsmNode(context);
    const c = new Rapid.OsmNode(context);
    const w = new Rapid.OsmWay(context, {nodes: [a.id, b.id, a.id]});
    const midpoint = {loc: [1, 2], edge: [a.id, b.id]};
    const graph = new Rapid.Graph([a, b, w]);
    const result = Rapid.actionAddMidpoint(midpoint, c)(graph);

    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity(w.id).nodes, [a.id, c.id, b.id, a.id]);
  });
});
