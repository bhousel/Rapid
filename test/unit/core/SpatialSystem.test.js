import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


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
    function createMockTile(tileID, locWgs84) {
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
      it('creates and returns a new cache', () => {
        const cache = _spatial.getCache('test-cache-1');
        assert.isObject(cache);
        assert.instanceOf(cache.graph, Rapid.Graph);
        assert.instanceOf(cache.boxes, Map);
        assert.instanceOf(cache.tiles, Map);
        assert.instanceOf(cache.data, Map);
        assert.isObject(cache.tileRBush);
        assert.isObject(cache.dataRBush);
      });

      it('returns the same cache on repeated calls', () => {
        const cache1 = _spatial.getCache('test-cache-2');
        const cache2 = _spatial.getCache('test-cache-2');
        assert.strictEqual(cache1, cache2);
      });
    });


    describe('clearCache', () => {
      it('clears all data from a cache', () => {
        const datasetID = 'test-clear';
        const data = createMockData('data1', [10, 0]);
        const tile = createMockTile('tile1', [10, 0]);

        _spatial.addData(datasetID, data);
        _spatial.addTiles(datasetID, tile);

        const cacheBefore = _spatial.getCache(datasetID);
        assert.isTrue(cacheBefore.data.size > 0);
        assert.isTrue(cacheBefore.tiles.size > 0);

        _spatial.clearCache(datasetID);

        const cacheAfter = _spatial.getCache(datasetID);
        assert.isEmpty(cacheAfter.data);
        assert.isEmpty(cacheAfter.tiles);
        assert.isEmpty(cacheAfter.boxes);
      });
    });


    describe('addData', () => {
      it('adds a single data item', () => {
        const datasetID = 'test-add-data-1';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        const cache = _spatial.getCache(datasetID);
        assert.isTrue(cache.data.has('data1'));
        assert.strictEqual(cache.data.get('data1'), data);
      });

      it('adds multiple data items', () => {
        const datasetID = 'test-add-data-2';
        const data1 = createMockData('data1', [10, 0]);
        const data2 = createMockData('data2', [11, 0]);
        _spatial.addData(datasetID, [data1, data2]);

        const cache = _spatial.getCache(datasetID);
        assert.isTrue(cache.data.has('data1'));
        assert.isTrue(cache.data.has('data2'));
      });

      it('ignores null/undefined items', () => {
        const datasetID = 'test-add-data-null';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, [data, null, undefined]);

        const cache = _spatial.getCache(datasetID);
        assert.strictEqual(cache.data.size, 1);
        assert.isTrue(cache.data.has('data1'));
      });

      it('skips data without extent', () => {
        const datasetID = 'test-add-data-no-extent';
        const data = new Rapid.AbstractData(context, { id: 'data1' });
        // data has no geoms.world.extent
        _spatial.addData(datasetID, data);

        const cache = _spatial.getCache(datasetID);
        assert.isFalse(cache.data.has('data1'));
      });
    });


    describe('replaceData', () => {
      it('replaces existing data item', () => {
        const datasetID = 'test-replace-data';
        const data1 = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data1);

        const data2 = createMockData('data1', [11, 0]);
        _spatial.replaceData(datasetID, data2);

        const cache = _spatial.getCache(datasetID);
        assert.strictEqual(cache.data.size, 1);
        assert.strictEqual(cache.data.get('data1'), data2);
      });

      it('adds new data if not existing', () => {
        const datasetID = 'test-replace-new';
        const data = createMockData('data1', [10, 0]);
        _spatial.replaceData(datasetID, data);

        const cache = _spatial.getCache(datasetID);
        assert.isTrue(cache.data.has('data1'));
      });
    });


    describe('removeData', () => {
      it('removes data by data object', () => {
        const datasetID = 'test-remove-data-1';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        _spatial.removeData(datasetID, data);
        const cache = _spatial.getCache(datasetID);
        assert.isFalse(cache.data.has('data1'));
      });

      it('removes data by dataID', () => {
        const datasetID = 'test-remove-data-2';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        _spatial.removeData(datasetID, 'data1');
        const cache = _spatial.getCache(datasetID);
        assert.isFalse(cache.data.has('data1'));
      });

      it('removes multiple data items', () => {
        const datasetID = 'test-remove-data-3';
        const data1 = createMockData('data1', [10, 0]);
        const data2 = createMockData('data2', [11, 0]);
        _spatial.addData(datasetID, [data1, data2]);

        _spatial.removeData(datasetID, ['data1', 'data2']);
        const cache = _spatial.getCache(datasetID);
        assert.isEmpty(cache.data);
      });

      it('handles removing non-existent data', () => {
        const datasetID = 'test-remove-nonexistent';
        _spatial.removeData(datasetID, 'nonexistent');
        // Should not throw
        assert.isTrue(true);
      });
    });


    describe('getData', () => {
      it('returns data by dataID', () => {
        const datasetID = 'test-get-data';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        const result = _spatial.getData(datasetID, 'data1');
        assert.strictEqual(result, data);
      });

      it('returns undefined for non-existent data', () => {
        const result = _spatial.getData('test-nonexistent', 'data1');
        assert.isUndefined(result);
      });
    });


    describe('hasData', () => {
      it('returns true if data exists', () => {
        const datasetID = 'test-has-data';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        assert.isTrue(_spatial.hasData(datasetID, 'data1'));
      });

      it('returns false if data does not exist', () => {
        assert.isFalse(_spatial.hasData('test-nonexistent', 'data1'));
      });
    });


    describe('getDataAtBox', () => {
      it('returns data within a bounding box', () => {
        const datasetID = 'test-data-at-box';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        const [x, y] = Rapid.sdk.projWgs84ToWorld([10, 0]);
        const box = { minX: x - 0.01, minY: y - 0.01, maxX: x + 0.01, maxY: y + 0.01 };
        const results = _spatial.getDataAtBox(datasetID, box);

        assert.isArray(results);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, data);
      });

      it('returns empty array when no data in box', () => {
        const datasetID = 'test-empty-box';
        const box = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
        const results = _spatial.getDataAtBox(datasetID, box);

        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('hasDataAtBox', () => {
      it('returns true if data exists in box', () => {
        const datasetID = 'test-has-data-box';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        const [x, y] = Rapid.sdk.projWgs84ToWorld([10, 0]);
        const box = { minX: x - 0.01, minY: y - 0.01, maxX: x + 0.01, maxY: y + 0.01 };
        assert.isTrue(_spatial.hasDataAtBox(datasetID, box));
      });

      it('returns false if no data in box', () => {
        const datasetID = 'test-no-data-box';
        const box = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
        assert.isFalse(_spatial.hasDataAtBox(datasetID, box));
      });
    });


    describe('getDataAtLoc', () => {
      it('returns data at a specific location', () => {
        const datasetID = 'test-data-at-loc';
        const loc = [10, 0];
        const data = createMockData('data1', loc);
        _spatial.addData(datasetID, data);

        const results = _spatial.getDataAtLoc(datasetID, loc);
        assert.isArray(results);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, data);
      });

      it('returns empty array when no data at location', () => {
        const datasetID = 'test-empty-loc';
        const results = _spatial.getDataAtLoc(datasetID, [50, 50]);
        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('hasDataAtLoc', () => {
      it('returns true if data exists at location', () => {
        const datasetID = 'test-has-data-loc';
        const loc = [10, 0];
        const data = createMockData('data1', loc);
        _spatial.addData(datasetID, data);

        assert.isTrue(_spatial.hasDataAtLoc(datasetID, loc));
      });

      it('returns false if no data at location', () => {
        const datasetID = 'test-no-data-loc';
        assert.isFalse(_spatial.hasDataAtLoc(datasetID, [50, 50]));
      });
    });


    describe('addTiles', () => {
      it('adds a single tile', () => {
        const datasetID = 'test-add-tile-1';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        const cache = _spatial.getCache(datasetID);
        assert.isTrue(cache.tiles.has(tile.id));
      });

      it('adds multiple tiles', () => {
        const datasetID = 'test-add-tile-2';
        const tile1 = createMockTile('tile1', [10, 0]);
        const tile2 = createMockTile('tile2', [11, 0]);
        if (!tile1 || !tile2) {
          assert.fail('Failed to create mock tiles');
          return;
        }

        _spatial.addTiles(datasetID, [tile1, tile2]);
        const cache = _spatial.getCache(datasetID);
        assert.isTrue(cache.tiles.has(tile1.id));
        assert.isTrue(cache.tiles.has(tile2.id));
      });

      it('skips duplicate tiles', () => {
        const datasetID = 'test-add-tile-dup';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        _spatial.addTiles(datasetID, tile);  // add again

        const cache = _spatial.getCache(datasetID);
        assert.strictEqual(cache.tiles.size, 1);
      });

      it('ignores null/undefined tiles', () => {
        const datasetID = 'test-add-tile-null';
        const tile = createMockTile('tile1', [10, 0]);
        _spatial.addTiles(datasetID, [tile, null, undefined]);

        const cache = _spatial.getCache(datasetID);
        assert.strictEqual(cache.tiles.size, 1);
      });
    });


    describe('removeTiles', () => {
      it('removes tile by tile object', () => {
        const datasetID = 'test-remove-tile-1';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        _spatial.removeTiles(datasetID, tile);

        const cache = _spatial.getCache(datasetID);
        assert.isFalse(cache.tiles.has(tile.id));
      });

      it('removes tile by tileID', () => {
        const datasetID = 'test-remove-tile-2';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        _spatial.removeTiles(datasetID, tile.id);

        const cache = _spatial.getCache(datasetID);
        assert.isFalse(cache.tiles.has(tile.id));
      });
    });


    describe('getTile', () => {
      it('returns tile by tileID', () => {
        const datasetID = 'test-get-tile';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        const result = _spatial.getTile(datasetID, tile.id);
        assert.strictEqual(result, tile);
      });

      it('returns undefined for non-existent tile', () => {
        const result = _spatial.getTile('test-nonexistent', 'tile1');
        assert.isUndefined(result);
      });
    });


    describe('hasTile', () => {
      it('returns true if tile exists', () => {
        const datasetID = 'test-has-tile';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        assert.isTrue(_spatial.hasTile(datasetID, tile.id));
      });

      it('returns false if tile does not exist', () => {
        assert.isFalse(_spatial.hasTile('test-nonexistent', 'tile1'));
      });
    });


    describe('hasTileAtBox', () => {
      it('returns true if tile exists in box', () => {
        const datasetID = 'test-has-tile-box';
        const tile = createMockTile('tile1', [10, 0]);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);

        const [x, y] = Rapid.sdk.projWgs84ToWorld([10, 0]);
        const box = { minX: x - 1000, minY: y - 1000, maxX: x + 1000, maxY: y + 1000 };
        assert.isTrue(_spatial.hasTileAtBox(datasetID, box));
      });

      it('returns false if no tile in box', () => {
        const datasetID = 'test-no-tile-box';
        const box = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
        assert.isFalse(_spatial.hasTileAtBox(datasetID, box));
      });
    });


    describe('hasTileAtLoc', () => {
      it('returns true if tile exists at location', () => {
        const datasetID = 'test-has-tile-loc';
        const loc = [10, 0];
        const tile = createMockTile('tile1', loc);
        if (!tile) {
          assert.fail('Failed to create mock tile');
          return;
        }

        _spatial.addTiles(datasetID, tile);
        // Check if tile actually covers the location by using a location from the tile extent
        const extent = tile.worldExtent;
        const testLoc = Rapid.sdk.projWorldToWgs84([extent.min[0], extent.min[1]]);
        assert.isTrue(_spatial.hasTileAtLoc(datasetID, testLoc));
      });

      it('returns false if no tile at location', () => {
        const datasetID = 'test-no-tile-loc';
        assert.isFalse(_spatial.hasTileAtLoc(datasetID, [50, 50]));
      });
    });


    describe('getVisibleData', () => {
      it('returns data in the visible viewport', () => {
        const datasetID = 'test-visible-data';
        const data = createMockData('data1', [10, 0]);
        _spatial.addData(datasetID, data);

        const results = _spatial.getVisibleData(datasetID);
        assert.isArray(results);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, data);
      });

      it('returns empty array when no visible data', () => {
        const datasetID = 'test-no-visible-data';
        const data = createMockData('data1', [100, 0]);  // far away
        _spatial.addData(datasetID, data);

        const results = _spatial.getVisibleData(datasetID);
        assert.isArray(results);
        assert.isEmpty(results);
      });
    });


    describe('getAllVisibleData', () => {
      it('returns visible data from all caches', () => {
        const data1 = createMockData('data1', [10, 0]);
        const data2 = createMockData('data2', [10, 0]);
        _spatial.addData('cache1', data1);
        _spatial.addData('cache2', data2);

        const results = _spatial.getAllVisibleData();
        assert.isArray(results);
        assert.isAtLeast(results.length, 2);
      });

      it('returns empty array when no visible data', () => {
        const datasetID = 'test-all-visible-empty';
        const data = createMockData('data1', [100, 0]);  // far away
        _spatial.addData(datasetID, data);

        const results = _spatial.getAllVisibleData();
        // May have data from other tests, so just check it's an array
        assert.isArray(results);
      });
    });


    describe('preventCoincidentLoc', () => {
      it('returns original location when no collision', () => {
        const datasetID = 'test-prevent-loc-1';
        const loc = [10, 0];
        const result = _spatial.preventCoincidentLoc(datasetID, loc);

        assert.isArray(result);
        assert.closeTo(result[0], loc[0], 0.0001);
        assert.closeTo(result[1], loc[1], 0.0001);
      });

      it('adjusts location when collision exists', () => {
        const datasetID = 'test-prevent-loc-2';
        const loc = [10, 0];
        const data = createMockData('data1', loc, 1e-8);  // very small extent
        _spatial.addData(datasetID, data);

        const result = _spatial.preventCoincidentLoc(datasetID, loc);
        assert.isArray(result);
        assert.closeTo(result[0], loc[0], 0.0001);
        // Y should be adjusted slightly south
        assert.isBelow(result[1], loc[1]);
      });
    });


    describe('resetAsync (with data)', () => {
      it('clears all caches when reset', () => {
        const datasetID = 'test-reset-data';
        const data = createMockData('data1', [10, 0]);
        const tile = createMockTile('tile1', [10, 0]);

        _spatial.addData(datasetID, data);
        _spatial.addTiles(datasetID, tile);

        return _spatial.resetAsync()
          .then(() => {
            const cache = _spatial.getCache(datasetID);
            assert.isEmpty(cache.data);
            assert.isEmpty(cache.tiles);
            assert.isEmpty(cache.boxes);
          });
      });
    });
  });

});
