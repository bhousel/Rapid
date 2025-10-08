import { after, before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './WaybackService.sample.js';


describe('WaybackService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context)
  };

  // Supply cached wayback config
  const assets = context.systems.assets;
  assets._cache.wayback = {
    wayback: sample.waybackConfig
  };

  // Setup fetchMock..
  before(() => {
    fetchMock.mockGlobal();
  });

  after(() => {
    fetchMock.hardReset({ includeSticky: true });
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a WaybackService from a context', () => {
        const wayback = new Rapid.WaybackService(context);
        assert.instanceOf(wayback, Rapid.WaybackService);
        assert.strictEqual(wayback.id, 'wayback');
        assert.strictEqual(wayback.context, context);
        assert.instanceOf(wayback.requiredDependencies, Set);
        assert.instanceOf(wayback.optionalDependencies, Set);
        assert.isTrue(wayback.autoStart);

        assert.isObject(wayback._cache);
        assert.instanceOf(wayback._metadata, Map);
        assert.instanceOf(wayback._localDates, Map);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const wayback = new Rapid.WaybackService(context);
        const prom = wayback.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => {
            assert.isObject(wayback._cache);
            assert.instanceOf(wayback._metadata, Map);
            assert.instanceOf(wayback._localDates, Map);
          });
      });

      it('rejects if a dependency is missing', () => {
        const wayback = new Rapid.WaybackService(context);
        wayback.requiredDependencies.add('missing');
        const prom = wayback.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const wayback = new Rapid.WaybackService(context);
        const prom = wayback.initAsync().then(() => wayback.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(wayback.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const wayback = new Rapid.WaybackService(context);

        wayback._cache.foo = 'bar';
        wayback._metadata.set('1,1,1_2011-01-01', { test: true });
        wayback._localDates.set('1,1,1', ['2011-01-01']);

        const prom = wayback.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => {
            assert.isObject(wayback._cache);
            assert.instanceOf(wayback._metadata, Map);
            assert.instanceOf(wayback._localDates, Map);

            // On reset, `_cache` should clear, but `_metadata` and `_localDates` can persist.
            assert.isUndefined(wayback._cache.foo);
            assert.deepEqual(wayback._metadata.get('1,1,1_2011-01-01'), { test: true });
            assert.deepEqual(wayback._localDates.get('1,1,1'), ['2011-01-01']);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _wayback, _tile;

    before(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];

      // Get a single tile at this location. (Use a viewport that's just 1 pixel)
      // tileID = '8647,8192,14'   [x,y,z]
      const tiler = new Rapid.sdk.Tiler();
      const t = context.viewport.transform.props;
      const v = new Rapid.sdk.Viewport({ x: t.x, y: t.y, z: t.z }, [1, 1]);
      _tile = tiler.getTiles(v).tiles[0];

      _wayback = new Rapid.WaybackService(context);
      return _wayback.initAsync().then(() => _wayback.startAsync());
    });

    beforeEach(() => {
      // mock tilemaps
      fetchMock
        .route(/tilemap\/13534/, sample.tilemap13534)
        .route(/tilemap\/13161/, sample.tilemap13161)
        .route(/tilemap\/9203/, sample.tilemap9203)
        .route(/tilemap\/10/, sample.tilemap10);

      // mock imagery
      fetchMock
        .route({ method: 'head', url: /tile\/13534\/14\/8192\/8647/ }, sample.response13534)
        .route({ method: 'head', url: /tile\/13161\/14\/8192\/8647/ }, sample.response13161)
        .route({ method: 'head', url: /tile\/10\/14\/8192\/8647/ }, sample.response10);

      // mock metadata
      fetchMock
        .route(/query/, sample.metadata13161);

      return _wayback.resetAsync();
    });

    describe('allDates', () => {
      it('contains an Array of all available dates', () => {
        const result = _wayback.allDates;
        assert.deepEqual(result, ['2014-02-20', '2015-04-15', '2018-01-08', '2021-06-30']);
      });
    });

    describe('byReleaseNumber', () => {
      it('looks up a release by its release number', () => {
        const result = _wayback.byReleaseNumber.get('10');
        assert.deepInclude(result, {
          releaseNumber: '10',
          releaseDate: '2014-02-20',
          itemTitle: 'World Imagery (Wayback 2014-02-20)',
        });
      });
    });

    describe('byReleaseDate', () => {
      it('looks up a release by its release date', () => {
        const result = _wayback.byReleaseDate.get('2014-02-20');
        assert.deepInclude(result, {
          releaseNumber: '10',
          releaseDate: '2014-02-20',
          itemTitle: 'World Imagery (Wayback 2014-02-20)',
        });
      });
    });

    describe('chooseClosestDate', () => {
      it('if invalid, chooses the earliest date', () => {
        const result = _wayback.chooseClosestDate('nah');
        assert.strictEqual(result, '2014-02-20');
      });

      it('if under range, chooses the earliest date', () => {
        const result = _wayback.chooseClosestDate('2000-01-01');
        assert.strictEqual(result, '2014-02-20');
      });

      it('if between dates, chooses the earlier date', () => {
        const result = _wayback.chooseClosestDate('2015-01-01');
        assert.strictEqual(result, '2014-02-20');
      });

     it('if exact match, chooses the matched date', () => {
        const result = _wayback.chooseClosestDate('2015-04-15');
        assert.strictEqual(result, '2015-04-15');
      });

      it('if over range, chooses the latest date', () => {
        const result = _wayback.chooseClosestDate('2025-01-01');
        assert.strictEqual(result, '2021-06-30');
      });
    });


    describe('checkTilemapsAsync', () => {
      it('fetches tilemaps for a given tile, returns candidate releases', () => {
        const prom = _wayback.checkTilemapsAsync(_tile);
        assert.instanceOf(prom, Promise);
        return prom
          .then(results => {
            assert.lengthOf(fetchMock.callHistory.calls(), 4);
            assert.instanceOf(results, Map);  // Map<releaseDate, release>

            assert.lengthOf(results, 3);
            assert.hasAllKeys(results, ['2014-02-20', '2018-01-08', '2021-06-30']);
            // '2015-04-15' skipped, it has `select:[10]` in the tilemap
          });
      });
    });

    describe('checkImagesAsync', () => {
      it('fetches images for a given tile, returns releases with changes', () => {
        // Use the dates we would have gotten from `checkTilemapsAsync`
        const dates = ['2014-02-20', '2018-01-08', '2021-06-30'];
        const candidates = new Map();
        for (const date of dates) {
          candidates.set(date, _wayback.byReleaseDate.get(date));
        }

        const prom = _wayback.checkImagesAsync(candidates, _tile);
        assert.instanceOf(prom, Promise);
        return prom
          .then(results => {
            assert.lengthOf(fetchMock.callHistory.calls(), 3);
            assert.instanceOf(results, Map);  // Map<releaseDate, release>

            assert.lengthOf(results, 2);
            assert.hasAllKeys(results, ['2014-02-20', '2018-01-08']);
            // '2021-06-30' skipped, it has same content-length as '2018-01-08'
          });
      });
    });

    describe('getLocalDatesAsync', () => {
      it('returns an Array of local dates with changed imagery', () => {
        assert.doesNotHaveAllKeys(_wayback._localDates, ['8647,8192,14']);

        // This really just calls `checkTilemapsAsync` then `checkImagesAsync`
        const prom = _wayback.getLocalDatesAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(results => {
            assert.lengthOf(fetchMock.callHistory.calls(), 7);
            assert.deepEqual(results, ['2014-02-20', '2018-01-08']);
          });
      });

      it('caches results', () => {
        assert.hasAllKeys(_wayback._localDates, ['8647,8192,14']);

        const prom = _wayback.getLocalDatesAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(results => {
            assert.lengthOf(fetchMock.callHistory.calls(), 0);     // we did it already
            assert.deepEqual(results, ['2014-02-20', '2018-01-08']);
          });
      });
    });


    describe('getMetadataAsync', () => {
      it('rejects if unknown release date', () => {
        const prom = _wayback.getMetadataAsync(_tile, '2018-01-00');
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /unknown release date/i));
      });

      it('returns the metadata result for the given tile and release date', () => {
        assert.doesNotHaveAllKeys(_wayback._metadata, ['8647,8192,14_2018-01-08']);

        const prom = _wayback.getMetadataAsync(_tile, '2018-01-08');
        assert.instanceOf(prom, Promise);
        return prom
          .then(results => {
            assert.lengthOf(fetchMock.callHistory.calls(), 1);
            assert.deepEqual(results, sample.metadata13161Result);
          });
      });

      it('caches results', () => {
        assert.hasAllKeys(_wayback._metadata, ['8647,8192,14_2018-01-08']);

        const prom = _wayback.getMetadataAsync(_tile, '2018-01-08');
        assert.instanceOf(prom, Promise);
        return prom
          .then(results => {
            assert.lengthOf(fetchMock.callHistory.calls(), 0);     // we did it already
            assert.deepEqual(results, sample.metadata13161Result);
          });
      });
    });

  });

});
