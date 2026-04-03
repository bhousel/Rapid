
describe('Map3dSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:   new Rapid.AssetSystem(context),
    editor:   new Rapid.EditSystem(context),
    gfx:      new Rapid.MockGfxSystem(context),
    map:      new Rapid.MapSystem(context),
    network:  new Rapid.NetworkSystem(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context),
    styles:   new Rapid.StyleSystem(context),
    ui:       new Rapid.MockSystem(context),  // Map3dSystem requires ui
    urlhash:  new Rapid.UrlHashSystem(context)
  };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a Map3dSystem from a context', () => {
        const map3d = new Rapid.Map3dSystem(context);
        assert.instanceOf(map3d, Rapid.Map3dSystem);
        assert.strictEqual(map3d.id, 'map3d');
        assert.strictEqual(map3d.context, context);
        assert.instanceOf(map3d.requiredDependencies, Set);
        assert.instanceOf(map3d.optionalDependencies, Set);
        assert.isFalse(map3d.autoStart);  // Map3dSystem doesn't auto-start
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const map3d = new Rapid.Map3dSystem(context);
        const prom = map3d.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const map3d = new Rapid.Map3dSystem(context);
        map3d.requiredDependencies.add('missing');
        const prom = map3d.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const map3d = new Rapid.Map3dSystem(context);
        const prom = map3d.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _map3d;

    beforeEach(() => {
      context.viewport = new Rapid.sdk.Viewport(undefined, [100, 100]);
      _map3d = new Rapid.Map3dSystem(context);
      return _map3d.initAsync();
    });


    describe('visible', () => {
      it('defaults to false when urlhash is not available', () => {
        const tempContext = new Rapid.MockContext();
        tempContext.systems = {};  // No urlhash
        const map3d = new Rapid.Map3dSystem(tempContext);
        assert.isFalse(map3d.visible);
      });

      it('returns false when urlhash param is not set', () => {
        assert.isFalse(_map3d.visible);
      });

      it('returns true when urlhash param is "true"', () => {
        const urlhash = context.systems.urlhash;
        urlhash.setParam('map3d', 'true');
        assert.isTrue(_map3d.visible);
      });
    });


    describe('containerID', () => {
      it('has the correct container ID', () => {
        assert.strictEqual(_map3d.containerID, 'map3d_container');
      });
    });


    describe('deferredRedraw', () => {
      it('has a throttled redraw function', () => {
        assert.isFunction(_map3d.deferredRedraw);
      });
    });
  });
});
