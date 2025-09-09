import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('StreetsideService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.MockSystem(context),
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
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
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
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /document is not defined/i));
  //        .then(val => assert.isTrue(streetside.started));
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

    before(() => {
      _streetside = new Rapid.StreetsideService(context);
      return _streetside.initAsync();
        //.then(() => _streetside.startAsync());
        // for now, expect start to fail when run headlessly
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
    });
  });


//
//  describe('loadTiles', () => {
//    it('fires loadedData when tiles are loaded', done => {
//      const spy = sinon.spy();
//      _streetside.on('loadedData', spy);
//
//      const data = [
//        {
//          elapsed: 0.001
//        }, {
//          id: 1, la: 0, lo: 10.001, al: 0, ro: 0, pi: 0, he: 0, bl: '',
//          cd: '1/1/2018 12:00:00 PM', ml: 3, nbn: [], pbn: [], rn: [],
//          pr: undefined, ne: 2
//        }, {
//          id: 2, la: 0, lo: 10.002, al: 0, ro: 0, pi: 0, he: 0, bl: '',
//          cd: '1/1/2018 12:00:01 PM', ml: 3, nbn: [], pbn: [], rn: [],
//          pr: 1, ne: 3
//        }, {
//          id: 3, la: 0, lo: 10.003, al: 0, ro: 0, pi: 0, he: 0, bl: '',
//          cd: '1/1/2018 12:00:02 PM', ml: 3, nbn: [], pbn: [], rn: [],
//          pr: 2, ne: undefined
//        }
//      ];
//
//      fetchMock.route(/StreetSideBubbleMetaData/, {
//        body: JSON.stringify(data),
//        status: 200,
//        headers: { 'Content-Type': 'text/plain' }
//      });
//
//      _streetside.loadTiles();
//
//      window.setTimeout(() => {
//        expect(spy.called).to.be.ok;   // called many times because of margin tiles
//        done();
//      }, 20);
//    });
//
//
//    it('does not load tiles around Null Island', done => {
//      _streetside.context.viewport.transform.translation = [0, 0];  // move map to Null Island
//
//      const spy = sinon.spy();
//      _streetside.on('loadedData', spy);
//
//      const data = [
//        {
//          elapsed: 0.001
//        }, {
//          id: 1, la: 0, lo: 0, al: 0, ro: 0, pi: 0, he: 0, bl: '',
//          cd: '1/1/2018 12:00:00 PM', ml: 3, nbn: [], pbn: [], rn: [],
//          pr: undefined, ne: 2
//        }, {
//          id: 2, la: 0, lo: 0, al: 0, ro: 0, pi: 0, he: 0, bl: '',
//          cd: '1/1/2018 12:00:01 PM', ml: 3, nbn: [], pbn: [], rn: [],
//          pr: 1, ne: 3
//        }, {
//          id: 3, la: 0, lo: 0, al: 0, ro: 0, pi: 0, he: 0, bl: '',
//          cd: '1/1/2018 12:00:02 PM', ml: 3, nbn: [], pbn: [], rn: [],
//          pr: 2, ne: undefined
//        }
//      ];
//
//      fetchMock.route(/StreetSideBubbleMetaData/, {
//        body: JSON.stringify(data),
//        status: 200,
//        headers: { 'Content-Type': 'text/plain' }
//      });
//
//      _streetside.loadTiles();
//
//      window.setTimeout(() => {
//        expect(spy.notCalled).to.be.ok;
//        expect(fetchMock.callHistory.calls().length).to.eql(0);   // no tile requests of any kind
//        done();
//      }, 20);
//    });
//  });
//
//
//  describe('getImages', () => {
//    it('returns images in the visible map area', () => {
//      const bubbles = [
//        new Rapid.Marker(context, { type: 'photo', id: '1', loc: [10, 0], ca: 90, pr: undefined, ne: '2', isPano: true }),
//        new Rapid.Marker(context, { type: 'photo', id: '2', loc: [10, 0], ca: 90, pr: '1', ne: '3', isPano: true }),
//        new Rapid.Marker(context, { type: 'photo', id: '3', loc: [10, 1], ca: 90, pr: '2', ne: undefined, isPano: true })
//      ];
//      const boxes = [
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: bubbles[0] },
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: bubbles[1] },
//        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: bubbles[2] }
//      ];
//
//      const cache = _streetside._cache;
//      for (const d of bubbles) {
//        cache.bubbles.set(d.id, d);
//      }
//      cache.rbush.load(boxes);
//
//      const result = _streetside.getImages();
//      expect(result).to.deep.eql([bubbles[0], bubbles[1]]);
//    });
//  });
//
//
//  describe('getSequences', () => {
//    it('returns sequence linestrings in the visible map area', () => {
//      const bubbles = [
//        new Rapid.Marker(context, { type: 'photo', id: '1', loc: [10, 0], ca: 90, pr: undefined, ne: '2', isPano: true }),
//        new Rapid.Marker(context, { type: 'photo', id: '2', loc: [10, 0], ca: 90, pr: '1', ne: '3', isPano: true }),
//        new Rapid.Marker(context, { type: 'photo', id: '3', loc: [10, 1], ca: 90, pr: '2', ne: undefined, isPano: true })
//      ];
//      const boxes = [
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: bubbles[0] },
//        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: bubbles[1] },
//        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: bubbles[2] }
//      ];
//
//      const sequence = new Rapid.GeoJSON(context, {
//        type: 'Feature',
//        id: 's1',
//        serviceID:  'streetside',
//        properties: {
//          type:       'sequence',
//          serviceID:  'streetside',
//          id:         's1',
//          bubbleIDs:  bubbles.map(d => d.id),
//          isPano:     true
//        },
//        geometry: {
//          type: 'LineString',
//          coordinates: bubbles.map(d => d.loc)
//        }
//      });
//
//
//      const cache = _streetside._cache;
//      for (const d of bubbles) {
//        cache.bubbles.set(d.id, d);
//      }
//      cache.rbush.load(boxes);
//      cache.sequences.set('s1', sequence);
//
//      cache.bubbleHasSequences.set('1', ['s1']);
//      cache.bubbleHasSequences.set('2', ['s1']);
//      cache.bubbleHasSequences.set('3', ['s1']);
//
//      const result = _streetside.getSequences();
//      expect(result).to.deep.eql([sequence]);
//    });
//  });

});
