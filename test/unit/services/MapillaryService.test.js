import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './MapillaryService.sample.js';


describe('MapillaryService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    gfx:     new Rapid.MockGfxSystem(context),
    l10n:    new Rapid.MockSystem(context),
    photos:  new Rapid.MockSystem(context),
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
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
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
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
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
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /document is not defined/i));
  //        .then(val => assert.isTrue(mapillary.started));
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
            assert.instanceOf(cache.inflight, Map);
            assert.isEmpty(cache.inflight);
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

    before(() => {
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
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/mly1_/, {
          body: sample.pbf10,
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        });

        _mapillary.loadTiles('images');

        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('mapillary-images', [10, 0]));  // tile is loaded here
          done();
        });
      });

      it('does not load tiles around Null Island', (t, done) => {
        context.viewport.transform.translation = [0, 0];  // move map to Null Island
        fetchMock.route(/mly1_/, {
          body: sample.pbf0,
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        });

        _mapillary.loadTiles('images');

        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 0);  // fetch not called
          assert.lengthOf(spyRedraw.mock.calls, 0);           // redraw not called

          const spatial = context.systems.spatial;
          assert.isFalse(spatial.hasTileAtLoc('mapillary-images', [0, 0]));  // tile is not loaded here
          done();
        });
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
        return new Promise(resolve => { setImmediate(resolve); });
      });

      describe('getData', () => {
        it('returns images in the visible map area', () => {
          const result = _mapillary.getData('images');
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.Marker);
          assert.deepInclude(m1.props, {
            id: '1', type: 'photo', serviceID: 'mapillary', isPano: false
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.Marker);
          assert.deepInclude(m2.props, {
            id: '2', type: 'photo', serviceID: 'mapillary', isPano: false
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.Marker);
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
          assert.instanceOf(seq, Rapid.GeoJSON);
          assert.deepInclude(seq.props, {
            id: '100', type: 'sequence', serviceID: 'mapillary'
          });
        });
      });

      describe('getImage', () => {
        it('returns the image with the given id', () => {
          const result = _mapillary.getImage('1');
          assert.instanceOf(result, Rapid.Marker);
          assert.deepInclude(result.props, {
            id: '1', type: 'photo', serviceID: 'mapillary', isPano: false
          });
        });
      });

      describe('getSequence', () => {
        it('returns the sequence with the given id', () => {
          const result = _mapillary.getSequence('100');
          assert.instanceOf(result, Rapid.GeoJSON);
          assert.deepInclude(result.props, {
            id: '100', type: 'sequence', serviceID: 'mapillary'
          });
        });
      });
    });

  });

});
