import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';

class MockContext {
  constructor() {
    this.viewport = new Rapid.sdk.Viewport();
  }
}

const context = new MockContext();


describe('createOsmFeature', () => {
  it('returns a subclass of the appropriate type', () => {
    assert.ok(Rapid.createOsmFeature(context, {type: 'node'}) instanceof Rapid.OsmNode);
    assert.ok(Rapid.createOsmFeature(context, {type: 'way'}) instanceof Rapid.OsmWay);
    assert.ok(Rapid.createOsmFeature(context, {type: 'relation'}) instanceof Rapid.OsmRelation);
    assert.ok(Rapid.createOsmFeature(context, {type: 'changeset'}) instanceof Rapid.OsmChangeset);
    assert.ok(Rapid.createOsmFeature(context, {id: 'n1'}) instanceof Rapid.OsmNode);
    assert.ok(Rapid.createOsmFeature(context, {id: 'w1'}) instanceof Rapid.OsmWay);
    assert.ok(Rapid.createOsmFeature(context, {id: 'r1'}) instanceof Rapid.OsmRelation);
    assert.ok(Rapid.createOsmFeature(context, {id: 'c1'}) instanceof Rapid.OsmChangeset);
  });

  it('returns a generic OsmEntity as a fallback', () => {
    assert.ok(Rapid.createOsmFeature(context) instanceof Rapid.OsmEntity);
  });
});



