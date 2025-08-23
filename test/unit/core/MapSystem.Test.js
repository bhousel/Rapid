import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('MapSystem', () => {
  let _map;

  class MockSystem {
    constructor(context) { this.context = context; }
    initAsync()          { return Promise.resolve(); }
    on()                 { return this; }
    off()                { return this; }
  }

  class MockGfxSystem extends MockSystem {
    constructor(context) {
      super(context);
      this.scene = new MockSystem();
    }
    deferredRedraw() {}
    immediateRedraw() {}
    setTransformAsync(t) {
      this.context.viewport.transform = t;
      return Promise.resolve(t);
    }
  }

  class MockContext {
    constructor()   {
      this.services = {};
      this.systems = {
        assets:   new Rapid.AssetSystem(this),
        editor:   new MockSystem(this),
        filters:  new MockSystem(this),
        gfx:      new MockGfxSystem(this),
        imagery:  new Rapid.ImagerySystem(this),
        map:      new Rapid.MapSystem(this),
        photos:   new Rapid.PhotoSystem(this),
        presets:  new Rapid.PresetSystem(this),
        rapid:    new Rapid.RapidSystem(this),
        l10n:     new Rapid.LocalizationSystem(this),
        spatial:  new Rapid.SpatialSystem(this),
        storage:  new Rapid.StorageSystem(this),
        styles:   new Rapid.StyleSystem(this),
        urlhash:  new Rapid.UrlHashSystem(this)
      };
      this.viewport = new Rapid.sdk.Viewport(undefined, [100, 100]);
      this._keybinding = new MockSystem(this);
    }
    container()   { return _container; }
    keybinding()  { return this._keybinding; }
    on()          { return this; }
  }


  beforeEach(() => {
    const context = new MockContext();  // get a fresh viewport each time

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
