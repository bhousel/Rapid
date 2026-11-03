import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Graph', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a Graph from a context', () => {
      const g = new Rapid.Graph(context);
      assert.instanceOf(g, Rapid.Graph);
      assert.strictEqual(g.context, context);
      assert.isTrue(g.isBaseGraph);
      assert.isObject(g.base);
      assert.isObject(g.props);
    });

    it('constructs a Graph from another Graph', () => {
      const entity = new Rapid.OsmNode(context);
      const g1 = new Rapid.Graph(context, [entity]);
      const g2 = new Rapid.Graph(g1);
      assert.strictEqual(g2.context, context);

      assert.isFalse(g2.isBaseGraph);
      assert.strictEqual(g2.base, g1.base);          // shared ===

      assert.strictEqual(g2.hasEntity(entity.id), entity);          // entities are ===

      assert.notStrictEqual(g2.props, g1.props);     // each Graph has its own props
    });

    it('accepts an entities Array', () => {
      const entity = new Rapid.OsmNode(context);
      const g = new Rapid.Graph(context, [entity]);
      assert.instanceOf(g, Rapid.Graph);
      assert.strictEqual(g.context, context);
      assert.strictEqual(g.hasEntity(entity.id), entity);
    });

    it('generates an id string, if unset', () => {
      const g = new Rapid.Graph(context);
      assert.match(g.props.id, /^g-/);
    });
  });

  describe('destroy', () => {
    it('destroys and frees the data', () => {
      const g = new Rapid.Graph(context);
      g.destroy();
      assert.isNull(g.base);
      assert.isNull(g.props);
      assert.isNull(g.context);
    });
  });

  describe('graphID', () => {
    it('gets graphID', () => {
      const g = new Rapid.Graph(context, { id: 'g-10' });
      assert.strictEqual(g.graphID, 'g-10');
      assert.strictEqual(g.id, 'g-10');
    });
  });

  describe('v', () => {
    it('gets 0 if no v', () => {
      const g = new Rapid.Graph(context, { id: 'g-10' });
      assert.strictEqual(g.v, 0);
    });
  });

  describe('key', () => {
    it('gets key as a combination of id and v', () => {
      const g = new Rapid.Graph(context, { id: 'g-10' });
      assert.strictEqual(g.key, `g-10v0`);
    });
  });


  describe('touch', () => {
    it('updates v in place', () => {
      const g = new Rapid.Graph(context);
      const v1 = g.v;
      g.touch();
      assert.isAbove(g.v, v1);
    });
  });


  describe('hasEntity', () => {
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


  describe('entity', () => {
    it('returns the entity when present', () => {
      const node = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph(context, [node]);
      assert.strictEqual(graph.entity(node.id), node);
    });

    it('throws when the entity is not present', () => {
      const graph = new Rapid.Graph(context);
      assert.throws(() => graph.entity('1'), /not found/i);
    });
  });

  describe('parentWays', () => {
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


  describe('parentRelations', () => {
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


  describe('childNodes', () => {
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


  describe('replace', () => {
    it('throws if called on a base graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      assert.throws(() => base.replace(n1), /do not call/i);
    });

    it('is a no-op if the replacement is identical to the existing entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      assert.strictEqual(head.replace(n1), head);
    });

    it('returns the same graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      const result = head.replace(n1);
      assert.strictEqual(result, head);
    });

    it('updates v', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      const v1 = head.v;
      head.replace(n1);
      assert.isAbove(head.v, v1);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const v = n1.v;
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      head.replace(n1);
      assert.strictEqual(n1.v, v);
    });

    it('replaces the entity in the result', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      const n1v2 = n1.update({});
      head.replace(n1v2);
      assert.strictEqual(head.hasEntity('n1'), n1v2);
    });

    it('replaces multiple', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      head.replace([n1, n2]);
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.strictEqual(head.hasEntity('n2'), n2);
    });

    it('adds parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      head.replace(w1);
      assert.deepEqual(head.parentWays(n1), [w1]);
    });

    it('removes parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const base = new Rapid.Graph(context, [n1, w1]);
      const head = new Rapid.Graph(base);
      const w1v2 = w1.update({ nodes: [] });
      head.replace(w1v2);
      assert.deepEqual(head.parentWays(n1), []);
    });

    it('doesn\'t add duplicate parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const base = new Rapid.Graph(context, [n1, w1]);
      const head = new Rapid.Graph(base);
      head.replace(w1);
      assert.deepEqual(head.parentWays(n1), [w1]);
    });

    it('adds parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      head.replace(r1);
      assert.deepEqual(head.parentRelations(n1), [r1]);
    });

    it('removes parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const base = new Rapid.Graph(context, [n1, r1]);
      const head = new Rapid.Graph(base);
      const r1v2 = r1.update({ members: [] });
      head.replace(r1v2);
      assert.deepEqual(head.parentRelations(n1), []);
    });

    it('doesn\'t add duplicate parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const base = new Rapid.Graph(context, [n1, r1]);
      const head = new Rapid.Graph(base);
      head.replace(r1);
      assert.deepEqual(head.parentRelations(n1), [r1]);
    });
  });


  describe('remove', () => {
    it('throws if called on a base graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      assert.throws(() => base.remove(n1), /do not call/i);
    });

    it('returns the same graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      const result = head.remove(n1);
      assert.strictEqual(result, head);
    });

    it('updates v', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      const v1 = head.v;
      head.remove(n1);
      assert.isAbove(head.v, v1);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const v = n1.v;
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      head.remove(n1);
      assert.strictEqual(n1.v, v);
    });

    it('removes the entity from the result', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      head.remove(n1);
      assert.isUndefined(head.hasEntity('n1'));
    });

    it('does not error if entity to be removed is not in the Graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      head.remove(n1);
      assert.isUndefined(head.hasEntity('n1'));
    });

    it('removes multiple', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const base = new Rapid.Graph(context, [n1, n2]);
      const head = new Rapid.Graph(base);
      head.remove([n1, n2]);
      assert.isUndefined(head.hasEntity('n1'));
      assert.isUndefined(head.hasEntity('n2'));
    });

    it('removes the entity as a parentWay', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const base = new Rapid.Graph(context, [n1, w1]);
      const head = new Rapid.Graph(base);
      head.remove(w1);
      assert.deepEqual(head.parentWays(n1), []);
    });

    it('removes the entity as a parentRelation', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const base = new Rapid.Graph(context, [n1, r1]);
      const head = new Rapid.Graph(base);
      head.remove(r1);
      assert.deepEqual(head.parentRelations(n1), []);
    });
  });


  describe('revert', () => {
    it('throws if called on a base graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      assert.throws(() => base.revert('n1'), /do not call/i);
    });

    it('returns the same graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const result = head.revert('n1');
      assert.strictEqual(result, head);
    });

    it('updates v', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const v1 = head.v;
      head.revert('n1');
      assert.isAbove(head.v, v1);
    });

    it('does nothing if the head entity is identical to the base entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      head.revert('n1');
      assert.strictEqual(head.hasEntity('n1'), n1);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const v1 = n1.v;
      const v2 = n1v2.v;
      head.revert('n1');
      assert.strictEqual(n1.v, v1);
      assert.strictEqual(n1v2.v, v2);
    });

    it('removes a new entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(n1);
      head.revert('n1');
      assert.isUndefined(head.hasEntity('n1'));
    });

    it('reverts an updated entity to the base version', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n1v2 = n1.update({});
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n1v2);
      head.revert('n1');
      assert.strictEqual(head.hasEntity('n1'), n1);
    });

    it('reverts multiple', () => {
      const n1v1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2v1 = new Rapid.OsmNode(context, { id: 'n2' });
      const n1v2 = n1v1.update({});
      const n2v2 = n2v1.update({});
      const base = new Rapid.Graph(context, [n1v1, n2v1]);
      const head = new Rapid.Graph(base).replace([n1v2, n2v2]);
      head.revert(['n1', 'n2']);
      assert.strictEqual(head.hasEntity('n1'), n1v1);
      assert.strictEqual(head.hasEntity('n2'), n2v1);
    });

    it('restores a deleted entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).remove(n1);
      head.revert('n1');
      assert.strictEqual(head.hasEntity('n1'), n1);
    });

    it('removes new parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace([n1, w1]);
      head.revert('w1');
      assert.isUndefined(head.hasEntity('w1'));
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.deepEqual(head.parentWays(n1), []);
    });

    it('removes new parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace([n1, r1]);
      head.revert('r1');
      assert.isUndefined(head.hasEntity('r1'));
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.deepEqual(head.parentRelations(n1), []);
    });

    it('reverts updated parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const w1v2 = w1.removeNode('n1');
      const base = new Rapid.Graph(context, [n1, w1]);
      const head = new Rapid.Graph(base).replace(w1v2);
      head.revert('w1');
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.strictEqual(head.hasEntity('w1'), w1);
      assert.deepEqual(head.parentWays(n1), [w1]);
    });

    it('reverts updated parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const r1v2 = r1.removeMembersWithID('n1');
      const base = new Rapid.Graph(context, [n1, r1]);
      const head = new Rapid.Graph(base).replace(r1v2);
      head.revert('r1');
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.strictEqual(head.hasEntity('r1'), r1);
      assert.deepEqual(head.parentRelations(n1), [r1]);
    });

    it('restores deleted parentWays', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const base = new Rapid.Graph(context, [n1, w1]);
      const head = new Rapid.Graph(base).remove(w1);
      head.revert('w1');
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.strictEqual(head.hasEntity('w1'), w1);
      assert.deepEqual(head.parentWays(n1), [w1]);
    });

    it('restores deleted parentRelations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const base = new Rapid.Graph(context, [n1, r1]);
      const head = new Rapid.Graph(base).remove(r1);
      head.revert('r1');
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.strictEqual(head.hasEntity('r1'), r1);
      assert.deepEqual(head.parentRelations(n1), [r1]);
    });
  });


  describe('commit', () => {
    it('returns the same Graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(n1);
      const result = head.commit();
      assert.strictEqual(result, head);
    });

    it('clears the pending writes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(n1);
      assert.isTrue(head.hasPendingChanges);
      head.commit();
      assert.isFalse(head.hasPendingChanges);
    });

    it('recomputes the parent ways of a moved node', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const head = new Rapid.Graph(base).replace(n2.move([2, 0]));
      head.commit();
      assert.deepEqual(head.extent(w1).max, [2, 0]);
      assert.deepEqual(base.extent(w1).max, [1, 0]);   // the base's shape is its own
    });

    it('does not recompute anything for a write of an equal copy', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const head = new Rapid.Graph(base).replace(n2.update({}));
      const geoms = base.geometry(w1);
      head.commit();
      assert.strictEqual(head.geometry(w1), geoms);
    });

    it('recomputes the old and new nodes\' parent ways when a way changes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [5, 5] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, n3, w1]);
      const head = new Rapid.Graph(base).replace(w1.update({ nodes: ['n1', 'n3'] }));
      head.commit();
      assert.deepEqual(head.extent(head.entity('w1')).max, [5, 5]);
    });

    it('builds nested relations members first', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', tags: { type: 'route' }, members: [{ id: 'w1', type: 'way' }] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', tags: { type: 'route_master' }, members: [{ id: 'r2', type: 'relation' }] });
      const base = new Rapid.Graph(context, [n1, n2, w1, r1, r2]);

      // r1 is written first, so it would come first without the members-first order.
      const head = new Rapid.Graph(base);
      head.replace(r1.update({ tags: { type: 'route_master', name: 'A' } }));
      head.replace(n2.move([3, 0]));
      head.commit();
      assert.deepEqual(head.extent(head.entity('r1')).max, [3, 0]);
      assert.deepEqual(head.extent(r2).max, [3, 0]);
    });

    it('builds relations in a membership cycle from their leaf members', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [0, 4] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1', type: 'node' }, { id: 'r2', type: 'relation' }] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'n3', type: 'node' }, { id: 'r1', type: 'relation' }] });
      const base = new Rapid.Graph(context, [n1, n2, n3, r1, r2]);
      const head = new Rapid.Graph(base).replace(n3.move([0, 6]));
      head.commit();
      assert.deepEqual(head.extent(r1).max, [0, 6]);
      assert.deepEqual(head.extent(r2).max, [0, 6]);
    });

    it('builds a relation in a cycle with a multipolygon from the multipolygon\'s new shape', () => {
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [1, 1] });
      const x = new Rapid.OsmNode(context, { id: 'x', loc: [0.5, 0.5] });
      const w = new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b', 'c', 'a'] });
      const r3 = new Rapid.OsmRelation(context, { id: 'r3', tags: { type: 'multipolygon', natural: 'water' },
        members: [{ id: 'w', type: 'way', role: 'outer' }, { id: 'r4', type: 'relation', role: '' }] });
      const r4 = new Rapid.OsmRelation(context, { id: 'r4', tags: { type: 'collection' },
        members: [{ id: 'r3', type: 'relation', role: '' }, { id: 'x', type: 'node', role: '' }] });
      const base = new Rapid.Graph(context, [a, b, c, x, w, r3, r4]);
      const head = new Rapid.Graph(base).replace(c.move([5, 5]));
      head.commit();
      assert.deepEqual(head.extent(r3).max, [5, 5]);
      assert.deepEqual(head.extent(r4).max, [5, 5]);
    });
  });


  describe('records', () => {
    it('keeps base\'s order of parent ways when a graph edits one of them', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1'] });
      const base = new Rapid.Graph(context, [n1, w1, w2]);
      const head = new Rapid.Graph(base).replace(w1.update({ tags: { highway: 'path' } }));
      assert.deepEqual(head.parentWays(n1).map(way => way.id), ['w1', 'w2']);
      assert.strictEqual(head.parentWays(n1)[0], head.entity('w1'));
    });

    it('lists a parent way only while the graph\'s version contains the child', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const head = new Rapid.Graph(base).replace(w1.update({ nodes: ['n2'] }));
      assert.deepEqual(head.parentWays(n1), []);
      assert.deepEqual(head.parentWays(n2).map(way => way.id), ['w1']);
      assert.deepEqual(base.parentWays(n1).map(way => way.id), ['w1']);
    });

    it('clears a record that says nothing different from base', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n1.update({ tags: { a: 'b' } }));
      head.revert('n1');
      assert.isFalse(head.isLocal('n1'));
      assert.strictEqual(head.diffIDs(base).size, 0);
      assert.strictEqual(head.localEntities().size, 0);
    });

    it('lists its own versions, and what differs from another graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const base = new Rapid.Graph(context, [n1, n2]);
      const g1 = new Rapid.Graph(base).remove(n1);
      const g2 = new Rapid.Graph(g1).replace(n2.update({ tags: { a: 'b' } }));

      assert.deepEqual([...g2.localEntities()], [['n1', undefined], ['n2', g2.entity('n2')]]);
      assert.sameMembers([...g2.diffIDs(g1)], ['n2']);
      assert.sameMembers([...g2.diffIDs(base)], ['n1', 'n2']);
      assert.sameMembers([...g2.diffIDs(null)], ['n1', 'n2']);

      const other = new Rapid.Graph(new Rapid.Graph(context, [n1, n2])).remove(n2);   // another lineage
      assert.sameMembers([...g2.diffIDs(other)], ['n1', 'n2']);
    });

    it('gives its own copy that equals the base\'s the base\'s shape', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const copy = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });   // equal by value, so no change
      const head = new Rapid.Graph(base).load({ w1: copy });
      assert.strictEqual(head.entity('w1'), copy);
      assert.deepEqual(head.extent(copy).rectangle(), [0, 0, 1, 1]);
    });
  });


  describe('journal', () => {
    it('lists the IDs written since the graph was derived', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const base = new Rapid.Graph(context, [n1]);
      const g1 = new Rapid.Graph(base).replace(n2);
      g1.commit();
      g1.remove(n1);
      assert.sameMembers([...g1.changedIDs], ['n1', 'n2']);

      const g2 = new Rapid.Graph(g1);
      assert.strictEqual(g2.changedIDs.size, 0);
    });

    it('carries uncommitted writes into a derived graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const g1 = new Rapid.Graph(base).replace(n2.move([2, 0]));
      const g2 = new Rapid.Graph(g1);
      assert.isTrue(g2.hasPendingChanges);
      g2.commit();
      assert.deepEqual(g2.extent(w1).max, [2, 0]);
    });
  });


  describe('freeze', () => {
    it('makes replace, remove, revert and load throw', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      head.freeze();
      assert.isTrue(head.isFrozen);
      assert.throws(() => head.replace(n1.update({ tags: { a: 'b' } })), /frozen/);
      assert.throws(() => head.remove(n1), /frozen/);
      assert.throws(() => head.revert('n1'), /frozen/);
      assert.throws(() => head.load({ n1: n1 }), /frozen/);
    });

    it('commits uncommitted writes first', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(n1);
      head.freeze();
      assert.isFalse(head.hasPendingChanges);
    });

    it('still accepts an iD#2085 restore from a rebase', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).remove(n1);
      head.freeze();

      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const { restored } = base.rebase([n2, w1], [head]);
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.sameMembers([...restored.get(head)], ['n1']);
    });
  });


  describe('savepoint', () => {
    it('rolls back entities, parent ways and geometry', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [9, 9] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const base = new Rapid.Graph(context, [n1, n2, n3, w1]);
      const head = new Rapid.Graph(base);

      head.beginSavepoint();
      head.replace(head.entity('w1').addNode('n3'));
      head.commit();
      head.remove(head.entity('n1'));
      head.rollbackToSavepoint();
      head.endSavepoint();

      assert.strictEqual(head.hasEntity('w1'), w1);
      assert.strictEqual(head.hasEntity('n1'), n1);
      assert.isFalse(head.isLocal('w1'));
      assert.isFalse(head.isLocal('n1'));
      assert.deepEqual(head.parentWays(n3), []);
      assert.deepEqual(head.extent(w1).max, [1, 0]);
      assert.isFalse(head.hasPendingChanges);
    });

    it('rolls back an entity created and removed again inside the savepoint', () => {
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      head.beginSavepoint();
      head.replace(n1).remove(n1);
      head.rollbackToSavepoint();
      head.endSavepoint();
      assert.isUndefined(head.hasEntity('n1'));
      assert.isFalse(head.isLocal('n1'));
    });

    it('throws if begun with uncommitted writes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(n1);
      assert.throws(() => head.beginSavepoint(), /uncommitted/);
    });
  });


  describe('load', () => {
    it('throws if called on a base graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      assert.throws(() => base.load({ n1: n1 }), /do not call/i);
    });

    it('returns the same graph', () => {
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      const result = head.load();
      assert.strictEqual(result, head);
    });

    it('updates v', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      const v1 = head.v;
      head.load({ n1: n1 });
      assert.isAbove(head.v, v1);
    });

    it('doesn\'t modify the entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const v = n1.v;
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base);
      head.load({ n1: n1 });
      assert.strictEqual(n1.v, v);
    });

    it('replaces the entity in the local graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      const n1v2 = n1.update({});
      head.load({ n1: n1v2 });
      assert.strictEqual(head.hasEntity('n1'), n1v2);
    });

    it('removes the entity from the local graph', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base);
      head.load({ n1: undefined });
      assert.isUndefined(head.hasEntity('n1'));
    });

    it('replaces/removes multiple', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const n2v2 = n2.update({});
      const n3 = new Rapid.OsmNode(context, { id: 'n3' });
      const base = new Rapid.Graph(context, [n2, n3]);
      const head = new Rapid.Graph(base);
      const entities = { n1: n1, n2: n2v2, n3: undefined };
      head.load(entities);
      assert.strictEqual(head.hasEntity('n1'), n1);    // added
      assert.strictEqual(head.hasEntity('n2'), n2v2);  // updated
      assert.isUndefined(head.hasEntity('n3'));        // deleted
    });
  });


  describe('rebase', () => {
    it('clears the memoized answers of nodes that a downloaded way passes through', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const base = new Rapid.Graph(context, [n1, n2]);
      assert.strictEqual(n1.geometry(base), 'point');

      base.rebase([new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] })], [base]);
      assert.strictEqual(n1.geometry(base), 'vertex');
    });

    it('answers for each graph about a downloaded way through a node a graph moved', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const base = new Rapid.Graph(context, [n1, n2]);
      const head = new Rapid.Graph(base).replace(n1.move([0, 5]));
      head.commit();

      base.rebase([new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] })], [head]);
      const w1 = base.entity('w1');
      assert.deepEqual(w1.asGeoJSON(base).geometry.coordinates, [[0, 0], [1, 0]]);
      assert.deepEqual(w1.asGeoJSON(head).geometry.coordinates, [[0, 5], [1, 0]]);
    });

    it('clears the memoized answers of the nodes a forced update takes out of a way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], version: 1 });
      const base = new Rapid.Graph(context, [n1, n2, n3, w1]);
      assert.strictEqual(n3.geometry(base), 'vertex');

      base.rebase([new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], version: 2 })], [base], true);
      assert.strictEqual(n3.geometry(base), 'point');
    });

    it('preserves existing entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context, [node]);
      base.rebase([]);
      assert.strictEqual(base.hasEntity('n'), node);
    });

    it('includes new entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context);
      base.rebase([node]);
      assert.strictEqual(base.hasEntity('n'), node);
    });

    it('doesn\'t rebase deleted entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n', visible: false });
      const graph = new Rapid.Graph(context);
      graph.rebase([node]);
      assert.isUndefined(graph.hasEntity('n'));
    });

    it('gives precedence to existing entities', () => {
      const a = new Rapid.OsmNode(context, { id: 'n' });
      const b = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph(context, [a]);
      graph.rebase([b]);
      assert.strictEqual(graph.hasEntity('n'), a);
    });

    it('gives precedence to new entities when force = true', () => {
      const a = new Rapid.OsmNode(context, { id: 'n' });
      const b = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph(context, [a]);
      graph.rebase([b], [], true);
      assert.strictEqual(graph.hasEntity('n'), b);
    });

    it('inherits entities from base', () => {
      const graph = new Rapid.Graph(context);
      graph.rebase([new Rapid.OsmNode(context, { id: 'n' })]);
      assert.ok(!graph.isLocal('n'));
      assert.ok(graph.base.entities.has('n'));
    });

    it('updates parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      graph.rebase([w2]);

      const parents = graph.parentWays(n);
      assert.instanceOf(parents, Array);
      assert.ok(parents.includes(w1));
      assert.ok(parents.includes(w2));
      assert.ok(graph.base.parentWays.has('n'));
    });

    it('avoids adding duplicate parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [n, w1]);
      graph.rebase([w1]);
      assert.deepEqual(graph.parentWays(n), [w1]);
    });

    it('updates parentWays for nodes with modified parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const w3 = new Rapid.OsmWay(context, { id: 'w3', nodes: ['n'] });
      const base = new Rapid.Graph(context, [n, w1]);
      const head = new Rapid.Graph(base).replace(w2);
      base.rebase([w3], [base, head]);

      const parents = head.parentWays(n);
      assert.instanceOf(parents, Array);
      assert.sameMembers(parents, [w1, w2, w3]);
    });

    it('avoids re-adding a modified way as a parent way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const w2 = w1.removeNode('n2');
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const head = new Rapid.Graph(base).replace(w2);
      base.rebase([w1], [base, head]);
      assert.deepEqual(head.parentWays(n2), []);
    });

    it('avoids re-adding a deleted way as a parent way', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const base = new Rapid.Graph(context, [n, w1]);
      const head = new Rapid.Graph(base).remove(w1);
      base.rebase([w1], [base, head]);
      assert.deepEqual(head.parentWays(n), []);
    });

    it('re-adds a deleted node that is discovered to have another parent', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const base = new Rapid.Graph(context, [n, w1]);
      const head = new Rapid.Graph(base).remove(n);
      base.rebase([n, w2], [base, head]);
      assert.strictEqual(head.entity('n'), n);
    });

    it('re-adds a deleted node in every graph that deleted it, not only the last of the stack', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n'] });
      const base = new Rapid.Graph(context, [n, w1]);
      const deleted = new Rapid.Graph(base).remove(n);   // e.g. an edit the user undid
      deleted.freeze();
      const head = new Rapid.Graph(base);                // didn't delete it
      const { restored } = base.rebase([w2], [deleted, head]);
      assert.strictEqual(deleted.entity('n'), n);
      assert.sameMembers([...restored.keys()], [deleted]);
      assert.deepEqual(deleted.verify(), []);
    });

    it('doesn\'t re-add the nodes of a way that was deleted along with them', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n'] });
      const w1v2 = w1.update({ version: 2 });
      const base = new Rapid.Graph(context, [n, w1]);
      const head = new Rapid.Graph(base).remove([w1, n]);
      base.rebase([w1v2], [base, head], true);   // a newer copy of the deleted way
      assert.isUndefined(head.hasEntity('n'));
      assert.isUndefined(head.hasEntity('w1'));
      assert.strictEqual(base.entity('w1'), w1v2);
    });

    it('updates parentWays when force replaces a way with fewer nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const w1v2 = w1.removeNode('n2');
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      base.rebase([w1v2], [], true);
      assert.deepEqual(base.parentWays(n1), [w1v2]);
      assert.deepEqual(base.parentWays(n2), []);
    });

    it('updates parentRelations', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'n'}] });
      const graph = new Rapid.Graph(context, [n, r1]);
      graph.rebase([r2]);

      const parents = graph.parentRelations(n);
      assert.instanceOf(parents, Array);
      assert.sameMembers(parents, [r1, r2]);
      assert.ok(graph.base.parentRels.has('n'));
    });

    it('avoids re-adding a modified relation as a parent relation', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const r2 = r1.removeMembersWithID('n');
      const base = new Rapid.Graph(context, [n, r1]);
      const head = new Rapid.Graph(base).replace(r2);
      base.rebase([r1], [base, head]);
      assert.deepEqual(head.parentRelations(n), []);
    });

    it('avoids re-adding a deleted relation as a parent relation', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const base = new Rapid.Graph(context, [n, r1]);
      const head = new Rapid.Graph(base).remove(r1);
      base.rebase([r1], [base, head]);
      assert.deepEqual(head.parentRelations(n), []);
    });

    it('updates parentRels for nodes with modified parentWays', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n'}] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'n'}] });
      const r3 = new Rapid.OsmRelation(context, { id: 'r3', members: [{ id: 'n'}] });
      const base = new Rapid.Graph(context, [n, r1]);
      const head = new Rapid.Graph(base).replace(r2);
      base.rebase([r3], [base, head]);

      const parents = head.parentRelations(n);
      assert.instanceOf(parents, Array);
      assert.sameMembers(parents, [r1, r2, r3]);
    });
  });
});
