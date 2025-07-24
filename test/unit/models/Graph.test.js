import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Graph', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('accepts an entities Array', () => {
      const entity = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph(context, [entity]);
      assert.instanceOf(graph, Rapid.Graph);
      assert.strictEqual(graph.entity(entity.id), entity);
    });

    it('accepts a Graph', () => {
      const entity = new Rapid.OsmNode(context);
      const graph1 = new Rapid.Graph(context, [entity]);
      const graph2 = new Rapid.Graph(graph1);
      assert.strictEqual(graph2.entity(entity.id), entity);
    });

    it('shallow copies other\'s entities', () => {
      const entity = new Rapid.OsmNode(context);
      const graph1 = new Rapid.Graph(context, [entity]);
      const graph2 = new Rapid.Graph(graph1);
      assert.notStrictEqual(graph1.local, graph2.local);
      assert.notStrictEqual(graph1.local.entities, graph2.local.entities);
    });

    it('shares base data among chain of Graphs', () => {
      const graph1 = new Rapid.Graph(context);
      const graph2 = new Rapid.Graph(graph1);
      assert.strictEqual(graph1.base, graph2.base);
    });
  });

  describe('#hasEntity', () => {
    it('returns the entity when present', () => {
      const node = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph(context, [node]);
      assert.strictEqual(graph.hasEntity(node.id), node);
    });

    it('returns undefined when the entity is not present', () => {
      const graph = new Rapid.Graph(context);
      assert.isUndefined(graph.hasEntity('1'));
    });
  });

  describe('#entity', () => {
    it('returns the entity when present', () => {
      const node = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph(context, [node]);
      assert.strictEqual(graph.entity(node.id), node);
    });

    it('throws when the entity is not present', () => {
      assert.throws(() => { Rapid.Graph(context).entity('1'); });
    });
  });

  describe('#rebase', () => {
    it('preserves existing entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph(context, [node]);
      graph.rebase([], [graph]);
      assert.strictEqual(graph.entity('n'), node);
    });

    it('includes new entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph(context);
      graph.rebase([node], [graph]);
      assert.strictEqual(graph.entity('n'), node);
    });

    it('doesn\'t rebase deleted entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n', visible: false });
      const graph = new Rapid.Graph(context);
      graph.rebase([node], [graph]);
      assert.isUndefined(graph.hasEntity('n'));
    });

    it('gives precedence to existing entities', () => {
      const a = new Rapid.OsmNode(context, { id: 'n' });
      const b = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph(context, [a]);
      graph.rebase([b], [graph]);
      assert.strictEqual(graph.entity('n'), a);
    });

    it('gives precedence to new entities when force = true', () => {
      const a = new Rapid.OsmNode(context, { id: 'n' });
      const b = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph(context, [a]);
      graph.rebase([b], [graph], true);
      assert.strictEqual(graph.entity('n'), b);
    });

    it('inherits entities from base', () => {
      const graph = new Rapid.Graph(context);
      graph.rebase([new Rapid.OsmNode(context, { id: 'n' })], [graph]);
      assert.ok(!graph.local.entities.has('n'));
      assert.ok(graph.base.entities.has('n'));
    });

    it('updates parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      graph.rebase([w2], [graph]);

      const parents = graph.parentWays(n);
      assert.instanceOf(parents, Array);
      assert.ok(parents.includes(w1));
      assert.ok(parents.includes(w2));
      assert.ok(!graph.local.parentWays.has('n'));
      assert.ok(graph.base.parentWays.has('n'));
    });

    it('avoids adding duplicate parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      graph.rebase([w1], [graph]);
      assert.deepEqual(graph.parentWays(n), [w1]);
    });

    it('updates parentWays for nodes with modified parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const w3 = new Rapid.OsmWay(context, { id: 'w3', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      const graph2 = graph.replace(w2);
      graph.rebase([w3], [graph, graph2]);

      const parents = graph2.parentWays(n);
      assert.instanceOf(parents, Array);
      assert.sameMembers(parents, [w1, w2, w3]);
    });

    it('avoids re-adding a modified way as a parent way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const w2 = w1.removeNode('n2');
      const graph = new Rapid.Graph(context, [n1, n2, w1]);
      const graph2 = graph.replace(w2);
      graph.rebase([w1], [graph, graph2]);
      assert.deepEqual(graph2.parentWays(n2), []);
    });

    it('avoids re-adding a deleted way as a parent way', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      const graph2 = graph.remove(w1);
      graph.rebase([w1], [graph, graph2]);
      assert.deepEqual(graph2.parentWays(n), []);
    });

    it('re-adds a deleted node that is discovered to have another parent', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      const graph2 = graph.remove(n);
      graph.rebase([n, w2], [graph, graph2]);
      assert.strictEqual(graph2.entity('n'), n);
    });

    it('updates parentRelations', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'n'}] });
      const graph = new Rapid.Graph(context, [n, r1]);
      graph.rebase([r2], [graph]);

      const parents = graph.parentRelations(n);
      assert.instanceOf(parents, Array);
      assert.sameMembers(parents, [r1, r2]);
      assert.ok(!graph.local.parentRels.has('n'));
      assert.ok(graph.base.parentRels.has('n'));
    });

    it('avoids re-adding a modified relation as a parent relation', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const r2 = r1.removeMembersWithID('n');
      const graph = new Rapid.Graph(context, [n, r1]);
      const graph2 = graph.replace(r2);
      graph.rebase([r1], [graph, graph2]);
      assert.deepEqual(graph2.parentRelations(n), []);
    });

    it('avoids re-adding a deleted relation as a parent relation', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const graph = new Rapid.Graph(context, [n, r1]);
      const graph2 = graph.remove(r1);
      graph.rebase([r1], [graph, graph2]);
      assert.deepEqual(graph2.parentRelations(n), []);
    });

    it('updates parentRels for nodes with modified parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'n'}] });
      const r3 = new Rapid.OsmRelation(context, { id: 'r3', members: [{ id: 'n'}] });
      const graph = new Rapid.Graph(context, [n, r1]);
      const graph2 = graph.replace(r2);
      graph.rebase([r3], [graph, graph2]);

      const parents = graph2.parentRelations(n);
      assert.instanceOf(parents, Array);
      assert.sameMembers(parents, [r1, r2, r3]);
    });
  });


  describe('#replace', () => {
    it('is a no-op if the replacement is identical to the existing entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      assert.strictEqual(graph.replace(n1), graph);
    });

    it('returns a the same graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context);
      const result = graph.replace(n1);
      assert.instanceOf(result, Rapid.Graph);
      assert.strictEqual(result, graph);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const v = n1.v;
      const graph = new Rapid.Graph(context);
      graph.replace(n1);
      assert.strictEqual(n1.v, v);
    });

    it('replaces the entity in the result', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      const n1v2 = n1.update({});
      const result = graph.replace(n1v2);
      assert.strictEqual(result.entity('n1'), n1v2);
    });

    it('adds parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const result = graph.replace(w1);
      assert.deepEqual(result.parentWays(n1), [w1]);
    });

    it('removes parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context, [n1, w1]);
      const w1v2 = w1.update({ nodes: [] });
      const result = graph.replace(w1v2);
      assert.deepEqual(result.parentWays(n1), []);
    });

    it('doesn\'t add duplicate parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context, [n1, w1]);
      const result = graph.replace(w1);
      assert.deepEqual(result.parentWays(n1), [w1]);
    });

    it('adds parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const result = graph.replace(r1);
      assert.deepEqual(result.parentRelations(n1), [r1]);
    });

    it('removes parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const graph = new Rapid.Graph(context, [n1, r1]);
      const r1v2 = r1.update({ members: [] });
      const result = graph.replace(r1v2);
      assert.deepEqual(result.parentRelations(n1), []);
    });

    it('doesn\'t add duplicate parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const graph = new Rapid.Graph(context, [n1, r1]);
      const result = graph.replace(r1);
      assert.deepEqual(result.parentRelations(n1), [r1]);
    });
  });


  describe('#remove', () => {
    it('returns the same graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      const result = graph.remove(n1);
      assert.instanceOf(result, Rapid.Graph);
      assert.strictEqual(result, graph);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const v = n1.v;
      const graph = new Rapid.Graph(context, [n1]);
      graph.remove(n1);
      assert.strictEqual(n1.v, v);
    });

    it('removes the entity from the result', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      const result = graph.remove(n1);
      assert.isUndefined(result.hasEntity('n1'));
    });

    it('removes the entity as a parentWay', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context, [n1, w1]);
      const result = graph.remove(w1);
      assert.deepEqual(result.parentWays(n1), []);
    });

    it('removes the entity as a parentRelation', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const graph = new Rapid.Graph(context, [n1, r1]);
      const result = graph.remove(r1);
      assert.deepEqual(result.parentRelations(n1), []);
    });
  });


  describe('#revert', () => {
    it('is a no-op if the head entity is identical to the base entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]);
      assert.strictEqual(graph.revert('n1'), graph);
    });

    it('returns the same graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const graph = new Rapid.Graph(context, [n1]).replace(n1v2).commit();
      const result = graph.revert('n1');
      assert.instanceOf(result, Rapid.Graph);
      assert.strictEqual(result, graph);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const graph = new Rapid.Graph(context, [n1]).replace(n1v2);
      const v1 = n1.v;
      const v2 = n1v2.v;
      graph.revert('n1');
      assert.strictEqual(n1.v, v1);
      assert.strictEqual(n1v2.v, v2);
    });

    it('removes a new entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context).replace(n1);
      const result = graph.revert('n1');
      assert.isUndefined(result.hasEntity('n1'));
    });

    it('reverts an updated entity to the base version', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const graph = new Rapid.Graph(context, [n1]).replace(n1v2);
      const result = graph.revert('n1');
      assert.strictEqual(result.hasEntity('n1'), n1);
    });

    it('restores a deleted entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const graph = new Rapid.Graph(context, [n1]).remove(n1);
      const result = graph.revert('n1');
      assert.strictEqual(result.hasEntity('n1'), n1);
    });

    it('removes new parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context).replace(n1).replace(w1);
      const result = graph.revert('w1');
      assert.isUndefined(result.hasEntity('w1'));
      assert.strictEqual(result.hasEntity('n1'), n1);
      assert.deepEqual(result.parentWays(n1), []);
    });

    it('removes new parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const graph = new Rapid.Graph(context).replace(n1).replace(r1);
      const result = graph.revert('r1');
      assert.isUndefined(result.hasEntity('r1'));
      assert.strictEqual(result.hasEntity('n1'), n1);
      assert.deepEqual(result.parentRelations(n1), []);
    });

    it('reverts updated parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const w1v2 = w1.removeNode('n1');
      const graph = new Rapid.Graph(context, [n1, w1]).replace(w1v2);
      const result = graph.revert('w1');
      assert.strictEqual(result.hasEntity('n1'), n1);
      assert.strictEqual(result.hasEntity('w1'), w1);
      assert.deepEqual(result.parentWays(n1), [w1]);
    });

    it('reverts updated parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const r1v2 = r1.removeMembersWithID('n1');
      const graph = new Rapid.Graph(context, [n1, r1]).replace(r1v2);
      const result = graph.revert('r1');
      assert.strictEqual(result.hasEntity('n1'), n1);
      assert.strictEqual(result.hasEntity('r1'), r1);
      assert.deepEqual(result.parentRelations(n1), [r1]);
    });

    it('restores deleted parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context, [n1, w1]).remove(w1);
      const result = graph.revert('w1');
      assert.strictEqual(result.hasEntity('n1'), n1);
      assert.strictEqual(result.hasEntity('w1'), w1);
      assert.deepEqual(result.parentWays(n1), [w1]);
    });

    it('restores deleted parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const graph = new Rapid.Graph(context, [n1, r1]).remove(r1);
      const result = graph.revert('r1');
      assert.strictEqual(result.hasEntity('n1'), n1);
      assert.strictEqual(result.hasEntity('r1'), r1);
      assert.deepEqual(result.parentRelations(n1), [r1]);
    });
  });

  // describe('#update', () => {
  //   it('returns a new Graph', () => {
  //     const graph = new Rapid.Graph(context);
  //     const result = graph.update();
  //     assert.instanceOf(result, Rapid.Graph);
  //     assert.notStrictEqual(result, graph);
  //   });

  //   it('doesn\'t modify self', () => {
  //     const node = new Rapid.OsmNode(context);
  //     const graph = new Rapid.Graph(context, [node]);
  //     graph.update(function (graph) { graph.remove(node); });
  //     assert.strictEqual(graph.hasEntity(node.id), node);
  //   });

  //   it('executes all of the given functions', () => {
  //     const a = new Rapid.OsmNode(context);
  //     const b = new Rapid.OsmNode(context);
  //     const graph = new Rapid.Graph(context, [a]);
  //     const result = graph.update(
  //       function (graph) { graph.remove(a); },
  //       function (graph) { graph.replace(b); }
  //     );

  //     assert.isUndefined(result.hasEntity(a.id));
  //     assert.strictEqual(result.hasEntity(b.id), b);
  //   });
  // });

  describe('#parentWays', () => {
    it('returns an array of ways that contain the given node id', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context, [n1, n2, w1]);
      assert.deepEqual(graph.parentWays(n1), [w1]);
      assert.deepEqual(graph.parentWays(n2), []);
      assert.deepEqual(graph.parentWays(w1), []);
    });
  });

  describe('#parentRelations', () => {
    it('returns an array of relations that contain the given entity id', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1', role: 'from' }] });
      const graph = new Rapid.Graph(context, [n1, n2, r1]);
      assert.deepEqual(graph.parentRelations(n1), [r1]);
      assert.deepEqual(graph.parentRelations(n2), []);
      assert.deepEqual(graph.parentRelations(r1), []);
    });
  });

  describe('#childNodes', () => {
    it('returns an array of child nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const graph = new Rapid.Graph(context, [n1, n2, w1]);
      assert.deepEqual(graph.childNodes(n1), []);
      assert.deepEqual(graph.childNodes(n2), []);
      assert.deepEqual(graph.childNodes(w1), [n1]);
    });
  });
});
