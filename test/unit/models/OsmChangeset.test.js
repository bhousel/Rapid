import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('OsmChangeset', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs an OsmChangeset from a context', () => {
      const a = new Rapid.OsmChangeset(context);
      assert.instanceOf(a, Rapid.OsmChangeset);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
      assert.ok(a.id, 'an id should be generated');
      assert.strictEqual(a.type, 'changeset');
      assert.deepEqual(a.tags, {});
    });

    it('constructs an OsmChangeset from a context, with props', () => {
      const props = { id: 'c1', tags: { comment: 'hello' } };
      const a = new Rapid.OsmChangeset(context, props);
      assert.instanceOf(a, Rapid.OsmChangeset);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      // `a.props` will be deep clone of props, possibly with other properties ('id') added.
      assert.deepInclude(a.props, props);
      assert.notStrictEqual(a.props, props);  // cloned, not ===
      assert.strictEqual(a.id, 'c1');
      assert.strictEqual(a.type, 'changeset');
      assert.deepEqual(a.tags, { comment: 'hello' });
    });

    it('constructs an OsmChangeset from another OsmChangeset', () => {
      const a = new Rapid.OsmChangeset(context);
      const b = new Rapid.OsmChangeset(a);
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
      assert.strictEqual(b.type, a.type);
      assert.strictEqual(b.id, a.id, 'an id should be generated');
    });

    it('constructs an OsmChangeset from another OsmChangeset, with props', () => {
      const aprops = { id: 'c1', tags: { comment: 'hello' } };
      const bprops = { foo: 'bar' };
      const a = new Rapid.OsmChangeset(context, aprops);
      const b = new Rapid.OsmChangeset(a, bprops);
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.strictEqual(b.id, a.id);
      assert.strictEqual(b.type, a.type);
      assert.deepInclude(b.props, { id: 'c1', tags: { comment: 'hello' }, foo: 'bar' });
    });
  });


  describe('update', () => {
    it('returns a new changeset', () => {
      const a = new Rapid.OsmChangeset(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.notStrictEqual(b, a);
    });

    it('updates the specified properties', () => {
      const a = new Rapid.OsmChangeset(context);
      const aprops = a.props;
      const update = { tags: { comment: 'hello' } };
      const b = a.update(update);
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.notStrictEqual(b, a);
      const bprops = b.props;
      assert.notStrictEqual(bprops, aprops);   // new object, not ===
      assert.notStrictEqual(bprops, update);   // cloned, not ===
      assert.deepInclude(bprops, update);      // will also include a `v`
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.OsmChangeset(context);
      const aprops = a.props;
      const b = a.update();
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.notStrictEqual(b, a);
      const bprops = b.props;
      assert.notStrictEqual(bprops, aprops);   // new object, not ===
    });

    it('preserves existing properties', () => {
      const a = new Rapid.OsmChangeset(context, { id: 'c1' });
      const aprops = a.props;
      const update = { tags: { comment: 'hello' } };
      const b = a.update(update);
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.notStrictEqual(b, a);
      const bprops = b.props;
      assert.notStrictEqual(bprops, aprops);   // new object, not ===
      assert.notStrictEqual(bprops, update);   // cloned, not ===
      assert.deepInclude(bprops, { id: 'c1', tags: { comment: 'hello' } });  // will also include a `v`
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.OsmChangeset(context);
      const aprops = a.props;
      const update = { tags: { comment: 'hello' } };
      const b = a.update(update);
      assert.doesNotHaveAnyKeys(b.props, ['constructor', '__proto__', 'toString']);
    });

    it('updates v', () => {
      const a = new Rapid.OsmChangeset(context);
      const v1 = a.v;
      const b = a.update({});
      assert.isAbove(b.v, v1);
    });
  });


  describe('asGeoJSON', () => {
    it('returns an unlocated GeoJSON Feature', () => {
      const c1 = new Rapid.OsmChangeset(context, { id: 'c1', tags: { comment: 'hello' }});
      const result = c1.asGeoJSON();
      const expected = {
        type: 'Feature',
        id: 'c1',
        properties: { comment: 'hello' },
        geometry: null
      };

      assert.deepEqual(result, expected);
    });
  });

  describe('asJXON', () => {
    it('converts a changeset to jxon', () => {
      const expected = {
        osm: {
          changeset: {
            tag: [{ '@k': 'comment', '@v': 'hello' }],
            '@version': 0.6,
            '@generator': 'Rapid'
          }
        }
      };

      const changeset = new Rapid.OsmChangeset(context, { tags: { comment: 'hello' }});
      const jxon = changeset.asJXON();
      assert.deepEqual(jxon, expected);
    });
  });

  describe('geometry', () => {
    it(`returns 'changeset'`, () => {
      const a = new Rapid.OsmChangeset(context);
      assert.deepEqual(a.geometry(), 'changeset');
    });
  });

  describe('osmChangeJXON', () => {
    it('converts change data to JXON', () => {
      const expected = {
        osmChange: {
          '@version': 0.6,
          '@generator': 'Rapid',
          'create': {},
          'modify': {},
          'delete': { '@if-unused': true }
        }
      };

      const changeset = new Rapid.OsmChangeset(context);
      const jxon = changeset.osmChangeJXON({ created: [], modified: [], deleted: [] });
      assert.deepEqual(jxon, expected);
    });

    it('includes creations ordered by nodes, ways, relations', () => {
      const n = new Rapid.OsmNode(context, { loc: [0, 0] });
      const w = new Rapid.OsmWay(context);
      const r = new Rapid.OsmRelation(context);
      const c = new Rapid.OsmChangeset(context, { id: '1234' });
      const changes = { created: [r, w, n], modified: [], deleted: [] };
      const jxon = c.osmChangeJXON(changes);

      const result = jxon.osmChange.create;
      assert.deepEqual(result.node, [n.asJXON('1234').node]);
      assert.deepEqual(result.way, [w.asJXON('1234').way]);
      assert.deepEqual(result.relation, [r.asJXON('1234').relation]);
  });

    it('includes creations ordered by dependencies', () => {
      const n = new Rapid.OsmNode(context, { loc: [0, 0] });
      const w = new Rapid.OsmWay(context, {nodes: [n.id]});
      const r1 = new Rapid.OsmRelation(context, { members: [{ id: w.id, type: 'way' }] });
      const r2 = new Rapid.OsmRelation(context, { members: [{ id: r1.id, type: 'relation' }] });
      const c = new Rapid.OsmChangeset(context, { id: '1234' });
      const changes = { created: [r2, r1, w, n], modified: [], deleted: [] };
      const jxon = c.osmChangeJXON(changes);

      const result = jxon.osmChange.create;
      assert.deepEqual(result.node, [n.asJXON('1234').node]);
      assert.deepEqual(result.way, [w.asJXON('1234').way]);
      assert.deepEqual(result.relation, [r1.asJXON('1234').relation, r2.asJXON('1234').relation]);
    });

    it('includes creations ignoring circular dependencies', () => {
      const r1 = new Rapid.OsmRelation(context);
      const r2 = new Rapid.OsmRelation(context);
      const c = new Rapid.OsmChangeset(context, { id: '1234' });
      r1.addMember({ id: r2.id, type: 'relation' });
      r2.addMember({ id: r1.id, type: 'relation' });
      const changes = { created: [r1, r2], modified: [], deleted: [] };
      const jxon = c.osmChangeJXON(changes);

      const result = jxon.osmChange.create;
      assert.deepEqual(result, {
        relation: [r1.asJXON('1234').relation, r2.asJXON('1234').relation]
      });
    });

    it('includes modifications', () => {
      const n = new Rapid.OsmNode(context, { loc: [0, 0] });
      const w = new Rapid.OsmWay(context);
      const r = new Rapid.OsmRelation(context);
      const c = new Rapid.OsmChangeset(context, { id: '1234' });
      const changes = { created: [], modified: [r, w, n], deleted: [] };
      const jxon = c.osmChangeJXON(changes);

      const result = jxon.osmChange.modify;
      assert.deepEqual(result, {
        node: [n.asJXON('1234').node],
        way: [w.asJXON('1234').way],
        relation: [r.asJXON('1234').relation]
      });
    });

    it('includes deletions ordered by relations, ways, nodes', () => {
      const n = new Rapid.OsmNode(context, { loc: [0, 0] });
      const w = new Rapid.OsmWay(context);
      const r = new Rapid.OsmRelation(context);
      const c = new Rapid.OsmChangeset(context, { id: '1234' });
      const changes = { created: [], modified: [], deleted: [n, w, r] };
      const jxon = c.osmChangeJXON(changes);

      const result = jxon.osmChange.delete;
      assert.deepEqual(result, {
        node: [n.asJXON('1234').node],
        way: [w.asJXON('1234').way],
        relation: [r.asJXON('1234').relation],
        '@if-unused': true
      });
    });
  });

});
