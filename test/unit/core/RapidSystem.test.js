import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock, spyOn } from 'bun:test';
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
    urlhash:  new MockUrlHashSystem(context)
  };


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
  });

});
