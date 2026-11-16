import { PixiLayerCustomData } from '../../../modules/pixi/PixiLayerCustomData.ts';


describe('PixiLayerCustomData', () => {
  // A real scene needs WebGL, so these tests use a stand-in scene with just what the layer uses.
  let context, layer, scene, urlParams, caches, pending;

  const point = name => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: name }, geometry: { type: 'Point', coordinates: [0, 0] } }]
  });
  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

  // Loads the url's params as a link would, on the first 'hashchange'
  function openLink(params) {
    for (const [k, v] of Object.entries(params)) urlParams.set(k, v);
    layer._hashChanged(new Map(urlParams), new Map());
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    urlParams = new Map();
    caches = new Map();
    pending = new Map();
    context.systems = {
      map: { trimmedExtent: () => {} },
      network: { fetch: url => new Promise(resolve => { pending.set(url, resolve); }) },
      spatial: {
        clearCache: spatialID => caches.delete(spatialID),
        replaceData: (spatialID, data) => caches.set(spatialID, data)
      },
      urlhash: {
        on: () => {},
        getParam: k => urlParams.get(k),
        setParam: (k, v) => (v === null ? urlParams.delete(k) : urlParams.set(k, v))
      }
    };

    const listeners = [];
    scene = {
      context: context,
      gfx: {},
      layers: new Map(),
      on: (eventName, fn) => listeners.push(fn),
      enableLayers: layerID => { scene.layers.get(layerID).enabled = true; listeners.forEach(fn => fn()); },
      disableLayers: layerID => { scene.layers.get(layerID).enabled = false; listeners.forEach(fn => fn()); }
    };
    layer = new PixiLayerCustomData(scene);
    scene.layers.set('custom-data', layer);
  });


  describe('in the url', () => {
    it('loads a link\'s data and leaves it in the url, so an `id=` in its data can be found again', async () => {
      openLink({ data: 'https://example.com/a.geojson' });
      pending.get('https://example.com/a.geojson')(point('a'));
      await tick();

      assert.isTrue(layer.enabled);
      assert.isTrue(layer.hasData());
      assert.strictEqual(urlParams.get('data'), 'https://example.com/a.geojson');
    });

    it('leaves a link\'s WKT in the url', () => {
      const wkt = 'polygon((-10 10, -10 -10, 10 -10, 10 10, -10 10))';
      openLink({ data: wkt });

      assert.isTrue(layer.enabled);
      assert.strictEqual(urlParams.get('data'), wkt);
    });

    it('keeps a link\'s data when its `id=` turns the layer on before the data is read', () => {
      urlParams.set('data', 'https://example.com/a.geojson');
      scene.enableLayers('custom-data');   // the selection is applied first
      openLink({});

      assert.strictEqual(urlParams.get('data'), 'https://example.com/a.geojson');
      assert.isTrue(pending.has('https://example.com/a.geojson'));
    });

    it('reads a legacy `gpx` link as `data`', () => {
      openLink({ gpx: 'https://example.com/track.gpx' });

      assert.isTrue(pending.has('https://example.com/track.gpx'));
      assert.isFalse(urlParams.has('gpx'));
      assert.strictEqual(urlParams.get('data'), 'https://example.com/track.gpx');
    });

    it('drops a link\'s data from the url when the user turns the layer off', async () => {
      openLink({ data: 'https://example.com/a.geojson' });
      pending.get('https://example.com/a.geojson')(point('a'));
      await tick();

      scene.disableLayers('custom-data');
      assert.isFalse(urlParams.has('data'));
    });

    it('drops a link\'s data from the url when the user loads other data, and doesn\'t write the new data', () => {
      openLink({ data: 'https://example.com/a.geojson' });
      layer.setUrl('https://example.com/b.geojson');

      assert.isFalse(urlParams.has('data'));
    });

    it('leaves the data alone when the url\'s `data` goes away', async () => {
      openLink({ data: 'https://example.com/a.geojson' });
      pending.get('https://example.com/a.geojson')(point('a'));
      await tick();

      const prevParams = new Map(urlParams);
      urlParams.delete('data');
      layer._hashChanged(new Map(urlParams), prevParams);
      assert.isTrue(layer.enabled);
      assert.isTrue(layer.hasData());
    });
  });


  describe('loading', () => {
    it('doesn\'t let a slow url load replace data loaded after it', async () => {
      layer.setUrl('https://example.com/slow.geojson');
      layer.setUrl('https://example.com/fast.geojson');
      pending.get('https://example.com/fast.geojson')(point('fast'));
      await tick();
      const fastSpatialID = layer._spatialID;

      pending.get('https://example.com/slow.geojson')(point('slow'));
      await tick();

      assert.strictEqual(layer._spatialID, fastSpatialID);
      assert.deepEqual([...caches.keys()], [fastSpatialID]);
    });
  });
});
