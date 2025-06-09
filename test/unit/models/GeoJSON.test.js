import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('GeoJSON', () => {
  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();

  const point = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'Point',
      coordinates: [0, 0]
    }
  };
  const multipoint = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'MultiPoint',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    }
  };

  const linestring = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-1, 0], [0, 0], [1, 0]
      ]
    }
  };
  const multilinestring = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [[-1, 0], [0, 0], [1, 0]],
        [[-1, 2], [0, 2], [1, 2]]
      ]
    }
  };

  const polygon = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-5, -5], [5, -5], [5, -1], [-5, -1], [-5, -5]],  // outer, counterclockwise
        [[-4, -4], [-4, -2], [4, -2], [4, -4], [-4, -4]]   // hole, clockwise
      ]
    }
  };
  const multipolygon = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [[-5, -5], [5, -5], [5, -1], [-5, -1], [-5, -5]],  // outer, counterclockwise
          [[-4, -4], [-4, -2], [4, -2], [4, -4], [-4, -4]]   // hole, clockwise
        ], [
          [[-5, 1], [5, 1], [5, 5], [-5, 5], [-5, 1]],  // outer, counterclockwise
          [[-4, 2], [4, 2], [4, 4], [-4, 4], [-4, 2]]   // hole, clockwise
        ]
      ]
    }
  };

  const featurecollection = {
    type: 'FeatureCollection',
    properties: { foo: 'bar' },
    features: [
      point,
      linestring,
      polygon
    ]
  };

  const geometrycollection = {
    type: 'Feature',
    properties: { foo: 'bar' },
    geometry: {
      type: 'GeometryCollection',
      geometries: [
        point.geometry,
        linestring.geometry,
        polygon.geometry
      ]
    }
  };


  describe('constructor', () => {
    it('constructs empty data, but flags it as dirty', () => {
      const data = new Rapid.GeoJSON(context, {});
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isTrue(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 0);
    });

    it('constructs a Point from a Feature', () => {
      const data = new Rapid.GeoJSON(context, point);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 1);
    });

    it('constructs a Point from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, point.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 1);
    });

    it('constructs a MultiPoint from a Feature', () => {
      const data = new Rapid.GeoJSON(context, multipoint);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 2);
    });

    it('constructs a MultiPoint from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, multipoint.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 2);
    });

    it('constructs a LineString from a Feature', () => {
      const data = new Rapid.GeoJSON(context, linestring);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 1);
    });

    it('constructs a LineString from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, linestring.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 1);
    });

    it('constructs a MultiLineString from a Feature', () => {
      const data = new Rapid.GeoJSON(context, multilinestring);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 2);
    });

    it('constructs a MultiLineString from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, multilinestring.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 2);
    });

    it('constructs a Polygon from a Feature', () => {
      const data = new Rapid.GeoJSON(context, polygon);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 1);
    });

    it('constructs a Polygon from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, polygon.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 1);
    });

    it('constructs a MultiPolygon from a Feature', () => {
      const data = new Rapid.GeoJSON(context, multipolygon);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 2);
    });

    it('constructs a MultiPolygon from a Geometry', () => {
      const data = new Rapid.GeoJSON(context, multipolygon.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 2);
    });

    it('constructs multiple items from a FeatureCollection', () => {
      const data = new Rapid.GeoJSON(context, featurecollection);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 3);
    });

    it('constructs multiple items from a Feature GeometryCollection', () => {
      const data = new Rapid.GeoJSON(context, geometrycollection);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 3);
    });

    it('constructs multiple items from a Geometry GeometryCollection', () => {
      const data = new Rapid.GeoJSON(context, geometrycollection.geometry);
      assert.instanceOf(data, Rapid.GeoJSON);
      assert.isFalse(data.geoms.dirty);
      assert.lengthOf(data.geoms.parts, 3);
    });

  });

  describe('#extent', () => {
    it('returns null for empty GeoJSON', () => {
      const data = new Rapid.GeoJSON(context, {});
      const extent = data.extent();
      assert.isNull(extent);
    });

    it('returns a Point extent', () => {
      const data = new Rapid.GeoJSON(context, point);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([0, 0], [0, 0]));
    });

    it('returns a MultiPoint extent', () => {
      const data = new Rapid.GeoJSON(context, multipoint);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([0, 0], [1, 1]));
    });

    it('returns a LineString extent', () => {
      const data = new Rapid.GeoJSON(context, linestring);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-1, 0], [1, 0]));
    });

    it('returns a MultiLinestring extent', () => {
      const data = new Rapid.GeoJSON(context, multilinestring);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-1, 0], [1, 2]));
    });

    it('returns a Polygon extent', () => {
      const data = new Rapid.GeoJSON(context, polygon);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, -1]));
    });

    it('returns a MultiPolygon extent', () => {
      const data = new Rapid.GeoJSON(context, multipolygon);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, 5]));
    });

    it('returns a FeatureCollection extent', () => {
      const data = new Rapid.GeoJSON(context, featurecollection);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, 0]));
    });

    it('returns a GeometryCollection extent', () => {
      const data = new Rapid.GeoJSON(context, geometrycollection);
      const extent = data.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([-5, -5], [5, 0]));
    });
  });

  describe('#intersects', () => {
    it('returns true for a Point within the given extent', () => {
      const data = new Rapid.GeoJSON(context, point);
      const extent = new Rapid.sdk.Extent([-5, -5], [5, 5]);
      assert.isTrue(data.intersects(extent));
    });

    it('returns false for a Point outside the given extent', () => {
      const data = new Rapid.GeoJSON(context, point);
      const extent = new Rapid.sdk.Extent([-5, -5], [-1, -1]);
      assert.isFalse(data.intersects(extent));
    });

    it('returns false for empty GeoJSON', () => {
      const data = new Rapid.GeoJSON(context, {});
      const extent = new Rapid.sdk.Extent([-5, -5], [5, 5]);
      assert.isFalse(data.intersects(extent));
    });
  });

  describe('types', () => {
  });

});
