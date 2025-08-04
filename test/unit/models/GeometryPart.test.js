import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './sample.js';


describe('GeometryPart', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a GeometryPart', () => {
      const part = new Rapid.GeometryPart(context);
      assert.instanceOf(part, Rapid.GeometryPart);
      assert.isNotOk(part.type);
      assert.isNull(part.orig);
      assert.isNull(part.world);
    });
  });

  describe('destroy', () => {
    it('destroys a Geometry', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      part.destroy();
      assert.isNotOk(part.type);
      assert.isNull(part.orig);
      assert.isNull(part.world);
      assert.isNull(part.context);
    });
  });

  describe('reset', () => {
    it('resets a Geometry', () => {  // similar to destroy, but leave context alone
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      part.reset();
      assert.isNotOk(part.type);
      assert.isNull(part.orig);
      assert.isNull(part.world);
    });
  });

  describe('clone', () => {
    it('clones a Geometry', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);

      const clone = part.clone();
      assert.notStrictEqual(clone, part);
      assert.strictEqual(clone.context, part.context);
      assert.strictEqual(clone.type, part.type);

      // orig
      assert.isObject(clone.orig);
      assert.notStrictEqual(clone.orig, part.orig);
      assert.instanceOf(clone.orig.extent, Rapid.sdk.Extent);
      assert.notStrictEqual(clone.orig.extent, part.orig.extent);
      assert.isOk(clone.orig.extent.equals(part.orig.extent));

      // world
      assert.isObject(clone.world);
      assert.notStrictEqual(clone.world, part.world);
      assert.instanceOf(clone.world.extent, Rapid.sdk.Extent);
      assert.notStrictEqual(clone.world.extent, part.world.extent);
      assert.isOk(clone.world.extent.equals(part.world.extent));
    });

    it('doesn\'t error on missing data', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      part.orig = null;
      part.world = null;

      const clone = part.clone();
      assert.isNull(clone.orig);
      assert.isNull(clone.world);
    });
  });

  describe('setData', () => {
    it('accepts a Point from a Geometry', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      assert.strictEqual(part.type, 'Point');
      assert.isObject(part.orig);
      assert.instanceOf(part.orig.extent, Rapid.sdk.Extent);
      assert.isObject(part.world);
      assert.instanceOf(part.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a LineString from a Geometry', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.linestring.geometry);
      assert.strictEqual(part.type, 'LineString');
      assert.isObject(part.orig);
      assert.instanceOf(part.orig.extent, Rapid.sdk.Extent);
      assert.isObject(part.world);
      assert.instanceOf(part.world.extent, Rapid.sdk.Extent);
    });

    it('accepts a Polygon from a Geometry', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.polygon.geometry);
      assert.strictEqual(part.type, 'Polygon');
      assert.isObject(part.orig);
      assert.instanceOf(part.orig.extent, Rapid.sdk.Extent);
      assert.isObject(part.world);
      assert.instanceOf(part.world.extent, Rapid.sdk.Extent);
    });

    it('clones the original geojson geometry', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      assert.notStrictEqual(part.orig.geojson, sample.point.geometry);
      assert.deepEqual(part.orig.geojson, sample.point.geometry);
    });

    it('resets when passed other things', () => {
      const part = new Rapid.GeometryPart(context);

      part.setData();
      assert.isNull(part.orig);

      part.setData({});
      assert.isNull(part.orig);

      part.setData('hi');
      assert.isNull(part.orig);

      part.setData(sample.point);
      assert.isNull(part.orig);

      part.setData(sample.multipoint);
      assert.isNull(part.orig);

      part.setData(sample.multipoint.geometry);
      assert.isNull(part.orig);

      part.setData(sample.linestring);
      assert.isNull(part.orig);

      part.setData(sample.multilinestring);
      assert.isNull(part.orig);

      part.setData(sample.multilinestring.geometry);
      assert.isNull(part.orig);

      part.setData(sample.polygon);
      assert.isNull(part.orig);

      part.setData(sample.multipolygon);
      assert.isNull(part.orig);

      part.setData(sample.multipolygon.geometry);
      assert.isNull(part.orig);

      part.setData(sample.featurecollection);
      assert.isNull(part.orig);

      part.setData(sample.geometrycollection);
      assert.isNull(part.orig);

      part.setData(sample.geometrycollection.geometry);
      assert.isNull(part.orig);

      part.setData(sample.nullfeature);
      assert.isNull(part.orig);

      part.setData(sample.emptyfeaturecollection);
      assert.isNull(part.orig);

      part.setData(sample.nullpoint);
      assert.isNull(part.orig);
    });
  });

  describe('updateWorld', () => {
    it('calculates world coordinate data', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);

      assert.isObject(part.orig);
      assert.deepEqual(part.orig.coords, [0, 0]);
      assert.deepEqual(part.orig.extent, new Rapid.sdk.Extent([0, 0], [0, 0]));

      assert.isObject(part.world);
      assert.deepEqual(part.world.coords, [128, 128]);
      assert.deepEqual(part.world.extent, new Rapid.sdk.Extent([128, 128], [128, 128]));
      assert.deepEqual(part.world.centroid, [128, 128]);
      assert.deepEqual(part.world.poi, [128, 128]);
    });

    it('skips calculations if no original data', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      part.orig = null;
      part.world = null;

      part.updateWorld();
      assert.isNull(part.orig);
      assert.isNull(part.world);
    });
  });

});
