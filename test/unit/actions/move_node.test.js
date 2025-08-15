import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionMoveNode', () => {
  const context = new Rapid.MockContext();

  it('changes a node\'s location', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const toLoc = [2, 3];
    const base = new Rapid.Graph(context, [n1]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionMoveNode('n1', toLoc)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('n1').loc, toLoc);
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionMoveNode().transitionable);
    });

    it('move node at t = 0', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const toLoc = [2, 3];
      const base = new Rapid.Graph(context, [n1]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionMoveNode('n1', toLoc)(graph, 0);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('n1').loc, [0, 0]);
    });

    it('move node at t = 0.5', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const toLoc = [2, 3];
      const base = new Rapid.Graph(context, [n1]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionMoveNode('n1', toLoc)(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('n1').loc, [1, 1.5]);
    });

    it('move node at t = 1', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const toLoc = [2, 3];
      const base = new Rapid.Graph(context, [n1]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionMoveNode('n1', toLoc)(graph, 1);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('n1').loc, [2, 3]);
    });
  });
});
