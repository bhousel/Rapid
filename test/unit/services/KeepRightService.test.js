import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './KeepRightService.sample.js';


describe('KeepRightService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    gfx:     new Rapid.MockGfxSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // supply cached qa_data and localization strings
  const assets = context.systems.assets;
  assets._cache.qa_data = {
    'keepRight': {
      'localizeStrings': {
        'this highway': 'this_highway',
      },
      'errorTypes': {
        '50': {
          'title': 'almost-junctions',
          'severity': 'error',
          'description': 'This node is very close but not connected to way #$1',
          'IDs': ['this', 'w'],
          'regex': '(this node) is very close but not connected to way #(\\d+)'
        },
        '300': {
          'title': 'missing maxspeed',
          'severity': 'warning',
          'description': 'This highway is missing a maxspeed tag',
          'IDs': ['this'],
          'regex': '(this highway)'
        },
        '390': {
          'title': 'missing tracktype',
          'severity': 'warning',
          'description': 'This track doesn\'t have a tracktype',
          'IDs': ['this'],
          'regex': '(this track)'
        }
      }
    }
  };

  const l10n = context.systems.l10n;
  l10n._cache = {
    en: {
      core: {
        QA: {
          keepRight: {
            error_parts: {
              this_highway: 'this highway'
            }
          }
        }
      }
    }
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
      it('constructs a KeepRightService from a context', () => {
        const keepright = new Rapid.KeepRightService(context);
        assert.instanceOf(keepright, Rapid.KeepRightService);
        assert.strictEqual(keepright.id, 'keepright');
        assert.strictEqual(keepright.context, context);
        assert.instanceOf(keepright.requiredDependencies, Set);
        assert.instanceOf(keepright.optionalDependencies, Set);
        assert.isFalse(keepright.autoStart);

        assert.deepEqual(keepright._cache, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const keepright = new Rapid.KeepRightService(context);
        const prom = keepright.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = keepright._cache;
            assert.instanceOf(cache.inflightTile, Map);
            assert.isEmpty(cache.inflightTile);
            assert.instanceOf(cache.inflightPost, Map);
            assert.isEmpty(cache.inflightPost);
            assert.deepEqual(cache.closed, {});
            assert.isNull(cache.lastv);
          });
      });

      it('rejects if a dependency is missing', () => {
        const keepright = new Rapid.KeepRightService(context);
        keepright.requiredDependencies.add('missing');
        const prom = keepright.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const keepright = new Rapid.KeepRightService(context);
        const prom = keepright.initAsync().then(() => keepright.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(keepright.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const keepright = new Rapid.KeepRightService(context);
        keepright._cache = {};
        const prom = keepright.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            const cache = keepright._cache;
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
    let _keepright;

    before(() => {
      _keepright = new Rapid.KeepRightService(context);
      return _keepright.initAsync().then(() => _keepright.startAsync());
    });

    beforeEach(() => {
      // reset viewport
      context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      context.viewport.dimensions = [64, 64];
      return _keepright.resetAsync();
    });


    describe('loadTiles', () => {
      it('loads a tile of data and requests a redraw', (t, done) => {
        fetchMock.route(/export\.php/, sample.data10);
        _keepright.loadTiles();
        setImmediate(() => {
          assert.lengthOf(fetchMock.callHistory.calls(), 1);  // fetch called once
          assert.lengthOf(spyRedraw.mock.calls, 1);           // redraw called once

          const spatial = context.systems.spatial;
          assert.isTrue(spatial.hasTileAtLoc('keepright', [10, 0]));  // tile is loaded here
          done();
        });
      });
    });


    describe('with data loaded', () => {
      beforeEach(() => {
        // load the data around [10°, 0°]
        // (this needs to be beforeEach because the parent beforeEach resets)
        fetchMock.route(/export\.php/, sample.data10);
        _keepright.loadTiles();
        return new Promise(resolve => { setImmediate(resolve); });
      });

      describe('getData', () => {
        it('returns data in the visible map area', () => {
          const result = _keepright.getData();
          assert.isArray(result);
          assert.lengthOf(result, 3);

          const m1 = result[0];
          assert.instanceOf(m1, Rapid.Marker);
          assert.deepInclude(m1.props, {
            id: '1', serviceID: 'keepright', itemType: '300', objectType: 'way', objectId: '1', schema: '56'
          });

          const m2 = result[1];
          assert.instanceOf(m2, Rapid.Marker);
          assert.deepInclude(m2.props, {
            id: '2', serviceID: 'keepright', itemType: '390', objectType: 'way', objectId: '2', schema: '56'
          });

          const m3 = result[2];
          assert.instanceOf(m3, Rapid.Marker);
          assert.deepInclude(m3.props, {
            id: '3', serviceID: 'keepright', itemType: '50', objectType: 'node', objectId: '1', schema: '56'
          });
        });
      });
    });

  });
});
