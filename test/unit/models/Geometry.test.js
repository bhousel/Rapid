import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './sample.js';


describe('Geometry', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      assert.instanceOf(geoms, Rapid.Geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);
    });
  });

  describe('destroy', () => {
    it('destroys a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.point);
      geoms.destroy();
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);
    });
  });

  describe('reset', () => {
    it('resets a Geometry', () => {  // reset and destroy do the same thing here
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.point);
      geoms.reset();
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 0);
      assert.isNull(geoms.orig);
      assert.isNull(geoms.world);
    });
  });

  describe('clone', () => {
    it('clones a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.point);

      const clone = geoms.clone();
      assert.notStrictEqual(clone, geoms);
      assert.strictEqual(clone.context, geoms.context);

      // parts
      assert.isArray(clone.parts);
      assert.lengthOf(clone.parts, 1);
      assert.notStrictEqual(clone.parts, geoms.parts);
      assert.notStrictEqual(clone.parts[0], geoms.parts[0]);
      assert.instanceOf(clone.parts[0], Rapid.GeometryPart);

      // orig
      assert.isObject(clone.orig);
      assert.notStrictEqual(clone.orig, geoms.orig);
      assert.instanceOf(clone.orig.extent, Rapid.sdk.Extent);
      assert.notStrictEqual(clone.orig.extent, geoms.orig.extent);
      assert.isOk(clone.orig.extent.equals(geoms.orig.extent));

      // world
      assert.isObject(clone.world);
      assert.notStrictEqual(clone.world, geoms.world);
      assert.instanceOf(clone.world.extent, Rapid.sdk.Extent);
      assert.notStrictEqual(clone.world.extent, geoms.world.extent);
      assert.isOk(clone.world.extent.equals(geoms.world.extent));
    });

    it('doesn\'t error on missing data', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.point);
      geoms.orig = null;
      geoms.world = null;

      const clone = geoms.clone();
      assert.isNull(clone.orig);
      assert.isNull(clone.world);
    });
  });

  describe('setData', () => {
    it('accepts a Point from a Feature', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.point);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a Point from a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.point.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a MultiPoint from a Feature', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.multipoint);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a MultiPoint from a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.multipoint.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a LineString from a Feature', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.linestring);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a LineString from a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.linestring.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a MultiLineString from a Feature', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.multilinestring);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a MultiLineString from a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.multilinestring.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a Polygon from a Feature', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.polygon);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a Polygon from a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.polygon.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 1);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a MultiPolygon from a Feature', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.multipolygon);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a MultiPolygon from a Geometry', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.multipolygon.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 2);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts multiple items from a FeatureCollection', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.featurecollection);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 3);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts multiple items from a Feature GeometryCollection', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.geometrycollection);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 3);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('accepts multiple items from a Geometry GeometryCollection', () => {
      const geoms = new Rapid.Geometry(context);
      geoms.setData(sample.geometrycollection.geometry);
      assert.isArray(geoms.parts);
      assert.lengthOf(geoms.parts, 3);
      assert.isObject(geoms.orig);
      assert.instanceOf(geoms.orig.extent, Rapid.sdk.Extent);
      assert.isObject(geoms.world);
      assert.instanceOf(geoms.world.extent, Rapid.sdk.Extent);
    });

    it('resets when passed other things', () => {
      const geoms = new Rapid.Geometry(context);

      geoms.setData();
      assert.isNull(geoms.orig);

      geoms.setData({});
      assert.isNull(geoms.orig);

      geoms.setData('hi');
      assert.isNull(geoms.orig);

      geoms.setData(sample.nullfeature);
      assert.isNull(geoms.orig);

      geoms.setData(sample.emptyfeaturecollection);
      assert.isNull(geoms.orig);

      geoms.setData(sample.nullpoint);
      assert.isNull(geoms.orig);
    });
  });

});
