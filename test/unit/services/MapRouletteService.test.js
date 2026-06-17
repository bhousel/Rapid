import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './MapRouletteService.sample.js';


describe('MapRouletteService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    gfx:     new Rapid.MockGfxSystem(context),
    network: new Rapid.NetworkSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

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
      it('constructs a MapRouletteService from a context', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        assert.instanceOf(maproulette, Rapid.MapRouletteService);
        assert.strictEqual(maproulette.id, 'maproulette');
        assert.strictEqual(maproulette.context, context);
        assert.instanceOf(maproulette.requiredDependencies, Set);
        assert.instanceOf(maproulette.optionalDependencies, Set);
        assert.isFalse(maproulette.autoStart);

        assert.instanceOf(maproulette._challenges, Map);
        assert.isEmpty(maproulette._challenges);
        assert.deepEqual(maproulette._closed, []);
        assert.isNull(maproulette._lastv);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        const prom = maproulette.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.instanceOf(maproulette._challenges, Map);
            assert.isEmpty(maproulette._challenges);
            assert.deepEqual(maproulette._closed, []);
            assert.isNull(maproulette._lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        maproulette.requiredDependencies.add('missing');
        const prom = maproulette.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        const prom = maproulette.initAsync().then(() => maproulette.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(maproulette.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        maproulette._closed = [{ id: 'x' }];
        maproulette._lastv = 5;
        const prom = maproulette.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.instanceOf(maproulette._challenges, Map);
            assert.isEmpty(maproulette._challenges);
            assert.deepEqual(maproulette._closed, []);
            assert.isNull(maproulette._lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _maproulette;

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
      const tiles = _maproulette._tiler.getTiles(viewport).tiles;
      return tiles.length > 0 && tiles.every(tile => network.isCompleted(`maproulette-tile-${tile.id}`));
    }

    beforeAll(() => {
      console.error = spyError;
      _maproulette = new Rapid.MapRouletteService(context);
      return _maproulette.initAsync().then(() => _maproulette.startAsync());
    });

    afterAll(() => {
      console.error = origError;
    });

    beforeEach(() => {
      spyError.mockClear();

      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _maproulette.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', async () => {
        fetchMock.route(/tasks/, sample.data10, { delay: 1 });
        fetchMock.route(/challenge/, sample.challenge100, { delay: 1 });
        _maproulette.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 2, '1 for tasks, 1 for the challenge');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it(`doesn't retry inflight tiles`, async () => {
        fetchMock.route(/tasks/, sample.data10, { delay: 1 });
        fetchMock.route(/challenge/, sample.challenge100, { delay: 1 });
        _maproulette.loadTiles();
        context.viewport.transform.v++;  // touch viewport
        _maproulette.loadTiles();        // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 2, '1 for tasks, 1 for the challenge');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
      });

      it(`doesn't retry loaded tiles`, async () => {
        fetchMock.route(/tasks/, sample.data10, { delay: 1 });
        fetchMock.route(/challenge/, sample.challenge100, { delay: 1 });
        _maproulette.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');

        context.viewport.transform.v++;  // touch viewport
        _maproulette.loadTiles();        // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.lengthOf(fetchMock.callHistory.calls(), 2, 'still 1 for tasks, 1 for the challenge');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it('aborts unwanted tile requests', async () => {
        fetchMock.route(/tasks/, sample.data10, { delay: 1 });
        fetchMock.route(/challenge/, sample.challenge100, { delay: 1 });
        _maproulette.loadTiles();

        // Move the viewport while fetches are still pending
        context.viewport.transform = { x: -233017, y: 0, z: 14 };  // [20°, 0°]
        _maproulette.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isFalse(tileLoaded([10, 0]), 'tile at [10°, 0°] was not loaded');
        assert.isTrue(tileLoaded([20, 0]), 'tile at [20°, 0°] was loaded');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it(`doesn't retry errored tiles`, async () => {
        const errResponse = { status: 403, body: 'Forbidden', headers: { 'Content-Type': 'text/plain' } };
        fetchMock.route(/tasks/, errResponse, { delay: 1 });
        _maproulette.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] considered loaded');
        assert.lengthOf(spyRedraw.mock.calls, 0, 'redraw not called');
        assert.lengthOf(spyError.mock.calls, 1, 'console.error called once');
        assert.match(spyError.mock.lastCall[0], /Forbidden/i);

        context.viewport.transform.v++;  // touch viewport
        _maproulette.loadTiles();        // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.lengthOf(spyRedraw.mock.calls, 0, 'redraw still not called');
        assert.lengthOf(spyError.mock.calls, 1, 'console.error still called once');
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/tasks/, sample.data10);
        fetchMock.route(/challenge/, sample.challenge100);
        _maproulette.loadTiles();
        return Bun.sleep(5);  // after all fetches have settled
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _maproulette.getData();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.MarkerData);
          assert.isTrue(Rapid.sdk.vecEqual(m1.loc, [10.0001, 0], 1e-6));
          assert.deepInclude(m1.props, {
            id: '1', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.MarkerData);
          assert.isTrue(Rapid.sdk.vecEqual(m2.loc, [10.0002, 0], 1e-6));
          assert.deepInclude(m2.props, {
            id: '2', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.MarkerData);
          assert.isTrue(Rapid.sdk.vecEqual(m3.loc, [10.0003, 0], 1e-6));
          assert.deepInclude(m3.props, {
            id: '3', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });
        });
      });

      describe('getTask', () => {
        it('returns a task given its ID', () => {
          const task = _maproulette.getTask('1');
          assert.instanceOf(task, Rapid.MarkerData);
          assert.isTrue(Rapid.sdk.vecEqual(task.loc, [10.0001, 0], 1e-6));
          assert.deepInclude(task.props, {
            id: '1', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });
        });
      });

      describe('getChallenge', () => {
        it('returns a challenge given its ID', () => {
          const challenge = _maproulette.getChallenge('100');
          assert.isObject(challenge);
          assert.deepInclude(challenge, {
            id: '100', isVisible: true, enabled: true, deleted: false, name: 'Unconnected Crosswalks'
          });
        });
      });

      describe('itemURL', () => {
        it('returns a task url', () => {
          const task = _maproulette.getTask('1');
          const result = _maproulette.itemURL(task);
          assert.strictEqual(result, `https://maproulette.org/challenge/100/task/1`);
        });
      });

    });

  });
});
