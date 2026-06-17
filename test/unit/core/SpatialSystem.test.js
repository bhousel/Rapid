import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// Build a generic SpatialItem with a small world-coordinate extent
function createItem(id, locWgs84, contents, half = 0.001) {
  const [x, y] = Rapid.sdk.projWgs84ToWorld(locWgs84);
  return { id, minX: x - half, minY: y - half, maxX: x + half, maxY: y + half, contents: contents ?? { id } };
}

// Build a generic SpatialItem at a raw (already-planar) coordinate
function rawItem(id, coord, contents, half = 1e-7) {
  return { id, minX: coord[0] - half, minY: coord[1] - half, maxX: coord[0] + half, maxY: coord[1] + half, contents: contents ?? { id } };
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
        assert.instanceOf(cache.items, Map);
        assert.isObject(cache.rbush);
      });

      it('returns the same cache on repeated calls', () => {
        const spatialID = `test-data2`;
        const cache1 = _spatial.getCache(spatialID);
        const cache2 = _spatial.getCache(spatialID);
        assert.strictEqual(cache1, cache2);
      });
    });

    describe('clearCache', () => {
      it('clears all data for a given spatialID', () => {
        const spatialID = 'test-clear';
        const item = createItem('seg1', [10, 0], { kind: 'segment' });
        _spatial.replaceItems(spatialID, item);

        const cache = _spatial.getCache(spatialID);
        assert.lengthOf(cache.items, 1);

        _spatial.clearCache(spatialID);
        assert.isEmpty(cache.items);
      });
    });


    describe('clearMatching', () => {
      it('clears only cachees matching the predicate', () => {
        const spatialID1 = 'test-ok1';
        const spatialID2 = 'test-ok2';
        const spatialID3 = 'test-no3';
        const item = createItem('data10', [10, 0]);

        _spatial.addItems(spatialID1, item);
        _spatial.addItems(spatialID2, item);
        _spatial.addItems(spatialID3, item);

        _spatial.clearMatching(id => id.startsWith('test-ok'));

        assert.isEmpty(_spatial.getCache('test-ok1').items);
        assert.isEmpty(_spatial.getCache('test-ok2').items);
        assert.hasAllKeys(_spatial.getCache('test-no3').items, ['data10']);
      });
    });


    describe('addItems', () => {
      it('adds items for a given spatialID', () => {
        const spatialID = 'test-addItems';
        const item1 = createItem('1', [10, 0]);
        const item2 = createItem('2', [10, 1]);
        _spatial.addItems(spatialID, [item1, item2]);

        const cache = _spatial.getCache(spatialID);
        assert.lengthOf(cache.items, 2);
      });
    });


    describe('replaceItems', () => {
      it('inserts items into an cache and finds them by box', () => {
        const spatialID = 'test-replaceItems-1';
        const item = createItem('seg1', [10, 0], { kind: 'segment' });
        _spatial.replaceItems(spatialID, item);

        const results = _spatial.getItemsAtBox(spatialID, worldBox([10, 0]));
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].id, 'seg1');
        assert.deepStrictEqual(results[0].contents, { kind: 'segment' });
      });

      it('replaces an existing item with the same id', () => {
        const spatialID = 'test-replaceItems-2';
        _spatial.replaceItems(spatialID, createItem('seg1', [10, 0], 'old'));
        _spatial.replaceItems(spatialID, createItem('seg1', [11, 0], 'new'));

        assert.strictEqual(_spatial.getCache(spatialID).items.size, 1);
        assert.isEmpty(_spatial.getItemsAtBox(spatialID, worldBox([10, 0])));
        const results = _spatial.getItemsAtBox(spatialID, worldBox([11, 0]));
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].contents, 'new');
      });

      it('inserts multiple items at once', () => {
        const spatialID = 'test-replaceItems-multi';
        _spatial.replaceItems(spatialID, [
          createItem('seg1', [10, 0]),
          createItem('seg2', [11, 0])
        ]);
        assert.strictEqual(_spatial.getCache(spatialID).items.size, 2);
      });

      it('ignores null/undefined items', () => {
        const spatialID = 'test-replaceItems-undefined';
        _spatial.replaceItems(spatialID, [createItem('seg1', [10, 0]), null, undefined]);
        assert.strictEqual(_spatial.getCache(spatialID).items.size, 1);
      });
    });


    describe('removeItems', () => {
      it('removes items by id', () => {
        const spatialID = 'test-removeItems';
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
        assert.isEmpty(_spatial.getCache(spatialID).items);
      });

      it('handles removing non-existent items', () => {
        const spatialID = 'test-remove-items-nonexistent';
        _spatial.removeItems(spatialID, 'nope');
        assert.isEmpty(_spatial.getCache(spatialID).items);
      });
    });

    describe('getItem', () => {
      it('returns a previously inserted item', () => {
        const spatialID = 'test-getItem';
        const item = createItem('item1', [10, 0], { foo: 'bar' });
        _spatial.replaceItems(spatialID, item);

        const found = _spatial.getItem(spatialID, 'item1');
        assert.deepStrictEqual(found, { foo: 'bar' });
      });
    });

    describe('hasItem', () => {
      it('returns true for a previously inserted item id', () => {
        const spatialID = 'test-hasItem';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));
        assert.isTrue(_spatial.hasItem(spatialID, 'a'));
      });
    });

    describe('getAllItems', () => {
      it('returns all inserted items', () => {
        const spatialID = 'test-getAllItems';
        _spatial.replaceItems(spatialID, [
          createItem('a', [10, 0], { id: 'a' }),
          createItem('b', [11, 0], { id: 'b' })
        ]);

        const all = _spatial.getAllItems(spatialID);
        assert.lengthOf(all, 2);
      });
    });

    describe('getItemsAtBox', () => {
      it('returns all items that exist in the given search box', () => {
        const spatialID = 'test-getItemsAtBox';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const search = worldBox([10, 0]);
        const results = _spatial.getItemsAtBox(spatialID, search);
        assert.lengthOf(results, 1);
      });
    });

    describe('hasItemsAtBox', () => {
      it('returns true if items exist in the given search box', () => {
        const spatialID = 'test-hasItemsAtBox';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const search = worldBox([10, 0]);
        const result = _spatial.hasItemsAtBox(spatialID, search);
        assert.isTrue(result);
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
        const ids = results.map(r => r.id).sort();
        assert.deepStrictEqual(ids, ['a', 'b']);
      });

      it('deduplicates a candidate that overlaps several query boxes', () => {
        const spatialID = 'test-boxes-dedup';
        _spatial.replaceItems(spatialID, createItem('big', [10, 0], 'big', 0.05));

        const boxes = [worldBox([10, 0], 0.001), worldBox([10.0005, 0], 0.001)];
        const results = _spatial.getItemsAtBoxes(spatialID, boxes);
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].id, 'big');
      });

      it('accepts a single box (OneOrMore)', () => {
        const spatialID = 'test-boxes-single';
        _spatial.replaceItems(spatialID, createItem('a', [10, 0]));

        const results = _spatial.getItemsAtBoxes(spatialID, worldBox([10, 0]));
        assert.lengthOf(results, 1);
        assert.strictEqual(results[0].id, 'a');
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

    describe('getItemsAtCoord', () => {
      it('returns items that exist at the given coordinate', () => {
        const spatialID = 'test-getItemsAtCoord';
        _spatial.replaceItems(spatialID, rawItem('a', [10, 0]));

        const hits = _spatial.getItemsAtCoord(spatialID, [10, 0]);
        assert.lengthOf(hits, 1);
        assert.strictEqual(hits[0].id, 'a');
      });
    });

    describe('hasItemsAtCoord', () => {
      it('returns true if items exist at the given coordinate', () => {
        const spatialID = 'test-hasItemsAtCoord';
        _spatial.replaceItems(spatialID, rawItem('a', [10, 0]));

        const result = _spatial.hasItemsAtCoord(spatialID, [10, 0]);
        assert.isTrue(result);
      });
    });

    describe('getFreeCoord', () => {
      it('getFreeCoord nudges to a non-colliding coordinate', () => {
        const spatialID = 'test-getFreeCoord';
        _spatial.replaceItems(spatialID, rawItem('a', [10, 0], { id: 'a' }, 1e-8));

        const result = _spatial.getFreeCoord(spatialID, [10, 0], [0, -1e-6]);
        assert.isArray(result);
        assert.closeTo(result[0], 10, 1e-9);
        assert.closeTo(result[1], -1e-6, 1e-9);
      });
    });

    describe('replaceData', () => {
      it('stores AbstractData by its world extent and id', () => {
        const spatialID = 'test-replaceData';
        const data = createMockData('d1', [10, 0]);
        _spatial.replaceData(spatialID, data);

        assert.isTrue(_spatial.hasItem(spatialID, 'd1'));
        assert.strictEqual(_spatial.getItem(spatialID, 'd1'), data);
      });

      it('ignores data without a world extent', () => {
        const spatialID = 'test-replaceData-noextent';
        const data = new Rapid.AbstractData(context, { id: 'd2' });  // no geoms.world set
        _spatial.replaceData(spatialID, data);
        assert.isFalse(_spatial.hasItem(spatialID, 'd2'));
      });
    });


    describe('replaceTiles', () => {
      it('stores tiles by their world extent and id', () => {
        const spatialID = 'test-replaceTiles';
        const tile = createMockTile('t1', [10, 0]);
        assert.exists(tile);
        _spatial.replaceTiles(spatialID, tile);
        assert.isTrue(_spatial.hasItem(spatialID, tile.id));
        assert.strictEqual(_spatial.getItem(spatialID, tile.id), tile);
      });
    });


    describe('getVisibleItems', () => {
      it('returns items within the current viewport', () => {
        const spatialID = 'test-getVisibleItems';
        const data = createMockData('vis', [10, 0]);
        _spatial.replaceData(spatialID, data);

        const visible = _spatial.getVisibleItems(spatialID);
        assert.lengthOf(visible, 1);
        assert.strictEqual(visible[0].contents, data);
      });
    });


    describe('hasItemAtLoc', () => {
      it('returns true when an item exists near the given WGS84 location', () => {
        const spatialID = 'test-hasItemAtLoc';
        _spatial.replaceData(spatialID, createMockData('a', [10, 0]));
        assert.isTrue(_spatial.hasItemAtLoc(spatialID, [10, 0]));
      });

      it('returns false when no item exists near the given location', () => {
        const spatialID = 'test-hasItemAtLoc-empty';
        _spatial.replaceData(spatialID, createMockData('a', [10, 0]));
        assert.isFalse(_spatial.hasItemAtLoc(spatialID, [50, 50]));
      });
    });


    describe('getFreeLoc', () => {
      it('returns a nearby non-colliding WGS84 location', () => {
        const spatialID = 'test-getFreeLoc';
        const result = _spatial.getFreeLoc(spatialID, [10, 0]);
        assert.isArray(result);
        assert.closeTo(result[0], 10, 1e-6);
        assert.closeTo(result[1], 0, 1e-6);
      });
    });


    describe('resetAsync (with data)', () => {
      it('does not clear caches upon reset', () => {
        const spatialID = 'test-resetAsync-with-data';
        _spatial.replaceItems(spatialID, rawItem('a', [10, 0]));

        return _spatial.resetAsync()
          .then(() => {
            const result = _spatial.hasItemsAtCoord(spatialID, [10, 0]);
            assert.isTrue(result);
          });
      });
    });
  });

});
