import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('dataID', () => {
  describe('makeDataID', () => {
    it('joins a spatial ID and a local ID with a colon', () => {
      assert.strictEqual(Rapid.makeDataID('osm-notes', '123'), 'osm-notes:123');
      assert.strictEqual(Rapid.makeDataID('fbRoads', 'abc:1'), 'fbRoads:abc:1');
    });

    it('returns bare IDs for OSM, or no spatial ID', () => {
      assert.strictEqual(Rapid.makeDataID('osm', 'w123'), 'w123');
      assert.strictEqual(Rapid.makeDataID(undefined, 'w123'), 'w123');
      assert.strictEqual(Rapid.makeDataID('', 'w123'), 'w123');
    });
  });

  describe('splitDataID', () => {
    it('splits on the first colon only', () => {
      assert.deepEqual(Rapid.splitDataID('osm-notes:123'), ['osm-notes', '123']);
      assert.deepEqual(Rapid.splitDataID('fbRoads:abc:1'), ['fbRoads', 'abc:1']);
      assert.deepEqual(Rapid.splitDataID('fbRoads.pieces:abc@0.25-0.5'), ['fbRoads.pieces', 'abc@0.25-0.5']);
    });

    it('treats a data ID with no colon as OSM', () => {
      assert.deepEqual(Rapid.splitDataID('w123'), ['osm', 'w123']);
      assert.deepEqual(Rapid.splitDataID('osm:w123'), ['osm', 'w123']);
    });
  });

  describe('osmEntityID', () => {
    it('returns the entity ID for OSM data IDs', () => {
      assert.strictEqual(Rapid.osmEntityID('w123'), 'w123');
      assert.strictEqual(Rapid.osmEntityID('osm:n-1'), 'n-1');
    });

    it('returns undefined for other spatial IDs', () => {
      assert.isUndefined(Rapid.osmEntityID('fbRoads:w-1000000000'));
      assert.isUndefined(Rapid.osmEntityID('osm-notes:123'));
    });
  });

  describe('isStableDataID', () => {
    it('is false for a local ID that GeoJSONData made up from a counter', () => {
      const context = new Rapid.MockContext();
      const d = new Rapid.GeoJSONData(context, { spatialID: 'overture-buildings', geojson: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } } });
      assert.isFalse(Rapid.isStableDataID(d.dataID));
    });

    it('is true for IDs that come from the data', () => {
      assert.isTrue(Rapid.isStableDataID('w123'));
      assert.isTrue(Rapid.isStableDataID('fbRoads:abc'));
      assert.isTrue(Rapid.isStableDataID('osm-notes:123'));
    });
  });

  describe('AbstractData.dataID', () => {
    const context = new Rapid.MockContext();

    it('is the bare id when there is no spatial ID', () => {
      const d = new Rapid.AbstractData(context, { id: 'w1' });
      assert.strictEqual(d.dataID, 'w1');
    });

    it('includes the spatial ID, and keeps it through `update()`', () => {
      const d = new Rapid.AbstractData(context, { id: '123', spatialID: 'osm-notes' });
      assert.strictEqual(d.dataID, 'osm-notes:123');
      assert.strictEqual(d.update({}).dataID, 'osm-notes:123');
    });
  });
});
