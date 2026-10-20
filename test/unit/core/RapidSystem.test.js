import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import fetchMock from 'fetch-mock';
import { assert } from 'chai';
import { DOMParser } from '@xmldom/xmldom';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './RapidSystem.sample.js';


describe('RapidSystem', () => {

  let _currParams = new Map();

  class MockUrlHashSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'urlhash';
    }
    hasParam(k) { return _currParams.has(k); }
    getParam(k) { return _currParams.get(k); }
    setParam(k, v) {
      if (typeof k !== 'string') return;
      if (v === undefined || v === null || v === 'undefined' || v === 'null') {
        _currParams.delete(k);
      } else {
        _currParams.set(k, v);
      }
    }
  }

  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    network:  new Rapid.NetworkSystem(context),
    settings: new Rapid.SettingsSystem(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context),
    urlhash:  new MockUrlHashSystem(context)
  };

  // Setup fetchMock..
  beforeAll(() => {
    fetchMock
      .mockGlobal()
      .sticky(/trees\.geojson/, sample.data10);
  });

  afterAll(() => {
    fetchMock.hardReset({ includeSticky: true });
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a RapidSystem from a context', () => {
        const rapid = new Rapid.RapidSystem(context);
        assert.instanceOf(rapid, Rapid.RapidSystem);
        assert.strictEqual(rapid.id, 'rapid');
        assert.strictEqual(rapid.context, context);
        assert.instanceOf(rapid.requiredDependencies, Set);
        assert.instanceOf(rapid.optionalDependencies, Set);
        assert.isTrue(rapid.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const rapid = new Rapid.RapidSystem(context);
        const prom = rapid.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const rapid = new Rapid.RapidSystem(context);
        rapid.requiredDependencies.add('missing');
        const prom = rapid.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const rapid = new Rapid.RapidSystem(context);
        const prom = rapid.initAsync().then(() => rapid.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(rapid.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const rapid = new Rapid.RapidSystem(context);
        const prom = rapid.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    const spyDatasetChange = mock();
    let _rapid;

    beforeAll(() => {
      _rapid = new Rapid.RapidSystem(context);
      context.systems.rapid = _rapid;

      return _rapid.initAsync()
        .then(() => _rapid.on('datasetchange', spyDatasetChange))
        .then(() => _rapid.startAsync())
        .then(() => {
          // load sample datasets into the catalog
          const toLoad = [
            new Rapid.RapidDataset(context, sample.msBuildings),
            new Rapid.RapidDataset(context, sample.overturePlaces),
          ];
          for (const dataset of toLoad) {
            _rapid.catalog.set(dataset.id, dataset);
            for (const category of dataset.categories) {
              _rapid.categories.add(category);
            }
          }
        });
    });


    it('has a catalog of datasets', () => {
      assert.instanceOf(_rapid.catalog, Map);
      assert.lengthOf(_rapid.catalog, 2);
      assert.hasAllKeys(_rapid.catalog, ['msBuildings', 'overture-places']);
    });

    it('has a set of categories', () => {
      assert.instanceOf(_rapid.categories, Set);
      assert.lengthOf(_rapid.categories, 5);
      assert.hasAllKeys(_rapid.categories, ['microsoft', 'buildings', 'overture', 'places', 'featured']);
    });

    it('has addedDatasetIDs and enabledDatasetIDs sets, default empty', () => {
      assert.instanceOf(_rapid.addedDatasetIDs, Set);
      assert.instanceOf(_rapid.enabledDatasetIDs, Set);
      assert.isEmpty(_rapid.addedDatasetIDs);
      assert.isEmpty(_rapid.enabledDatasetIDs);
    });

    it('has a datasets Map, defaults empty', () => {
      assert.instanceOf(_rapid.datasets, Map);
      assert.isEmpty(_rapid.datasets);
    });

    it('has acceptIDs and ignoreIDs sets, default empty', () => {
      assert.instanceOf(_rapid.acceptIDs, Set);
      assert.instanceOf(_rapid.ignoreIDs, Set);
      assert.isEmpty(_rapid.acceptIDs);
      assert.isEmpty(_rapid.ignoreIDs);
    });

    it('gets colors', () => {
      const colors = _rapid.colors;
      assert.isArray(colors);
      assert.isTrue(colors.length > 0);
      assert.strictEqual(colors[0], '#ff0000');  // red
    });

    describe('isTaskRectangular', () => {
      it('initializes with null taskExtent', () => {
        assert.isNull(_rapid.taskExtent);
        assert.isFalse(_rapid.isTaskRectangular());
      });
    });

    describe('hadPoweruser', () => {
      it('gets value of _hadPoweruser internal variable', () => {
        _rapid._hadPoweruser = true;
        assert.isTrue(_rapid.hadPoweruser());
        _rapid._hadPoweruser = false;
        assert.isFalse(_rapid.hadPoweruser());
      });
    });

    describe('isPoweruser', () => {
      it('gets current poweruser state from urlhash', () => {
        _currParams.set('poweruser', 'true');
        assert.isTrue(_rapid.isPoweruser());
        _currParams.set('poweruser', '');
        assert.isFalse(_rapid.isPoweruser());
        _currParams.delete('poweruser');
      });
    });


    describe('dataset management', () => {
      beforeEach(() => {
        spyDatasetChange.mockClear();
        _rapid.addedDatasetIDs.clear();
        _rapid.enabledDatasetIDs.clear();
      });

      afterEach(() => {
        spyDatasetChange.mockClear();
        _rapid.addedDatasetIDs.clear();
        _rapid.enabledDatasetIDs.clear();
      });

      describe('addDatasets', () => {
        it('addDatasets adds a single dataset to the addedDatasetIDs set only', () => {
          _rapid.addDatasets('msBuildings');

          assert.hasAllKeys(_rapid.datasets, ['msBuildings'], `added datasets appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings'], `added to addedDatasetIDs`);
          assert.isEmpty(_rapid.enabledDatasetIDs, `does not affect enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });

        it('addDatasets adds multiple datasets to the addedDatasetIDs set only', () => {
          _rapid.addDatasets(['msBuildings', 'overture-places']);

          assert.hasAllKeys(_rapid.datasets, ['msBuildings', 'overture-places'], `added datasets appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings', 'overture-places'], `added to addedDatasetIDs`);
          assert.isEmpty(_rapid.enabledDatasetIDs, `does not affect enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });
      });

      describe('enableDatasets', () => {
        it('enableDatasets adds a single dataset to both addedDatasetIDs and enabledDatasetIDs sets', () => {
          _rapid.enableDatasets('msBuildings');

          assert.hasAllKeys(_rapid.datasets, ['msBuildings'], `added datasets appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings'], `added to addedDatasetIDs`);
          assert.hasAllKeys(_rapid.enabledDatasetIDs, ['msBuildings'], `added to enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });

        it('enableDatasets adds multiple datasets to both addedDatasetIDs and enabledDatasetIDs sets', () => {
          _rapid.enableDatasets(['msBuildings', 'overture-places']);

          assert.hasAllKeys(_rapid.datasets, ['msBuildings', 'overture-places'], `added datasets appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings', 'overture-places'], `added to addedDatasetIDs`);
          assert.hasAllKeys(_rapid.enabledDatasetIDs, ['msBuildings', 'overture-places'], `added to enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });
      });

      describe('removeDatasets', () => {
        it('removeDatasets removes a single dataset from both addedDatasetIDs and enabledDatasetIDs sets', () => {
          _rapid.addedDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.enabledDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.removeDatasets('msBuildings');

          assert.hasAllKeys(_rapid.datasets, ['overture-places'], `removed datasets do not appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['overture-places'], `removed from addedDatasetIDs`);
          assert.hasAllKeys(_rapid.enabledDatasetIDs, ['overture-places'], `removed from enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });

        it('removeDatasets removes multiple datasets from both addedDatasetIDs and enabledDatasetIDs sets', () => {
          _rapid.addedDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.enabledDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.removeDatasets(['msBuildings', 'overture-places']);

          assert.isEmpty(_rapid.datasets, `removed datasets do not appear in 'datasets' Map`);
          assert.isEmpty(_rapid.addedDatasetIDs, `removed from addedDatasetIDs`);
          assert.isEmpty(_rapid.enabledDatasetIDs, `removed from enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });
      });

      describe('disableDatasets', () => {
        it('disableDatasets removes a single dataset from the enabledDatasetIDs set only', () => {
          _rapid.addedDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.enabledDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.disableDatasets('msBuildings');

          assert.hasAllKeys(_rapid.datasets, ['msBuildings', 'overture-places'], `disabled datasets still appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings', 'overture-places'], `does not affect addedDatasetIDs`);
          assert.hasAllKeys(_rapid.enabledDatasetIDs, ['overture-places'], `removed from enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });

        it('disableDatasets removes multiple datasets from both addedDatasetIDs and enabledDatasetIDs sets', () => {
          _rapid.addedDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.enabledDatasetIDs.add('msBuildings').add('overture-places');
          _rapid.disableDatasets(['msBuildings', 'overture-places']);

          assert.hasAllKeys(_rapid.datasets, ['msBuildings', 'overture-places'], `disabled datasets still appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings', 'overture-places'], `does not affect addedDatasetIDs`);
          assert.isEmpty(_rapid.enabledDatasetIDs, `removed from enabledDatasetIDs`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });
      });

      describe('toggleDatasets', () => {
        it('toggles enabled state for a single dataset', () => {
          // Start with MS Buildings added/enabled only
          _rapid.addedDatasetIDs.add('msBuildings');
          _rapid.enabledDatasetIDs.add('msBuildings');
          // Toggle both (in two calls)
          _rapid.toggleDatasets('msBuildings');
          _rapid.toggleDatasets('overture-places');

          assert.hasAllKeys(_rapid.datasets, ['msBuildings', 'overture-places'], `disabled datasets still appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings', 'overture-places'], `disabled datasets still appear in addedDatasetIDs`);
          assert.hasAllKeys(_rapid.enabledDatasetIDs, ['overture-places'], `both datasets enabled state has toggled`);
          assert.lengthOf(spyDatasetChange.mock.calls, 2, `'datasetchange' emitted twice`);
        });

        it('toggles enabled state for multiple datasets', () => {
          // Start with MS Buildings added/enabled only
          _rapid.addedDatasetIDs.add('msBuildings');
          _rapid.enabledDatasetIDs.add('msBuildings');
          // Toggle both (in a single call)
          _rapid.toggleDatasets(['msBuildings', 'overture-places']);

          assert.hasAllKeys(_rapid.datasets, ['msBuildings', 'overture-places'], `disabled datasets still appear in 'datasets' Map`);
          assert.hasAllKeys(_rapid.addedDatasetIDs, ['msBuildings', 'overture-places'], `disabled datasets still appear in addedDatasetIDs`);
          assert.hasAllKeys(_rapid.enabledDatasetIDs, ['overture-places'], `both datasets enabled state has toggled`);
          assert.lengthOf(spyDatasetChange.mock.calls, 1, `'datasetchange' emitted once`);
        });
      });
    });


    describe('task extent', () => {
      it('setTaskExtentByGpxData sets task extent from GPX with points', () => {
        const parser = new DOMParser();
        const gpxDom = parser.parseFromString(sample.gpxWithPoints, 'text/xml');

        _rapid.setTaskExtentByGpxData(gpxDom);

        const extent = _rapid.taskExtent;
        assert.isNotNull(extent);
        assert.approximately(extent.min[0], -118.2437, 0.0001);
        assert.approximately(extent.min[1], 34.0522, 0.0001);
        assert.approximately(extent.max[0], -74.0060, 0.0001);
        assert.approximately(extent.max[1], 40.7128, 0.0001);
      });

      it('setTaskExtentByGpxData detects rectangular bounds', () => {
        const parser = new DOMParser();
        const gpxDom = parser.parseFromString(sample.gpxRectangularBounds, 'text/xml');

        _rapid.setTaskExtentByGpxData(gpxDom);

        assert.isTrue(_rapid.isTaskRectangular());
      });

      it('setTaskExtentByGpxData detects non-rectangular bounds', () => {
        const parser = new DOMParser();
        const gpxDom = parser.parseFromString(sample.gpxNonRectangularBounds, 'text/xml');

        _rapid.setTaskExtentByGpxData(gpxDom);

        assert.isFalse(_rapid.isTaskRectangular());
      });
    });


    describe('resetAsync', () => {
      it('clears acceptIDs and ignoreIDs', () => {
        _rapid.acceptIDs.add('test-accept-1');
        _rapid.acceptIDs.add('test-accept-2');
        _rapid.ignoreIDs.add('test-ignore-1');

        assert.strictEqual(_rapid.acceptIDs.size, 2);
        assert.strictEqual(_rapid.ignoreIDs.size, 1);

        return _rapid.resetAsync().then(() => {
          assert.strictEqual(_rapid.acceptIDs.size, 0);
          assert.strictEqual(_rapid.ignoreIDs.size, 0);
        });
      });
    });


    describe('saveDatasetSettings / loadDatasetSettings', () => {
      const storage = context.systems.storage;

      function cleanStorage() {
        for (const key of storage.keys()) {
          if (key.startsWith('rapid.settings.')) {
            storage.removeItem(key);
          }
        }
      }

      beforeEach(() => cleanStorage());
      afterEach(() => cleanStorage());

      // Test that dataset settings survive a save -> load round-trip through the
      // string-only `SettingsSystem` with their types intact (e.g. `conflated` stays a boolean).
      it('round-trips a custom dataset through save/load preserving types', () => {
        const custom = new Rapid.RapidDataset(context, sample.customDataset);
        _rapid.catalog.set(custom.id, custom);

        _rapid.saveDatasetSettings(custom);

        // Simulate a fresh load: drop it from the catalog so `_loadDatasetSettings` reconstructs it.
        _rapid.catalog.delete(custom.id);
        _rapid._loadDatasetSettings();

        const restored = _rapid.catalog.get('my-custom');
        assert.instanceOf(restored, Rapid.RapidDataset);
        assert.strictEqual(restored.custom, true);
        assert.strictEqual(restored.conflated, true);
        assert.strictEqual(restored.color, '#00ff00');
        assert.strictEqual(restored.sourceUrl, 'https://example.com/data/trees.geojson');
        assert.strictEqual(restored.label, 'Custom Data');
        assert.strictEqual(restored.description, 'My Custom Dataset');
      });
    });
  });


  // Dataset assets get their own RapidSystem instances, since merging rebuilds the catalog.
  describe('dataset assets', () => {
    const storage = context.systems.storage;

    // A minimal stand-in for AssetSystem, serving the given assets by assetID.
    function makeMockAssets(served) {
      return {
        id: 'assets',
        initAsync: () => Promise.resolve(),
        registerAsset: () => {},
        getFileURL: (path) => path,
        loadAssetAsync: (assetID) => served[assetID] ? Promise.resolve(served[assetID]) : Promise.reject(new Error(`unknown asset ${assetID}`))
      };
    }

    function makeRapid() {
      const rapid = new Rapid.RapidSystem(context);
      context.systems.rapid = rapid;
      return rapid;
    }

    const sidewalks = {
      assetID: 'my_datasets',
      scopes: [{
        scope: '*',
        datasets: {
          'my-sidewalks': {
            label: 'My Sidewalks',
            categories: ['footways'],
            sourceUrl: 'https://example.com/data/trees.geojson',
            extent: [[9, -1], [11, 1]],
            dictionary: { transforms: [{ order: 0, function: 'copy', source: 'highway', target: 'highway' }] }
          }
        }
      }]
    };

    const origWarn = console.warn;
    const spyWarn = mock();

    beforeEach(() => {
      _currParams.clear();
      spyWarn.mockClear();
      console.warn = spyWarn;
      for (const key of storage.keys()) {
        if (key.startsWith('rapid.settings.')) storage.removeItem(key);
      }
    });

    afterEach(() => {
      console.warn = origWarn;
      delete context.systems.assets;
      _currParams.clear();
    });

    it('merges datasets from an asset into the catalog', () => {
      const rapid = makeRapid();
      return rapid.initAsync()
        .then(() => rapid.startAsync())
        .then(() => {
          rapid.merge(sidewalks);
          const ds = rapid.catalog.get('my-sidewalks');
          assert.instanceOf(ds, Rapid.RapidDataset);
          assert.strictEqual(ds.label, 'My Sidewalks');
          assert.strictEqual(ds.assetID, 'my_datasets');
          assert.isFalse(ds.custom);       // the user didn't add it, so they can't edit or delete it
          assert.deepEqual([...ds.extent.min, ...ds.extent.max], [9, -1, 11, 1]);
          assert.strictEqual(ds.dictionary.transforms[0].order, 0);
          assert.isTrue(rapid.categories.has('footways'));
          assert.strictEqual(rapid.loadedAssetIDs.get('my_datasets'), 'unknown');
        });
    });

    it('keeps a dataset with a serviceID as a service dataset', () => {
      const rapid = makeRapid();
      return rapid.initAsync()
        .then(() => {
          rapid.merge({ assetID: 'svc', scopes: [{ scope: '*', datasets: { 'my-roads': { serviceID: 'mapwithai', label: 'Roads' } } }] });
          assert.isFalse(rapid.catalog.get('my-roads').custom);
        });
    });

    it('replaces and deletes service datasets, with wildcards', () => {
      const rapid = makeRapid();
      return rapid.initAsync()
        .then(() => {
          rapid._serviceDatasets = [
            new Rapid.RapidDataset(context, sample.msBuildings),
            new Rapid.RapidDataset(context, sample.overturePlaces)
          ];
          rapid.merge({ assetID: 'edits', scopes: [{ scope: '*', datasets: {
            'msBuildings': { label: 'Renamed', serviceID: 'mapwithai' },
            'overture-*': null
          } }] });
          assert.hasAllKeys(rapid.catalog, ['msBuildings']);
          assert.strictEqual(rapid.catalog.get('msBuildings').label, 'Renamed');
        });
    });

    it('throws when the assetID is missing or already merged', () => {
      const rapid = makeRapid();
      assert.throws(() => rapid.merge({ scopes: [] }), /missing assetID/);
      rapid.merge(sidewalks);
      assert.throws(() => rapid.merge(sidewalks), /already merged/);
    });

    it('keeps the same instance for a dataset when another asset is merged', () => {
      const rapid = makeRapid();
      rapid.merge(sidewalks);
      const before = rapid.catalog.get('my-sidewalks');
      rapid.merge({ assetID: 'other', scopes: [{ scope: '*', datasets: { 'other-ds': { label: 'Other' } } }] });
      assert.strictEqual(rapid.catalog.get('my-sidewalks'), before);
    });

    it('keeps the custom datasets that the user added when the catalog is rebuilt', () => {
      const rapid = makeRapid();
      const mine = new Rapid.RapidDataset(context, sample.customDataset);
      rapid.catalog.set(mine.id, mine);
      rapid.merge(sidewalks);
      assert.strictEqual(rapid.catalog.get('my-custom'), mine);
    });

    it('loads the default and requested assets, and skips unknown assetIDs with a warning', () => {
      context.systems.assets = makeMockAssets({
        rapid_datasets: { assetID: 'rapid_datasets', scopes: [{ scope: '*', datasets: {} }] },
        my_datasets: sidewalks
      });
      _currParams.set('datasets', 'default,my_datasets,fbRoads');   // e.g. an old link

      const rapid = makeRapid();
      return rapid.initAsync()
        .then(() => {
          assert.hasAllKeys(rapid.loadedAssetIDs, ['rapid_datasets', 'my_datasets']);
          assert.isTrue(rapid.catalog.has('my-sidewalks'));
          assert.strictEqual(spyWarn.mock.calls.length, 1);
          assert.match(spyWarn.mock.calls[0][0], /fbRoads/);
        });
    });

    it('enables the datasets listed in `dataset_ids`, including ones from assets', () => {
      context.systems.assets = makeMockAssets({ my_datasets: sidewalks });
      _currParams.set('datasets', 'my_datasets');
      _currParams.set('dataset_ids', 'my-sidewalks');

      const rapid = makeRapid();
      return rapid.initAsync()
        .then(() => {
          // Don't actually fetch the data
          rapid.catalog.get('my-sidewalks').setupCustomDatasetAsync = mock(() => Promise.resolve());
          return rapid.startAsync();
        })
        .then(() => {
          assert.hasAllKeys(rapid.enabledDatasetIDs, ['my-sidewalks']);
          assert.strictEqual(_currParams.get('dataset_ids'), 'my-sidewalks');
        });
    });

    it('starts loading the data for an asset dataset only once it is added', () => {
      const rapid = makeRapid();
      return rapid.initAsync()
        .then(() => rapid.startAsync())
        .then(() => {
          rapid.merge(sidewalks);
          const ds = rapid.catalog.get('my-sidewalks');
          ds.setupCustomDatasetAsync = mock(() => Promise.resolve());

          rapid.toggleDatasets('overture-places');   // some other change
          assert.strictEqual(ds.setupCustomDatasetAsync.mock.calls.length, 0);

          rapid.addDatasets('my-sidewalks');
          rapid.enableDatasets('my-sidewalks');
          assert.strictEqual(ds.setupCustomDatasetAsync.mock.calls.length, 1);
        });
    });

    it('keeps the stored settings of a user dataset whose datasetID an asset also uses', () => {
      const settings = context.systems.settings;
      settings.set('rapid.custom.my-sidewalks', { id: 'my-sidewalks', label: 'Mine', sourceUrl: 'https://example.com/data/trees.geojson' });

      const rapid = makeRapid();
      rapid.merge(sidewalks);       // the asset's `my-sidewalks` wins while it's loaded..
      rapid._loadDatasetSettings();
      assert.strictEqual(rapid.catalog.get('my-sidewalks').assetID, 'my_datasets');
      assert.isDefined(settings.get('rapid.custom.my-sidewalks'));   // ..but the user's definition is kept
      settings.unset('rapid.custom.my-sidewalks');
    });

    it('saves only the color and conflated settings for an asset dataset', () => {
      const rapid = makeRapid();
      rapid.merge(sidewalks);
      const ds = rapid.catalog.get('my-sidewalks');
      ds.color = '#123456';
      rapid.saveDatasetSettings(ds);

      const settings = context.systems.settings;
      assert.deepEqual(settings.get('rapid.dataset.my-sidewalks'), { color: '#123456', conflated: 'false' });
      assert.isUndefined(settings.get('rapid.custom.my-sidewalks'));
    });
  });

});
