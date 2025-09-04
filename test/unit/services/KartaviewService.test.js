import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './KartaviewService.sample.js';


describe('KartaviewService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    gfx:     new Rapid.MockGfxSystem(context),
    l10n:    new Rapid.MockSystem(context),
    photos:  new Rapid.MockSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Spy on redraws
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
      it('constructs a KartaviewService from a context', () => {
        const kartaview = new Rapid.KartaviewService(context);
        assert.instanceOf(kartaview, Rapid.KartaviewService);
        assert.strictEqual(kartaview.id, 'kartaview');
        assert.strictEqual(kartaview.context, context);
        assert.instanceOf(kartaview.requiredDependencies, Set);
        assert.instanceOf(kartaview.optionalDependencies, Set);
        assert.isFalse(kartaview.autoStart);

        assert.deepEqual(kartaview._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const kartaview = new Rapid.KartaviewService(context);
        const prom = kartaview.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = kartaview._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.instanceOf(cache.nextPage, Map);
            assert.isEmpty(cache.inflight);
            assert.isEmpty(cache.nextPage);
            assert.isNull(cache.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const kartaview = new Rapid.KartaviewService(context);
        kartaview.requiredDependencies.add('missing');
        const prom = kartaview.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const kartaview = new Rapid.KartaviewService(context);
        const prom = kartaview.initAsync().then(() => kartaview.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(kartaview.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const kartaview = new Rapid.KartaviewService(context);
        kartaview._cache = {};
        const prom = kartaview.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = kartaview._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.instanceOf(cache.nextPage, Map);
            assert.isEmpty(cache.inflight);
            assert.isEmpty(cache.nextPage);
            assert.isNull(cache.lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _kartaview;

    before(() => {
      _kartaview = new Rapid.KartaviewService(context);
      return _kartaview.initAsync().then(() => _kartaview.startAsync());
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _kartaview.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/nearby-photos/, sample.nearbyPhotos10);
        _kartaview.loadTiles();
        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('kartaview-images', [10, 0]));  // tile is loaded here
          done();
        });
      });

      it('does not load tiles around Null Island', (t, done) => {
        context.viewport.transform.translation = [0, 0];  // move map to Null Island
        fetchMock.route(/nearby-photos/, sample.nearbyPhotos0);
        _kartaview.loadTiles();
        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 0);  // fetch not called
          assert.lengthOf(spyRedraw.mock.calls, 0);           // redraw not called

          const spatial = context.systems.spatial;
          assert.isFalse(spatial.hasTileAtLoc('kartaview-images', [0, 0]));  // tile is not loaded here
          done();
        });
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the images around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/nearby-photos/, sample.nearbyPhotos10);
        _kartaview.loadTiles();
        return new Promise(resolve => setImmediate(resolve));
      });

      describe('getImages', () => {
        it('returns images in the visible map area', () => {
          const result = _kartaview.getImages();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.Marker);
          assert.strictEqual(m1.id, '1');

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.Marker);
          assert.strictEqual(m2.id, '2');

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.Marker);
          assert.strictEqual(m3.id, '3');
        });
      });

      describe('getSequences', () => {
        it('returns sequences in the visible map area', () => {
          const result = _kartaview.getSequences();
          assert.isArray(result);
          assert.lengthOf(result, 1);

          const s1 = result[0];
          assert.instanceOf(s1, Rapid.GeoJSON);
          assert.strictEqual(s1.id, '100');
        });
      });

    });
  });
});
