import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './MapillaryService.sample.js';


describe('MapillaryService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    gfx:     new Rapid.MockGfxSystem(context),
    l10n:    new Rapid.MockSystem(context),
    network: new Rapid.NetworkSystem(context),
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
      it('constructs a MapillaryService from a context', () => {
        const mapillary = new Rapid.MapillaryService(context);
        assert.instanceOf(mapillary, Rapid.MapillaryService);
        assert.strictEqual(mapillary.id, 'mapillary');
        assert.strictEqual(mapillary.context, context);
        assert.instanceOf(mapillary.requiredDependencies, Set);
        assert.instanceOf(mapillary.optionalDependencies, Set);
        assert.isFalse(mapillary.autoStart);

        assert.deepEqual(mapillary._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const mapillary = new Rapid.MapillaryService(context);
        const prom = mapillary.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = mapillary._cache;
            assert.isNull(cache.images.lastv);
            assert.isNull(cache.detections.lastv);
            assert.isNull(cache.signs.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const mapillary = new Rapid.MapillaryService(context);
        mapillary.requiredDependencies.add('missing');
        const prom = mapillary.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const mapillary = new Rapid.MapillaryService(context);
        const prom = mapillary.initAsync().then(() => mapillary.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
  // for now, expect this to fail when run headlessly
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /document/i));
  //        .then(() => assert.isTrue(mapillary.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const mapillary = new Rapid.MapillaryService(context);
        mapillary._cache = {};
        const prom = mapillary.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = mapillary._cache;
            assert.isNull(cache.images.lastv);
            assert.isNull(cache.detections.lastv);
            assert.isNull(cache.signs.lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _mapillary;

    beforeAll(() => {
      _mapillary = new Rapid.MapillaryService(context);
      return _mapillary.initAsync();
        //.then(() => _mapillary.startAsync());
        // for now, expect start to fail when run headlessly
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _mapillary.resetAsync();
    });

    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', done => {
        fetchMock.route(/mly1_/, {
          body: sample.pbf10,
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        });

        _mapillary.loadTiles('images');

        setTimeout(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('mapillary-images', [10, 0]));  // tile is loaded here
          done();
        }, 1);
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the images around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/mly1_/, {
          body: sample.pbf10,
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        });
        _mapillary.loadTiles('images');
        return new Promise(resolve => { setTimeout(resolve, 1); });
      });

      describe('getData', () => {
        it('returns images in the visible map area', () => {
          const result = _mapillary.getData('images');
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.MarkerData);
          assert.deepInclude(m1.props, {
            id: '1', type: 'photo', serviceID: 'mapillary', isPano: false
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.MarkerData);
          assert.deepInclude(m2.props, {
            id: '2', type: 'photo', serviceID: 'mapillary', isPano: false
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.MarkerData);
          assert.deepInclude(m3.props, {
            id: '3', type: 'photo', serviceID: 'mapillary', isPano: false
          });
        });
      });

      describe('getSequences', () => {
        it('returns sequences in the visible map area', () => {
          const result = _mapillary.getSequences();
          assert.isArray(result);
          assert.lengthOf(result, 1);

          const seq = result[0];
          assert.instanceOf(seq, Rapid.GeoJSONData);
          assert.deepInclude(seq.props, {
            id: '100', type: 'sequence', serviceID: 'mapillary'
          });
        });
      });

      describe('getImage', () => {
        it('returns the image with the given id', () => {
          const result = _mapillary.getImage('1');
          assert.instanceOf(result, Rapid.MarkerData);
          assert.deepInclude(result.props, {
            id: '1', type: 'photo', serviceID: 'mapillary', isPano: false
          });
        });
      });

      describe('getSequence', () => {
        it('returns the sequence with the given id', () => {
          const result = _mapillary.getSequence('100');
          assert.instanceOf(result, Rapid.GeoJSONData);
          assert.deepInclude(result.props, {
            id: '100', type: 'sequence', serviceID: 'mapillary'
          });
        });
      });
    });

  });

});
