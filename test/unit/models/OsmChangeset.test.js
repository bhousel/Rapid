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
    });

    it('generates an empty tags object, if unset', () => {
      const a = new Rapid.OsmChangeset(context);
      assert.deepEqual(a.props.tags, {});
    });

    it('generates an id string, if unset', () => {
      const a = new Rapid.OsmChangeset(context);
      assert.match(a.props.id, /^c-/);
    });

    it('constructs an OsmChangeset from a context, with props', () => {
      const orig = { id: 'c1', tags: { comment: 'hello' } };
      const a = new Rapid.OsmChangeset(context, orig);
      assert.instanceOf(a, Rapid.OsmChangeset);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.notStrictEqual(a.props, orig);  // cloned, not ===
      assert.deepInclude(a.props, orig);
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
    });

    it('constructs an OsmChangeset from another OsmChangeset, with props', () => {
      const orig = { id: 'c1', tags: { comment: 'hello' } };
      const a = new Rapid.OsmChangeset(context, orig);
      const update = { foo: 'bar' };
      const b = new Rapid.OsmChangeset(a, update);
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });
  });


  describe('update', () => {
    it('returns a new OsmChangeset', () => {
      const a = new Rapid.OsmChangeset(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.OsmChangeset);
      assert.notStrictEqual(b, a);
    });

    it('updates the specified properties', () => {
      const a = new Rapid.OsmChangeset(context);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.notStrictEqual(b.props, a.props);  // new object, not ===
      assert.notStrictEqual(b.props, update);   // cloned, not ===
      assert.deepInclude(b.props, update);
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.OsmChangeset(context);
      const b = a.update();
      assert.notStrictEqual(b.props, a.props);  // new object, not ===
    });

    it('preserves existing properties', () => {
      const orig = { id: 'c1', tags: { comment: 'hello' } };
      const a = new Rapid.OsmChangeset(context, orig);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.notStrictEqual(b.props, a.props);   // new object, not ===
      assert.notStrictEqual(b.props, update);    // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.OsmChangeset(context);
      const update = { foo: 'bar' };
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
