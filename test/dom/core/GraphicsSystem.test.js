import { ANIMATION_GAP_FACTOR, ANIMATION_REST_MS, AnimationPacer } from '../../../modules/pixi/lib/AnimationPacer.ts';


describe('GraphicsSystem', () => {

  // Which layers are shown: saved in settings, and a link's `layers=` overrides that until they change.
  // A real scene needs WebGL (and the constructor a canvas), so these tests use a stand-in scene,
  // and a system made without its constructor, with just what the layer code uses.
  describe('layers', () => {
    let context, gfx, scene, saved, initialParams, urlParams;

    // Starts with the given url, up to the first 'hashchange' (when the url resumes)
    function startGfx(urlLayers) {
      if (urlLayers !== undefined) initialParams.set('layers', urlLayers);
      for (const [k, v] of initialParams) urlParams.set(k, v);
      gfx._startLayers();
      gfx._started = true;
    }
    function firstHashChange() {
      gfx._hashChanged(new Map(initialParams), new Map());
    }
    const shownIDs = () => [...scene.layers.values()].filter(layer => layer.enabled).map(layer => layer.id);

    beforeEach(() => {
      context = new Rapid.MockContext();
      saved = new Map();
      initialParams = new Map();
      urlParams = new Map();
      context.systems = {
        settings: {
          get: k => saved.get(k),
          set: (k, v) => saved.set(k, v)
        },
        urlhash: {
          initialHashParams: initialParams,
          getParam: k => urlParams.get(k),
          setParam: (k, v) => (v === null ? urlParams.delete(k) : urlParams.set(k, v))
        }
      };

      gfx = Object.assign(Object.create(Rapid.GraphicsSystem.prototype), {
        context: context,
        _started: false,
        _shownLayerIDs: new Set(),
        _defaultLayerIDs: new Set(),
        _isApplyingUrl: false
      });

      // The layers start with their own defaults: OSM and Rapid data are shown.
      // KartaView isn't supported (as if its service wasn't there), so it can't be turned on.
      const setLayers = (layerIDs, enabled) => {
        for (const layerID of layerIDs) {
          const layer = scene.layers.get(layerID);
          if (layer) layer.enabled = enabled && layer.supported;
        }
        gfx._layersChanged();   // 'layerchange'
      };
      scene = {
        layers: new Map(['osm', 'osm-notes', 'rapid', 'mapillary', 'kartaview', 'background'].map(layerID => {
          const layer = { id: layerID, supported: layerID !== 'kartaview', enabled: ['osm', 'rapid', 'background'].includes(layerID) };
          return [layerID, layer];
        })),
        enableLayers: layerIDs => setLayers(layerIDs, true),
        disableLayers: layerIDs => setLayers(layerIDs, false)
      };
      gfx.scene = scene;
    });


    it('shows the layers saved in settings, without writing them to the url', () => {
      saved.set('layers.enabled', ['osm', 'osm-notes']);
      startGfx();
      firstHashChange();
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);   // the background isn't one of them
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes']);
      assert.isFalse(urlParams.has('layers'));

      scene.enableLayers(['mapillary']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes', 'mapillary']);
      assert.isFalse(urlParams.has('layers'));
    });

    it('doesn\'t save or take a layer change from before startup', () => {
      saved.set('layers.enabled', ['osm', 'osm-notes']);
      scene.enableLayers(['mapillary']);
      startGfx();
      firstHashChange();
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes']);
    });

    it('shows the layers\' own defaults when nothing is saved, without saving them', () => {
      startGfx();
      firstHashChange();
      assert.sameMembers(shownIDs(), ['osm', 'rapid', 'background']);
      assert.isFalse(saved.has('layers.enabled'));
    });

    it('shows a link\'s layers instead, without saving them, and leaves them in the url', () => {
      saved.set('layers.enabled', ['osm', 'rapid']);
      startGfx('osm,mapillary,kartaview');   // KartaView can't be shown, so it doesn't count
      firstHashChange();
      assert.sameMembers(shownIDs(), ['osm', 'mapillary', 'background']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'rapid']);
      assert.strictEqual(urlParams.get('layers'), 'osm,mapillary,kartaview');
    });

    it('drops a link\'s layers from the url once they change, and saves only that change', () => {
      saved.set('layers.enabled', ['osm', 'rapid']);
      startGfx('osm');                    // rapid hidden, for this session
      firstHashChange();
      scene.enableLayers(['osm-notes']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes', 'rapid']);
      assert.isFalse(urlParams.has('layers'));
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);   // rapid stays hidden

      scene.disableLayers(['osm']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm-notes', 'rapid']);
    });

    it('doesn\'t apply a link\'s layers again after the same link\'s selection changed them', () => {
      // e.g. the link's `id=` turned on the notes layer, while the url was being read
      startGfx('osm');
      scene.enableLayers(['osm-notes']);
      firstHashChange();
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);
      assert.isFalse(urlParams.has('layers'));
    });

    it('follows layers the user puts in the url, without saving them', () => {
      saved.set('layers.enabled', ['osm', 'rapid']);
      startGfx();
      firstHashChange();
      urlParams.set('layers', 'mapillary');
      gfx._hashChanged(new Map([['layers', 'mapillary']]), new Map());
      assert.sameMembers(shownIDs(), ['mapillary', 'background']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'rapid']);

      // Changed, then put in the url again
      scene.enableLayers(['osm']);
      assert.isFalse(urlParams.has('layers'));
      urlParams.set('layers', 'mapillary');
      gfx._hashChanged(new Map([['layers', 'mapillary']]), new Map());
      assert.sameMembers(shownIDs(), ['mapillary', 'background']);
    });

    it('leaves the layers alone when the url\'s layers go away', () => {
      startGfx('osm');
      firstHashChange();
      urlParams.delete('layers');
      gfx._hashChanged(new Map(), new Map([['layers', 'osm']]));
      assert.sameMembers(shownIDs(), ['osm', 'background']);
    });

    it('doesn\'t remember the walkthrough\'s layers', () => {
      startGfx('osm,rapid');
      firstHashChange();
      context.inIntro = true;
      scene.disableLayers(['osm', 'rapid']);
      assert.isFalse(saved.has('layers.enabled'));
      assert.strictEqual(urlParams.get('layers'), 'osm,rapid');
    });
  });


  // While something that's shown moves by itself (a hover's glow, a selection's dashes), the
  // game loop draws the scene again as it is, when its `AnimationPacer` says one is due.
  // These tests run the tick of a system made without its constructor, with what a tick uses.
  describe('animation draws', () => {
    let gfx, scene, pacer, calls;

    beforeEach(() => {
      calls = [];
      pacer = new AnimationPacer();
      scene = {
        animated: true,
        animate: (now, isResting) => calls.push(['animate', now, isResting])
      };
      gfx = Object.assign(Object.create(Rapid.GraphicsSystem.prototype), {
        _started: true,
        _paused: false,
        _pixiTickTime: Infinity,     // (Pixi's own scheduler doesn't get a turn here)
        _glTimer: null,
        _drawPending: false,
        _appPending: false,
        _isTempTransformed: false,
        _animationPacer: pacer,
        _animationDraws: 0,
        scene: scene,
        textureManager: { loaded: true },
        pixi: { render: () => calls.push(['render']) },
        _updateTransform: () => false,
        _followTransform: () => calls.push(['follow']),
        _passAllowed: () => true,
        _app: () => calls.push(['app'])
      });
    });

    it('draws the scene again when an animation draw is due: what moves is moved first, then Pixi renders', () => {
      const before = performance.now();
      pacer.changed(before - 100);     // the last frame was a while ago
      gfx._tick(16.7);

      assert.deepEqual(calls.map(call => call[0]), ['animate', 'render']);
      assert.isAtLeast(calls[0][1], before);
      assert.isFalse(calls[0][2], 'not the last one before a rest');
      assert.strictEqual(gfx.animationDraws, 1);
    });

    it('waits for the pacer\'s gap before the next one', () => {
      pacer.changed(performance.now() - 100);
      gfx._tick(16.7);
      gfx._tick(16.7);
      assert.strictEqual(gfx.animationDraws, 1);
      assert.isFalse(pacer.isDue(performance.now()));
    });

    it('draws none when nothing in the scene moves', () => {
      scene.animated = false;
      pacer.changed(performance.now() - 100);
      gfx._tick(16.7);
      assert.deepEqual(calls, []);
      assert.strictEqual(gfx.animationDraws, 0);
    });

    it('draws none while a frame is being prepared, or while the view has moved on from what\'s drawn', () => {
      pacer.changed(performance.now() - 100);
      gfx._appPending = true;
      gfx._tick(16.7);
      assert.deepEqual(calls, [['app']]);

      gfx._appPending = false;
      gfx._isTempTransformed = true;
      gfx._tick(16.7);
      assert.deepEqual(calls, [['app']]);
      assert.strictEqual(gfx.animationDraws, 0);
    });

    it('draws none before the textures are there, and doesn\'t count one', () => {
      gfx.textureManager.loaded = false;
      pacer.changed(performance.now() - 100);
      gfx._tick(16.7);
      assert.deepEqual(calls, []);
      assert.strictEqual(gfx.animationDraws, 0);
    });

    it('tells the pacer how long the browser took to come back after an animation draw', () => {
      pacer.changed(performance.now() - 100);
      gfx._tick(16.7);
      assert.strictEqual(gfx.animationDraws, 1);
      gfx._tick(60);                   // the GPU needed that long
      assert.strictEqual(pacer.gap, 60 * ANIMATION_GAP_FACTOR);
    });

    it('settles what moves with one last draw when nothing else was drawn for a while, then rests', () => {
      pacer.changed(performance.now() - ANIMATION_REST_MS - 100);
      gfx._tick(16.7);
      assert.deepEqual(calls.map(call => call[0]), ['animate', 'render']);
      assert.isTrue(calls[0][2], 'the last one before a rest');

      gfx._tick(16.7);
      gfx._tick(16.7);
      assert.strictEqual(gfx.animationDraws, 1);

      // ..until something is drawn again
      pacer.changed(performance.now() - 100);
      gfx._tick(16.7);
      assert.strictEqual(gfx.animationDraws, 2);
      assert.isFalse(calls.at(-2)[2]);
    });
  });
});
