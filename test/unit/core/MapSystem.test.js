import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('MapSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:   new Rapid.AssetSystem(context),
    editor:   new Rapid.MockSystem(context),
    filters:  new Rapid.MockSystem(context),
    gfx:      new Rapid.MockGfxSystem(context),
    imagery:  new Rapid.MockSystem(context),
    map:      new Rapid.MapSystem(context),
    photos:   new Rapid.MockSystem(context),
    presets:  new Rapid.MockSystem(context),
    rapid:    new Rapid.MockSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    spatial:  new Rapid.MockSystem(context),
    storage:  new Rapid.StorageSystem(context),
    styles:   new Rapid.MockSystem(context),
    urlhash:  new Rapid.UrlHashSystem(context)
  };


  let _map;

  beforeEach(() => {
    context.viewport = new Rapid.sdk.Viewport(undefined, [100, 100]);

    const l10n = context.systems.l10n;
    l10n.preferredLocaleCodes = 'en';
    l10n._cache = {
      en: {
        core: {
          shortcuts: {
            command: {
              wireframe: { key: 'W' },
              highlight_edits: { key: 'G' }
            }
          }
        }
      }
    };

    _map = context.systems.map;
    return _map.initAsync();
  });


  describe('constructor', () => {
    it('constructs an MapSystem from a context', () => {
      const map = new Rapid.MapSystem(context);
      assert.instanceOf(map, Rapid.MapSystem);
      assert.strictEqual(map.id, 'map');
      assert.strictEqual(map.context, context);
      assert.instanceOf(map.requiredDependencies, Set);
      assert.instanceOf(map.optionalDependencies, Set);
      assert.isTrue(map.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const map = new Rapid.MapSystem(context);
      const prom = map.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const map = new Rapid.MapSystem(context);
      map.requiredDependencies.add('missing');
      const prom = map.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const map = new Rapid.MapSystem(context);
      const prom = map.initAsync().then(() => map.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(map.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const map = new Rapid.MapSystem(context);
      const prom = map.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('zoom', () => {
    it('gets and sets zoom level', () => {
      assert.strictEqual(_map.zoom(4), _map);  // set
      assert.strictEqual(_map.zoom(), 4);      // get
    });

    it('respects minzoom', () => {
      _map.zoom(1);
      assert.strictEqual(_map.zoom(), 2);
    });
  });


  describe('zoomIn', () => {
    it('increments zoom', (t, done) => {
      assert.strictEqual(_map.zoom(4), _map);  // set
      _map.zoomIn();
      setImmediate(() => {
        assert.closeTo(_map.zoom(), 5, 1e-6);  // get
        done();
      });
    });
  });

  describe('zoomOut', () => {
    it('decrements zoom', (t, done) => {
      assert.strictEqual(_map.zoom(4), _map);  // set
      _map.zoomOut();
      setImmediate(() => {
        assert.closeTo(_map.zoom(), 3, 1e-6);  // get
        done();
      });
    });
  });

  describe('center', () => {
    it('gets and sets center', () => {
      assert.strictEqual(_map.center([0, 0]), _map);  // set
      assert.closeTo(_map.center()[0], 0, 1e-6);      // get
      assert.closeTo(_map.center()[1], 0, 1e-6);      // get

      assert.strictEqual(_map.center([10, 15]), _map);  // set
      assert.closeTo(_map.center()[0], 10, 1e-6);       // get
      assert.closeTo(_map.center()[1], 15, 1e-6);       // get
    });
  });

  describe('centerEase', () => {
    it('sets center', (t, done) => {
      assert.strictEqual(_map.centerEase([20, 20], 0), _map);  // set
      setImmediate(() => {
        assert.closeTo(_map.center()[0], 20, 1e-6);  // get
        assert.closeTo(_map.center()[1], 20, 1e-6);  // get
        done();
      });
    });
  });

  describe('centerZoom', () => {
    it('gets and sets center and zoom', (t, done) => {
      assert.strictEqual(_map.centerZoom([20, 25], 4), _map);  // set
      setImmediate(() => {
        assert.closeTo(_map.center()[0], 20, 1e-6);  // get
        assert.closeTo(_map.center()[1], 25, 1e-6);  // get
        assert.strictEqual(_map.zoom(), 4);          // get
        done();
      });
    });
  });

  describe('extent', () => {
    it('gets and sets extent', () => {
      _map.center([0, 0]);
      let extent;

      // get
      extent = new Rapid.sdk.Extent(_map.extent());
      assert.closeTo(extent.min[0], -17.5, 0.1);
      assert.closeTo(extent.min[1], -17.3, 0.1);
      assert.closeTo(extent.max[0], 17.5, 0.1);
      assert.closeTo(extent.max[1], 17.3, 0.1);

      // set
      _map.extent( new Rapid.sdk.Extent([10, 1], [30, 1]) );

      // get
      extent = new Rapid.sdk.Extent(_map.extent());
      assert.closeTo(extent.min[0], 10, 0.1);
      assert.closeTo(extent.min[1], -9, 0.1);
      assert.closeTo(extent.max[0], 30, 0.1);
      assert.closeTo(extent.max[1], 11, 0.1);

      // set
      _map.extent( new Rapid.sdk.Extent([-1, -40], [1, -20]) );

      // get
      extent = new Rapid.sdk.Extent(_map.extent());
      assert.closeTo(extent.min[0], -11.6, 0.1);
      assert.closeTo(extent.min[1], -39.5, 0.1);
      assert.closeTo(extent.max[0], 11.6, 0.1);
      assert.closeTo(extent.max[1], -19.4, 0.1);
    });
  });

});
