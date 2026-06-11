import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// helper functions
// Generate a spatialID for a legacy method that appends -data or -tiles
function sid(legacyID, suffix) {
  return `${legacyID}-${suffix}`;
}
// Build a generic SpatialItem with a small world-coordinate extent
function createItem(id, locWgs84, contents, half = 0.001) {
  const [x, y] = Rapid.sdk.projWgs84ToWorld(locWgs84);
  const extent = new Rapid.sdk.Extent([x - half, y - half], [x + half, y + half]);
  return { id, extent, contents: contents ?? { id } };
}
// Build a world-coordinate search box around a [lon,lat]
function worldBox(locWgs84, half = 0.01) {
  const [x, y] = Rapid.sdk.projWgs84ToWorld(locWgs84);
  return { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
}


describe('SpatialSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a SpatialSystem from a context', () => {
        const spatial = new Rapid.SpatialSystem(context);
        assert.instanceOf(spatial, Rapid.SpatialSystem);
        assert.strictEqual(spatial.id, 'spatial');
        assert.strictEqual(spatial.context, context);
        assert.instanceOf(spatial.requiredDependencies, Set);
        assert.instanceOf(spatial.optionalDependencies, Set);
        assert.isTrue(spatial.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const spatial = new Rapid.SpatialSystem(context);
        const prom = spatial.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const spatial = new Rapid.SpatialSystem(context);
        spatial.requiredDependencies.add('missing');
        const prom = spatial.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const spatial = new Rapid.SpatialSystem(context);
        const prom = spatial.initAsync().then(() => spatial.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(spatial.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const spatial = new Rapid.SpatialSystem(context);
        const prom = spatial.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _spatial;

    beforeAll(() => {
      // Set up viewport for testing
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];

      _spatial = new Rapid.SpatialSystem(context);
      return _spatial.initAsync().then(() => _spatial.startAsync());
    });

    // Helper to create mock data
    function createMockData(dataID, locWgs84, extentSize = 0.001) {
      const data = new Rapid.AbstractData(context, { id: dataID });
      const [x, y] = Rapid.sdk.projWgs84ToWorld(locWgs84);
      const extent = new Rapid.sdk.Extent([x - extentSize, y - extentSize], [x + extentSize, y + extentSize]);
      data.geoms.world = { extent };
      return data;
    }

    // Helper to create mock tile
    function createMockTile(_tileID, locWgs84) {
      const tiler = new Rapid.sdk.Tiler();
      // Create a tile at the given location by using a small viewport.
      // The SDK's worldToScreen formula is: screen = (world - WORLD_HALF) * scale + [tx, ty]
      // With z=WORLD_ZOOM=16, scale=1. For screen [0,0] to map to [wx, wy]:
      //   tx = -(wx - WORLD_HALF), ty = -(wy - WORLD_HALF)
      const [wx, wy] = Rapid.sdk.projWgs84ToWorld(locWgs84);
      const tx = -(wx - Rapid.sdk.WORLD_HALF);
      const ty = -(wy - Rapid.sdk.WORLD_HALF);
      const v = new Rapid.sdk.Viewport({ x: tx, y: ty, z: 16 }, [256, 256]);
      const tiles = tiler.getTiles(v).tiles;
      return tiles.length > 0 ? tiles[0] : null;
    }


    describe('getCache', () => {
      it('creates and returns a spatial cache', () => {
        const spatialID = `test-data1`;
        const cache = _spatial.getCache(spatialID);
        assert.isObject(cache);
        assert.strictEqual(cache.id, spatialID);
        assert.instanceOf(cache.boxes, Map);
        assert.isObject(cache.rbush);
      });

      it('returns the same cache on repeated calls', () => {
        const spatialID = `test-data2`;
        const cache1 = _spatial.getCache(spatialID);
        const cache2 = _spatial.getCache(spatialID);
        assert.strictEqual(cache1, cache2);
      });
    });


    describe('generic item helpers', () => {
      it('getItem returns a previously inserted item', () => {
        const spatialID = 'test-generic-item';
        const item = createItem('item1', [10, 0], { foo: 'bar' });
        _spatial.replaceItems(spatialID, item);

        const found = _spatial.getItem(spatialID, 'item1');
        assert.deepStrictEqual(found, { foo: 'bar' });
      });

      it('getAllItems returns all inserted items', () => {
        const spatialID = 'test-generic-all';
        _spatial.replaceItems(spatialID, [
          createItem('a', [10, 0], { id: 'a' }),
          createItem('b', [11, 0], { id: 'b' })
        ]);

        const all = _spatial.getAllItems(spatialID);
        assert.lengthOf(all, 2);
      });

      it('hasItem returns true for existing item ids', () => {
        const spatialID = 'test-generic-has';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));
        assert.isTrue(_spatial.hasItem(spatialID, 'a'));
      });

      it('hasItemsAtBox and hasItemsAtLoc detect indexed items', () => {
        const spatialID = 'test-generic-collide';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const box = worldBox([10, 0]);
        assert.isTrue(_spatial.hasItemsAtBox(spatialID, box));
        assert.isTrue(_spatial.hasItemsAtLoc(spatialID, [10, 0]));
      });

      it('getItemsAtLoc returns hits at a location', () => {
        const spatialID = 'test-generic-atloc';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const hits = _spatial.getItemsAtLoc(spatialID, [10, 0]);
        assert.lengthOf(hits, 1);
        assert.strictEqual(hits[0].boxID, 'a');
      });

      it('preventCoincidentItemLoc nudges to a non-colliding location', () => {
        const spatialID = 'test-generic-prevent';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0], { id: 'a' }, 1e-8));

        const result = _spatial.preventCoincidentItemLoc(spatialID, [10, 0]);
        assert.isArray(result);
        assert.closeTo(result[0], 10, 0.0001);
        assert.isBelow(result[1], 0);
      });
    });


    describe('clearCache', () => {
      it('clears all data for a given spatialID', () => {
        const spatialID = 'test-clear';
        const item = createItem('seg1', [10, 0], { kind: 'segment' });
        _spatial.replaceItems(spatialID, item);

        const cache = _spatial.getCache(spatialID);
        assert.lengthOf(cache.boxes, 1);

        _spatial.clearCache(spatialID);
        assert.isEmpty(cache.boxes);
      });
    });


    describe('clearMatching', () => {
      it('clears only cachees matching the predicate', () => {
        const spatialID1 = 'test-ok1';
        const spatialID2 = 'test-ok2';
        const spatialID3 = 'test-no3';
        const data = createMockData('data10', [10, 0]);
        const tile = createMockTile('34589,32769,16', [10, 0]);

        _spatial.addData(spatialID1, data);
        _spatial.addTiles(spatialID1, tile);
        _spatial.addData(spatialID2, data);
        _spatial.addTiles(spatialID2, tile);
        _spatial.addData(spatialID3, data);
        _spatial.addTiles(spatialID3, tile);

        _spatial.clearMatching(id => id.startsWith('test-ok'));

        assert.isEmpty(_spatial.getCache(sid(spatialID1, 'data')).boxes);
        assert.isEmpty(_spatial.getCache(sid(spatialID1, 'tiles')).boxes);

        assert.isEmpty(_spatial.getCache(sid(spatialID2, 'data')).boxes);
        assert.isEmpty(_spatial.getCache(sid(spatialID2, 'tiles')).boxes);

        assert.hasAllKeys(_spatial.getCache(sid(spatialID3, 'data')).boxes, ['data10']);
        assert.hasAllKeys(_spatial.getCache(sid(spatialID3, 'tiles')).boxes, ['34589,32769,16']);
      });
    });


    describe('addData', () => {
      it('adds a single data item', () => {
        const spatialID = 'test-add-data-1';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        assert.isTrue(_spatial.hasData(spatialID, 'data1'));
        assert.strictEqual(_spatial.getData(spatialID, 'data1'), data);
      });

      it('adds multiple data items', () => {
        const spatialID = 'test-add-data-2';
        const data1 = createMockData('data1', [10, 0]);
        const data2 = createMockData('data2', [11, 0]);
        _spatial.addData(spatialID, [data1, data2]);

        assert.isTrue(_spatial.hasData(spatialID, 'data1'));
        assert.isTrue(_spatial.hasData(spatialID, 'data2'));
      });

      it('ignores null/undefined items', () => {
        const spatialID = 'test-add-data-null';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, [data, null, undefined]);

        assert.strictEqual(_spatial.getCache(`${spatialID}-data`).boxes.size, 1);
        assert.isTrue(_spatial.hasData(spatialID, 'data1'));
      });

      it('skips data without extent', () => {
        const spatialID = 'test-add-data-no-extent';
        const data = new Rapid.AbstractData(context, { id: 'data1' });
        // data has no geoms.world.extent
        _spatial.addData(spatialID, data);

        assert.isFalse(_spatial.hasData(spatialID, 'data1'));
      });
    });


    describe('replaceData', () => {
      it('replaces existing data item', () => {
        const spatialID = 'test-replace-data';
        const data1 = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data1);

        const data2 = createMockData('data1', [11, 0]);
        _spatial.replaceData(spatialID, data2);

        assert.strictEqual(_spatial.getCache(`${spatialID}-data`).boxes.size, 1);
        assert.strictEqual(_spatial.getData(spatialID, 'data1'), data2);
      });

      it('adds new data if not existing', () => {
        const spatialID = 'test-replace-new';
        const data = createMockData('data1', [10, 0]);
        _spatial.replaceData(spatialID, data);

        assert.isTrue(_spatial.hasData(spatialID, 'data1'));
      });
    });


    describe('removeData', () => {
      it('removes data by data object', () => {
        const spatialID = 'test-remove-data-1';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        _spatial.removeData(spatialID, data);
        assert.isFalse(_spatial.hasData(spatialID, 'data1'));
      });

      it('removes data by dataID', () => {
        const spatialID = 'test-remove-data-2';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        _spatial.removeData(spatialID, 'data1');
        assert.isFalse(_spatial.hasData(spatialID, 'data1'));
      });

      it('removes multiple data items', () => {
        const spatialID = 'test-remove-data-3';
        const data1 = createMockData('data1', [10, 0]);
        const data2 = createMockData('data2', [11, 0]);
        _spatial.addData(spatialID, [data1, data2]);

        _spatial.removeData(spatialID, ['data1', 'data2']);
        assert.isEmpty(_spatial.getCache(`${spatialID}-data`).boxes);
      });

      it('handles removing non-existent data', () => {
        const spatialID = 'test-remove-nonexistent';
        _spatial.removeData(spatialID, 'nonexistent');
        // Should not throw
        assert.isTrue(true);
      });
    });


    describe('getData', () => {
      it('returns data by dataID', () => {
        const spatialID = 'test-get-data';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        const result = _spatial.getData(spatialID, 'data1');
        assert.strictEqual(result, data);
      });

      it('returns undefined for non-existent data', () => {
        const result = _spatial.getData('test-nonexistent', 'data1');
        assert.isUndefined(result);
      });
    });


    describe('hasData', () => {
      it('returns true if data exists', () => {
        const spatialID = 'test-has-data';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        assert.isTrue(_spatial.hasData(spatialID, 'data1'));
      });

      it('returns false if data does not exist', () => {
        assert.isFalse(_spatial.hasData('test-nonexistent', 'data1'));
      });
    });


    describe('getDataAtBox', () => {
      it('returns data within a bounding box', () => {
        const spatialID = 'test-data-at-box';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        const [x, y] = Rapid.sdk.projWgs84ToWorld([10, 0]);
        const box = { minX: x - 0.01, minY: y - 0.01, maxX: x + 0.01, maxY: y + 0.01 };
        const results = _spatial.getDataAtBox(spatialID, box);

        assert.isArray(results);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, data);
      });

      it('returns empty array when no data in box', () => {
        const spatialID = 'test-empty-box';
        const box = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
        const results = _spatial.getDataAtBox(spatialID, box);

        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('hasDataAtBox', () => {
      it('returns true if data exists in box', () => {
        const spatialID = 'test-has-data-box';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        const [x, y] = Rapid.sdk.projWgs84ToWorld([10, 0]);
        const box = { minX: x - 0.01, minY: y - 0.01, maxX: x + 0.01, maxY: y + 0.01 };
        assert.isTrue(_spatial.hasDataAtBox(spatialID, box));
      });

      it('returns false if no data in box', () => {
        const spatialID = 'test-no-data-box';
        const box = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
        assert.isFalse(_spatial.hasDataAtBox(spatialID, box));
      });
    });


    describe('getDataAtLoc', () => {
      it('returns data at a specific location', () => {
        const spatialID = 'test-data-at-loc';
        const loc = [10, 0];
        const data = createMockData('data1', loc);
        _spatial.addData(spatialID, data);

        const results = _spatial.getDataAtLoc(spatialID, loc);
        assert.isArray(results);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, data);
      });

      it('returns empty array when no data at location', () => {
        const spatialID = 'test-empty-loc';
        const results = _spatial.getDataAtLoc(spatialID, [50, 50]);
        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('hasDataAtLoc', () => {
      it('returns true if data exists at location', () => {
        const spatialID = 'test-has-data-loc';
        const loc = [10, 0];
        const data = createMockData('data1', loc);
        _spatial.addData(spatialID, data);

        assert.isTrue(_spatial.hasDataAtLoc(spatialID, loc));
      });

      it('returns false if no data at location', () => {
        const spatialID = 'test-no-data-loc';
        assert.isFalse(_spatial.hasDataAtLoc(spatialID, [50, 50]));
      });
    });


    describe('addTiles', () => {
      it('adds a single tile', () => {
        const spatialID = 'test-add-tile-1';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        assert.isTrue(_spatial.hasTile(spatialID, tile.id));
      });

      it('adds multiple tiles', () => {
        const spatialID = 'test-add-tile-2';
        const tile1 = createMockTile('tile1', [10, 0]);
        const tile2 = createMockTile('tile2', [11, 0]);
        if (!tile1 || !tile2) {
          assert.fail('Failed to create mock tiles');
          return;
        }

        _spatial.addTiles(spatialID, [tile1, tile2]);
        assert.isTrue(_spatial.hasTile(spatialID, tile1.id));
        assert.isTrue(_spatial.hasTile(spatialID, tile2.id));
      });

      it('skips duplicate tiles', () => {
        const spatialID = 'test-add-tile-dup';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        _spatial.addTiles(spatialID, tile);  // add again

        assert.strictEqual(_spatial.getCache(`${spatialID}-tiles`).boxes.size, 1);
      });

      it('ignores null/undefined tiles', () => {
        const spatialID = 'test-add-tile-null';
        const tile = createMockTile('tile1', [10, 0]);
        _spatial.addTiles(spatialID, [tile, null, undefined]);

        assert.strictEqual(_spatial.getCache(`${spatialID}-tiles`).boxes.size, 1);
      });
    });


    describe('removeTiles', () => {
      it('removes tile by tile object', () => {
        const spatialID = 'test-remove-tile-1';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        _spatial.removeTiles(spatialID, tile);

        assert.isFalse(_spatial.hasTile(spatialID, tile.id));
      });

      it('removes tile by tileID', () => {
        const spatialID = 'test-remove-tile-2';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        _spatial.removeTiles(spatialID, tile.id);

        assert.isFalse(_spatial.hasTile(spatialID, tile.id));
      });
    });


    describe('getTile', () => {
      it('returns tile by tileID', () => {
        const spatialID = 'test-get-tile';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        const result = _spatial.getTile(spatialID, tile.id);
        assert.strictEqual(result, tile);
      });

      it('returns undefined for non-existent tile', () => {
        const result = _spatial.getTile('test-nonexistent', 'tile1');
        assert.isUndefined(result);
      });
    });


    describe('hasTile', () => {
      it('returns true if tile exists', () => {
        const spatialID = 'test-has-tile';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        assert.isTrue(_spatial.hasTile(spatialID, tile.id));
      });

      it('returns false if tile does not exist', () => {
        assert.isFalse(_spatial.hasTile('test-nonexistent', 'tile1'));
      });
    });


    describe('hasTileAtBox', () => {
      it('returns true if tile exists in box', () => {
        const spatialID = 'test-has-tile-box';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);

        const [x, y] = Rapid.sdk.projWgs84ToWorld([10, 0]);
        const box = { minX: x - 1000, minY: y - 1000, maxX: x + 1000, maxY: y + 1000 };
        assert.isTrue(_spatial.hasTileAtBox(spatialID, box));
      });

      it('returns false if no tile in box', () => {
        const spatialID = 'test-no-tile-box';
        const box = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
        assert.isFalse(_spatial.hasTileAtBox(spatialID, box));
      });
    });


    describe('hasTileAtLoc', () => {
      it('returns true if tile exists at location', () => {
        const spatialID = 'test-has-tile-loc';
        const loc = [10, 0];
        const tile = createMockTile('tile1', loc);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(spatialID, tile);
        // Check if tile actually covers the location by using a location from the tile extent
        const extent = tile.worldExtent;
        const testLoc = Rapid.sdk.projWorldToWgs84([extent.min[0], extent.min[1]]);
        assert.isTrue(_spatial.hasTileAtLoc(spatialID, testLoc));
      });

      it('returns false if no tile at location', () => {
        const spatialID = 'test-no-tile-loc';
        assert.isFalse(_spatial.hasTileAtLoc(spatialID, [50, 50]));
      });
    });


    describe('getVisibleData', () => {
      it('returns data in the visible viewport', () => {
        const spatialID = 'test-visible-data';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(spatialID, data);

        const results = _spatial.getVisibleData(spatialID);
        assert.isArray(results);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, data);
      });

      it('returns empty array when no visible data', () => {
        const spatialID = 'test-no-visible-data';
        const data = createMockData('data1', [100, 0]);  // far away
        _spatial.addData(spatialID, data);

        const results = _spatial.getVisibleData(spatialID);
        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('preventCoincidentLoc', () => {
      it('returns original location when no collision', () => {
        const spatialID = 'test-prevent-loc-1';
        const loc = [10, 0];
        const result = _spatial.preventCoincidentLoc(spatialID, loc);

        assert.isArray(result);
        assert.closeTo(result[0], loc[0], 0.0001);
        assert.closeTo(result[1], loc[1], 0.0001);
      });

      it('adjusts location when collision exists', () => {
        const spatialID = 'test-prevent-loc-2';
        const loc = [10, 0];
        const data = createMockData('data1', loc, 1e-8);  // very small extent
        _spatial.addData(spatialID, data);

        const result = _spatial.preventCoincidentLoc(spatialID, loc);
        assert.isArray(result);
        assert.closeTo(result[0], loc[0], 0.0001);
        // Y should be adjusted slightly south
        assert.isBelow(result[1], loc[1]);
      });
    });


    describe('replaceItems / getItemsAtBox', () => {
      it('inserts items into an cache and finds them by box', () => {
        const spatialID = 'test-items-1';
        const item = createItem('seg1', [10, 0], { kind: 'segment' });
        _spatial.replaceItems(spatialID, item);

        const results = _spatial.getItemsAtBox(spatialID, worldBox([10, 0]));
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].boxID, 'seg1');
        assert.deepStrictEqual(results[0].contents, { kind: 'segment' });
      });

      it('replaces an existing item with the same id', () => {
        const segSpatialID = sid('test-items-replace', 'segments');
        _spatial.replaceItems(segSpatialID, createItem('seg1', [10, 0], 'old'));
        _spatial.replaceItems(segSpatialID, createItem('seg1', [11, 0], 'new'));

        assert.strictEqual(_spatial.getCache(segSpatialID).boxes.size, 1);
        assert.isEmpty(_spatial.getItemsAtBox(segSpatialID, worldBox([10, 0])));
        const results = _spatial.getItemsAtBox(segSpatialID, worldBox([11, 0]));
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, 'new');
      });

      it('inserts multiple items at once', () => {
        const segSpatialID = sid('test-items-multi', 'segments');
        _spatial.replaceItems(segSpatialID, [
          createItem('seg1', [10, 0]),
          createItem('seg2', [11, 0])
        ]);
        assert.strictEqual(_spatial.getCache(segSpatialID).boxes.size, 2);
      });

      it('ignores null/undefined items', () => {
        const segSpatialID = sid('test-items-null', 'segments');
        _spatial.replaceItems(segSpatialID, [createItem('seg1', [10, 0]), null, undefined]);
        assert.strictEqual(_spatial.getCache(segSpatialID).boxes.size, 1);
      });
    });


    describe('removeItems', () => {
      it('removes items by id from an cache', () => {
        const spatialID = sid('test-remove-items', 'segments');
        _spatial.replaceItems(spatialID, [
          createItem('seg1', [10, 0]),
          createItem('seg2', [11, 0])
        ]);

        _spatial.removeItems(spatialID, 'seg1');
        assert.isEmpty(_spatial.getItemsAtBox(spatialID, worldBox([10, 0])));
        assert.lengthOf(_spatial.getItemsAtBox(spatialID, worldBox([11, 0])), 1);
      });

      it('removes multiple items at once', () => {
        const spatialID = 'test-remove-items-multi';
        _spatial.replaceItems(spatialID, [
          createItem('seg1', [10, 0]),
          createItem('seg2', [11, 0])
        ]);

        _spatial.removeItems(spatialID, ['seg1', 'seg2']);
        assert.isEmpty(_spatial.getCache(spatialID).boxes);
      });

      it('handles removing non-existent items', () => {
        const spatialID = 'test-remove-items-nonexistent';
        _spatial.removeItems(spatialID, 'nope');
        assert.isEmpty(_spatial.getCache(spatialID).boxes);
      });
    });


    describe('getItemsAtBoxes', () => {
      it('returns the union of hits across multiple boxes', () => {
        const spatialID = 'test-boxes-union';
        _spatial.replaceItems(spatialID, [
          createItem('a', [10, 0]),
          createItem('b', [20, 0])
        ]);

        const results = _spatial.getItemsAtBoxes(spatialID, [worldBox([10, 0]), worldBox([20, 0])]);
        assert.lengthOf(results, 2);
        const ids = results.map(r => r.boxID).sort();
        assert.deepStrictEqual(ids, ['a', 'b']);
      });

      it('deduplicates a candidate that overlaps several query boxes', () => {
        const spatialID = 'test-boxes-dedup';
        _spatial.replaceItems(spatialID, createItem('big', [10, 0], 'big', 0.05));

        const boxes = [worldBox([10, 0], 0.001), worldBox([10.0005, 0], 0.001)];
        const results = _spatial.getItemsAtBoxes(spatialID, boxes);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].boxID, 'big');
      });

      it('accepts a single box (OneOrMore)', () => {
        const spatialID = 'test-boxes-single';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const results = _spatial.getItemsAtBoxes(spatialID, worldBox([10, 0]));
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].boxID, 'a');
      });

      it('ignores null/undefined boxes', () => {
        const spatialID = 'test-boxes-null';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const results = _spatial.getItemsAtBoxes(spatialID, [null, worldBox([10, 0]), undefined]);
        assert.lengthOf(results, 1);
      });

      it('returns an empty array when nothing matches', () => {
        const spatialID = 'test-boxes-empty';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const results = _spatial.getItemsAtBoxes(spatialID, [worldBox([50, 50])]);
        assert.isArray(results);
        assert.isEmpty(results);
      });

      it('returns an empty array for empty input', () => {
        const spatialID = 'test-boxes-empty-input';
        const results = _spatial.getItemsAtBoxes(spatialID, []);
        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('refineItems', () => {
      it('keeps only candidates for which the predicate returns true', () => {
        const dataSpatialID = 'test-refine-keep';
        _spatial.replaceItems(dataSpatialID, [
          createItem('a', [10, 0], 'keep'),
          createItem('b', [20, 0], 'drop')
        ]);
        const candidates = _spatial.getItemsAtBoxes(dataSpatialID, [worldBox([10, 0]), worldBox([20, 0])]);

        const refined = _spatial.refineItems(candidates, box => box.contents === 'keep');
        assert.lengthOf(refined, 1);
        assert.strictEqual(refined[0].contents, 'keep');
      });

      it('returns an empty array when the predicate always fails', () => {
        const dataSpatialID = 'test-refine-none';
        _spatial.replaceItems(dataSpatialID, createItem('a', [10, 0]));
        const candidates = _spatial.getItemsAtBox(dataSpatialID, worldBox([10, 0]));

        const refined = _spatial.refineItems(candidates, () => false);
        assert.isArray(refined);
        assert.isEmpty(refined);
      });

      it('passes each candidate box to the predicate', () => {
        const dataSpatialID = 'test-refine-args';
        _spatial.replaceItems(dataSpatialID, createItem('a', [10, 0]));
        const candidates = _spatial.getItemsAtBox(dataSpatialID, worldBox([10, 0]));

        const seen = [];
        _spatial.refineItems(candidates, box => { seen.push(box); return true; });
        assert.lengthOf(seen, 1);
        assert.strictEqual(seen[0].boxID, 'a');
      });
    });


    describe('two-phase conflation query (buffers cache)', () => {
      it('finds and refines OSM candidates overlapping coverage boxes (forward query)', () => {
        const dataSpatialID = 'test-conflation-forward';
        _spatial.replaceItems(dataSpatialID, [
          createItem('near', [10, 0], { loc: [10, 0] }),
          createItem('far', [30, 0], { loc: [30, 0] })
        ]);

        const coverage = [worldBox([10, 0], 0.005), worldBox([10.01, 0], 0.005)];
        const candidates = _spatial.getItemsAtBoxes(dataSpatialID, coverage);
        assert.lengthOf(candidates, 1);
        assert.strictEqual(candidates[0].boxID, 'near');

        const matched = _spatial.refineItems(candidates, box => box.contents.loc[0] === 10);
        assert.lengthOf(matched, 1);
        assert.strictEqual(matched[0].boxID, 'near');
      });

      it('cachees third-party buffers for the reverse query', () => {
        const bufferSpatialID = 'test-conflation-reverse';
        _spatial.replaceItems(bufferSpatialID, [
          createItem('tp1', [10, 0], { source: 'overture' }),
          createItem('tp2', [20, 0], { source: 'overture' })
        ]);

        const hits = _spatial.getItemsAtBox(bufferSpatialID, worldBox([10, 0]));
        assert.lengthOf(hits, 1);
        assert.strictEqual(hits[0].boxID, 'tp1');
        assert.deepStrictEqual(hits[0].contents, { source: 'overture' });
      });
    });


    describe('resetAsync (with data)', () => {
      it('clears all caches when reset', () => {
        const spatialID = 'test-reset-data';
        const data = createMockData('data1', [10, 0]);
        const tile = createMockTile('tile1', [10, 0]);

        _spatial.addData(spatialID, data);
        _spatial.addTiles(spatialID, tile);

        return _spatial.resetAsync()
          .then(() => {
            assert.isEmpty(_spatial.getCache(`${spatialID}-data`).boxes);
            assert.isEmpty(_spatial.getCache(`${spatialID}-tiles`).boxes);
          });
      });
    });
  });

});
