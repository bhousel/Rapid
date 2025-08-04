import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';

const context = new Rapid.MockContext();


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


// This is an abstract class that shouldn't be instantiated in normal sitations.
describe('OsmEntity', () => {

  describe('constructor', () => {
    it('constructs an OsmEntity from a context', () => {
      const a = new Rapid.OsmEntity(context);
      assert.instanceOf(a, Rapid.OsmEntity);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
    });

    it('generates an empty tags object, if unset', () => {
      const a = new Rapid.OsmEntity(context);
      assert.deepEqual(a.props.tags, {});
    });

    it('constructs an OsmEntity from a context, with props', () => {
      const orig = { id: 'a', tags: { building: 'yes' } };
      const a = new Rapid.OsmEntity(context, orig);
      assert.instanceOf(a, Rapid.OsmEntity);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.notStrictEqual(a.props, orig);  // cloned, not ===
      assert.deepInclude(a.props, orig);
    });

    it('constructs an OsmEntity from another OsmEntity', () => {
      const a = new Rapid.OsmEntity(context);
      const b = new Rapid.OsmEntity(a);
      assert.instanceOf(b, Rapid.OsmEntity);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
    });

    it('constructs an OsmEntity from another OsmEntity, with props', () => {
      const orig = { id: 'a', tags: { building: 'yes' } };
      const a = new Rapid.OsmEntity(context, orig);
      const update = { foo: 'bar' };
      const b = new Rapid.OsmEntity(a, update);
      assert.instanceOf(b, Rapid.OsmEntity);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });
  });

  describe('destroy', () => {
    it('destroys and frees the data', () => {
      const a = new Rapid.OsmEntity(context);
      a.destroy();
      assert.isNull(a._transients);
    });
  });

  describe('update', () => {
    it('returns a new OsmEntity', () => {
      const a = new Rapid.OsmEntity(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.OsmEntity);
      assert.notStrictEqual(a, b);
    });
  });

  describe('updateSelf', () => {
    it('returns the same OsmEntity', () => {
      const a = new Rapid.OsmEntity(context);
      const b = a.updateSelf({});
      assert.instanceOf(b, Rapid.OsmEntity);
      assert.strictEqual(a, b);
    });
  });

  describe('asGeoJSON', () => {
    it('returns a GeoJSON Feature with null geometry', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' }});
      const result = a.asGeoJSON();
      const expected = {
        type: 'Feature',
        id: 'a',
        properties: { amenity: 'cafe' },
        geometry: null
      };
      assert.deepEqual(result, expected);
    });
  });

  describe('asJSON', () => {
    it('returns a JSON representation of the OsmEntity', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' }});
      const result = a.asJSON();
      assert.deepEqual(result, a.props);  // it's just the props
    });
  });

  describe('asJXON', () => {
    it('throws when calling OsmEntity.asJXON', () => {
      const a = new Rapid.OsmEntity(context);
      assert.throws(() => a.asJXON(), /do not call/i);
    });
  });

  describe('updateGeometry', () => {
    it('updates the geometry', () => {
      const a = new Rapid.OsmEntity(context);
      let geoms = a.geoms;
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);

      // generic OsmEntity has no geometry, so nothing will happen
      a.updateGeometry();

      geoms = a.geoms;
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);
    });
  });

  describe('extent', () => {
    it('doesn\'t return an extent', () => {
      const a = new Rapid.OsmEntity(context);
      assert.isNotOk(a.extent());
    });
  });

  describe('intersects', () => {
    it('doesn\'t intersect anything', () => {
      const a = new Rapid.OsmEntity(context);
      const extent = new Rapid.sdk.Extent([-180, -90], [180, 90]);
      assert.isFalse(a.intersects(extent));
    });
  });

  describe('touch', () => {
    it('updates v in place', () => {
      const a = new Rapid.OsmEntity(context);
      const v1 = a.v;
      a.touch();
      assert.isAbove(a.v, v1);
    });
  });

  describe('transient', () => {
    it('sets/gets transient values', () => {
      const a = new Rapid.OsmEntity(context);
      const obj = {};
      a.transient('test', () => obj);  // set
      const v = a.transient('test');   // get
      assert.strictEqual(v, obj);
    });
  });

  describe('tags', () => {
    it('gets tags', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' } });
      assert.deepEqual(a.tags, { amenity: 'cafe' });
    });
  });

  describe('visible', () => {
    it('gets visible', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' }, visible: false });
      assert.isFalse(a.visible);
    });

    it('gets true if no visible', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' } });
      assert.isTrue(a.visible);
    });

    it('sets visible', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' }, visible: true });
      a.visible = false;
      assert.isFalse(a.props.visible);
      assert.isFalse(a.visible);
    });
  });

  describe('version', () => {
    it('gets version', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' }, version: '5' });
      assert.strictEqual(a.props.version, '5');
      assert.strictEqual(a.version, '5');
    });

    it('gets undefined if no version', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' } });
      assert.isUndefined(a.version);
    });

    it('sets version', () => {
      const a = new Rapid.OsmEntity(context, { id: 'a', tags: { amenity: 'cafe' } });
      a.version = '5';
      assert.strictEqual(a.props.version, '5');
      assert.strictEqual(a.version, '5');
    });
  });


  describe('.id', () => {
    it('generates unique IDs', () => {
      const a = new Rapid.OsmNode(context);
      const b = new Rapid.OsmNode(context);
      assert.notEqual(a.id, b.id);
    });

    describe('.fromOSM', () => {
      it('returns a ID string unique across entity types', () => {
        assert.strictEqual(Rapid.OsmEntity.fromOSM('node', '1'), 'n1');
      });
    });

    describe('.toOSM', () => {
      it('reverses fromOSM', () => {
        const id = Rapid.OsmEntity.fromOSM('node', '1');
        assert.strictEqual(Rapid.OsmEntity.toOSM(id), '1');
      });
    });
  });

  describe('copy', () => {
    it('returns a new OsmEntity', () => {
      const source = new Rapid.OsmEntity(context, { id: 'a' });
      const result = source.copy(null, {});
      assert.instanceOf(result, Rapid.OsmEntity);
      assert.notStrictEqual(source, result);
    });

    it('adds the new OsmEntity to the memo object', () => {
      const source = new Rapid.OsmEntity(context, { id: 'a' });
      const copies = {};
      const result = source.copy(null, copies);
      assert.hasAllKeys(copies, ['a']);
      assert.strictEqual(copies.a, result);
    });

    it('returns an existing copy in memo object', () => {
      const source = new Rapid.OsmEntity(context, { id: 'a' });
      const copies = {};
      const result1 = source.copy(null, copies);
      const result2 = source.copy(null, copies);
      assert.hasAllKeys(copies, ['a']);
      assert.strictEqual(result1, result2);
    });

    it('resets \'id\', \'user\', \'version\', and \'v\' properties', () => {
      const source = new Rapid.OsmEntity(context, { id: 'a', user: 'user', version: 10, v: 100 });
      const copies = {};
      const result = source.copy(null, copies);
      assert.isUndefined(result.props.id);
      assert.isUndefined(result.props.user);
      assert.isUndefined(result.props.version);
      assert.isUndefined(result.props.v);
    });

    it('copies tags', () => {
      const source = new Rapid.OsmEntity(context, { id: 'a', tags: { foo: 'foo' }});
      const copies = {};
      const result = source.copy(null, copies);
      assert.deepEqual(result.tags, source.tags);
      assert.notStrictEqual(result.tags, source.tags);
    });
  });


  describe('mergeTags', () => {
    it('returns self if unchanged', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a' }});
      const b = a.mergeTags({ a: 'a' });
      assert.strictEqual(a, b);
    });

    it('returns a new OsmEntity if changed', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a' }});
      const b = a.mergeTags({ a: 'b' });
      assert.ok(b instanceof Rapid.OsmWay);
      assert.notEqual(a, b);
    });

    it('merges tags', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a' }});
      const b = a.mergeTags({ b: 'b' });
      assert.deepEqual(b.tags, { a: 'a', b: 'b' });
    });

    it('combines non-conflicting tags', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a' }});
      const b = a.mergeTags({ a: 'a' });
      assert.deepEqual(b.tags, { a: 'a' });
    });

    it('combines conflicting tags with semicolons', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a' }});
      const b = a.mergeTags({ a: 'b' });
      assert.deepEqual(b.tags, { a: 'a;b' });
    });

    it('combines combined tags', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a;b' }});
      const b = new Rapid.OsmWay(context, { tags: { a: 'b' }});
      assert.deepEqual(a.mergeTags(b.tags).tags, { a: 'a;b' });
      assert.deepEqual(b.mergeTags(a.tags).tags, { a: 'b;a' });
    });

    it('combines combined tags with whitespace', () => {
      const a = new Rapid.OsmWay(context, { tags: { a: 'a;    b' }});
      const b = new Rapid.OsmWay(context, { tags: { a: 'b' }});
      assert.deepEqual(a.mergeTags(b.tags).tags, { a: 'a;b' });
      assert.deepEqual(b.mergeTags(a.tags).tags, { a: 'b;a' });
    });

    it('does NOT combine building tags for new tag: building=yes', () => {
      const a = new Rapid.OsmWay(context, { tags: { building: 'residential' }});
      const b = a.mergeTags({ building: 'yes' });
      assert.deepEqual(b.tags, { building: 'residential' });
    });

    it('does combine building tags if existing tag is building=yes', () => {
      const a = new Rapid.OsmWay(context, { tags: { building: 'yes' }});
      const b = a.mergeTags({ building: 'residential' });
      assert.deepEqual(b.tags, { building: 'residential' });
    });

    it('keeps the existing building tag if the new tag is not building=yes', () => {
      const a = new Rapid.OsmWay(context, { tags: { building: 'residential' }});
      const b = a.mergeTags({ building: 'house' });
      assert.deepEqual(b.tags, { building: 'residential' });
    });
  });


  describe('osmId', () => {
    it('returns an OSM ID as a string', () => {
      assert.strictEqual(new Rapid.OsmWay(context, { id: 'w1234' }).osmId(), '1234');
      assert.strictEqual(new Rapid.OsmNode(context, { id: 'n1234' }).osmId(), '1234');
      assert.strictEqual(new Rapid.OsmRelation(context, { id: 'r1234' }).osmId(), '1234');
      assert.strictEqual(new Rapid.OsmChangeset(context, { id: 'c1234' }).osmId(), '1234');
    });
  });


  describe('hasNonGeometryTags', () => {
    it('returns false for an OsmEntity without tags', () => {
      const node = new Rapid.OsmNode(context);
      assert.isFalse(node.hasNonGeometryTags());
    });

    it('returns true for an OsmEntity with tags', () => {
      const node = new Rapid.OsmNode(context, { tags: { foo: 'bar' }});
      assert.isTrue(node.hasNonGeometryTags());
    });

    it('returns false for an OsmEntity with only an area=yes tag', () => {
      const node = new Rapid.OsmNode(context, { tags: { area: 'yes'}});
      assert.isFalse(node.hasNonGeometryTags());
    });
  });


  describe('hasParentRelations', () => {
    it('returns true for an OsmEntity that is a relation member', () => {
      const node = new Rapid.OsmNode(context);
      const relation = new Rapid.OsmRelation(context, {members: [{id: node.id}]});
      const graph = new Rapid.Graph(context, [node, relation]);
      assert.isTrue(node.hasParentRelations(graph));
    });

    it('returns false for an OsmEntity that is not a relation member', () => {
      const node = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph(context, [node]);
      assert.isFalse(node.hasParentRelations(graph));
    });
  });


  describe('hasInterestingTags', () => {
    it('returns false if there are no tags', () => {
      const e = new Rapid.OsmEntity(context);
      assert.isFalse(e.hasInterestingTags());
    });

    it('returns true there are tags other than \'attribution\', \'created_by\', \'source\', \'odbl\' and tiger tags', () => {
      const e = new Rapid.OsmEntity(context, { tags: { foo: 'bar' }});
      assert.isTrue(e.hasInterestingTags());
    });

    it('return false if there are only uninteresting tags', () => {
      const e = new Rapid.OsmEntity(context, { tags: { source: 'Bing' }});
      assert.isFalse(e.hasInterestingTags());
    });

    it('return false if there are only tiger tags', () => {
      const e = new Rapid.OsmEntity(context, { tags: { 'tiger:source': 'blah', 'tiger:foo': 'bar' }});
      assert.isFalse(e.hasInterestingTags());
    });
  });


  describe('isHighwayIntersection', () => {
    it('returns false', () => {
      const e = new Rapid.OsmEntity(context);
      assert.isFalse(e.isHighwayIntersection());
    });
  });

  describe('isDegenerate', () => {
    it('returns true', () => {
      const e = new Rapid.OsmEntity(context);
      assert.isTrue(e.isDegenerate());
    });
  });

});
