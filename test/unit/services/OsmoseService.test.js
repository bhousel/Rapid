import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './OsmoseService.sample.js';


describe('OsmoseService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    gfx:     new Rapid.MockGfxSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Supply cached qa_data and localization strings
  const assets = context.systems.assets;
  assets._cache.qa_data = sample.qa_data;

  // Spy on redraws..
  const gfx = context.systems.gfx;
  const spyRedraw = mock.fn();
  gfx.immediateRedraw = spyRedraw;
  gfx.deferredRedraw = spyRedraw;

  // Setup fetchMock..
  before(() => {
    fetchMock
      .mockGlobal()
      // service will `_loadStringsAsync()` to fetch supported issue types when it starts.
      .sticky(/items\/1070\/class\/1\?langs/, sample.lang_1070_1)
      .sticky(/items\/7040\/class\/6\?langs/, sample.lang_7040_6)
      .sticky(/items\/8300\/class\/52\?langs/, sample.lang_8300_52);
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
      it('constructs a OsmoseService from a context', () => {
        const osmose = new Rapid.OsmoseService(context);
        assert.instanceOf(osmose, Rapid.OsmoseService);
        assert.strictEqual(osmose.id, 'osmose');
        assert.strictEqual(osmose.context, context);
        assert.instanceOf(osmose.requiredDependencies, Set);
        assert.instanceOf(osmose.optionalDependencies, Set);
        assert.isFalse(osmose.autoStart);

        assert.deepEqual(osmose._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const osmose = new Rapid.OsmoseService(context);
        const prom = osmose.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = osmose._cache;
            assert.instanceOf(cache.inflightTile, Map);
            assert.isEmpty(cache.inflightTile);
            assert.instanceOf(cache.inflightPost, Map);
            assert.isEmpty(cache.inflightPost);
            assert.deepEqual(cache.closed, {});
            assert.isNull(cache.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const osmose = new Rapid.OsmoseService(context);
        osmose.requiredDependencies.add('missing');
        const prom = osmose.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const osmose = new Rapid.OsmoseService(context);
        const prom = osmose.initAsync().then(() => osmose.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(osmose.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const osmose = new Rapid.OsmoseService(context);
        osmose._cache = {};
        const prom = osmose.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = osmose._cache;
            assert.instanceOf(cache.inflightTile, Map);
            assert.isEmpty(cache.inflightTile);
            assert.instanceOf(cache.inflightPost, Map);
            assert.isEmpty(cache.inflightPost);
            assert.deepEqual(cache.closed, {});
            assert.isNull(cache.lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _osmose;

    before(() => {
      _osmose = new Rapid.OsmoseService(context);
      return _osmose.initAsync().then(() => _osmose.startAsync());
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _osmose.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/issues/, sample.data10);
        _osmose.loadTiles();
        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('osmose', [10, 0]));  // tile is loaded here
          done();
        });
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/issues/, sample.data10);
        _osmose.loadTiles();
        return new Promise(resolve => { setImmediate(resolve); });
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _osmose.getData();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.Marker);
          assert.deepInclude(m1.props, {
            id: '1', class: 1, item: 1070, type: '1070-1', iconID: 'maki-home', serviceID: 'osmose'
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.Marker);
          assert.deepInclude(m2.props, {
            id: '2', class: 6, item: 7040, type: '7040-6', iconID: 'temaki-power', serviceID: 'osmose'
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.Marker);
          assert.deepInclude(m3.props, {
            id: '3', class: 52, item: 8300, type: '8300-52', iconID: 'temaki-stop', serviceID: 'osmose'
          });
        });
      });

      describe('getStrings', () => {
        it('returns string data for a given item type and locale code', () => {
          const result = _osmose.getStrings('1070-1', 'en-US');
          assert.deepInclude(result, {
            title: 'Highway intersecting building',
            detail: '<p>Two features overlap with no shared node to indicate a physical connection or tagging to indicate a vertical separation.</p>\n',
            fix: '<p>Move a feature if it&#39;s in the wrong place. Connect the features if appropriate or update the tags if not.</p>\n',
            trap: '<p>A feature may be missing a tag, such as <code>tunnel=*</code>, <code>bridge=*</code>, <code>covered=*</code> or <code>ford=*</code>.\nIf a road or railway intersects a building, consider adding the <code>layer=*</code> tag to it.\nWarning: information sources can be contradictory in time or with spatial offset.</p>\n'
          });
        });
      });

      describe('getColor', () => {
        it('returns the color for a given item', () => {
          const result = _osmose.getColor(1070);
          assert.strictEqual(result, 16763904);  // PIXI.Color('#FFCC00').toNumber()
        });
      });

      describe('getIcon', () => {
        it('returns the icon for a given item type', () => {
          const result = _osmose.getIcon('1070-1');
          assert.strictEqual(result, 'maki-home');
        });
      });

    });

  });
});
