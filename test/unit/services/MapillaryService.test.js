import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


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
//    // Mock function for retrieving tile data.. The original expects a protobuffer vector tile.
//    _mapillary._loadTileDataToCache = () => { };

      return _mapillary.initAsync();
        //.then(() => _mapillary.startAsync());
        // for now, expect start to fail when run headlessly
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
    });
  });

  //
//
//  describe('getData', () => {
//    it('returns images in the visible map area', () => {
//      const data = [
//        new Rapid.Marker(context, { type: 'photo', id: 'photo0', loc: [10,0], ca: 90, isPano: false, sequenceID: 'seq1' }),
//        new Rapid.Marker(context, { type: 'photo', id: 'photo1', loc: [10,0], ca: 90, isPano: false, sequenceID: 'seq1' }),
//        new Rapid.Marker(context, { type: 'photo', id: 'photo2', loc: [10,1], ca: 90, isPano: false, sequenceID: 'seq1' })
//      ];
//      const boxes = [
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[0] },
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[1] },
//        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: data[2] }
//      ];
//
//      const cache = _mapillary._cache;
//      for (const d of data) {
//        cache.images.data.set(d.id, d);
//      }
//      cache.images.rbush.load(boxes);
//
//      const result = _mapillary.getData('images');
//      expect(result).to.deep.eql([data[0], data[1]]);
//    });
//
//
//    it('returns detections in the visible map area', () => {
//      const data = [
//        new Rapid.Marker(context, { type: 'detection', id: 'detect0', loc: [10,0], object_type: 'point' }),
//        new Rapid.Marker(context, { type: 'detection', id: 'detect1', loc: [10,0], object_type: 'point' }),
//        new Rapid.Marker(context, { type: 'detection', id: 'detect2', loc: [10,1], object_type: 'point' })
//      ];
//      const boxes = [
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[0] },
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[1] },
//        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: data[2] }
//      ];
//
//      const cache = _mapillary._cache;
//      for (const d of data) {
//        cache.detections.data.set(d.id, d);
//      }
//      cache.detections.rbush.load(boxes);
//
//      const result = _mapillary.getData('detections');
//      expect(result).to.deep.eql([data[0], data[1]]);
//    });
//
//
//    it('returns signs in the visible map area', () => {
//      const data = [
//        new Rapid.Marker(context, { type: 'detection', id: 'sign0', loc: [10,0], object_type: 'traffic_sign' }),
//        new Rapid.Marker(context, { type: 'detection', id: 'sign1', loc: [10,0], object_type: 'traffic_sign' }),
//        new Rapid.Marker(context, { type: 'detection', id: 'sign2', loc: [10,1], object_type: 'traffic_sign' })
//      ];
//      const boxes = [
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[0] },
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[1] },
//        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: data[2] }
//      ];
//
//      // signs are now also stored in the detections cache
//      const cache = _mapillary._cache;
//      for (const d of data) {
//        cache.detections.data.set(d.id, d);
//      }
//      cache.detections.rbush.load(boxes);
//
//      const result = _mapillary.getData('signs');
//      expect(result).to.deep.eql([data[0], data[1]]);
//    });
//  });
//
//
//  describe('getSequences', () => {
//    it('returns sequence linestrings in the visible map area', () => {
//      const data = [
//        new Rapid.Marker(context, { type: 'photo', id: 'photo0', loc: [10,0], ca: 90, isPano: false, sequenceID: 'seq1' }),
//        new Rapid.Marker(context, { type: 'photo', id: 'photo1', loc: [10,0], ca: 90, isPano: false, sequenceID: 'seq1' }),
//        new Rapid.Marker(context, { type: 'photo', id: 'photo2', loc: [10,1], ca: 90, isPano: false, sequenceID: 'seq1' })
//      ];
//      const boxes = [
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[0] },
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: data[1] },
//        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: data[2] }
//      ];
//      const sequence = new Rapid.GeoJSON(context, {
//        type: 'FeatureCollection',
//        id: 'seq1',
//        features: [{
//          type: 'Feature',
//          properties: {
//            id: 'seq1',
//            isPano: false
//          },
//          geometry: {
//            type: 'LineString',
//            coordinates: [[10,0], [10,0], [10,1]],
//          }
//        }]
//      });
//
//      const cache = _mapillary._cache;
//      for (const d of data) {
//        cache.images.data.set(d.id, d);
//      }
//      cache.images.rbush.load(boxes);
//      cache.sequences.data.set(sequence.id, sequence);
//
//      const result = _mapillary.getSequences();
//      expect(result).to.deep.eql([sequence]);
//    });
//  });
//
//
//  describe('loadTiles', () => {
//    it('fires loadedImages when image tiles are loaded', done => {
//      fetchMock.route(/mly1(_computed)?_public/, {
//        body: '{"data":[]}',
//        status: 200,
//        headers: { 'Content-Type': 'application/json' }
//      });
//
//      _mapillary.on('loadedImages', () => {
//        expect(fetchMock.callHistory.calls().length).to.eql(1);
//        done();
//      });
//
//      _mapillary.loadTiles('images');
//    });
//
//
//    it('does not load tiles around Null Island', done => {
//      const spy = sinon.spy();
//      fetchMock.route(/mly1(_computed)?_public/, {
//        body: '{"data":[]}',
//        status: 200,
//        headers: { 'Content-Type': 'application/json' }
//      });
//
//      _mapillary.context.viewport.transform.translation = [0, 0];  // move map to Null Island
//      _mapillary.on('loadedImages', spy);
//      _mapillary.loadTiles('images');
//
//      window.setTimeout(() => {
//        expect(spy.notCalled).to.be.ok;
//        expect(fetchMock.callHistory.calls().length).to.eql(0);   // no tile requests of any kind
//        done();
//      }, 20);
//    });
//  });

});
