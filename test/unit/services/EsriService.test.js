import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './EsriService.sample.js';


describe('EsriService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    gfx:     new Rapid.MockGfxSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  // Spy on redraws..
  const gfx = context.systems.gfx;
  const spyRedraw = mock.fn();
  gfx.immediateRedraw = spyRedraw;
  gfx.deferredRedraw = spyRedraw;

  // Setup fetchMock..
  before(() => {
    fetchMock
      .mockGlobal()
      .sticky(/search\?.*&start=1$/, sample.datasetsPage1)
      .sticky(/search\?.*&start=101$/, sample.datasetsPage2);
  });

  after(() => {
    fetchMock.hardReset({ includeSticky: true });
    mock.reset();
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
    spyRedraw.mock.resetCalls();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an EsriService from a context', () => {
        const esri = new Rapid.EsriService(context);
        assert.instanceOf(esri, Rapid.EsriService);
        assert.strictEqual(esri.id, 'esri');
        assert.strictEqual(esri.context, context);
        assert.instanceOf(esri.requiredDependencies, Set);
        assert.instanceOf(esri.optionalDependencies, Set);
        assert.isTrue(esri.autoStart);

        const datasets = esri._datasets;
        assert.instanceOf(datasets, Map);
        assert.isEmpty(datasets);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const esri = new Rapid.EsriService(context);
        const prom = esri.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => {
            const datasets = esri._datasets;
            assert.instanceOf(datasets, Map);
            assert.lengthOf(datasets, 198);    // expect 198 datasets loaded in 2 pages
            const calls = fetchMock.callHistory.calls();
            assert.lengthOf(calls, 2);
          });
      });

      it('rejects if a dependency is missing', () => {
        const esri = new Rapid.EsriService(context);
        esri.requiredDependencies.add('missing');
        const prom = esri.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const esri = new Rapid.EsriService(context);
        const prom = esri.initAsync().then(() => esri.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(esri.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const esri = new Rapid.EsriService(context);
        const prom = esri.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _esri;

    before(() => {
      _esri = new Rapid.EsriService(context);
      return _esri.initAsync().then(() => _esri.startAsync());
    });

    beforeEach(() => {
      return _esri.resetAsync();
    });

    describe('getAvailableDatasets', () => {
      it('returns datasets provided by this service', () => {
        const results = _esri.getAvailableDatasets();
        assert.isArray(results);
        assert.lengthOf(results, 198);    // expect 198 datasets loaded in 2 pages

        const ds0 = results[0];
        assert.instanceOf(ds0, Rapid.RapidDataset);
        assert.strictEqual(ds0.id, '660457fac76344b195c555e0dff386ff');
        assert.strictEqual(ds0.label, 'Africa Buildings');
      });
    });

    describe('getDataUsed', () => {
      it('rewrites the data used string for the Google Buildings datasets', () => {
        const result = _esri.getDataUsed('Google Buildings for Argentina');
        assert.strictEqual(result, 'Google Open Buildings');
      });
      it('doesn\'t rewrite the data used string other datasets', () => {
        const result = _esri.getDataUsed('United States Addresses');
        assert.strictEqual(result, 'United States Addresses');
      });
    });

  });

});

