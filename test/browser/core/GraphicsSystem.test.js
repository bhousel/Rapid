describe('GraphicsSystem', () => {

  // Which layers are shown: saved in settings, and written to the url, which wins for the session.
  // A real scene needs WebGL (and the constructor a canvas), so these tests use a stand-in scene,
  // and a system made without its constructor, with just what the layer code uses.
  describe('layers', () => {
    let context, gfx, scene, saved, initialParams, urlParams;

    function startGfx(urlLayers) {
      if (urlLayers !== undefined) initialParams.set('layers', urlLayers);
      gfx._startLayers();
      gfx._started = true;
      gfx._hashChanged(new Map(initialParams));   // the first 'hashchange', when the url resumes
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
          setParam: (k, v) => urlParams.set(k, v)
        }
      };

      gfx = Object.assign(Object.create(Rapid.GraphicsSystem.prototype), {
        context: context,
        _started: false,
        _shownLayerIDs: new Set(),
        _defaultLayerIDs: new Set(),
        _layersParam: undefined,
        _applyingLayers: false
      });

      // The layers start with their own defaults: OSM and Rapid data are shown.
      const setLayers = (layerIDs, enabled) => {
        for (const layerID of layerIDs) {
          const layer = scene.layers.get(layerID);
          if (layer) layer.enabled = enabled;
        }
        gfx._layersChanged();   // 'layerchange'
      };
      scene = {
        layers: new Map(['osm', 'osm-notes', 'rapid', 'mapillary', 'background'].map(layerID => {
          return [layerID, { id: layerID, enabled: ['osm', 'rapid', 'background'].includes(layerID) }];
        })),
        enableLayers: layerIDs => setLayers(layerIDs, true),
        disableLayers: layerIDs => setLayers(layerIDs, false)
      };
      gfx.scene = scene;
    });


    it('shows the layers saved in settings, and writes them to the url', () => {
      saved.set('layers.enabled', ['osm', 'osm-notes']);
      startGfx();
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);   // the background isn't one of them
      assert.strictEqual(urlParams.get('layers'), 'osm,osm-notes');
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes']);
    });

    it('doesn\'t take layers written to the url before startup for the url\'s own', () => {
      // A 'layerchange' before startup, while the url is paused
      saved.set('layers.enabled', ['osm', 'osm-notes']);
      scene.enableLayers(['mapillary']);
      startGfx();
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);
      assert.strictEqual(urlParams.get('layers'), 'osm,osm-notes');
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes']);
    });

    it('shows the layers\' own defaults when nothing is saved, without saving them', () => {
      startGfx();
      assert.sameMembers(shownIDs(), ['osm', 'rapid', 'background']);
      assert.isFalse(saved.has('layers.enabled'));
    });

    it('shows the url\'s layers instead, without saving them', () => {
      saved.set('layers.enabled', ['osm', 'rapid']);
      startGfx('osm,mapillary');
      assert.sameMembers(shownIDs(), ['osm', 'mapillary', 'background']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'rapid']);
    });

    it('saves only the layers the user changes, so the url\'s choices don\'t replace the others', () => {
      saved.set('layers.enabled', ['osm', 'rapid']);
      startGfx('osm');                    // rapid hidden, for this session
      scene.enableLayers(['osm-notes']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'osm-notes', 'rapid']);
      assert.strictEqual(urlParams.get('layers'), 'osm,osm-notes');

      scene.disableLayers(['osm']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm-notes', 'rapid']);
    });

    it('follows layers the user puts in the url, without saving them', () => {
      saved.set('layers.enabled', ['osm', 'rapid']);
      startGfx();
      gfx._hashChanged(new Map([['layers', 'mapillary']]));
      assert.sameMembers(shownIDs(), ['mapillary', 'background']);
      assert.deepEqual(saved.get('layers.enabled'), ['osm', 'rapid']);
    });

    it('doesn\'t apply the url\'s layers again when it\'s read at startup', () => {
      // e.g. a link's `id=` showed the notes layer before the first 'hashchange'
      startGfx('osm');
      scene.enableLayers(['osm-notes']);
      gfx._hashChanged(new Map([['layers', 'osm']]));
      assert.sameMembers(shownIDs(), ['osm', 'osm-notes', 'background']);
    });

    it('puts the layers back in the url if they\'re taken out of it', () => {
      startGfx();
      urlParams.delete('layers');
      gfx._hashChanged(new Map());
      assert.strictEqual(urlParams.get('layers'), 'osm,rapid');
    });

    it('doesn\'t remember the walkthrough\'s layers', () => {
      startGfx();
      context.inIntro = true;
      scene.disableLayers(['osm', 'rapid']);
      assert.isFalse(saved.has('layers.enabled'));
      assert.strictEqual(urlParams.get('layers'), 'osm,rapid');
    });
  });
});
