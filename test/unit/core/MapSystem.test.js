import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('MapSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.MockSystem(context),
    gfx:      new Rapid.MockGfxSystem(context),
    keyboard: new Rapid.KeyboardSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    map:      new Rapid.MapSystem(context)
  };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a MapSystem from a context', () => {
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
      it('returns a promise to init', () => {
        const map = new Rapid.MapSystem(context);
        const prom = map.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const map = new Rapid.MapSystem(context);
        map.requiredDependencies.add('missing');
        const prom = map.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const map = new Rapid.MapSystem(context);
        const prom = map.initAsync().then(() => map.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(map.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const map = new Rapid.MapSystem(context);
        const prom = map.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _map;

    beforeEach(() => {
      context.viewport = new Rapid.sdk.Viewport(undefined, [100, 100]);
      _map = context.systems.map;
      return _map.initAsync().then(() => _map.startAsync());
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
      it('increments zoom', async () => {
        assert.strictEqual(_map.zoom(4), _map);  // set
        _map.zoomIn();
        await Bun.sleep(1);
        assert.closeTo(_map.zoom(), 5, 1e-6);  // get
      });
    });

    describe('zoomOut', () => {
      it('decrements zoom', async () => {
        assert.strictEqual(_map.zoom(4), _map);  // set
        _map.zoomOut();
        await Bun.sleep(1);
        assert.closeTo(_map.zoom(), 3, 1e-6);  // get
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
      it('sets center', async () => {
        assert.strictEqual(_map.centerEase([20, 20], 0), _map);  // set
        await Bun.sleep(1);
        assert.closeTo(_map.center()[0], 20, 1e-6);  // get
        assert.closeTo(_map.center()[1], 20, 1e-6);  // get
      });
    });

    describe('centerZoom', () => {
      it('gets and sets center and zoom', async () => {
        assert.strictEqual(_map.centerZoom([20, 25], 4), _map);  // set
        await Bun.sleep(1);
        assert.closeTo(_map.center()[0], 20, 1e-6);  // get
        assert.closeTo(_map.center()[1], 25, 1e-6);  // get
        assert.strictEqual(_map.zoom(), 4);          // get
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


    // Showing a change on undo/redo.  The map is 1000×800 at z17, centered on [0, 0].
    describe('showing changes', () => {
      const D = 360 / (256 * 2 ** 17);   // degrees per pixel at z17 (near the equator)
      const box = (x, y, halfPx) => new Rapid.sdk.Extent([(x - halfPx) * D, (y - halfPx) * D], [(x + halfPx) * D, (y + halfPx) * D]);
      const point = (x, y) => new Rapid.sdk.Extent([x * D, y * D]);

      beforeEach(() => {
        context.viewport.dimensions = [1000, 800];
        _map.centerZoom([0, 0], 17);
      });

      describe('easeDuration', () => {
        it('is 0 when nothing changes', () => {
          assert.strictEqual(_map.easeDuration([0, 0], 17), 0);
        });

        it('is short within about a screen, longer within a few, longest beyond', () => {
          assert.strictEqual(_map.easeDuration([200 * D, 0]), 250);
          assert.strictEqual(_map.easeDuration([2000 * D, 0]), 500);
          assert.strictEqual(_map.easeDuration([1, 0]), 1000);
        });

        it('counts zoom changes', () => {
          assert.strictEqual(_map.easeDuration([0, 0], 17.5), 250);
          assert.strictEqual(_map.easeDuration([0, 0], 20), 1000);
        });
      });

      describe('showsExtent', () => {
        it('shows a change near the center', () => {
          assert.isTrue(_map.showsExtent(box(0, 0, 50)));
        });

        it('does not show a change off screen', () => {
          assert.isFalse(_map.showsExtent(box(2000, 0, 50)));
        });

        it('does not show a small change when zoomed far out', () => {
          _map.zoom(14);
          assert.isFalse(_map.showsExtent(point(0, 0)));
          _map.zoom(16);
          assert.isTrue(_map.showsExtent(point(0, 0)));
        });

        it('shows a change bigger than the screen if any of it is in view', () => {
          assert.isTrue(_map.showsExtent(box(2000, 0, 2500)));
        });

        it('checks a given view instead of the current one', () => {
          const here = { ..._map.transform() };
          _map.center([2000 * D, 0]);
          const there = { ..._map.transform() };
          _map.center([0, 0]);
          assert.isFalse(_map.showsExtent(box(2000, 0, 50), here));
          assert.isTrue(_map.showsExtent(box(2000, 0, 50), there));
        });
      });

      describe('viewForExtent', () => {
        it('returns null when the change is already in view', () => {
          assert.isNull(_map.viewForExtent(box(0, 0, 50)));
        });

        it('centers on a change off screen, keeping the zoom', () => {
          const t = _map.viewForExtent(box(2000, 0, 50));
          assert.isObject(t);
          assert.closeTo(t.z, 17, 1e-6);
          _map.transform(t);
          const [lon, lat] = _map.center();
          assert.closeTo(lon, 2000 * D, 1e-6);
          assert.closeTo(lat, 0, 1e-6);
        });

        it('prefers the given transform if it shows the change', () => {
          _map.center([2010 * D, 0]);
          const preferred = { ..._map.transform() };
          _map.center([0, 0]);
          assert.deepEqual(_map.viewForExtent(box(2000, 0, 50), preferred), preferred);
        });

        it('does not zoom out past z16 for a big change', () => {
          const t = _map.viewForExtent(new Rapid.sdk.Extent([4, 4], [6, 6]));
          assert.closeTo(t.z, 16, 1e-6);
        });

        it('zooms in to z16 for a small change seen from far out', () => {
          _map.zoom(12);
          const t = _map.viewForExtent(point(0, 0));
          assert.closeTo(t.z, 16, 1e-6);
        });
      });

      describe('showExtentAsync', () => {
        it('moves the map only when needed', async () => {
          assert.isFalse(await _map.showExtentAsync(box(0, 0, 50)));
          assert.isTrue(await _map.showExtentAsync(box(2000, 0, 50)));
          assert.closeTo(_map.center()[0], 2000 * D, 1e-6);
        });
      });
    });

  });
});
