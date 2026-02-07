import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import { DOMParser } from '@xmldom/xmldom';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './RapidSystem.sample.js';


describe('RapidSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

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
    let _rapid;

    beforeAll(() => {
      _rapid = new Rapid.RapidSystem(context);
      return _rapid.initAsync().then(() => _rapid.startAsync());
    });


    it('has a catalog of datasets', () => {
      assert.instanceOf(_rapid.catalog, Map);
      // Catalog may be empty in test environment if services aren't available
    });

    it('has a set of categories', () => {
      assert.instanceOf(_rapid.categories, Set);
      // Categories may be empty in test environment if services aren't available
    });

    it('has acceptIDs and ignoreIDs sets', () => {
      assert.instanceOf(_rapid.acceptIDs, Set);
      assert.instanceOf(_rapid.ignoreIDs, Set);
    });

    it('gets colors', () => {
      const colors = _rapid.colors;
      assert.isArray(colors);
      assert.isTrue(colors.length > 0);
      assert.strictEqual(colors[0], '#ff0000');  // red
    });

    it('gets datasets', () => {
      const datasets = _rapid.datasets;
      assert.instanceOf(datasets, Map);
      // Should return currently added datasets
    });

    it('initializes with null taskExtent', () => {
      assert.isNull(_rapid.taskExtent);
      assert.isFalse(_rapid.isTaskRectangular());
    });

    it('initializes with hadPoweruser false', () => {
      assert.isFalse(_rapid.hadPoweruser);
    });


    describe('dataset management', () => {
      it('addDatasets adds datasets to menu', () => {
        if (_rapid.catalog.size === 0) {
          // Skip if no datasets available in test environment
          return;
        }

        const testDatasetID = [..._rapid.catalog.keys()][0];
        _rapid.addDatasets(testDatasetID);

        const datasets = _rapid.datasets;
        assert.isTrue(datasets.has(testDatasetID));
      });

      it('addDatasets accepts array of dataset IDs', () => {
        if (_rapid.catalog.size < 2) {
          // Skip if not enough datasets available
          return;
        }

        const datasetIDs = [..._rapid.catalog.keys()].slice(0, 2);
        _rapid.addDatasets(datasetIDs);

        const datasets = _rapid.datasets;
        for (const id of datasetIDs) {
          assert.isTrue(datasets.has(id));
        }
      });

      it('removeDatasets removes datasets from menu', () => {
        if (_rapid.catalog.size === 0) {
          // Skip if no datasets available
          return;
        }

        const testDatasetID = [..._rapid.catalog.keys()][0];

        _rapid.addDatasets(testDatasetID);
        assert.isTrue(_rapid.datasets.has(testDatasetID));

        _rapid.removeDatasets(testDatasetID);
        assert.isFalse(_rapid.datasets.has(testDatasetID));
      });

      it('enableDatasets adds and enables datasets', () => {
        if (_rapid.catalog.size === 0) {
          // Skip if no datasets available
          return;
        }

        const testDatasetID = [..._rapid.catalog.keys()][0];

        _rapid.enableDatasets(testDatasetID);

        const dataset = _rapid.datasets.get(testDatasetID);
        assert.isDefined(dataset);
      });

      it('disableDatasets unchecks dataset', () => {
        if (_rapid.catalog.size === 0) {
          // Skip if no datasets available
          return;
        }

        const testDatasetID = [..._rapid.catalog.keys()][0];

        _rapid.enableDatasets(testDatasetID);
        const dataset1 = _rapid.datasets.get(testDatasetID);
        assert.isDefined(dataset1);

        _rapid.disableDatasets(testDatasetID);
        // Dataset is still in datasets map because it's added, but enabled flag should be false
        const dataset2 = _rapid.catalog.get(testDatasetID);
        if (dataset2) {
          assert.isFalse(dataset2.enabled);
        }
      });

      it('toggleDatasets toggles enabled state', () => {
        if (_rapid.catalog.size === 0) {
          // Skip if no datasets available
          return;
        }

        const testDatasetID = [..._rapid.catalog.keys()][0];

        _rapid.disableDatasets(testDatasetID);
        const dataset = _rapid.catalog.get(testDatasetID);
        if (!dataset) return;

        const initialState = dataset.enabled;

        _rapid.toggleDatasets(testDatasetID);
        assert.notStrictEqual(dataset.enabled, initialState);

        _rapid.toggleDatasets(testDatasetID);
        assert.strictEqual(dataset.enabled, initialState);
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
  });

});
