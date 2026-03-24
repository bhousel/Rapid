import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('MarkerData', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a MarkerData from a context', () => {
      const a = new Rapid.MarkerData(context);
      assert.instanceOf(a, Rapid.MarkerData);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
      assert.ok(a.id, 'an id should be generated');
    });

    it('constructs a MarkerData from a context, with props', () => {
      const orig = { id: 'note1', loc: [0, 0] };
      const a = new Rapid.MarkerData(context, orig);
      assert.instanceOf(a, Rapid.MarkerData);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.notStrictEqual(a.props, orig);  // cloned, not ===
      assert.deepInclude(a.props, orig);
      assert.strictEqual(a.id, 'note1');
    });

    it('constructs a MarkerData from another MarkerData', () => {
      const a = new Rapid.MarkerData(context);
      const b = new Rapid.MarkerData(a);
      assert.instanceOf(b, Rapid.MarkerData);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
      assert.strictEqual(b.id, a.id, 'an id should be generated');
    });

    it('constructs a MarkerData from another MarkerData, with props', () => {
      const orig = { id: 'note1', loc: [0, 0] };
      const a = new Rapid.MarkerData(context, orig);
      const update = { serviceID: 'osm' };
      const b = new Rapid.MarkerData(a, update);
      assert.instanceOf(b, Rapid.MarkerData);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
      assert.strictEqual(a.id, 'note1');
    });
  });

  describe('update', () => {
    it('returns a new MarkerData', () => {
      const a = new Rapid.MarkerData(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.MarkerData);
      assert.notStrictEqual(a, b);
    });
  });

  describe('updateGeometry', () => {
    it('updates the geometry', () => {
      const a = new Rapid.MarkerData(context);  // no loc
      let geoms = a.geoms;
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);

      a.props.loc = [0, 0];
      a.touch();
      a.updateGeometry();

      geoms = a.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.isObject(geoms.world);
    });
  });

  describe('asGeoJSON', () => {
    it('returns a GeoJSONData Feature with Point geometry', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
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

    it('returns a GeoJSONData Feature with null geometry if missing location', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1', serviceID: 'osm' });
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
      const a = new Rapid.MarkerData(context, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
      assert.deepEqual(a.props.loc, [0, 0]);
      assert.deepEqual(a.loc, [0, 0]);
    });

    it('gets undefined if no loc', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1' });
      assert.isUndefined(a.loc);
    });
  });

  describe('serviceID', () => {
    it('gets serviceID', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1', loc: [0, 0], serviceID: 'osm' });
      assert.strictEqual(a.props.serviceID, 'osm');
      assert.strictEqual(a.serviceID, 'osm');
    });

    it('gets undefined if no serviceID', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1' });
      assert.isUndefined(a.serviceID);
    });
  });

  describe('isNew', () => {
    it('gets isNew', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1', loc: [0, 0], serviceID: 'osm', isNew: true });
      assert.isTrue(a.props.isNew);
      assert.isTrue(a.isNew);
    });

    it('gets false if no isNew', () => {
      const a = new Rapid.MarkerData(context, { id: 'note1' });
      assert.isFalse(a.isNew);
    });
  });

});
