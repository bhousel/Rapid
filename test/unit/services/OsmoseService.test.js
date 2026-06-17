import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
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
    network: new Rapid.NetworkSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Supply cached qa_data and localization strings
  const assets = context.systems.assets;
  assets._loaded.qa_data = sample.qa_data;

  // Spy on redraws..
  const gfx = context.systems.gfx;
  const spyRedraw = mock();
  gfx.immediateRedraw = spyRedraw;
  gfx.deferredRedraw = spyRedraw;

  // Setup fetchMock..
  beforeAll(() => {
    fetchMock
      .mockGlobal()
      // service will `_loadStringsAsync()` to fetch supported issue types when it starts.
      .sticky(/items\/1070\/class\/1\?langs/, sample.lang_1070_1)
      .sticky(/items\/7040\/class\/6\?langs/, sample.lang_7040_6)
      .sticky(/items\/8300\/class\/52\?langs/, sample.lang_8300_52);
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
      it('constructs a OsmoseService from a context', () => {
        const osmose = new Rapid.OsmoseService(context);
        assert.instanceOf(osmose, Rapid.OsmoseService);
        assert.strictEqual(osmose.id, 'osmose');
        assert.strictEqual(osmose.context, context);
        assert.instanceOf(osmose.requiredDependencies, Set);
        assert.instanceOf(osmose.optionalDependencies, Set);
        assert.isFalse(osmose.autoStart);

        assert.deepEqual(osmose._closed, {});
        assert.isNull(osmose._lastv);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const osmose = new Rapid.OsmoseService(context);
        const prom = osmose.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.deepEqual(osmose._closed, {});
            assert.isNull(osmose._lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const osmose = new Rapid.OsmoseService(context);
        osmose.requiredDependencies.add('missing');
        const prom = osmose.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const osmose = new Rapid.OsmoseService(context);
        const prom = osmose.initAsync().then(() => osmose.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(osmose.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const osmose = new Rapid.OsmoseService(context);
        osmose._closed = { foo: 1 };
        osmose._lastv = 5;
        const prom = osmose.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.deepEqual(osmose._closed, {});
            assert.isNull(osmose._lastv);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _osmose;

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
      const tiles = _osmose._tiler.getTiles(viewport).tiles;
      return tiles.length > 0 && tiles.every(tile => network.isCompleted(`osmose-tile-${tile.id}`));
    }

    beforeAll(() => {
      console.error = spyError;
      _osmose = new Rapid.OsmoseService(context);
      return _osmose.initAsync().then(() => _osmose.startAsync());
    });

    afterAll(() => {
      console.error = origError;
    });

    beforeEach(() => {
      spyError.mockClear();

      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _osmose.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', async () => {
        fetchMock.route(/issues/, sample.data10, { delay: 1 });
        _osmose.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it(`doesn't retry inflight tiles`, async () => {
        fetchMock.route(/issues/, sample.data10, { delay: 1 });
        _osmose.loadTiles();
        context.viewport.transform.v++;  // touch viewport
        _osmose.loadTiles();             // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
      });

      it(`doesn't retry loaded tiles`, async () => {
        fetchMock.route(/issues/, sample.data10, { delay: 1 });
        _osmose.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] was loaded');

        context.viewport.transform.v++;  // touch viewport
        _osmose.loadTiles();             // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it('aborts unwanted tile requests', async () => {
        fetchMock.route(/issues/, sample.data10, { delay: 1 });
        _osmose.loadTiles();

        // Move the viewport while fetches are still pending
        context.viewport.transform = { x: -233017, y: 0, z: 14 };  // [20°, 0°]
        _osmose.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isFalse(tileLoaded([10, 0]), 'tile at [10°, 0°] was not loaded');
        assert.isTrue(tileLoaded([20, 0]), 'tile at [20°, 0°] was loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 2, 'fetch called twice - but one was aborted');
        assert.lengthOf(spyRedraw.mock.calls, 1, 'redraw called once');
        assert.lengthOf(spyError.mock.calls, 0, 'console.error not called');
      });

      it(`doesn't retry errored tiles`, async () => {
        const errResponse = { status: 403, body: 'Forbidden', headers: { 'Content-Type': 'text/plain' } };
        fetchMock.route(/issues/, errResponse, { delay: 1 });
        _osmose.loadTiles();

        await Bun.sleep(5);  // after all fetches have settled
        assert.isTrue(tileLoaded([10, 0]), 'tile at [10°, 0°] considered loaded');
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch called once');
        assert.lengthOf(spyRedraw.mock.calls, 0, 'redraw not called');
        assert.lengthOf(spyError.mock.calls, 1, 'console.error called once');
        assert.match(spyError.mock.lastCall[0], /Forbidden/i);

        context.viewport.transform.v++;  // touch viewport
        _osmose.loadTiles();             // try again

        await Bun.sleep(5);  // after all fetches have settled
        assert.lengthOf(fetchMock.callHistory.calls(), 1, 'fetch still called once');
        assert.lengthOf(spyRedraw.mock.calls, 0, 'redraw still not called');
        assert.lengthOf(spyError.mock.calls, 1, 'console.error still called once');
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/issues/, sample.data10);
        _osmose.loadTiles();
        return Bun.sleep(5);  // after all fetches have settled
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _osmose.getData();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.MarkerData);
          assert.deepInclude(m1.props, {
            id: '1', class: 1, item: 1070, type: '1070-1', iconID: 'maki-home', serviceID: 'osmose'
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.MarkerData);
          assert.deepInclude(m2.props, {
            id: '2', class: 6, item: 7040, type: '7040-6', iconID: 'temaki-power', serviceID: 'osmose'
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.MarkerData);
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
