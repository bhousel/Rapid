import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionMoveNode', () => {
  it('changes a node\'s location', () => {
    const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
    const toLoc = [2, 3];
    const graph = new Rapid.Graph([n1]);

    const result = Rapid.actionMoveNode('n1', toLoc)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity('n1').loc, toLoc);
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.equal(Rapid.actionMoveNode().transitionable, true);
    });


    it('move node at t = 0', () => {
      const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
      const toLoc = [2, 3];
      const graph = new Rapid.Graph([n1]);

      const result = Rapid.actionMoveNode('n1', toLoc)(graph, 0);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(result.entity('n1').loc, [0, 0]);
    });


    it('move node at t = 0.5', () => {
      const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
      const toLoc = [2, 3];
      const graph = new Rapid.Graph([n1]);

      const result = Rapid.actionMoveNode('n1', toLoc)(graph, 0.5);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(result.entity('n1').loc, [1, 1.5]);
    });


    it('move node at t = 1', () => {
      const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
      const toLoc = [2, 3];
      const graph = new Rapid.Graph([n1]);

      const result = Rapid.actionMoveNode('n1', toLoc)(graph, 1);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(result.entity('n1').loc, [2, 3]);
    });
  });
});
