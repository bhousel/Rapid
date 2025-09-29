import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './MapWithAIService.sample.js';


describe('MapWithAIService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    gfx:     new Rapid.MockGfxSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Spy on redraws..
  const gfx = context.systems.gfx;
  const spyRedraw = mock.fn();
  gfx.immediateRedraw = spyRedraw;
  gfx.deferredRedraw = spyRedraw;

  // Setup fetchMock..
  before(() => {
    fetchMock.mockGlobal();
  });

  after(() => {
    fetchMock.hardReset({ includeSticky: true });
    mock.reset();
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
    spyRedraw.mock.resetCalls();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a MapWithAIService from a context', () => {
        const mapwithai = new Rapid.MapWithAIService(context);
        assert.instanceOf(mapwithai, Rapid.MapWithAIService);
        assert.strictEqual(mapwithai.id, 'mapwithai');
        assert.strictEqual(mapwithai.context, context);
        assert.instanceOf(mapwithai.requiredDependencies, Set);
        assert.instanceOf(mapwithai.optionalDependencies, Set);
        assert.isTrue(mapwithai.autoStart);

        assert.instanceOf(mapwithai._datasets, Map);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const mapwithai = new Rapid.MapWithAIService(context);
        const prom = mapwithai.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const datasets = mapwithai._datasets;
            assert.hasAllKeys(datasets, 'rapid_intro_graph');
          });
      });

      it('rejects if a dependency is missing', () => {
        const mapwithai = new Rapid.MapWithAIService(context);
        mapwithai.requiredDependencies.add('missing');
        const prom = mapwithai.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const mapwithai = new Rapid.MapWithAIService(context);
        const prom = mapwithai.initAsync().then(() => mapwithai.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(mapwithai.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const mapwithai = new Rapid.MapWithAIService(context);
        const ds = mapwithai.getDataset('test');
        ds.seen.add('n1');

        const prom = mapwithai.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const ds = mapwithai.getDataset('test');
            assert.isEmpty(ds.seen);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _mapwithai;

    before(() => {
      _mapwithai = new Rapid.MapWithAIService(context);

      // We will replace the tiler to make testing a little easier.
      // The default MapWithAI tiler is zoomed into 16.
      // This tiler mimics what the other tests do
      _mapwithai._tiler = new Rapid.sdk.Tiler().zoomRange(14);

      return _mapwithai.initAsync().then(() => _mapwithai.startAsync());
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _mapwithai.resetAsync();
    });


    describe('getAvailableDatasets', () => {
      it('returns datasets provided by this service', () => {
        const results = _mapwithai.getAvailableDatasets();
        assert.isArray(results);

        const ds0 = results[0];
        assert.instanceOf(ds0, Rapid.RapidDataset);
        assert.strictEqual(ds0.id, 'fbRoads');

        const ds1 = results[1];
        assert.instanceOf(ds1, Rapid.RapidDataset);
        assert.strictEqual(ds1.id, 'msBuildings');

        const ds2 = results[2];
        assert.instanceOf(ds2, Rapid.RapidDataset);
        assert.strictEqual(ds2.id, 'rapid_intro_graph');
        assert.strictEqual(ds2.label, 'Rapid Walkthrough');
      });
    });

    describe('getDataset', () => {
      it('creates a cache for the given datasetID', () => {
        const ds = _mapwithai.getDataset('test');
        assert.isObject(ds);
        assert.strictEqual(ds.id, 'test');
        assert.instanceOf(ds.graph, Rapid.Graph);
        assert.instanceOf(ds.tree, Rapid.Tree);
        assert.deepEqual(ds.inflight, {});
        assert.instanceOf(ds.loaded, Set);
        assert.instanceOf(ds.seen, Set);
        assert.instanceOf(ds.seenFirstNodeID, Set);
        assert.isNull(ds.lastv);
      });

      it('repeated calls return the same dataset cache', () => {
        const ds1 = _mapwithai.getDataset('test_repeat');
        const ds2 = _mapwithai.getDataset('test_repeat');
        assert.strictEqual(ds1, ds2);   // ===
      });
    });

    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/ml_roads/, {
          body: sample.data10,
          status: 200,
          headers: { 'Content-Type': 'text/xml' }
        });
        _mapwithai.loadTiles('msBuildings');

        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const ds = _mapwithai.getDataset('msBuildings');
          const tileID = '8647,8192,14';
          assert.isTrue(ds.loaded.has(tileID));
//          const spatial = context.systems.spatial;
//          assert.isTrue(spatial.hasTileAtLoc('mapwithai', [10, 0]));  // tile is loaded here
          done();
        });
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/ml_roads/, {
          body: sample.data10,
          status: 200,
          headers: { 'Content-Type': 'text/xml' }
        });
        _mapwithai.loadTiles('msBuildings');
        return new Promise(resolve => { setImmediate(resolve); });
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _mapwithai.getData('msBuildings');
          assert.isArray(result);
          assert.lengthOf(result, 5);  // 4 nodes and 1 way

//          const item1 = result[0];
//          assert.instanceOf(item1, Rapid.GeoJSON);
//          assert.deepInclude(item1.props, { serviceID: 'mapwithai' });
//          assert.deepInclude(item1.props?.geojson?.properties, { id: 1, type: 'scribble', color: '#ffffff' });
//
//          const item2 = result[1];
//          assert.instanceOf(item2, Rapid.GeoJSON);
//          assert.deepInclude(item2.props, { serviceID: 'mapwithai' });
//          assert.deepInclude(item2.props?.geojson?.properties, { id: 2, type: 'label', color: null });
        });
      });
    });

  });
});
