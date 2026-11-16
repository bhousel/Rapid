import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionAddMidpoint', () => {
  const context = new Rapid.MockContext();

  it('adds the node at the midpoint location', () => {
    const node = new Rapid.OsmNode(context);
    const a = new Rapid.OsmNode(context);
    const b = new Rapid.OsmNode(context);
    const midpoint = {loc: [1, 2], edge: [a.id, b.id]};
    const base = new Rapid.Graph(context, [a, b]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity(node.id).loc, [1, 2]);
  });

  it('adds the node to a way that contains the given edge in forward order', () => {
    const node = new Rapid.OsmNode(context);
    const a = new Rapid.OsmNode(context);
    const b = new Rapid.OsmNode(context);
    const w1 = new Rapid.OsmWay(context);
    const w2 = new Rapid.OsmWay(context, {nodes: [a.id, b.id]});
    const midpoint = {loc: [1, 2], edge: [a.id, b.id]};
    const base = new Rapid.Graph(context, [a, b, w1, w2]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.instanceOf(result, Rapid.Graph);
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
    const base = new Rapid.Graph(context, [a, b, w1, w2]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.instanceOf(result, Rapid.Graph);
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
    const base = new Rapid.Graph(context, [a, b, w]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, c)(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity(w.id).nodes, [a.id, c.id, b.id, a.id]);
  });

  it('adds the node to the piece of the edge it lies on, if the edge was split since', () => {
    // The edge a-b was split at x, so a and b aren't next to each other anymore
    const a = new Rapid.OsmNode(context, { loc: [0, 0] });
    const x = new Rapid.OsmNode(context, { loc: [0, 0.001] });
    const b = new Rapid.OsmNode(context, { loc: [0, 0.002] });
    const node = new Rapid.OsmNode(context);
    const w = new Rapid.OsmWay(context, { nodes: [a.id, x.id, b.id] });
    const midpoint = { loc: [0, 0.0015], edge: [a.id, b.id] };
    const base = new Rapid.Graph(context, [a, x, b, w]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.deepEqual(result.entity(w.id).nodes, [a.id, x.id, node.id, b.id]);
  });

  it('doesn\'t add the node to a way where the edge was split, if another way still has the edge', () => {
    // w1 goes straight from a to b, w2 goes from a to b by way of x
    const a = new Rapid.OsmNode(context, { loc: [0, 0] });
    const x = new Rapid.OsmNode(context, { loc: [0, 0.001] });
    const b = new Rapid.OsmNode(context, { loc: [0, 0.002] });
    const node = new Rapid.OsmNode(context);
    const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id] });
    const w2 = new Rapid.OsmWay(context, { nodes: [a.id, x.id, b.id] });
    const midpoint = { loc: [0, 0.0015], edge: [a.id, b.id] };
    const base = new Rapid.Graph(context, [a, x, b, w1, w2]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.deepEqual(result.entity(w1.id).nodes, [a.id, node.id, b.id]);
    assert.deepEqual(result.entity(w2.id).nodes, [a.id, x.id, b.id]);
  });

  it('doesn\'t add the node to a piece of the split edge that it isn\'t on', () => {
    const a = new Rapid.OsmNode(context, { loc: [0, 0] });
    const x = new Rapid.OsmNode(context, { loc: [0, 0.001] });
    const b = new Rapid.OsmNode(context, { loc: [0, 0.002] });
    const node = new Rapid.OsmNode(context);
    const w = new Rapid.OsmWay(context, { nodes: [a.id, x.id, b.id] });
    const midpoint = { loc: [0.001, 0.0015], edge: [a.id, b.id] };   // about 110 m away
    const base = new Rapid.Graph(context, [a, x, b, w]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddMidpoint(midpoint, node)(graph);

    assert.deepEqual(result.entity(w.id).nodes, [a.id, x.id, b.id]);
  });
});
