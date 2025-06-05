import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('OsmRelation', () => {
  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();

  describe('constructor', () => {
    it('constructs a Relation', () => {
      const relation = new Rapid.OsmRelation(context);
      assert(relation instanceof Rapid.OsmRelation);
      assert.equal(relation.type, 'relation');
    });

    it('defaults members to an empty array', () => {
      const relation = new Rapid.OsmRelation(context);
      assert.deepEqual(relation.members, []);
    });

    it('sets members as specified', () => {
      const relation = new Rapid.OsmRelation(context, { members: ['n-1'] });
      assert.deepEqual(relation.members, ['n-1']);
    });

    it('defaults tags to an empty object', () => {
      const relation = new Rapid.OsmRelation(context);
      assert.deepEqual(relation.tags, {});
    });

    it('sets tags as specified', () => {
      const relation = new Rapid.OsmRelation(context, { tags: { foo: 'bar' } });
      assert.deepEqual(relation.tags, { foo: 'bar' });
    });
  });


  describe('#copy', () => {
    it('returns a new Relation', () => {
      const r = new Rapid.OsmRelation(context, { id: 'r' });
      const result = r.copy(null, {});
      assert(result instanceof Rapid.OsmRelation);
      assert.notEqual(result, r);
    });


    it('adds the new Relation to input object', () => {
      const r = new Rapid.OsmRelation(context, { id: 'r' });
      const copies = {};
      const result = r.copy(null, copies);
      assert.equal(Object.keys(copies).length, 1);
      assert.equal(copies.r, result);
    });


    it('returns an existing copy in input object', () => {
      const r = new Rapid.OsmRelation(context, { id: 'r' });
      const copies = {};
      const result1 = r.copy(null, copies);
      const result2 = r.copy(null, copies);
      assert.equal(Object.keys(copies).length, 1);
      assert.equal(result1, result2);
    });


    it('deep copies members', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const b = new Rapid.OsmNode(context, { id: 'b' });
      const c = new Rapid.OsmNode(context, { id: 'c' });
      const w = new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b', 'c', 'a'] });
      const r = new Rapid.OsmRelation(context, { id: 'r', members: [{ id: 'w', role: 'outer' }] });
      const graph = new Rapid.Graph([a, b, c, w, r]);
      const copies = {};
      const result = r.copy(graph, copies);

      assert.equal(Object.keys(copies).length, 5);
      assert(copies.w instanceof Rapid.OsmWay);
      assert(copies.a instanceof Rapid.OsmNode);
      assert(copies.b instanceof Rapid.OsmNode);
      assert(copies.c instanceof Rapid.OsmNode);
      assert.notEqual(result.members[0].id, r.members[0].id);
      assert.equal(result.members[0].role, r.members[0].role);
    });


    it('deep copies non-tree relation graphs without duplicating children', () => {
      const w = new Rapid.OsmWay(context, { id: 'w' });
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'r2' }, { id: 'w' }] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'w' }] });
      const graph = new Rapid.Graph([w, r1, r2]);
      const copies = {};
      r1.copy(graph, copies);

      assert.equal(Object.keys(copies).length, 3);
      assert(copies.r1 instanceof Rapid.OsmRelation);
      assert(copies.r2 instanceof Rapid.OsmRelation);
      assert(copies.w instanceof Rapid.OsmWay);
      assert.equal(copies.r1.members[0].id, copies.r2.id);
      assert.equal(copies.r1.members[1].id, copies.w.id);
      assert.equal(copies.r2.members[0].id, copies.w.id);
    });


    it('deep copies cyclical relation graphs without issue', () => {
      const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'r2' }] });
      const r2 = new Rapid.OsmRelation(context, { id: 'r2', members: [{ id: 'r1' }] });
      const graph = new Rapid.Graph([r1, r2]);
      const copies = {};
      r1.copy(graph, copies);

      assert.equal(Object.keys(copies).length, 2);
      assert.equal(copies.r1.members[0].id, copies.r2.id);
      assert.equal(copies.r2.members[0].id, copies.r1.id);
    });


    it('deep copies self-referencing relations without issue', () => {
      const r = new Rapid.OsmRelation(context, { id: 'r', members: [{ id: 'r' }] });
      const graph = new Rapid.Graph([r]);
      const copies = {};
      r.copy(graph, copies);

      assert.equal(Object.keys(copies).length, 1);
      assert.equal(copies.r.members[0].id, copies.r.id);
    });
  });


  describe('#extent', () => {
    it('returns the minimal extent containing the extents of all members', () => {
      const a = new Rapid.OsmNode(context, { loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { loc: [5, 10] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: a.id }, { id: b.id }] });
      const graph = new Rapid.Graph([a, b, r]);
      assert.deepEqual(r.extent(graph), new Rapid.sdk.Extent([0, 0], [5, 10]));
    });


    it('returns the known extent of incomplete relations', () => {
      const a = new Rapid.OsmNode(context, { loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { loc: [5, 10] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: a.id }, { id: b.id }] });
      const graph = new Rapid.Graph([a, r]);
      assert.deepEqual(r.extent(graph), new Rapid.sdk.Extent([0, 0], [0, 0]));
    });


    it('does not error on self-referencing relations', () => {
      let r = new Rapid.OsmRelation(context);
      r = r.addMember({ id: r.id });
      const graph = new Rapid.Graph([r]);
      assert.equal(r.extent(graph), null);
    });
  });


  describe('#geometry', () => {
    it('returns \'area\' for multipolygons', () => {
      assert.equal(new Rapid.OsmRelation(context, { tags: { type: 'multipolygon' } }).geometry(new Rapid.Graph()), 'area');
    });


    it('returns \'relation\' for other relations', () => {
      assert.equal(new Rapid.OsmRelation(context).geometry(new Rapid.Graph()), 'relation');
    });
  });


  describe('#isDegenerate', () => {
    it('returns true for a relation without members', () => {
      assert.equal(new Rapid.OsmRelation(context).isDegenerate(), true);
    });


    it('returns false for a relation with members', () => {
      assert.equal(new Rapid.OsmRelation(context, { members: [{ id: 'a', role: 'inner' }] }).isDegenerate(), false);
    });
  });


  describe('#memberByRole', () => {
    it('returns the first member with the given role', () => {
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: 'a', role: 'inner' },
          { id: 'b', role: 'outer' },
          { id: 'c', role: 'outer' }
        ]
      });
      assert.deepEqual(r.memberByRole('outer'), { id: 'b', role: 'outer', index: 1 });
    });


    it('returns undefined if no members have the given role', () => {
      assert.equal(new Rapid.OsmRelation(context).memberByRole('outer'), undefined);
    });
  });

  describe('#memberById', () => {
    it('returns the first member with the given id', () => {
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: 'a', role: 'outer' },
          { id: 'b', role: 'outer' },
          { id: 'b', role: 'inner' }
        ]
      });
      assert.deepEqual(r.memberById('b'), { id: 'b', role: 'outer', index: 1 });
    });


    it('returns undefined if no members have the given role', () => {
      assert.equal(new Rapid.OsmRelation(context).memberById('b'), undefined);
    });
  });

  describe('#hasFromViaTo', () => {
    it('returns true if there is a from, via, and to', () => {
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'manoeuvre' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't', type: 'way' }
        ]
      });
      assert.equal(r.hasFromViaTo(), true);
    });


    it('returns true if there are extra froms, vias, tos', () => {
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'manoeuvre' },
        members: [
          { role: 'from', id: 'f1', type: 'way' },
          { role: 'from', id: 'f2', type: 'way' },
          { role: 'via', id: 'v1', type: 'node' },
          { role: 'via', id: 'v2', type: 'node' },
          { role: 'to', id: 't1', type: 'way' },
          { role: 'to', id: 't2', type: 'way' }
        ]
      });
      assert.equal(r.hasFromViaTo(), true);
    });


    it('returns false if from missing', () => {
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'manoeuvre' },
        members: [
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't', type: 'way' }
        ]
      });
      assert.equal(r.hasFromViaTo(), false);
    });


    it('returns false if via missing', () => {
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'manoeuvre' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'to', id: 't', type: 'way' }
        ]
      });
      assert.equal(r.hasFromViaTo(), false);
    });


    it('returns false if to missing', () => {
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'manoeuvre' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v', type: 'node' }
        ]
      });
      assert.equal(r.hasFromViaTo(), false);
    });


    it('returns false if all missing', () => {
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'multipolygon' },
        members: [
          { role: 'inner', id: 'i', type: 'way' },
          { role: 'outer', id: 'o', type: 'way' }
        ]
      });
      assert.equal(r.hasFromViaTo(), false);
    });
  });


  describe('#isRestriction', () => {
    it('returns true for \'restriction\' type', () => {
      assert.equal(new Rapid.OsmRelation(context, { tags: { type: 'restriction' } }).isRestriction(), true);
    });


    it('returns true for \'restriction:type\' types', () => {
      assert.equal(new Rapid.OsmRelation(context, { tags: { type: 'restriction:bus' } }).isRestriction(), true);
    });


    it('returns false otherwise', () => {
      assert.equal(new Rapid.OsmRelation(context).isRestriction(), false);
      assert.equal(new Rapid.OsmRelation(context, { tags: { type: 'multipolygon' } }).isRestriction(), false);
    });
  });


  describe('#isValidRestriction', () => {
    it('not a restriction', () => {
      const r = new Rapid.OsmRelation(context, { id: 'r', tags: { type: 'multipolygon' } });
      const graph = new Rapid.Graph([r]);
      assert.equal(r.isValidRestriction(graph), false);
    });


    it('typical restriction (from way, via node, to way) is valid', () => {
      const f = new Rapid.OsmWay(context, { id: 'f' });
      const v = new Rapid.OsmNode(context, { id: 'v' });
      const t = new Rapid.OsmWay(context, { id: 't' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f, v, t, r]);

      assert.equal(r.isValidRestriction(graph), true);
    });


    it('multiple froms, normal restriction is invalid', () => {
      const f1 = new Rapid.OsmWay(context, { id: 'f1' });
      const f2 = new Rapid.OsmWay(context, { id: 'f2' });
      const v = new Rapid.OsmNode(context, { id: 'v' });
      const t = new Rapid.OsmWay(context, { id: 't' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { role: 'from', id: 'f1', type: 'way' },
          { role: 'from', id: 'f2', type: 'way' },
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f1, f2, v, t, r]);

      assert.equal(r.isValidRestriction(graph), false);
    });


    it('multiple froms, no_entry restriction is valid', () => {
      const f1 = new Rapid.OsmWay(context, { id: 'f1' });
      const f2 = new Rapid.OsmWay(context, { id: 'f2' });
      const v = new Rapid.OsmNode(context, { id: 'v' });
      const t = new Rapid.OsmWay(context, { id: 't' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_entry' },
        members: [
          { role: 'from', id: 'f1', type: 'way' },
          { role: 'from', id: 'f2', type: 'way' },
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f1, f2, v, t, r]);

      assert.equal(r.isValidRestriction(graph), true);
    });


    it('multiple tos, normal restriction is invalid', () => {
      const f = new Rapid.OsmWay(context, { id: 'f' });
      const v = new Rapid.OsmNode(context, { id: 'v' });
      const t1 = new Rapid.OsmWay(context, { id: 't1' });
      const t2 = new Rapid.OsmWay(context, { id: 't2' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't1', type: 'way' },
          { role: 'to', id: 't2', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f, v, t1, t2, r]);

      assert.equal(r.isValidRestriction(graph), false);
    });


    it('multiple tos, no_exit restriction is valid', () => {
      const f = new Rapid.OsmWay(context, { id: 'f' });
      const v = new Rapid.OsmNode(context, { id: 'v' });
      const t1 = new Rapid.OsmWay(context, { id: 't1' });
      const t2 = new Rapid.OsmWay(context, { id: 't2' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_exit' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v', type: 'node' },
          { role: 'to', id: 't1', type: 'way' },
          { role: 'to', id: 't2', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f, v, t1, t2, r]);

      assert.equal(r.isValidRestriction(graph), true);
    });


    it('multiple vias, with some as node is invalid', () => {
      const f = new Rapid.OsmWay(context, { id: 'f' });
      const v1 = new Rapid.OsmNode(context, { id: 'v1' });
      const v2 = new Rapid.OsmWay(context, { id: 'v2' });
      const t = new Rapid.OsmWay(context, { id: 't' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v1', type: 'node' },
          { role: 'via', id: 'v2', type: 'way' },
          { role: 'to', id: 't', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f, v1, v2, t, r]);

      assert.equal(r.isValidRestriction(graph), false);
    });


    it('multiple vias, with all as way is valid', () => {
      const f = new Rapid.OsmWay(context, { id: 'f' });
      const v1 = new Rapid.OsmWay(context, { id: 'v1' });
      const v2 = new Rapid.OsmWay(context, { id: 'v2' });
      const t = new Rapid.OsmWay(context, { id: 't' });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { role: 'from', id: 'f', type: 'way' },
          { role: 'via', id: 'v1', type: 'way' },
          { role: 'via', id: 'v2', type: 'way' },
          { role: 'to', id: 't', type: 'way' },
        ]
      });
      const graph = new Rapid.Graph([f, v1, v2, t, r]);

      assert.equal(r.isValidRestriction(graph), true);
    });
  });


  describe('#indexedMembers', () => {
    it('returns an array of members extended with indexes', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: '1' }, { id: '3' }] });
      assert.deepEqual(r.indexedMembers(), [{ id: '1', index: 0 }, { id: '3', index: 1 }]);
    });
  });

  describe('#addMember', () => {
    it('adds a member at the end of the relation', () => {
      const r = new Rapid.OsmRelation(context);
      assert.deepEqual(r.addMember({ id: '1' }).members, [{ id: '1' }]);
    });


    it('adds a member at index 0', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: '1' }] });
      assert.deepEqual(r.addMember({ id: '2' }, 0).members, [{ id: '2' }, { id: '1' }]);
    });


    it('adds a member at a positive index', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: '1' }, { id: '3' }] });
      assert.deepEqual(r.addMember({ id: '2' }, 1).members, [{ id: '1' }, { id: '2' }, { id: '3' }]);
    });


    it('adds a member at a negative index', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: '1' }, { id: '3' }] });
      assert.deepEqual(r.addMember({ id: '2' }, -1).members, [{ id: '1' }, { id: '2' }, { id: '3' }]);
    });
  });


  describe('#updateMember', () => {
    it('updates the properties of the relation member at the specified index', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ role: 'forward' }] });
      assert.deepEqual(r.updateMember({ role: 'backward' }, 0).members, [{ role: 'backward' }]);
    });
  });


  describe('#removeMember', () => {
    it('removes the member at the specified index', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
      assert.deepEqual(r.removeMember(1).members, [{ id: 'a' }, { id: 'c' }]);
    });
  });


  describe('#removeMembersWithID', () => {
    it('removes members with the given ID', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] });
      assert.deepEqual(r.removeMembersWithID('a').members, [{ id: 'b' }]);
    });
  });


  describe('#replaceMember', () => {
    it('returns self if self does not contain needle', () => {
      const r = new Rapid.OsmRelation(context, { members: [] });
      assert.equal(r.replaceMember({ id: 'a' }, { id: 'b' }), r);
    });


    it('replaces a member which doesn\'t already exist', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: 'a', role: 'a' }] });
      assert.deepEqual(r.replaceMember({ id: 'a' }, { id: 'b', type: 'node' }).members, [{ id: 'b', role: 'a', type: 'node' }]);
    });


    it('preserves the existing role', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: 'a', role: 'a', type: 'node' }] });
      assert.deepEqual(r.replaceMember({ id: 'a' }, { id: 'b', type: 'node' }).members, [{ id: 'b', role: 'a', type: 'node' }]);
    });


    it('uses the replacement type', () => {
      const r = new Rapid.OsmRelation(context, { members: [{ id: 'a', role: 'a', type: 'node' }] });
      assert.deepEqual(r.replaceMember({ id: 'a' }, { id: 'b', type: 'way' }).members, [{ id: 'b', role: 'a', type: 'way' }]);
    });


    it('removes members if replacing them would produce duplicates', () => {
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: 'a', role: 'b', type: 'node' },
          { id: 'b', role: 'b', type: 'node' }
        ]
      });
      assert.deepEqual(r.replaceMember({ id: 'a' }, { id: 'b', type: 'node' }).members, [{ id: 'b', role: 'b', type: 'node' }]);
    });


    it('keeps duplicate members if `keepDuplicates = true`', () => {
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: 'a', role: 'b', type: 'node' },
          { id: 'b', role: 'b', type: 'node' }
        ]
      });
      assert.deepEqual(r.replaceMember({ id: 'a' }, { id: 'b', type: 'node' }, true).members, [{ id: 'b', role: 'b', type: 'node' }, { id: 'b', role: 'b', type: 'node' }]);
    });
  });


  describe('#asJXON', () => {
    it('converts a relation to jxon', function() {
      const relation = new Rapid.OsmRelation(context, { id: 'r-1', members: [{ id: 'w1', role: 'forward', type: 'way' }], tags: { type: 'route' } });
      assert.deepEqual(relation.asJXON(), {
        relation: {
          '@id': '-1',
          '@version': 0,
          member: [{ keyAttributes: { ref: '1', role: 'forward', type: 'way' } }],
          tag: [{ keyAttributes: { k: 'type', v: 'route' } }]
        }
      });
    });


    it('includes changeset if provided', function() {
      assert.equal(new Rapid.OsmRelation(context).asJXON('1234').relation['@changeset'], '1234');
    });
  });


  describe('#asGeoJSON', () => {
    //
    //  3
    //  |\
    //  | \
    //  |  \
    //  | 6 \
    //  | |\ \
    //  | 4-5 \
    //  1------2
    //
    it('converts a multipolygon to a GeoJSON MultiPolygon feature', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 9] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [9, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n1'] });  // counterclockwise
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'multipolygon' },
        members: [{ id: 'w1', type: 'way' }]  // 'outer' assumed
      });
      const graph = new Rapid.Graph([n1, n2, n3, w1, r1]);
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'r1',
        properties: { type: 'multipolygon' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [[0, 0], [0, 9], [9, 0], [0, 0]]  // counterclockwise outer
            ]
          ]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('forces counterclockwise winding order for outer multipolygon ways', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 9] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [9, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n3', 'n2', 'n1'] });  // clockwise
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'multipolygon' },
        members: [{ id: 'w1', type: 'way' }]  // 'outer' assumed
      });
      const graph = new Rapid.Graph([n1, n2, n3, w1, r1]);
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'r1',
        properties: { type: 'multipolygon' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [[0, 0], [0, 9], [9, 0], [0, 0]]  // counterclockwise outer
            ]
          ]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('forces clockwise winding order for inner multipolygon ways', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 9] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [9, 0] });
      const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [1, 1] });
      const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [1, 8] });
      const n6 = new Rapid.OsmNode(context, { id: 'n6', loc: [8, 1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n3', 'n2', 'n1'] });  // clockwise outer
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n5', 'n6', 'n4'] });  // counterclockwise inner
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'multipolygon' },
        members: [{ id: 'w1', type: 'way', role: 'outer' }, { id: 'w2', type: 'way', role: 'inner' }]
      });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5, n6, w1, w2, r1]);
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'r1',
        properties: { type: 'multipolygon' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [[0, 0], [0, 9], [9, 0], [0, 0]], // counterclockwise outer
              [[1, 1], [8, 1], [1, 8], [1, 1]]  // clockwise inner
            ]
          ]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('converts a relation to a GeoJSON FeatureCollection', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'foo' },
        members: [{ id: 'n1', role: 'via' }]
      });
      const graph = new Rapid.Graph([n1, r1]);
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'FeatureCollection',
        id: 'r1',
        properties: { type: 'foo' },
        features: [{
          type: 'Feature',
          id: 'n1',
          role: 'via',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [1, 1]
          }
        }]
      };
      assert.deepEqual(result, expected);
    });

    it('does not error on incomplete relations', () => {
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'foo' },
        members: [{ id: 'n1', role: 'via' }]
      });
      const graph = new Rapid.Graph([r1]);  // n1 not in the graph
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'FeatureCollection',
        id: 'r1',
        properties: { type: 'foo' },
        features: []
      };
      assert.deepEqual(result, expected);
    });

    it('does not error on self-referencing relations', () => {
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'foo' },
        members: [{ id: 'r1', role: 'self' }]
      });
      const graph = new Rapid.Graph([r1]);
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'FeatureCollection',
        id: 'r1',
        properties: { type: 'foo' },
        features: [] // empty
      };
      assert.deepEqual(result, expected);
    });

    it('does not error on cyclical relations', () => {
      const r1 = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'foo' },
        members: [{ id: 'r2', role: 'other' }]
      });
      const r2 = new Rapid.OsmRelation(context, {
        id: 'r2',
        tags: { type: 'bar' },
        members: [{ id: 'r1', role: 'other' }]
      });
      const graph = new Rapid.Graph([r1, r2]);
      const result = r1.asGeoJSON(graph);
      const expected = {
        type: 'FeatureCollection',
        id: 'r1',
        properties: { type: 'foo' },
        features: [{
          type: 'FeatureCollection',
          id: 'r2',
          role: 'other',
          properties: { type: 'bar' },
          features: [] // empty
        }]
      };
      assert.deepEqual(result, expected);
    });
  });


  describe('#multipolygon', () => {
    it('single polygon consisting of a single way', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [3, 3] });
      const c = new Rapid.OsmNode(context, { loc: [2, 2] });
      const w = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ]
      ]);
    });


    it('single polygon consisting of multiple ways', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [3, 3] });
      const c = new Rapid.OsmNode(context, { loc: [2, 2] });
      const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [b.id, c.id, a.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ]
      ]);
    });


    it('single polygon consisting of multiple ways, one needing reversal', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [3, 3] });
      const c = new Rapid.OsmNode(context, { loc: [2, 2] });
      const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [a.id, c.id, b.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ]
      ]);
    });


    it('multiple polygons consisting of single ways', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [3, 3] });
      const c = new Rapid.OsmNode(context, { loc: [2, 2] });
      const d = new Rapid.OsmNode(context, { loc: [4, 4] });
      const e = new Rapid.OsmNode(context, { loc: [6, 6] });
      const f = new Rapid.OsmNode(context, { loc: [5, 5] });
      const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [d.id, e.id, f.id, d.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, d, e, f, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ],
        [
          [d.loc, e.loc, f.loc, d.loc]
        ]
      ]);
    });


    it('invalid geometry: unclosed ring consisting of a single way', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [3, 3] });
      const c = new Rapid.OsmNode(context, { loc: [2, 2] });
      const w = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ]
      ]);
    });


    it('invalid geometry: unclosed ring consisting of multiple ways', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [3, 3] });
      const c = new Rapid.OsmNode(context, { loc: [2, 2] });
      const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [b.id, c.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ]
      ]);
    });


    it('invalid geometry: unclosed ring consisting of multiple ways, alternate order', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [2, 2] });
      const c = new Rapid.OsmNode(context, { loc: [3, 3] });
      const d = new Rapid.OsmNode(context, { loc: [4, 4] });
      const w1 = new Rapid.OsmWay(context, { nodes: [c.id, d.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, d, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [d.loc, c.loc, b.loc, a.loc, d.loc]
        ]
      ]);
    });


    it('invalid geometry: unclosed ring consisting of multiple ways, one needing reversal', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [2, 2] });
      const c = new Rapid.OsmNode(context, { loc: [3, 3] });
      const d = new Rapid.OsmNode(context, { loc: [4, 4] });
      const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [d.id, c.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, d, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, d.loc, c.loc, b.loc, a.loc]
        ]
      ]);
    });


    it('invalid geometry: unclosed ring consisting of multiple ways, one needing reversal, alternate order', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [2, 2] });
      const c = new Rapid.OsmNode(context, { loc: [3, 3] });
      const d = new Rapid.OsmNode(context, { loc: [4, 4] });
      const w1 = new Rapid.OsmWay(context, { nodes: [c.id, d.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [c.id, b.id, a.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w1.id, type: 'way' }, { id: w2.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, d, w1, w2, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [d.loc, c.loc, b.loc, a.loc, d.loc]
        ]
      ]);
    });


    it('single polygon with single single-way inner', () => {
      const a = new Rapid.OsmNode(context, { loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { loc: [0, 1] });
      const c = new Rapid.OsmNode(context, { loc: [1, 0] });
      const d = new Rapid.OsmNode(context, { loc: [0.1, 0.1] });
      const e = new Rapid.OsmNode(context, { loc: [0.2, 0.1] });
      const f = new Rapid.OsmNode(context, { loc: [0.1, 0.2] });
      const outer = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const inner = new Rapid.OsmWay(context, { nodes: [d.id, e.id, f.id, d.id] });
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: outer.id, type: 'way' },
          { id: inner.id, role: 'inner', type: 'way' }
        ]
      });
      const g = new Rapid.Graph([a, b, c, d, e, f, outer, inner, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc],
          [d.loc, e.loc, f.loc, d.loc]
        ]
      ]);
    });


    it('single polygon with single multi-way inner', () => {
      const a = new Rapid.OsmNode(context, { loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { loc: [0, 1] });
      const c = new Rapid.OsmNode(context, { loc: [1, 0] });
      const d = new Rapid.OsmNode(context, { loc: [0.1, 0.1] });
      const e = new Rapid.OsmNode(context, { loc: [0.2, 0.1] });
      const f = new Rapid.OsmNode(context, { loc: [0.2, 0.1] });
      const outer = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const inner1 = new Rapid.OsmWay(context, { nodes: [d.id, e.id] });
      const inner2 = new Rapid.OsmWay(context, { nodes: [e.id, f.id, d.id] });
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: outer.id, type: 'way' },
          { id: inner1.id, role: 'inner', type: 'way' },
          { id: inner2.id, role: 'inner', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph([a, b, c, d, e, f, outer, inner1, inner2, r]);

      assert.deepEqual(r.multipolygon(graph), [
        [
          [a.loc, b.loc, c.loc, a.loc],
          [d.loc, e.loc, f.loc, d.loc]
        ]
      ]);
    });


    it('single polygon with multiple single-way inners', () => {
      const a = new Rapid.OsmNode(context, { loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { loc: [0, 1] });
      const c = new Rapid.OsmNode(context, { loc: [1, 0] });
      const d = new Rapid.OsmNode(context, { loc: [0.1, 0.1] });
      const e = new Rapid.OsmNode(context, { loc: [0.2, 0.1] });
      const f = new Rapid.OsmNode(context, { loc: [0.1, 0.2] });
      const g = new Rapid.OsmNode(context, { loc: [0.2, 0.2] });
      const h = new Rapid.OsmNode(context, { loc: [0.3, 0.2] });
      const i = new Rapid.OsmNode(context, { loc: [0.2, 0.3] });
      const outer = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const inner1 = new Rapid.OsmWay(context, { nodes: [d.id, e.id, f.id, d.id] });
      const inner2 = new Rapid.OsmWay(context, { nodes: [g.id, h.id, i.id, g.id] });
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: outer.id, type: 'way' },
          { id: inner1.id, role: 'inner', type: 'way' },
          { id: inner2.id, role: 'inner', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph([a, b, c, d, e, f, g, h, i, outer, inner1, inner2, r]);

      assert.deepEqual(r.multipolygon(graph), [
        [
          [a.loc, b.loc, c.loc, a.loc],
          [d.loc, e.loc, f.loc, d.loc],
          [g.loc, h.loc, i.loc, g.loc]
        ]
      ]);
    });


    it('multiple polygons with single single-way inner', () => {
      const a = new Rapid.OsmNode(context, { loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { loc: [0, 1] });
      const c = new Rapid.OsmNode(context, { loc: [1, 0] });
      const d = new Rapid.OsmNode(context, { loc: [0.1, 0.1] });
      const e = new Rapid.OsmNode(context, { loc: [0.2, 0.1] });
      const f = new Rapid.OsmNode(context, { loc: [0.1, 0.2] });
      const g = new Rapid.OsmNode(context, { loc: [0, 0] });
      const h = new Rapid.OsmNode(context, { loc: [0, -1] });
      const i = new Rapid.OsmNode(context, { loc: [-1, 0] });
      const outer1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const outer2 = new Rapid.OsmWay(context, { nodes: [g.id, h.id, i.id, g.id] });
      const inner = new Rapid.OsmWay(context, { nodes: [d.id, e.id, f.id, d.id] });
      const r = new Rapid.OsmRelation(context, {
        members: [
          { id: outer1.id, type: 'way' },
          { id: outer2.id, type: 'way' },
          { id: inner.id, role: 'inner', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph([a, b, c, d, e, f, g, h, i, outer1, outer2, inner, r]);

      assert.deepEqual(r.multipolygon(graph), [
        [
          [a.loc, b.loc, c.loc, a.loc],
          [d.loc, e.loc, f.loc, d.loc]
        ],
        [
          [g.loc, h.loc, i.loc, g.loc]
        ]
      ]);
    });


    it('invalid geometry: unmatched inner', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [2, 2] });
      const c = new Rapid.OsmNode(context, { loc: [3, 3] });
      const w = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id, a.id] });
      const r = new Rapid.OsmRelation(context, { members: [{ id: w.id, role: 'inner', type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, b.loc, c.loc, a.loc]
        ]
      ]);
    });


    it('incomplete relation', () => {
      const a = new Rapid.OsmNode(context, { loc: [1, 1] });
      const b = new Rapid.OsmNode(context, { loc: [2, 2] });
      const c = new Rapid.OsmNode(context, { loc: [3, 3] });
      const w1 = new Rapid.OsmWay(context, { nodes: [a.id, b.id, c.id] });
      const w2 = new Rapid.OsmWay(context);
      const r = new Rapid.OsmRelation(context, { members: [{ id: w2.id, type: 'way' }, { id: w1.id, type: 'way' }] });
      const g = new Rapid.Graph([a, b, c, w1, r]);

      assert.deepEqual(r.multipolygon(g), [
        [
          [a.loc, c.loc, b.loc, a.loc]
        ]
      ]);
    });
  });


  describe('.creationOrder comparator', () => {
    it('orders existing relations newest-first', () => {
      const a = new Rapid.OsmRelation(context, { id: 'r1' });
      const b = new Rapid.OsmRelation(context, { id: 'r2' });
      assert.ok(Rapid.OsmRelation.creationOrder(a, b) > 0);
      assert.ok(Rapid.OsmRelation.creationOrder(b, a) < 0);
    });


    it('orders new relations newest-first', () => {
      const a = new Rapid.OsmRelation(context, { id: 'r-1' });
      const b = new Rapid.OsmRelation(context, { id: 'r-2' });
      assert.ok(Rapid.OsmRelation.creationOrder(a, b) > 0);
      assert.ok(Rapid.OsmRelation.creationOrder(b, a) < 0);
    });
  });
});
