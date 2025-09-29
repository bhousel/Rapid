import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './MapRouletteService.sample.js';


describe('MapRouletteService', () => {
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
      it('constructs a MapRouletteService from a context', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        assert.instanceOf(maproulette, Rapid.MapRouletteService);
        assert.strictEqual(maproulette.id, 'maproulette');
        assert.strictEqual(maproulette.context, context);
        assert.instanceOf(maproulette.requiredDependencies, Set);
        assert.instanceOf(maproulette.optionalDependencies, Set);
        assert.isFalse(maproulette.autoStart);

        assert.deepEqual(maproulette._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        const prom = maproulette.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = maproulette._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
            assert.instanceOf(cache.challenges, Map);
            assert.isEmpty(cache.challenges);
            assert.deepEqual(cache.closed, []);
            assert.isNull(cache.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        maproulette.requiredDependencies.add('missing');
        const prom = maproulette.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        const prom = maproulette.initAsync().then(() => maproulette.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(maproulette.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const maproulette = new Rapid.MapRouletteService(context);
        maproulette._cache = {};
        const prom = maproulette.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = maproulette._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
            assert.instanceOf(cache.challenges, Map);
            assert.isEmpty(cache.challenges);
            assert.deepEqual(cache.closed, []);
            assert.isNull(cache.lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _maproulette;

    before(() => {
      _maproulette = new Rapid.MapRouletteService(context);
      return _maproulette.initAsync().then(() => _maproulette.startAsync());
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _maproulette.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/tasks/, sample.data10);
        fetchMock.route(/challenge/, sample.challenge100);
        _maproulette.loadTiles();
        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 2);  // 1 for tasks, 1 for the challenge
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('maproulette', [10, 0]));  // tile is loaded here
          done();
        });
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/tasks/, sample.data10);
        fetchMock.route(/challenge/, sample.challenge100);
        _maproulette.loadTiles();
        return new Promise(resolve => { setImmediate(resolve); });
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _maproulette.getData();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.Marker);
          assert.isTrue(Rapid.sdk.vecEqual(m1.loc, [10.0001, 0], 1e-6));
          assert.deepInclude(m1.props, {
            id: '1', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.Marker);
          assert.isTrue(Rapid.sdk.vecEqual(m2.loc, [10.0002, 0], 1e-6));
          assert.deepInclude(m2.props, {
            id: '2', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.Marker);
          assert.isTrue(Rapid.sdk.vecEqual(m3.loc, [10.0003, 0], 1e-6));
          assert.deepInclude(m3.props, {
            id: '3', serviceID: 'maproulette', parentId: '100', parentName: 'Unconnected Crosswalks'
          });
        });
      });

      describe('getTask', () => {
        it('returns a task given its ID', () => {
          const task = _maproulette.getTask('1');
          assert.instanceOf(task, Rapid.Marker);
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
