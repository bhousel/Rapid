import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './sample.js';


describe('GeoJSON', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs empty data, but flags it as dirty', () => {
      const data = new Rapid.GeoJSON(context, {});
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isObject(data.props);
      const geoms = data.geoms;
      assert.instanceOf(geoms, Rapid.Geometry);
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.world);
    });

    it('clones the original GeoJSON data into props', () => {
      const orig = { geojson: sample.point };
      const data = new Rapid.GeoJSON(context, orig);
      assert.deepInclude(data.props, orig);
      assert.notStrictEqual(data.props, orig);                  // cloned, not ===
      assert.notStrictEqual(data.props.geojson, sample.point);  // cloned, not ===
    });

    it('constructs a Point from a Feature', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.point });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a Point from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.point.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a MultiPoint from a Feature', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multipoint });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a MultiPoint from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multipoint.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a LineString from a Feature', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.linestring });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a LineString from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.linestring.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a MultiLineString from a Feature', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multilinestring });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a MultiLineString from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multilinestring.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a Polygon from a Feature', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.polygon });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a Polygon from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.polygon.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a MultiPolygon from a Feature', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multipolygon });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs a MultiPolygon from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multipolygon.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs multiple items from a FeatureCollection', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.featurecollection });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 3);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs multiple items from a Feature GeometryCollection', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.geometrycollection });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 3);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('constructs multiple items from a Geometry GeometryCollection', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.geometrycollection.geometry });
      assert.instanceOf(data, Rapid.GeoJSON);
      const geoms = data.geoms;
      assert.lengthOf(geoms.parts, 3);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });
  });

  describe('update', () => {
    it('returns a new GeoJSON element', () => {
      const a = new Rapid.GeoJSON(context, { geojson: sample.point });
      const b = a.update({});
      assert.instanceOf(b, Rapid.GeoJSON);
      assert.notStrictEqual(a, b);
    });
  });

  describe('updateSelf', () => {
    it('returns the same GeoJSON element', () => {
      const a = new Rapid.GeoJSON(context, { geojson: sample.point });
      const b = a.updateSelf({});
      assert.instanceOf(b, Rapid.GeoJSON);
      assert.strictEqual(a, b);
    });
  });

  describe('asGeoJSON', () => {
    it('returns the originally cloned GeoJSON data, stored in props', () => {
      const orig = { geojson: sample.point };
      const a = new Rapid.GeoJSON(context, orig);
      const result = a.asGeoJSON();
      // result will be a clone of sample.point, but with an `id` property added
      assert.deepInclude(result, sample.point);
      assert.notStrictEqual(result, sample.point);
    });
  });

  describe('properties', () => {
    it('gets the original geojson properties object', () => {
      const a = new Rapid.GeoJSON(context, { geojson: sample.point });
      assert.strictEqual(a.properties, a.props.geojson.properties);
    });

    it('returns an empty object if the source Feature has null properties', () => {
      const a = new Rapid.GeoJSON(context, { geojson: sample.nullfeature });
      assert.deepEqual(a.properties, {});
    });
  });

  describe('serviceID', () => {
    it('gets the serviceID property', () => {
      const a = new Rapid.GeoJSON(context, { serviceID: 'mapillary', geojson: sample.point });
      assert.strictEqual(a.serviceID, 'mapillary');
    });
  });

  describe('extent', () => {
    it('returns null for empty GeoJSON', () => {
      const data = new Rapid.GeoJSON(context, {});
      const extent = data.extent();
      assert.isNotOk(extent);
    });

    it('returns a Point extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.point });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([0, 0], [0, 0]));
    });

    it('returns a MultiPoint extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multipoint });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([0, 0], [1, 1]));
    });

    it('returns a LineString extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.linestring });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-1, 0], [1, 0]));
    });

    it('returns a MultiLinestring extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multilinestring });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-1, 0], [1, 2]));
    });

    it('returns a Polygon extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.polygon });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, -1]));
    });

    it('returns a MultiPolygon extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.multipolygon });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, 5]));
    });

    it('returns a FeatureCollection extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.featurecollection });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, 0]));
    });

    it('returns a GeometryCollection extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.geometrycollection });
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, 0]));
    });
  });

  describe('intersects', () => {
    it('returns true for a Point within the given extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.point });
      const extent = new Rapid.sdk.Extent([-5, -5], [5, 5]);
      assert.isTrue(data.intersects(extent));
    });

    it('returns false for a Point outside the given extent', () => {
      const data = new Rapid.GeoJSON(context, { geojson: sample.point });
      const extent = new Rapid.sdk.Extent([-5, -5], [-1, -1]);
      assert.isFalse(data.intersects(extent));
    });

    it('returns false for empty GeoJSON', () => {
      const data = new Rapid.GeoJSON(context, {});
      const extent = new Rapid.sdk.Extent([-5, -5], [5, 5]);
      assert.isFalse(data.intersects(extent));
    });
  });

});
