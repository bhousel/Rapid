import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe.skip('Tree', () => {
  const context = new Rapid.MockContext();

  describe('rebase', () => {
    it('adds entities to the tree', () => {
      const graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });

      graph.rebase([n1], [graph]);
      tree.rebase([n1]);

      const result = tree.intersects(new Rapid.sdk.Extent([0, 0], [2, 2]), graph);
      assert.deepEqual(result, [n1]);
    });

    it('is idempotent', () => {
      const graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph.rebase([n1], [graph]);
      tree.rebase([n1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1]);

      graph.rebase([n1], [graph]);
      tree.rebase([n1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1]);
    });

    it('does not insert if entity has a modified version', () => {
      const base = new Rapid.Graph(context);
      const tree = new Rapid.Tree(base, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const n1v1 = n1.update({ loc: [10, 10] });
      const head = base.replace(n1v1);

      // n1v1 is now moved to [10,10]
      assert.deepEqual(tree.intersects(new Rapid.sdk.Extent([9, 9], [11, 11]), head), [n1v1]);

      // older version should not replace newer version
      base.rebase([n1], [base]);
      tree.rebase([base]);

      // n1v1 remains at [10,10]
      assert.deepEqual(tree.intersects(new Rapid.sdk.Extent([0, 0], [2, 2]), head), []);
      assert.deepEqual(tree.intersects(new Rapid.sdk.Extent([0, 0], [11, 11]), head), [n1v1]);
    });

    it('does not error on self-referencing relations', () => {
      const graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      let r1 = new Rapid.OsmRelation(context, { id: 'r1' });

      r1 = r1.addMember({ id: 'n1' });
      r1 = r1.addMember({ id: 'r1' });  // self reference

      graph.rebase([n1, r1], [graph]);
      tree.rebase([r1]);

      assert.deepEqual(tree.intersects(new Rapid.sdk.Extent([0, 0], [2, 2]), graph), [r1]);
    });

    it('adjusts entities that are force-rebased', () => {
      const graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      let n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });

      graph.rebase([n1], [graph]);
      tree.rebase([n1]);

      n1 = n1.move([-1, -1]);
      graph.rebase([n1], [graph], true);
      tree.rebase([n1], true);

      assert.deepEqual(tree.intersects(new Rapid.sdk.Extent([0, 0], [2, 2]), graph), []);
    });
  });


  describe('intersects', () => {
    it('includes entities within extent, excludes those without', () => {
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [3, 3] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph = graph.replace([n1, n2]);
      assert.deepEqual(tree.intersects(extent, graph), [n1]);
    });

    it('includes intersecting relations after incomplete members are loaded', () => {
      const graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{id: 'n1'}, {id: 'n2'}] });
      const extent = new Rapid.sdk.Extent([0.5, 0.5], [1.5, 1.5]);

      graph.rebase([n1, r1], [graph]);
      tree.rebase([n1, r1]);
      assert.deepEqual(tree.intersects(extent, graph), []);

      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 1] });
      graph.rebase([n2], [graph]);
      tree.rebase([n2]);
      assert.deepEqual(tree.intersects(extent, graph), [n2, r1]);
    });

    // This happens when local storage includes a changed way but not its nodes.
    it('includes intersecting ways after missing nodes are loaded', () => {
      const base = new Rapid.Graph(context);
      const tree = new Rapid.Tree(base, 'test');
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = base.replace(w1);
      const extent = new Rapid.sdk.Extent([0, 0], [1, 1]);

      assert.deepEqual(tree.intersects(extent, graph), []);

      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0.5, 0.5] });
      base.rebase([n1], [base, graph]);
      tree.rebase([n1], true);  // force will ensure that includeParents updates the parentway too
      assert.deepEqual(tree.intersects(extent, graph), [n1, w1]);
    });

    it('adjusts parent ways when a member node is moved', () => {
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph = graph.replace([n1, w1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1, w1]);

      graph = graph.replace(n1.move([3, 3]));
      assert.deepEqual(tree.intersects(extent, graph), []);
    });

    it('adjusts parent relations when a member node is moved', () => {
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ type: 'node', id: 'n1' }] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph = graph.replace([n1, r1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1, r1]);

      graph = graph.replace(n1.move([3, 3]));
      assert.deepEqual(tree.intersects(extent, graph), []);
    });

    it('adjusts parent relations of parent ways when a member node is moved', () => {
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w', nodes: ['n1'] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ type: 'multipolygon', id: 'w1' }] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph = graph.replace([n1, w1, r1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1, w1, r1]);

      graph = graph.replace(n1.move([3, 3]));
      assert.deepEqual(tree.intersects(extent, graph), []);
    });

    it('adjusts parent ways when a member node is removed', () => {
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [3, 3] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph = graph.replace([n1, n2, w1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1, w1]);

      graph = graph.replace(w1.removeNode('n1'));
      assert.deepEqual(tree.intersects(extent, graph), [n1]);
    });

    it('don\'t include parent way multiple times when multiple child nodes are moved', () => {
      // checks against the following regression: https://github.com/openstreetmap/iD/issues/1978
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [3, 3] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const extent = new Rapid.sdk.Extent([0, 0], [4, 4]);

      graph = graph.replace([n1, n2, w1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1, n2, w1]);

      graph = graph.replace(n1.move([1.1, 1.1])).replace(n2.move([2.1, 2.1]));
      const intersects = tree.intersects(extent, graph).map(e => e.id);
      assert.ok(intersects.includes('n1'));
      assert.ok(intersects.includes('n2'));
      assert.ok(intersects.includes('w1'));
    });

    it('doesn\'t include removed entities', () => {
      let graph = new Rapid.Graph(context);
      const tree = new Rapid.Tree(graph, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      graph = graph.replace(n1);
      assert.deepEqual(tree.intersects(extent, graph), [n1]);

      graph = graph.remove(n1);
      assert.deepEqual(tree.intersects(extent, graph), []);
    });

    it('doesn\'t include removed entities after rebase', () => {
      const base = new Rapid.Graph(context);
      const tree = new Rapid.Tree(base, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      const graph = base.replace(n1).remove(n1);
      assert.deepEqual(tree.intersects(extent, graph), []);

      base.rebase([n1], [base]);
      tree.rebase([n1]);
      assert.deepEqual(tree.intersects(extent, graph), []);
    });

    it('handles recursive relations', () => {
      const base = new Rapid.Graph(context);
      const tree = new Rapid.Tree(base, 'test');
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{id: 'n1'}] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{id: 'r1'}] });
      const extent = new Rapid.sdk.Extent([0, 0], [2, 2]);

      const graph = base.replace(r1).replace(r2);
      assert.deepEqual(tree.intersects(extent, graph), []);

      base.rebase([n1], [base, graph]);
      tree.rebase([n1]);
      assert.deepEqual(tree.intersects(extent, graph), [n1, r1, r2]);
    });
  });
});
