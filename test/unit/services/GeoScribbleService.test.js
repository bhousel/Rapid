import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './GeoScribbleService.sample.js';


describe('GeoScribbleService', () => {
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
      it('constructs a GeoScribbleService from a context', () => {
        const geoscribble = new Rapid.GeoScribbleService(context);
        assert.instanceOf(geoscribble, Rapid.GeoScribbleService);
        assert.strictEqual(geoscribble.id, 'geoscribble');
        assert.strictEqual(geoscribble.context, context);
        assert.instanceOf(geoscribble.requiredDependencies, Set);
        assert.instanceOf(geoscribble.optionalDependencies, Set);
        assert.isFalse(geoscribble.autoStart);

        assert.deepEqual(geoscribble._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const geoscribble = new Rapid.GeoScribbleService(context);
        const prom = geoscribble.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = geoscribble._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
            assert.isNull(cache.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const geoscribble = new Rapid.GeoScribbleService(context);
        geoscribble.requiredDependencies.add('missing');
        const prom = geoscribble.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const geoscribble = new Rapid.GeoScribbleService(context);
        const prom = geoscribble.initAsync().then(() => geoscribble.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(geoscribble.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const geoscribble = new Rapid.GeoScribbleService(context);
        geoscribble._cache = {};
        const prom = geoscribble.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = geoscribble._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
            assert.isNull(cache.lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _geoscribble;

    before(() => {
      _geoscribble = new Rapid.GeoScribbleService(context);
      return _geoscribble.initAsync().then(() => _geoscribble.startAsync());
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _geoscribble.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/geojson/, sample.data10);
        _geoscribble.loadTiles();
        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('geoscribble', [10, 0]));  // tile is loaded here
          done();
        });
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/geojson/, sample.data10);
        _geoscribble.loadTiles();
        return new Promise(resolve => { setImmediate(resolve); });
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _geoscribble.getData();
          assert.isArray(result);
          assert.lengthOf(result, 2);

          const item1 = result[0];
          assert.instanceOf(item1, Rapid.GeoJSON);
          assert.deepInclude(item1.props, { serviceID: 'geoscribble' });
          assert.deepInclude(item1.props?.geojson?.properties, { id: 1, type: 'scribble', color: '#ffffff' });

          const item2 = result[1];
          assert.instanceOf(item2, Rapid.GeoJSON);
          assert.deepInclude(item2.props, { serviceID: 'geoscribble' });
          assert.deepInclude(item2.props?.geojson?.properties, { id: 2, type: 'label', color: null });
        });
      });
    });

  });
});
