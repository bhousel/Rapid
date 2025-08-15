import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionRevert', () => {
  const context = new Rapid.MockContext();

  describe('basic', () => {
    it('removes a new entity', () => {
      const base = new Rapid.Graph(context);
      const n1 = new Rapid.OsmNode(context, { id: 'n-1' });
      const graph = new Rapid.Graph(base).replace(n1);
      const result = Rapid.actionRevert('n-1')(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.isUndefined(result.hasEntity('n-1'));
    });

    it('reverts an updated entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const n1v2 = n1.update({});
      const graph = new Rapid.Graph(base).replace(n1v2);
      const result = Rapid.actionRevert('n1')(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.strictEqual(result.hasEntity('n1'), n1);
    });

    it('restores a deleted entity', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const graph = new Rapid.Graph(base).remove(n1);
      const result = Rapid.actionRevert('n1')(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.strictEqual(result.hasEntity('n1'), n1);
    });
  });


  describe('reverting way child nodes', () => {
    it('removes new node, updates parent way nodelist', () => {
      // note: test with a 3 node way so w1 doesn't go degenerate..
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const n3 = new Rapid.OsmNode(context, { id: 'n-3' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const w1v2 = w1.addNode('n-3', 2);
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const graph = new Rapid.Graph(base).replace([n3, w1v2]);

      const result = Rapid.actionRevert('n-3')(graph);
      assert.instanceOf(result, Rapid.Graph);

      const w1_1 = result.hasEntity('w1');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n2'), n2, 'n2 unchanged');
      assert.strictEqual(result.hasEntity('n-3'), undefined, 'n-3 removed');
      assert.deepEqual(result.parentWays(n1), [w1_1], 'n1 has w1 as parent way');
      assert.deepEqual(result.parentWays(n2), [w1_1], 'n2 has w1 as parent way');
      assert.deepEqual(w1_1.nodes, w1.nodes, 'w1 nodes updated');
    });

    it('reverts existing node, preserves parent way nodelist', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const n1v2 = n1.update({});
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const graph = new Rapid.Graph(base).replace(n1v2);

      const result = Rapid.actionRevert('n1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      const w1_1 = result.hasEntity('w1');
      assert.equal(result.hasEntity('n1'), n1, 'n1 reverted');
      assert.equal(result.hasEntity('n2'), n2, 'n2 unchanged');
      assert.deepEqual(result.parentWays(n1), [w1_1], 'n1 has w1 as parent way');
      assert.deepEqual(result.parentWays(n2), [w1_1], 'n2 has w1 as parent way');
      assert.deepEqual(w1_1.nodes, w1.nodes, 'w1 nodes preserved');
    });
  });


  describe('reverting relation members', () => {
    it('removes new node, updates parent relation memberlist', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const r1v2 = r1.addMember({ id: 'n-2' }, 1);
      const base = new Rapid.Graph(context, [n1, r1]);
      const graph = new Rapid.Graph(base).replace([n2, r1v2]);

      const result = Rapid.actionRevert('n-2')(graph);
      assert.instanceOf(result, Rapid.Graph);

      const r1_1 = result.hasEntity('r1');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.isUndefined(result.hasEntity('n-2'), 'n-2 removed');
      assert.deepEqual(result.parentRelations(n1), [r1_1], 'n1 has r1 as parent relation');
      assert.deepEqual(r1_1.members, r1.members, 'r1 members updated');
    });

    it('reverts existing node, preserves parent relation memberlist', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }, { id: 'n2' }] });
      const n1v2 = n1.update({});
      const base = new Rapid.Graph(context, [n1, n2, r1]);
      const graph = new Rapid.Graph(base).replace(n1v2);

      const result = Rapid.actionRevert('n1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      const r1_1 = result.hasEntity('r1');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 reverted');
      assert.strictEqual(result.hasEntity('n2'), n2, 'n2 unchanged');
      assert.deepEqual(result.parentRelations(n1), [r1_1], 'n1 has r1 as parent relation');
      assert.deepEqual(result.parentRelations(n2), [r1_1], 'n2 has r1 as parent relation');
      assert.deepEqual(r1_1.members, r1.members, 'r1 members preserved');
    });
  });


  describe('reverting parent ways', () => {
    it('removes new way, preserves new and existing child nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n1', 'n-2'] });
      const base = new Rapid.Graph(context, [n1]);
      const graph = new Rapid.Graph(base).replace([n2, w1]);

      const result = Rapid.actionRevert('w-1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      assert.isUndefined(result.hasEntity('w-1'), 'w-1 removed');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n-2'), n2, 'n-2 unchanged');
      assert.deepEqual(result.parentWays(n1), [], 'n1 has no parent ways');
      assert.deepEqual(result.parentWays(n2), [], 'n-2 has no parent ways');
    });

    it('reverts an updated way, preserves new and existing child nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const w1v2 = w1.addNode('n-2', 1);
      const base = new Rapid.Graph(context, [n1, w1]);
      const graph = new Rapid.Graph(base).replace([n2, w1v2]);

      const result = Rapid.actionRevert('w1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      assert.strictEqual(result.hasEntity('w1'), w1, 'w1 reverted');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n-2'), n2, 'n-2 unchanged');
      assert.deepEqual(result.parentWays(n1), [w1], 'n1 has w1 as parent way');
      assert.deepEqual(result.parentWays(n2), [], 'n2 has no parent ways');
    });

    it('restores a deleted way, preserves new and existing child nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const w1v2 = w1.addNode('n-2', 1);
      const base = new Rapid.Graph(context, [n1, w1]);
      const graph = new Rapid.Graph(base).replace([n2, w1v2]).remove(w1v2);

      const result = Rapid.actionRevert('w1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      assert.strictEqual(result.hasEntity('w1'), w1, 'w1 restored');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n-2'), n2, 'n-2 unchanged');
      assert.deepEqual(result.parentWays(n1), [w1], 'n1 has w1 as parent way');
      assert.deepEqual(result.parentWays(n2), [], 'n2 has no parent ways');
    });
  });


  describe('reverting parent relations', () => {
    it('removes new relation, preserves new and existing members', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r-1', members: [{ id: 'n1' }, { id: 'n-2' }] });
      const base = new Rapid.Graph(context, [n1]);
      const graph = new Rapid.Graph(base).replace([n2, r1]);

      const result = Rapid.actionRevert('r-1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      assert.isUndefined(result.hasEntity('r-1'), 'r-1 removed');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n-2'), n2, 'n-2 unchanged');
      assert.deepEqual(result.parentRelations(n1), [], 'n1 has no parent relations');
      assert.deepEqual(result.parentRelations(n2), [], 'n-2 has no parent relations');
    });

    it('reverts an updated relation, preserves new and existing members', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const r1v2 = r1.addMember({ id: 'n-2' }, 1);
      const base = new Rapid.Graph(context, [n1, r1]);
      const graph = new Rapid.Graph(base).replace([n2, r1v2]);

      const result = Rapid.actionRevert('r1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      assert.strictEqual(result.hasEntity('r1'), r1, 'r1 reverted');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n-2'), n2, 'n-2 unchanged');
      assert.deepEqual(result.parentRelations(n1), [r1], 'n1 has r1 as parent relation');
      assert.deepEqual(result.parentRelations(n2), [], 'n-2 has no parent relations');
    });

    it('restores a deleted relation, preserves new and existing members', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n-2' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const r1v2 = r1.addMember({ id: 'n-2' }, 1);
      const base = new Rapid.Graph(context, [n1, r1]);
      const graph = new Rapid.Graph(base).replace([n2, r1v2]).remove(r1v2);

      const result = Rapid.actionRevert('r1')(graph);
      assert.instanceOf(result, Rapid.Graph);

      assert.strictEqual(result.hasEntity('r1'), r1, 'r1 reverted');
      assert.strictEqual(result.hasEntity('n1'), n1, 'n1 unchanged');
      assert.strictEqual(result.hasEntity('n-2'), n2, 'n-2 unchanged');
      assert.deepEqual(result.parentRelations(n1), [r1], 'n1 has r1 as parent relation');
      assert.deepEqual(result.parentRelations(n2), [], 'n-2 has no parent relations');
    });
  });
});
