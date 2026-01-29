import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './StreetsideService.sample.js';


describe('StreetsideService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    gfx:     new Rapid.MockGfxSystem(context),
    l10n:    new Rapid.MockSystem(context),
    photos:  new Rapid.MockSystem(context),
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
      it('constructs a StreetsideService from a context', () => {
        const streetside = new Rapid.StreetsideService(context);
        assert.instanceOf(streetside, Rapid.StreetsideService);
        assert.strictEqual(streetside.id, 'streetside');
        assert.strictEqual(streetside.context, context);
        assert.instanceOf(streetside.requiredDependencies, Set);
        assert.instanceOf(streetside.optionalDependencies, Set);
        assert.isFalse(streetside.autoStart);

        assert.deepEqual(streetside._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const streetside = new Rapid.StreetsideService(context);
        const prom = streetside.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = streetside._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
            assert.isNull(cache.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const streetside = new Rapid.StreetsideService(context);
        streetside.requiredDependencies.add('missing');
        const prom = streetside.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const streetside = new Rapid.StreetsideService(context);
        const prom = streetside.initAsync().then(() => streetside.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
  // for now, expect this to fail when run headlessly
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /document/i));
  //        .then(() => assert.isTrue(streetside.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const streetside = new Rapid.StreetsideService(context);
        streetside._cache = {};
        const prom = streetside.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = streetside._cache;
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
            assert.isNull(cache.lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _streetside;

    beforeAll(() => {
      _streetside = new Rapid.StreetsideService(context);

      // We will replace the tiler to make testing a little easier.
      // The default StreetsideService tiler is zoomed into 16.5 and fetches margin tiles.
      // This tiler mimics what the Mapillary and Kartaview do.
      _streetside._tiler = new Rapid.sdk.Tiler().zoomRange(14).skipNullIsland(true);

      return _streetside.initAsync();
        //.then(() => _streetside.startAsync());
        // for now, expect start to fail when run headlessly
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _streetside.resetAsync();
    });

    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', done => {
        fetchMock
          .route(/StreetSideBubbleMetaData/, {
            body: JSON.stringify(sample.bubbles10),
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });

        _streetside.loadTiles();

        setTimeout(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('streetside-images', [10, 0]));  // tile is loaded here
          done();
        }, 1);
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the images around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
       fetchMock
          .route(/StreetSideBubbleMetaData/, {
            body: JSON.stringify(sample.bubbles10),
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });
        _streetside.loadTiles();
        return new Promise(resolve => { setTimeout(resolve, 1); });
      });

      describe('getImages', () => {
        it('returns images in the visible map area', () => {
          const result = _streetside.getImages();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.Marker);
          assert.deepInclude(m1.props, {
            id: '1', type: 'photo', serviceID: 'streetside', isPano: true
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.Marker);
          assert.deepInclude(m2.props, {
            id: '2', type: 'photo', serviceID: 'streetside', isPano: true
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.Marker);
          assert.deepInclude(m3.props, {
            id: '3', type: 'photo', serviceID: 'streetside', isPano: true
          });
        });
      });

      describe('getSequences', () => {
        it('returns sequences in the visible map area', () => {
          const result = _streetside.getSequences();
          assert.isArray(result);
          assert.lengthOf(result, 1);

          const seq = result[0];
          assert.instanceOf(seq, Rapid.GeoJSON);
          assert.deepInclude(seq.props, {
            type: 'sequence', serviceID: 'streetside', isPano: true, bubbleIDs: ['1', '2', '3']
          });
        });
      });

    });
  });

});
