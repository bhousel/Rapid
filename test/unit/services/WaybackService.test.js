import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './WaybackService.sample.js';


describe('WaybackService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    gfx:     new Rapid.MockGfxSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Supply cached wayback config
  const assets = context.systems.assets;
  assets._cache.wayback = {
    wayback: sample.waybackConfig
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
      it('constructs a WaybackService from a context', () => {
        const wayback = new Rapid.WaybackService(context);
        assert.instanceOf(wayback, Rapid.WaybackService);
        assert.strictEqual(wayback.id, 'wayback');
        assert.strictEqual(wayback.context, context);
        assert.instanceOf(wayback.requiredDependencies, Set);
        assert.instanceOf(wayback.optionalDependencies, Set);
        assert.isTrue(wayback.autoStart);

        assert.isObject(wayback._cache);
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
        const prom = wayback.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => {
            assert.isObject(wayback._cache);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _wayback;

    before(() => {
      _wayback = new Rapid.WaybackService(context);
      return _wayback.initAsync().then(() => _wayback.startAsync());
    });

    beforeEach(() => {
      return _wayback.resetAsync();
    });
  });

});
