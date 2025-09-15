import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Difference', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a Difference between 2 Graphs', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node);
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff, Rapid.Difference);
      assert.instanceOf(diff.changes, Map);
      assert.hasAllKeys(diff.changes, ['n']);
    });

    it('constructs a create-only Difference if no base', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node);
      const diff = new Rapid.Difference(null, head);
      assert.instanceOf(diff, Rapid.Difference);
      assert.instanceOf(diff.changes, Map);
      assert.hasAllKeys(diff.changes, ['n']);
    });

    it('constructs an empty Difference if no head', () => {
      const base = new Rapid.Graph(context);
      const diff = new Rapid.Difference(base);
      assert.instanceOf(diff, Rapid.Difference);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });

    it('constructs an empty Difference if base and head are the same', () => {
      const base = new Rapid.Graph(context);
      const diff = new Rapid.Difference(base, base);
      assert.instanceOf(diff, Rapid.Difference);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });
  });

  describe('changes', () => {
    it('includes created entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node);
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.deepEqual(diff.changes.get('n'), { base: undefined, head: node });
    });

    it('includes undone created entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node);
      const diff = new Rapid.Difference(head, base);
      assert.instanceOf(diff.changes, Map);
      assert.deepEqual(diff.changes.get('n'), { base: node, head: undefined });
    });

    it('includes modified entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n' });
      const n2 = n1.update({ tags: { yes: 'no' } });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n2);
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.deepEqual(diff.changes.get('n'), { base: n1, head: n2 });
    });

    it('includes undone modified entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n' });
      const n2 = n1.update({ tags: { yes: 'no' } });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n2);
      const diff = new Rapid.Difference(head, base);
      assert.instanceOf(diff.changes, Map);
      assert.deepEqual(diff.changes.get('n'), { base: n2, head: n1 });
    });

    it('doesn\'t include updated but identical entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n' });
      const n2 = n1.update();
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n2);
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });

    it('includes deleted entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context, [node]);
      const head = new Rapid.Graph(base).remove(node);
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.deepEqual(diff.changes.get('n'), { base: node, head: undefined });
    });

    it('includes undone deleted entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context, [node]);
      const head = new Rapid.Graph(base).remove(node);
      const diff = new Rapid.Difference(head, base);
      assert.instanceOf(diff.changes, Map);
      assert.deepEqual(diff.changes.get('n'), { base: undefined, head: node });
    });

    it('doesn\'t include created entities that were subsequently deleted', () => {
      const node = new Rapid.OsmNode(context, );
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node).remove(node);
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });

    it('doesn\'t include created entities that were subsequently reverted', () => {
      const node = new Rapid.OsmNode(context, { id: 'n-1' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node).revert('n-1');
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });

    it('doesn\'t include modified entities that were subsequently reverted', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n' });
      const n2 = n1.update({ tags: { yes: 'no' } });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n2).revert('n');
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });

    it('doesn\'t include deleted entities that were subsequently reverted', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context, [node]);
      const head = new Rapid.Graph(base).remove(node).revert('n');
      const diff = new Rapid.Difference(base, head);
      assert.instanceOf(diff.changes, Map);
      assert.isEmpty(diff.changes);
    });
  });


  describe('created', () => {
    it('returns an array of created entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context);
      const head = new Rapid.Graph(base).replace(node);
      const diff = new Rapid.Difference(base, head);
      assert.deepEqual(diff.created(), [node]);
    });
  });

  describe('modified', () => {
    it('returns an array of modified entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n' });
      const n2 = n1.move([1, 2]);
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).replace(n2);
      const diff = new Rapid.Difference(base, head);
      assert.deepEqual(diff.modified(), [n2]);
    });
  });

  describe('deleted', () => {
    it('returns an array of deleted entities', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const base = new Rapid.Graph(context, [node]);
      const head = new Rapid.Graph(base).remove(node);
      const diff = new Rapid.Difference(base, head);
      assert.deepEqual(diff.deleted(), [node]);
    });
  });

  describe('summary', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', tags: { crossing: 'marked' }}),
      new Rapid.OsmNode(context, { id: 'n2' }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2']})
    ]);

    it('includes a created way as created', () => {
      const w2 = new Rapid.OsmWay(context, { id: 'w2' });
      const head = new Rapid.Graph(base).replace(w2);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w2']);
      assert.deepEqual(summary.get('w2'), { changeType: 'created', entity: w2, graph: head });
    });

    it('includes a deleted way as deleted', () => {
      const w1 = base.entity('w1');
      const head = new Rapid.Graph(base).remove(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);
      assert.deepEqual(summary.get('w1'), { changeType: 'deleted', entity: w1, graph: base });
    });

    it('includes a way as modified when its tags are changed', () => {
      const w1 = base.entity('w1').mergeTags({ highway: 'primary' });
      const head = new Rapid.Graph(base).replace(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: w1, graph: head });
    });

    it('ignores uninteresting child node added to the way', () => {
      const n3 = new Rapid.OsmNode(context, { id: 'n3' });
      const w1 = base.entity('w1').addNode('n3');
      const head = new Rapid.Graph(base).replace(n3).replace(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);   // no n3
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: w1, graph: head });
    });

    it('ignores uninteresting child node when moved', () => {
      const n2 = base.entity('n2').move([0,3]);
      const head = new Rapid.Graph(base).replace(n2);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);  // no n2
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: head.entity('w1'), graph: head });
    });

    it('ignores uninteresting child node removed from the way', () => {
      const w1 = base.entity('w1').removeNode('n2');
      const head = new Rapid.Graph(base).replace(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);  // no n2
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: w1, graph: head });
    });

    it('ignores uninteresting child node moved, as way being created', () => {
      const n2 = base.entity('n2').move([0,3]);
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n2']});
      const head = new Rapid.Graph(base).replace(w2).replace(n2);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1', 'w2']);  // no n2
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: head.entity('w1'), graph: head });
      assert.deepEqual(summary.get('w2'), { changeType: 'created', entity: w2, graph: head });
    });

    it('ignores uninteresting child node created, as way being created', () => {
      const n3 = new Rapid.OsmNode(context, { id: 'n3' });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3']});
      const head = new Rapid.Graph(base).replace(n3).replace(w2);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w2']);  // no n3
      assert.deepEqual(summary.get('w2'), { changeType: 'created', entity: w2, graph: head });
    });

    it('includes a child node as modified when it has interesting tag changes', () => {
      const n1 = base.entity('n1').mergeTags({ highway: 'traffic_signals' });
      const head = new Rapid.Graph(base).replace(n1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['n1']);
      assert.deepEqual(summary.get('n1'), { changeType: 'modified', entity: n1, graph: head });
    });

    it('includes interesting child node when moved', () => {
      const n1 = base.entity('n1').move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1', 'n1']);  // yes n1
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: head.entity('w1'), graph: head });
      assert.deepEqual(summary.get('n1'), { changeType: 'modified', entity: n1, graph: head });
    });

    it('ignores child node if no-op tag changes or movements', () => {
      const n2 = base.entity('n2').update({ tags: {}, loc: [1, 2]});
      const head = new Rapid.Graph(base).replace(n2);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);  // no n2
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: head.entity('w1'), graph: head });
    });

    it('includes an interesting child node deleted', () => {
      const w1 = base.entity('w1').removeNode('n1');
      const n1 = base.entity('n1');
      const head = new Rapid.Graph(base).remove(n1).replace(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1', 'n1']);  // yes n1
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: w1, graph: head });
      assert.deepEqual(summary.get('n1'), { changeType: 'deleted', entity: n1, graph: base });
    });

    it('ignores an uninteresting child node deleted', () => {
      const w1 = base.entity('w1').removeNode('n2');
      const n2 = base.entity('n2');
      const head = new Rapid.Graph(base).remove(n2).replace(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1']);  // no n2
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: w1, graph: head });
    });

    it('included interesting child node created', () => {
      const n3 = new Rapid.OsmNode(context, { id: 'n3', tags: { crossing: 'marked' }});
      const w1 = base.entity('w1').addNode('n3');
      const head = new Rapid.Graph(base).replace(n3).replace(w1);
      const diff = new Rapid.Difference(base, head);
      const summary = diff.summary();
      assert.ok(summary instanceof Map);
      assert.hasAllKeys(summary, ['w1', 'n3']);  // yes n3
      assert.deepEqual(summary.get('w1'), { changeType: 'modified', entity: w1, graph: head });
      assert.deepEqual(summary.get('n3'), { changeType: 'created', entity: n3, graph: head });
    });
  });

  describe('complete', () => {
    it('includes created entities', () => {
      const base = new Rapid.Graph(context);
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const head = new Rapid.Graph(base).replace(n1);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1']);
      assert.strictEqual(complete.get('n1'), n1);
    });

    it('includes modified entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const n1v2 = n1.move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1']);
      assert.strictEqual(complete.get('n1'), n1v2);
    });

    it('includes deleted entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const base = new Rapid.Graph(context, [n1]);
      const head = new Rapid.Graph(base).remove(n1);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1']);
      assert.strictEqual(complete.get('n1'), undefined);
    });

    it('includes nodes added to a way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1']});
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const w1v2 = w1.addNode('n2');
      const head = new Rapid.Graph(base).replace(w1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1', 'n2', 'w1']);
      assert.strictEqual(complete.get('w1'), w1v2);
      assert.strictEqual(complete.get('n1'), n1);
      assert.strictEqual(complete.get('n2'), n2);
    });

    it('includes nodes removed from a way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2']});
      const base = new Rapid.Graph(context, [n1, n2, w1]);
      const w1v2 = w1.removeNode('n2');
      const head = new Rapid.Graph(base).replace(w1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1', 'n2', 'w1']);
      assert.strictEqual(complete.get('w1'), w1v2);
      assert.strictEqual(complete.get('n1'), n1);
      assert.strictEqual(complete.get('n2'), n2);
    });

    it('includes multipolygon members', () => {
      const w1 = new Rapid.OsmWay(context, { id: 'w1' });
      const w2 = new Rapid.OsmWay(context, { id: 'w2' });
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'multipolygon' },
        members: [{ role: 'outer', id: 'w1', type: 'way' }, { role: '', id: 'w2', type: 'way' }]
      });
      const base = new Rapid.Graph(context, [w1, w2, r1]);
      const r1v2 = r1.updateMember({ role: 'inner', id: 'w2', type: 'way' }, 1);
      const head = new Rapid.Graph(base).replace(r1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['w1', 'w2', 'r1']);
      assert.strictEqual(complete.get('r1'), r1v2);
      assert.strictEqual(complete.get('w1'), w1);
      assert.strictEqual(complete.get('w2'), w2);
    });

    it('ignored multipolygon members not in the graph (not downloaded)', () => {
      const w1 = new Rapid.OsmWay(context, { id: 'w1' });
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'multipolygon' },
        members: [{ role: 'outer', id: 'w1', type: 'way' }, { role: '', id: 'w2', type: 'way' }]
      });
      const base = new Rapid.Graph(context, [w1, r1]);  // w2 not downloaded
      const r1v2 = r1.updateMember({ role: 'inner', id: 'w2', type: 'way' }, 1);
      const head = new Rapid.Graph(base).replace(r1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['w1', 'r1']);  // no w2
      assert.strictEqual(complete.get('r1'), r1v2);
      assert.strictEqual(complete.get('w1'), w1);
    });

    it('includes parent ways of modified nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const base = new Rapid.Graph(context, [n1, w1]);
      const n1v2 = n1.move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.hasAllKeys(complete, ['n1', 'w1']);
      assert.instanceOf(complete, Map);
      assert.strictEqual(complete.get('n1'), n1v2);
      assert.strictEqual(complete.get('w1'), w1);
    });

    it('includes parent relations of modified entities', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const base = new Rapid.Graph(context, [n1, r1]);
      const n1v2 = n1.move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1', 'r1']);
      assert.strictEqual(complete.get('n1'), n1v2);
      assert.strictEqual(complete.get('r1'), r1);
    });

    it('includes parent relations of modified entities, recursively', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'r1' }] });
      const base = new Rapid.Graph(context, [n1, r1, r2]);
      const n1v2 = n1.move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1', 'r1', 'r2']);
      assert.strictEqual(complete.get('n1'), n1v2);
      assert.strictEqual(complete.get('r1'), r1);
      assert.strictEqual(complete.get('r2'), r2);
    });

    it('includes parent relations of parent ways of modified nodes', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'w1' }] });
      const base = new Rapid.Graph(context, [n1, w1, r1]);
      const n1v2 = n1.move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1', 'w1', 'r1']);
      assert.strictEqual(complete.get('n1'), n1v2);
      assert.strictEqual(complete.get('w1'), w1);
      assert.strictEqual(complete.get('r1'), r1);
    });

    it('copes with recursive relations', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1' }, { id: 'r2' }] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'r1' }] });
      const base = new Rapid.Graph(context, [n1, r1, r2]);
      const n1v2 = n1.move([1, 2]);
      const head = new Rapid.Graph(base).replace(n1v2);
      const diff = new Rapid.Difference(base, head);
      const complete = diff.complete();
      assert.instanceOf(complete, Map);
      assert.hasAllKeys(complete, ['n1', 'r1', 'r2']);
      assert.strictEqual(complete.get('n1'), n1v2);
      assert.strictEqual(complete.get('r1'), r1);
      assert.strictEqual(complete.get('r2'), r2);
    });

  });
});
