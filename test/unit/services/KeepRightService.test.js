import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './KeepRightService.sample.js';


describe('KeepRightService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    gfx:     new Rapid.MockGfxSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    network: new Rapid.NetworkSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Supply cached qa_data
  const assets = context.systems.assets;
  assets._loaded.qa_data = sample.qa_data;

  // Spy on redraws..
  const gfx = context.systems.gfx;
  const spyRedraw = mock();
  gfx.immediateRedraw = spyRedraw;
  gfx.deferredRedraw = spyRedraw;

  // Setup fetchMock..
  beforeAll(() => {
    fetchMock.mockGlobal();
  });

  afterAll(() => {
    fetchMock.hardReset({ includeSticky: true });
    spyRedraw.mockReset();
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
    spyRedraw.mockClear();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a KeepRightService from a context', () => {
        const keepright = new Rapid.KeepRightService(context);
        assert.instanceOf(keepright, Rapid.KeepRightService);
        assert.strictEqual(keepright.id, 'keepright');
        assert.strictEqual(keepright.context, context);
        assert.instanceOf(keepright.requiredDependencies, Set);
        assert.instanceOf(keepright.optionalDependencies, Set);
        assert.isFalse(keepright.autoStart);

        assert.instanceOf(keepright._closed, Set);
        assert.isEmpty(keepright._closed);
        assert.isNull(keepright._lastv);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const keepright = new Rapid.KeepRightService(context);
        const prom = keepright.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.instanceOf(keepright._closed, Set);
            assert.isEmpty(keepright._closed);
            assert.isNull(keepright._lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const keepright = new Rapid.KeepRightService(context);
        keepright.requiredDependencies.add('missing');
        const prom = keepright.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const keepright = new Rapid.KeepRightService(context);
        const prom = keepright.initAsync().then(() => keepright.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(keepright.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const keepright = new Rapid.KeepRightService(context);
        keepright._closed = new Set(['x']);
        keepright._lastv = 5;
        const prom = keepright.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.instanceOf(keepright._closed, Set);
            assert.isEmpty(keepright._closed);
            assert.isNull(keepright._lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _keepright;

    const origError = console.error;
    const spyError = mock();

    // Map a WGS84 loc used in these tests to its viewport transform.
    const TRANSFORMS = {
      '10,0': { x: -116508, y: 0, z: 14 },
      '20,0': { x: -233017, y: 0, z: 14 }
    };

    // A tile covering `loc` is considered "loaded" once its network request has completed.
    // (Tile-load tracking moved from the SpatialSystem to NetworkSystem.completed.)
    function tileLoaded(loc) {
      const network = context.systems.network;
      const viewport = new Rapid.sdk.Viewport(TRANSFORMS[loc.join(',')], [64, 64]);
      const tiles = _keepright._tiler.getTiles(viewport).tiles;
      return tiles.length > 0 && tiles.every(tile => network.isCompleted(`keepright-tile-${tile.id}`));
    }

    beforeAll(() => {
      console.error = spyError;
      _keepright = new Rapid.KeepRightService(context);
      return _keepright.initAsync().then(() => _keepright.startAsync());
    });

    afterAll(() => {
      console.error = origError;
    });

    beforeEach(() => {
      spyError.mockClear();

      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _keepright.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', async () => {
        fetchMock.route(/export\.php/, sample.data10, { delay: 1 });
        _keepright.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it(`doesn't retry inflight tiles`, async () => {
        fetchMock.route(/export\.php/, sample.data10, { delay: 1 });
        _keepright.loadTiles();
        context.viewport.transform.v++;  // touch viewport
        _keepright.loadTiles();           // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
      });

      it(`doesn't retry loaded tiles`, async () => {
        fetchMock.route(/export\.php/, sample.data10, { delay: 1 });
        _keepright.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');

        context.viewport.transform.v++;  // touch viewport
        _keepright.loadTiles();           // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it('aborts unwanted tile requests', async () => {
        fetchMock.route(/export\.php/, sample.data10, { delay: 1 });
        _keepright.loadTiles();

        // Move the viewport while fetches are still pending
        context.viewport.transform = { x: -233017, y: 0, z: 14 };  // [20°, 0°]
        _keepright.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isFalse(tileLoaded([10, 0]), 'tile at [10°, 0°] was not loaded');
        assert.isTrue(tileLoaded([20, 0]), 'tile at [20°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 2, 'fetch called twice - but one was aborted');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it(`doesn't retry errored tiles`, async () => {
        const errResponse = { status: 403, body: 'Forbidden', headers: { 'Content-Type': 'text/plain' } };
        fetchMock.route(/export\.php/, errResponse, { delay: 1 });
        _keepright.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] considered loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 0, 'redraw not called');
        assert.lengthOf(spyError.mock.calls, 1, 'console.error called once');
        assert.match(spyError.mock.lastCall[0], /Forbidden/i);

        context.viewport.transform.v++;  // touch viewport
        _keepright.loadTiles();           // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch still called once');
        assert.lengthOf(spyRedraw.mock.calls, 0, 'redraw still not called');
        assert.lengthOf(spyError.mock.calls, 1, 'console.error still called once');
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/export\.php/, sample.data10);
        _keepright.loadTiles();
        return Bun.sleep(5);  // after all fetches have settled
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _keepright.getData();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.MarkerData);
          assert.deepInclude(m1.props, {
            id: '1', serviceID: 'keepright', itemType: '300', objectType: 'way', objectId: '1', schema: '56'
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.MarkerData);
          assert.deepInclude(m2.props, {
            id: '2', serviceID: 'keepright', itemType: '390', objectType: 'way', objectId: '2', schema: '56'
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.MarkerData);
          assert.deepInclude(m3.props, {
            id: '3', serviceID: 'keepright', itemType: '50', objectType: 'node', objectId: '1', schema: '56'
          });
        });
      });
    });

  });
});
