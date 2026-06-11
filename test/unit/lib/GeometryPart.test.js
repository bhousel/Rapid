import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from '../data/GeoJSONData.sample.js';


describe('GeometryPart', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a GeometryPart', () => {
      const part = new Rapid.GeometryPart(context);
      assert.instanceOf(part, Rapid.GeometryPart);
      assert.isNotOk(part.type);
      assert.isNull(part.orig);
      assert.isNull(part.world);
      assert.isNull(part.local);
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
      assert.isNull(part.local);
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
      assert.isNull(part.local);
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

      // local
      assert.isObject(clone.local);
      assert.notStrictEqual(clone.local, part.local);
      assert.instanceOf(clone.local.extent, Rapid.sdk.Extent);
      assert.notStrictEqual(clone.local.extent, part.local.extent);
      assert.isOk(clone.local.extent.equals(part.local.extent));
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

  describe('update', () => {
    it('calculates world coordinate data', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);

      assert.isObject(part.orig);
      assert.deepEqual(part.orig.coords, [0, 0]);
      assert.deepEqual(part.orig.extent, new Rapid.sdk.Extent([0, 0], [0, 0]));

      // World coords are z16 (WORLD_ZOOM=16): [0,0] lon/lat maps to [WORLD_HALF, WORLD_HALF]
      const WORLD_HALF = Rapid.sdk.WORLD_HALF;
      assert.isObject(part.world);
      assert.deepEqual(part.world.coords, [WORLD_HALF, WORLD_HALF]);
      assert.deepEqual(part.world.extent, new Rapid.sdk.Extent([WORLD_HALF, WORLD_HALF], [WORLD_HALF, WORLD_HALF]));
      assert.deepEqual(part.world.centroid, [WORLD_HALF, WORLD_HALF]);
      assert.deepEqual(part.world.poi, [WORLD_HALF, WORLD_HALF]);
    });

    it('keeps tiny polygon centroid inside projected extent', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({
        type: 'Polygon',
        coordinates: [[
          [-74.0000, 40.0000],
          [-73.99985, 40.0000],
          [-73.99985, 40.0001],
          [-74.0000, 40.0001],
          [-74.0000, 40.0000]
        ]]
      });

      assert.isObject(part.world);
      assert.isOk(part.world.centroid);
      assert.isAtLeast(part.world.centroid[0], part.world.extent.min[0]);
      assert.isAtMost(part.world.centroid[0], part.world.extent.max[0]);
      assert.isAtLeast(part.world.centroid[1], part.world.extent.min[1]);
      assert.isAtMost(part.world.centroid[1], part.world.extent.max[1]);
    });

    it('skips calculations if no original data', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);
      part.orig = null;
      part.world = null;

      part.update();
      assert.isNull(part.orig);
      assert.isNull(part.world);
    });

    it('computes local coordinate data', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(sample.point.geometry);

      // For a point, local coords should be [0, 0] since origin is the point itself
      assert.isObject(part.local);
      assert.deepEqual(part.local.coords, [0, 0]);
      assert.deepEqual(part.local.extent, new Rapid.sdk.Extent([0, 0], [0, 0]));
      assert.deepEqual(part.local.centroid, [0, 0]);
      assert.deepEqual(part.local.poi, [0, 0]);
    });

    it('local centroid is centered in local extent', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({
        type: 'Polygon',
        coordinates: [[
          [-74.0000, 40.0000],
          [-73.99985, 40.0000],
          [-73.99985, 40.0001],
          [-74.0000, 40.0001],
          [-74.0000, 40.0000]
        ]]
      });

      assert.isObject(part.local);
      assert.isOk(part.local.centroid);
      assert.isAtLeast(part.local.centroid[0], part.local.extent.min[0]);
      assert.isAtMost(part.local.centroid[0], part.local.extent.max[0]);
      assert.isAtLeast(part.local.centroid[1], part.local.extent.min[1]);
      assert.isAtMost(part.local.centroid[1], part.local.extent.max[1]);
    });

    it('world centroid is centered in world extent (derived from local)', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({
        type: 'Polygon',
        coordinates: [[
          [-74.0000, 40.0000],
          [-73.99985, 40.0000],
          [-73.99985, 40.0001],
          [-74.0000, 40.0001],
          [-74.0000, 40.0000]
        ]]
      });

      assert.isObject(part.world);
      assert.isOk(part.world.centroid);
      assert.isAtLeast(part.world.centroid[0], part.world.extent.min[0]);
      assert.isAtMost(part.world.centroid[0], part.world.extent.max[0]);
      assert.isAtLeast(part.world.centroid[1], part.world.extent.min[1]);
      assert.isAtMost(part.world.centroid[1], part.world.extent.max[1]);
    });
  });


  describe('lazy derived products', () => {
    const square = {
      type: 'Polygon',
      coordinates: [[ [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1] ]]
    };

    it('computes hull, area, and winding for a polygon', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(square);

      assert.isArray(part.local.hull);
      assert.isArray(part.world.hull);
      assert.isNumber(part.world.area);
      assert.isAbove(part.world.area, 0);
      assert.strictEqual(part.local.area, part.world.area);   // area is translation-invariant
      assert.oneOf(part.world.winding, [1, -1]);
      assert.strictEqual(part.local.winding, part.world.winding);
    });

    it('computes a surrounding rectangle for a polygon', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(square);

      assert.isObject(part.local.surround);
      assert.isObject(part.world.surround);
      assert.isNumber(part.world.surround.angle);
      assert.isArray(part.world.surround.polygon);
    });

    it('computes a flattened coordinate array for each ring', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(square);

      const flat = part.local.flat;
      assert.isArray(flat);
      assert.isArray(flat[0]);
      assert.lengthOf(flat[0], 10);   // 5 coordinate pairs -> 10 numbers
    });

    it('memoizes derived products (returns the same reference on repeated access)', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(square);

      assert.strictEqual(part.world.hull, part.world.hull);
      assert.strictEqual(part.local.flat, part.local.flat);
      assert.strictEqual(part.world.surround, part.world.surround);
    });

    it('LineString poi falls back to the centroid', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0.001], [0.002, 0]] });

      assert.isOk(part.world.centroid);
      assert.strictEqual(part.world.poi, part.world.centroid);
      assert.strictEqual(part.local.poi, part.local.centroid);
    });

    it('handles a two-coordinate line without computing rings', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0]] });

      assert.strictEqual(part.world.area, 0);
      assert.isUndefined(part.world.winding);
      assert.isUndefined(part.world.hull);
      assert.isUndefined(part.world.surround);
      assert.isOk(part.world.centroid);
      assert.deepEqual(part.world.poi, part.world.centroid);
    });

    it('clone re-derives equal derived products as independent arrays', () => {
      const part = new Rapid.GeometryPart(context);
      part.setData(square);

      const area = part.world.area;
      const hull = part.world.hull;

      const clone = part.clone();
      assert.strictEqual(clone.world.area, area);
      assert.deepEqual(clone.world.hull, hull);
      assert.notStrictEqual(clone.world.hull, hull);   // independent arrays
    });
  });

});
