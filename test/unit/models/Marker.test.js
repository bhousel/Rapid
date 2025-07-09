import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Marker', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a Marker from a context', () => {
      const a = new Rapid.Marker(context);
      assert.instanceOf(a, Rapid.Marker);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
      assert.ok(a.id, 'an id should be generated');
    });

    it('constructs a Marker from a context, with props', () => {
      const props = { id: 'note1', loc: [0, 0] };
      const a = new Rapid.Marker(context, props);
      assert.instanceOf(a, Rapid.Marker);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      // `a.props` will be deep clone of props, possibly with other properties ('id') added.
      assert.deepInclude(a.props, props);
      assert.notStrictEqual(a.props, props);  // cloned, not ===
      assert.strictEqual(a.id, 'note1');
    });

    it('constructs a Marker from another Marker', () => {
      const a = new Rapid.Marker(context);
      const b = new Rapid.Marker(a);
      assert.instanceOf(b, Rapid.Marker);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
      assert.strictEqual(b.id, a.id, 'an id should be generated');
    });

    it('constructs a Marker from another Marker, with props', () => {
      const aprops = { id: 'note1', loc: [0, 0] };
      const bprops = { serviceID: 'osm' };
      const a = new Rapid.Marker(context, aprops);
      const b = new Rapid.Marker(a, bprops);
      assert.instanceOf(b, Rapid.Marker);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
    });
  });

  describe('destroy', () => {
    it('destroys and frees the data', () => {
      const a = new Rapid.Marker(context);
      a.destroy();
      assert.isNull(a.geoms);
      assert.isNull(a.props);
    });
  });

  describe('update', () => {
    it('returns a new Marker', () => {
      const a = new Rapid.Marker(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.Marker);
      assert.notStrictEqual(b, a);
    });

    it('updates the specified properties', () => {
      const a = new Rapid.Marker(context);
      const aprops = a.props;
      const update = { serviceID: 'osm' };
      const b = a.update(update);
      assert.instanceOf(b, Rapid.Marker);
      assert.notStrictEqual(b, a);
      const bprops = b.props;
      assert.notStrictEqual(bprops, aprops);   // new object, not ===
      assert.notStrictEqual(bprops, update);   // cloned, not ===
      assert.deepInclude(bprops, update);      // will also include a `v`
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.Marker(context);
      const aprops = a.props;
      const b = a.update();
      assert.instanceOf(b, Rapid.Marker);
      assert.notStrictEqual(b, a);
      const bprops = b.props;
      assert.notStrictEqual(bprops, aprops);   // new object, not ===
    });

    it('preserves existing properties', () => {
      const a = new Rapid.Marker(context, { id: 'note1', loc: [0, 0] });
      const aprops = a.props;
      const update = { serviceID: 'osm' };
      const b = a.update(update);
      assert.instanceOf(b, Rapid.Marker);
      assert.notStrictEqual(b, a);
      const bprops = b.props;
      assert.notStrictEqual(bprops, aprops);   // new object, not ===
      assert.notStrictEqual(bprops, update);   // cloned, not ===
      assert.deepInclude(bprops, { id: 'note1', loc: [0, 0], serviceID: 'osm' });  // will also include a `v`
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.Marker(context);
      const aprops = a.props;
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.doesNotHaveAnyKeys(b.props, ['constructor', '__proto__', 'toString']);
    });

    it('updates v', () => {
      const a = new Rapid.Marker(context);
      const v1 = a.v;
      const b = a.update({});
      assert.isAbove(b.v, v1);
    });
  });

  describe('updateGeometry', () => {
    it('updates the geometry', () => {
      const a = new Rapid.Marker(context);  // no loc
      let geoms = a.geoms;
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);

      a.updateSelf({ loc: [0, 0] });
      a.updateGeometry();

      geoms = a.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.isObject(geoms.world);
    });
  });

  describe('asGeoJSON', () => {
    it('returns a GeoJSON Feature with Point geometry', () => {
      const a = new Rapid.Marker(context, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
      const result = a.asGeoJSON();
      const expected = {
        type: 'Feature',
        id: 'note1',
        properties: { id: 'note1', loc: [0, 0], serviceID: 'osm' },
        geometry: {
          type: 'Point',
          coordinates: [0, 0]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('returns a GeoJSON Feature with null geometry if missing location', () => {
      const a = new Rapid.Marker(context, { id: 'note1', serviceID: 'osm' });
      const result = a.asGeoJSON();
      const expected = {
        type: 'Feature',
        id: 'note1',
        properties: { id: 'note1', serviceID: 'osm' },
        geometry: null
      };
      assert.deepEqual(result, expected);
    });
  });

  describe('loc', () => {
    it('gets loc', () => {
      const a = new Rapid.Marker(context, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
      assert.deepEqual(a.props.loc, [0, 0]);
      assert.deepEqual(a.loc, [0, 0]);
    });

    it('gets undefined if no loc', () => {
      const a = new Rapid.Marker(context, { id: 'note1' });
      assert.isUndefined(a.loc);
    });
  });

  describe('serviceID', () => {
    it('gets serviceID', () => {
      const a = new Rapid.Marker(context, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
      assert.strictEqual(a.props.serviceID, 'osm');
      assert.strictEqual(a.serviceID, 'osm');
    });

    it('gets undefined if no serviceID', () => {
      const a = new Rapid.Marker(context, { id: 'note1' });
      assert.isUndefined(a.serviceID);
    });
  });

  describe('isNew', () => {
    it('gets isNew', () => {
      const a = new Rapid.Marker(context, { id: 'note1', loc: [0, 0], serviceID: 'osm', isNew: true });
      assert.isTrue(a.props.isNew);
      assert.isTrue(a.isNew);
    });

    it('gets false if no isNew', () => {
      const a = new Rapid.Marker(context, { id: 'note1' });
      assert.isFalse(a.isNew);
    });
  });

});
