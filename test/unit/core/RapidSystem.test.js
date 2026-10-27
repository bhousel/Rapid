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


    describe('actedRanges', () => {
      // Replays an edit history the way `EditSystem` reports it after an edit.
      function replay(editProps) {
        context.systems.editor = { history: [{ props: {} }, ...editProps.map(props => ({ props }))], index: editProps.length };
        _rapid._stablechange();
        delete context.systems.editor;
      }

      afterEach(() => _rapid.resetAsync());

      it('is empty for a line the user has not acted on', () => {
        replay([]);
        assert.deepEqual(_rapid.actedRanges('test:k1:0'), []);
      });

      it('gathers accepted and ignored pieces of a line from the edit history, sorted and merged', () => {
        replay([
          { type: 'rapid_accept_feature', acceptIDs: ['test:k1:0@0.6-1'] },
          { type: 'rapid_ignore_feature', ignoreID: 'test:k1:0@0-0.25' },
          { type: 'rapid_accept_feature', acceptIDs: ['test:k1:0@0.2-0.4', 'test:k2:0@0-0.5'] }
        ]);
        assert.deepEqual(_rapid.actedRanges('test:k1:0'), [[0, 0.4], [0.6, 1]]);
        assert.deepEqual(_rapid.actedRanges('test:k2:0'), [[0, 0.5]]);
      });

      it('a whole feature that was accepted or ignored covers all of it', () => {
        replay([{ type: 'rapid_ignore_feature', ignoreID: 'test:k1:0' }]);
        assert.deepEqual(_rapid.actedRanges('test:k1:0'), [[0, 1]]);
      });

      it('resetAsync clears them', () => {
        replay([{ type: 'rapid_ignore_feature', ignoreID: 'test:k1:0' }]);
        return _rapid.resetAsync()
          .then(() => assert.deepEqual(_rapid.actedRanges('test:k1:0'), []));
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

      // Test that a custom dataset survives a save -> load round-trip with its types intact
      // (e.g. `conflated` stays a boolean). There's no DatabaseSystem here, so it's kept for the session.
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

    it('keeps the saved definition of a user dataset whose datasetID an asset also uses', async () => {
      const rapid = makeRapid();
      const mine = new Rapid.RapidDataset(context, { id: 'my-sidewalks', custom: true, label: 'Mine' });
      rapid.catalog.set(mine.id, mine);
      await rapid.saveDatasetSettings(mine);   // no DatabaseSystem here, so it's kept for the session

      rapid.merge(sidewalks);       // the asset's `my-sidewalks` wins while it's loaded..
      rapid._loadDatasetSettings();
      assert.strictEqual(rapid.catalog.get('my-sidewalks').assetID, 'my_datasets');
      assert.isDefined(rapid._datasetRecords.get('my-sidewalks').dataset);   // ..but the user's definition is kept

      // Changing the asset's dataset keeps the user's own definition too
      const asset = rapid.catalog.get('my-sidewalks');
      asset.color = '#123456';
      await rapid.saveDatasetSettings(asset);
      const record = rapid._datasetRecords.get('my-sidewalks');
      assert.isDefined(record.dataset);
      assert.strictEqual(record.changes.color, '#123456');
    });

    it('saves the changes to an asset dataset, not its definition', async () => {
      const rapid = makeRapid();
      rapid.merge(sidewalks);
      const ds = rapid.catalog.get('my-sidewalks');
      ds.color = '#123456';
      ds.conflated = true;
      await rapid.saveDatasetSettings(ds);

      const record = rapid._datasetRecords.get('my-sidewalks');
      assert.isUndefined(record.dataset);
      assert.deepInclude(record.changes, { color: '#123456', conflated: true });
      assert.deepEqual(record.changes.conflation, ds.conflation);
    });
  });


  // The custom datasets that the user added are kept in the DatabaseSystem `datasets` store.
  describe('custom datasets', () => {
    const settings = context.systems.settings;
    let database;

    // A RapidSystem whose custom datasets don't fetch their data.
    function makeRapid() {
      const rapid = new Rapid.RapidSystem(context);
      context.systems.rapid = rapid;
      return rapid;
    }

    beforeEach(async () => {
      database = new Rapid.DatabaseSystem(context);
      context.systems.database = database;
      await database.initAsync();
      await database.clear('datasets');
      settings.unset('rapid');
    });

    afterEach(() => {
      delete context.systems.database;
      settings.unset('rapid');
    });

    it('saves a custom dataset, with its conflation settings, in the datasets store', async () => {
      const rapid = makeRapid();
      await rapid.initAsync();

      const ds = new Rapid.RapidDataset(context, sample.customDataset);
      ds.conflation.showMatched = true;
      ds.conflation.rules[0].sameDist = 4;
      rapid.catalog.set(ds.id, ds);
      await rapid.saveDatasetSettings(ds);

      const record = await database.get('datasets', 'my-custom');
      assert.strictEqual(record.id, 'my-custom');
      assert.isNumber(record.updatedAt);
      assert.strictEqual(record.dataset.conflated, true);   // a real boolean
      assert.isTrue(record.dataset.conflation.showMatched);
      assert.strictEqual(record.dataset.conflation.rules[0].sameDist, 4);
      assert.isUndefined(record.changes);
    });

    it('creates the saved custom datasets at startup', async () => {
      const saved = new Rapid.RapidDataset(context, sample.customDataset);
      saved.conflation.showMatched = true;
      await database.put('datasets', { id: 'my-custom', updatedAt: 1, dataset: saved.toJSON() });

      const rapid = makeRapid();
      await rapid.initAsync();
      await rapid.startAsync();

      const ds = rapid.catalog.get('my-custom');
      assert.instanceOf(ds, Rapid.RapidDataset);
      assert.isTrue(ds.custom);
      assert.isTrue(ds.conflated);
      assert.strictEqual(ds.color, '#00ff00');
      assert.isTrue(ds.conflation.showMatched);
    });

    it('saves the changes to a dataset from a service, and applies them at startup', async () => {
      const rapid = makeRapid();
      await rapid.initAsync();
      const svc = new Rapid.RapidDataset(context, sample.msBuildings);
      rapid.catalog.set(svc.id, svc);

      svc.color = '#123456';
      svc.conflated = true;
      svc.conflation.rules[0].sameDist = 7;
      await rapid.saveDatasetSettings(svc);

      const record = await database.get('datasets', 'msBuildings');
      assert.isUndefined(record.dataset);
      assert.deepInclude(record.changes, { color: '#123456', conflated: true });
      assert.strictEqual(record.changes.conflation.rules[0].sameDist, 7);

      // A new session, where the service provides a fresh `msBuildings`
      const next = makeRapid();
      await next.initAsync();
      next._serviceDatasets = [new Rapid.RapidDataset(context, sample.msBuildings)];
      next._rebuildCatalog();
      next._loadDatasetSettings();

      const ds = next.catalog.get('msBuildings');
      assert.strictEqual(ds.color, '#123456');
      assert.isTrue(ds.conflated);
      assert.strictEqual(ds.conflation.rules[0].sameDist, 7);
      assert.isFalse(ds.custom);
    });

    it('keeps the changes to a dataset that is not in the catalog now', async () => {
      await database.put('datasets', { id: 'not-loaded', updatedAt: 1, changes: { color: '#123456' } });

      const rapid = makeRapid();
      await rapid.initAsync();
      await rapid.startAsync();

      assert.isFalse(rapid.catalog.has('not-loaded'));
      assert.isDefined(await database.get('datasets', 'not-loaded'));
    });

    it('deletes a custom dataset: its record, and its place in the catalog and the menu', async () => {
      const rapid = makeRapid();
      await rapid.initAsync();

      const ds = new Rapid.RapidDataset(context, sample.customDataset);
      rapid.catalog.set(ds.id, ds);
      rapid.enableDatasets(ds.id);
      await rapid.saveDatasetSettings(ds);
      await rapid.deleteCustomDatasetAsync(ds.id);

      assert.isFalse(rapid.catalog.has('my-custom'));
      assert.isFalse(rapid.addedDatasetIDs.has('my-custom'));
      assert.isUndefined(await database.get('datasets', 'my-custom'));
    });

    it('does not delete a dataset that the user did not add', async () => {
      const rapid = makeRapid();
      const ds = new Rapid.RapidDataset(context, sample.msBuildings);
      rapid.catalog.set(ds.id, ds);
      await rapid.deleteCustomDatasetAsync(ds.id);
      assert.isTrue(rapid.catalog.has('msBuildings'));
    });
  });

});