describe('OsmEntity', () => {

  describe('.id', () => {
    it('generates unique IDs', () => {
      const a = new Rapid.OsmNode(context);
      const b = new Rapid.OsmNode(context);
      assert.notEqual(a.id, b.id);
    });

    describe('.fromOSM', () => {
      it('returns a ID string unique across entity types', () => {
        assert.equal(Rapid.OsmEntity.fromOSM('node', '1'), 'n1');
      });
    });

    describe('.toOSM', () => {
      it('reverses fromOSM', () => {
        const id = Rapid.OsmEntity.fromOSM('node', '1');
        assert.equal(Rapid.OsmEntity.toOSM(id), '1');
      });
    });
  });

  describe('#copy', () => {
    it('returns a new Entity', () => {
      const source = new Rapid.OsmEntity(context, { id: 'x' });
      const result = source.copy(null, {});
      assert.ok(result instanceof Rapid.OsmEntity);
      assert.notStrictEqual(source, result);
    });

    it('adds the new Entity to memo object', () => {
      const source = new Rapid.OsmEntity(context, { id: 'x' });
      const copies = {};
      const result = source.copy(null, copies);
      assert.strictEqual(Object.keys(copies).length, 1);
      assert.strictEqual(copies.x, result);
    });

    it('returns an existing copy in memo object', () => {
      const source = new Rapid.OsmEntity(context, { id: 'x' });
      const copies = {};
      const result1 = source.copy(null, copies);
      const result2 = source.copy(null, copies);
      assert.strictEqual(Object.keys(copies).length, 1);
      assert.strictEqual(result1, result2);
    });

    it('resets \'id\', \'user\', \'version\', and \'v\' properties', () => {
      const source = new Rapid.OsmEntity(context, { id: 'x', user: 'user', version: 10, v: 100 });
      const copies = {};
      const result = source.copy(null, copies);
      assert.strictEqual(result.props.id, undefined);
      assert.strictEqual(result.props.user, undefined);
      assert.strictEqual(result.props.version, undefined);
      assert.strictEqual(result.props.v, undefined);
    });

    it('copies tags', () => {
      const source = new Rapid.OsmEntity(context, { id: 'x', tags: { foo: 'foo' }});
      const copies = {};
      const result = source.copy(null, copies);
      assert.deepEqual(result.tags, source.tags);
      assert.notStrictEqual(result.tags, source.tags);
    });
  });


  describe('#update', () => {
    it('returns a new Entity', () => {
      const a = new Rapid.OsmEntity(context);
      const b = a.update({});
      assert.ok(b instanceof Rapid.OsmEntity);
      assert.notStrictEqual(a, b);
    });

    it('updates the specified properties', () => {
      const tags = { foo: 'bar' };
      const result = new Rapid.OsmEntity(context).update({ tags: tags });
      assert.deepEqual(result.tags, tags);
    });

    it('preserves existing properties', () => {
      const result = new Rapid.OsmEntity(context, { id: 'w1' }).update({});
      assert.strictEqual(result.id, 'w1');
    });

    it('doesn\'t modify the input', () => {
      const props = { tags: { foo: 'bar' }};
      new Rapid.OsmEntity(context).update(props);
      assert.deepEqual(props, { tags: { foo: 'bar' }});
    });

    it('doesn\'t copy prototype properties', () => {
      const result = new Rapid.OsmEntity(context).update({});
      assert.ok(!result.hasOwnProperty('update'));
    });

    it('sets v if undefined', () => {
      const a = new Rapid.OsmEntity(context);
      const b = a.update({});
      assert.equal(typeof b.v, 'number');
    });

    it('updates v if already defined', () => {
      const a = new Rapid.OsmEntity(context, { v: 100 });
      const b = a.update({});
      assert.equal(typeof b.v, 'number');
      assert.notEqual(b.v, 100);
    });
  });


  describe('#updateSelf', () => {
    it('returns the same Entity', () => {
      const a = new Rapid.OsmEntity(context);
      const b = a.updateSelf({});
      assert.ok(b instanceof Rapid.OsmEntity);
      assert.strictEqual(a, b);
    });

    it('updates the specified properties', () => {
      const tags = { foo: 'bar' };
      const result = new Rapid.OsmEntity(context).updateSelf({ tags: tags });
      assert.deepEqual(result.tags, tags);
    });

    it('preserves existing properties', () => {
      const result = new Rapid.OsmEntity(context, { id: 'w1' }).updateSelf({});
      assert.strictEqual(result.id, 'w1');
    });

    it('doesn\'t modify the input', () => {
      const props = { tags: { foo: 'bar' }};
      new Rapid.OsmEntity(context).updateSelf(props);
      assert.deepEqual(props, { tags: { foo: 'bar' }});
    });

    it('doesn\'t copy prototype properties', () => {
      const result = new Rapid.OsmEntity(context).updateSelf({});
      assert.ok(!result.hasOwnProperty('updateSelf'));
    });

    it('sets v if undefined', () => {
      const a = new Rapid.OsmEntity(context);
      const b = a.updateSelf({});
      assert.equal(typeof b.v, 'number');
    });

    it('updates v if already defined', () => {
      const a = new Rapid.OsmEntity(context, { v: 100 });
      const b = a.updateSelf({});
      assert.equal(typeof b.v, 'number');
      assert.notEqual(b.v, 100);
    });
  });


  describe('#touch', () => {
    it('updates v in place', () => {
      const a = new Rapid.OsmEntity(context);
      const av = a.v;
      assert.equal(typeof av, 'number');
      assert.equal(av, 0);

      const b = a.touch();
      const bv = b.v;
      assert.equal(a, b);
      assert.equal(typeof bv, 'number');
      assert.notEqual(av, bv);
    });
  });

  describe('#mergeTags', () => {
    it('returns self if unchanged', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a'}});
      const b = a.mergeTags({a: 'a'});
      assert.equal(a, b);
    });

    it('returns a new Entity if changed', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a'}});
      const b = a.mergeTags({a: 'b'});
      assert.ok(b instanceof Rapid.OsmWay);
      assert.notEqual(a, b);
    });

    it('merges tags', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a'}});
      const b = a.mergeTags({b: 'b'});
      assert.deepEqual(b.tags, {a: 'a', b: 'b'});
    });

    it('combines non-conflicting tags', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a'}});
      const b = a.mergeTags({a: 'a'});
      assert.deepEqual(b.tags, {a: 'a'});
    });

    it('combines conflicting tags with semicolons', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a'}});
      const b = a.mergeTags({a: 'b'});
      assert.deepEqual(b.tags, {a: 'a;b'});
    });

    it('combines combined tags', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a;b'}});
      const b = new Rapid.OsmWay(context, {tags: {a: 'b'}});
      assert.deepEqual(a.mergeTags(b.tags).tags, {a: 'a;b'});
      assert.deepEqual(b.mergeTags(a.tags).tags, {a: 'b;a'});
    });

    it('combines combined tags with whitespace', () => {
      const a = new Rapid.OsmWay(context, {tags: {a: 'a; b'}});
      const b = new Rapid.OsmWay(context, {tags: {a: 'b'}});
      assert.deepEqual(a.mergeTags(b.tags).tags, {a: 'a;b'});
      assert.deepEqual(b.mergeTags(a.tags).tags, {a: 'b;a'});
    });

    it('does NOT combine building tags for new tag: building=yes', () => {
      const a = new Rapid.OsmWay(context, {tags: {building: 'residential'}});
      const b = a.mergeTags({building: 'yes'});
      assert.deepEqual(b.tags, {building: 'residential'});
    });

    it('does combine building tags if existing tag is building=yes', () => {
      const a = new Rapid.OsmWay(context, {tags: {building: 'yes'}});
      const b = a.mergeTags({building: 'residential'});
      assert.deepEqual(b.tags, {building: 'residential'});
    });

    it('keeps the existing building tag if the new tag is not building=yes', () => {
      const a = new Rapid.OsmWay(context, {tags: {building: 'residential'}});
      const b = a.mergeTags({building: 'house'});
      assert.deepEqual(b.tags, {building: 'residential'});
    });
  });


  describe('#osmId', () => {
    it('returns an OSM ID as a string', () => {
      assert.equal(new Rapid.OsmWay(context, {id: 'w1234'}).osmId(), '1234');
      assert.equal(new Rapid.OsmNode(context, {id: 'n1234'}).osmId(), '1234');
      assert.equal(new Rapid.OsmRelation(context, {id: 'r1234'}).osmId(), '1234');
      assert.equal(new Rapid.OsmChangeset(context, {id: 'c1234'}).osmId(), '1234');
    });
  });


  describe('#hasNonGeometryTags', () => {
    it('returns false for an entity without tags', () => {
      const node = new Rapid.OsmNode(context);
      assert.equal(node.hasNonGeometryTags(), false);
    });

    it('returns true for an entity with tags', () => {
      const node = new Rapid.OsmNode(context, {tags: {foo: 'bar'}});
      assert.equal(node.hasNonGeometryTags(), true);
    });

    it('returns false for an entity with only an area=yes tag', () => {
      const node = new Rapid.OsmNode(context, {tags: {area: 'yes'}});
      assert.equal(node.hasNonGeometryTags(), false);
    });
  });


  describe('#hasParentRelations', () => {
    it('returns true for an entity that is a relation member', () => {
      const node = new Rapid.OsmNode(context);
      const relation = new Rapid.OsmRelation(context, {members: [{id: node.id}]});
      const graph = new Rapid.Graph([node, relation]);
      assert.equal(node.hasParentRelations(graph), true);
    });

    it('returns false for an entity that is not a relation member', () => {
      const node = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph([node]);
      assert.equal(node.hasParentRelations(graph), false);
    });
  });


  // describe('#deprecatedTags', () => {
  //   const deprecated = [
  //     { old: { highway: 'no' } },
  //     { old: { amenity: 'toilet' }, replace: { amenity: 'toilets' } },
  //     { old: { speedlimit: '*' }, replace: { maxspeed: '$1' } },
  //     { old: { man_made: 'water_tank' }, replace: { man_made: 'storage_tank', content: 'water' } },
  //     { old: { amenity: 'gambling', gambling: 'casino' }, replace: { amenity: 'casino' } }
  //   ];

  //   it('returns none if entity has no tags', () => {
  //     const e = new Rapid.OsmEntity(context);
  //     assert.deepEqual(e.deprecatedTags(deprecated), []);
  //   });

  //   it('returns none when no tags are deprecated', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { amenity: 'toilets' } });
  //     assert.deepEqual(e.deprecatedTags(deprecated), []);
  //   });

  //   it('returns 1:0 replacement', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { highway: 'no' } });
  //     assert.deepEqual(
  //       e.deprecatedTags(deprecated),
  //       [{ old: { highway: 'no' }}]
  //     );
  //   });

  //   it('returns 1:1 replacement', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { amenity: 'toilet' } });
  //     assert.deepEqual(
  //       e.deprecatedTags(deprecated),
  //       [{ old: { amenity: 'toilet' }, replace: { amenity: 'toilets' } }]
  //     );
  //   });

  //   it('returns 1:1 wildcard', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { speedlimit: '50' } });
  //     assert.deepEqual(
  //       e.deprecatedTags(deprecated),
  //       [{ old: { speedlimit: '*' }, replace: { maxspeed: '$1' } }]
  //     );
  //   });

  //   it('returns 1:2 total replacement', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { man_made: 'water_tank' } });
  //     assert.deepEqual(
  //       e.deprecatedTags(deprecated),
  //       [{ old: { man_made: 'water_tank' }, replace: { man_made: 'storage_tank', content: 'water' } }]
  //     );
  //   });

  //   it('returns 1:2 partial replacement', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { man_made: 'water_tank', content: 'water' } });
  //     assert.deepEqual(
  //       e.deprecatedTags(deprecated),
  //       [{ old: { man_made: 'water_tank' }, replace: { man_made: 'storage_tank', content: 'water' } }]
  //     );
  //   });

  //   it('returns 2:1 replacement', () => {
  //     const e = new Rapid.OsmEntity(context, { tags: { amenity: 'gambling', gambling: 'casino' } });
  //     assert.deepEqual(
  //       e.deprecatedTags(deprecated),
  //       [{ old: { amenity: 'gambling', gambling: 'casino' }, replace: { amenity: 'casino' } }]
  //     );
  //   });
  // });


  describe('#hasInterestingTags', () => {
    it('returns false if the entity has no tags', () => {
      const e = new Rapid.OsmEntity(context);
      assert.equal(e.hasInterestingTags(), false);
    });

    it('returns true if the entity has tags other than \'attribution\', \'created_by\', \'source\', \'odbl\' and tiger tags', () => {
      const e = new Rapid.OsmEntity(context, {tags: {foo: 'bar'}});
      assert.equal(e.hasInterestingTags(), true);
    });

    it('return false if the entity has only uninteresting tags', () => {
      const e = new Rapid.OsmEntity(context, {tags: {source: 'Bing'}});
      assert.equal(e.hasInterestingTags(), false);
    });

    it('return false if the entity has only tiger tags', () => {
      const e = new Rapid.OsmEntity(context, {tags: {'tiger:source': 'blah', 'tiger:foo': 'bar'}});
      assert.equal(e.hasInterestingTags(), false);
    });
  });


  describe('#isHighwayIntersection', () => {
    it('returns false', () => {
      assert.equal(new Rapid.OsmEntity(context).isHighwayIntersection(), false);
    });
  });

  describe('#isDegenerate', () => {
    it('returns true', () => {
      assert.equal(new Rapid.OsmEntity(context).isDegenerate(), true);
    });
  });

});
