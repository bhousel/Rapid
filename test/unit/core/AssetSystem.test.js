import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('AssetSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    network: new Rapid.NetworkSystem(context),
    urlhash: new Rapid.UrlHashSystem(context)
  };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an AssetSystem from a context', () => {
        const assets = new Rapid.AssetSystem(context);
        assert.instanceOf(assets, Rapid.AssetSystem);
        assert.strictEqual(assets.id, 'assets');
        assert.strictEqual(assets.context, context);
        assert.instanceOf(assets.requiredDependencies, Set);
        assert.instanceOf(assets.optionalDependencies, Set);
        assert.isTrue(assets.autoStart);

        assert.isObject(assets.sources);
        assert.isObject(assets.bundles);
        assert.strictEqual(assets.origin, 'latest');
        assert.strictEqual(assets.filePath, '');
        assert.deepEqual(assets.fileReplacements, {});

        assert.isObject(assets._loaded);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const assets = new Rapid.AssetSystem(context);
        const prom = assets.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const assets = new Rapid.AssetSystem(context);
        assets.requiredDependencies.add('missing');
        const prom = assets.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });

      it('registers assets specified in the URL hash, if any', () => {
        const assets = new Rapid.AssetSystem(context);
        const urlhash = context.systems.urlhash;
        const params = 'my_presets|https://example.com/presets.json,my_imagery|https://example.com/imagery.json';
        urlhash._initParams.set('assets', params);

        const prom = assets.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.strictEqual(assets.sources['my_presets']?.preferred, 'https://example.com/presets.json');
            assert.strictEqual(assets.sources['my_imagery']?.preferred, 'https://example.com/imagery.json');
          })
          .finally(() => urlhash._initParams.clear());  // cleanup
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const assets = new Rapid.AssetSystem(context);
        const prom = assets.initAsync().then(() => assets.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(assets.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const assets = new Rapid.AssetSystem(context);
        const prom = assets.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });

  describe('origin', () => {
    it('sets and gets origin', () => {
      const assets = new Rapid.AssetSystem(context);
      assert.strictEqual(assets.origin, 'latest');
      assets.origin = 'local';
      assert.strictEqual(assets.origin, 'local');
    });
  });

  describe('filePath', () => {
    it('sets and gets filePath', () => {
      const assets = new Rapid.AssetSystem(context);
      assert.strictEqual(assets.filePath, '');
      assets.filePath = 'test/';
      assert.strictEqual(assets.filePath, 'test/');
    });
  });

  describe('fileReplacements', () => {
    it('sets and gets fileReplacements', () => {
      const TESTMAP = { 'test/img/loader.gif': '/assets/test/img/loader-b66184b5c4afbccc25f.gif' };
      const assets = new Rapid.AssetSystem(context);
      assert.deepEqual(assets.fileReplacements, {});
      assets.fileReplacements = TESTMAP;
      assert.deepEqual(assets.fileReplacements, TESTMAP);
    });
  });

  describe('sources', () => {
    it('gets the sources', () => {
      const assets = new Rapid.AssetSystem(context);
      const sources = assets.sources;
      assert.isObject(sources);   // Expect some keys to be present
      assert.containsAllKeys(sources, ['address_formats', 'intro_graph', 'phone_formats']);
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _assets;

    beforeAll(() => {
      _assets = new Rapid.AssetSystem(context);
      return _assets.initAsync().then(() => _assets.startAsync());
    });

    describe('registerAsset', () => {
      it('registers assets, origin specified', () => {
        const sample = { latest: 'foo.json', local: 'bar.json' };
        _assets.registerAsset('test_asset1', sample);
        assert.deepEqual(_assets.sources['test_asset1'], sample);
      });

      it('throws if the assetID is a reserved word', () => {
        const sample = { latest: 'foo.json', local: 'bar.json' };
        assert.throws(() => _assets.registerAsset('default', sample), /reserved word/i);
      });
    });


    describe('getFileURL', () => {
      const TESTMAP = { 'test/img/loader.gif': '/assets/test/img/loader-b66184b5c4afbccc25f.gif' };

      beforeAll(() => {
        _assets.filePath = 'test/';
        _assets.fileReplacements = TESTMAP;
      });

      afterAll(() => {
        _assets.filePath = '';
        _assets.fileReplacements = {};
      });

      it('passes URLs through unchanged', () => {
        assert.strictEqual(_assets.getFileURL('HTTP://hello'), 'HTTP://hello');
        assert.strictEqual(_assets.getFileURL('https://world'), 'https://world');
      });

      it('looks first in fileReplacements', () => {
        assert.strictEqual(_assets.getFileURL('img/loader.gif'), '/assets/test/img/loader-b66184b5c4afbccc25f.gif');
      });

      it('falls back to prepending filePath', () => {
        assert.strictEqual(_assets.getFileURL('img/spinner.gif'), 'test/img/spinner.gif');
      });
    });


    describe('getAssetURL', () => {
      beforeAll(() => {
        // add some test data
        _assets.registerAsset('foo', {
          latest: 'foo_latest.json',
          local:  'foo_local.json'
        });
        _assets.registerAsset('bar', {
          preferred: 'bar_preferred.json',
          latest:    'bar_latest.json',
          local:     'bar_local.json'
        });
      });

      it('passes URLs through unchanged', () => {
        assert.strictEqual(_assets.getAssetURL('HTTP://hello'), 'HTTP://hello');
        assert.strictEqual(_assets.getAssetURL('https://world'), 'https://world');
      });

      it('throws if assetID is invalid', () => {
        assert.throws(() => _assets.getAssetURL('nope'), /unknown assetID/i);
      });

      it('throws if assetID is valid but no matching asset path exists', () => {
        _assets.origin = 'nope';   // no 'nope' or 'preferred'
        assert.throws(() => _assets.getAssetURL('foo'), /no asset found/i);
      });

      it('returns the URL if the assetID and origin is valid', () => {
        _assets.origin = 'latest';
        assert.strictEqual(_assets.getAssetURL('foo'), 'foo_latest.json');
      });

      it(`'preferred' origin overrides both 'latest' and 'local'`, () => {
        _assets.origin = 'latest';
        assert.strictEqual(_assets.getAssetURL('bar'), 'bar_preferred.json');
        _assets.origin = 'local';
        assert.strictEqual(_assets.getAssetURL('bar'), 'bar_preferred.json');
      });
    });


    describe('loadAssetAsync', () => {
      const origError = console.error;
      const spyError = mock();

      beforeAll(() => {
        console.error = spyError;
      });

      beforeEach(() => {
        spyError.mockClear();  // reset call count
      });

      afterAll(() => {
        console.error = origError;
      });

      it('returns a promise resolved if we already have the data', () => {
        _assets._loaded.test = { hello: 'world' };

        const prom = _assets.loadAssetAsync('test');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.deepEqual(data, { hello: 'world' }));
      });

      it('returns a promise rejected if the assetID is invalid', () => {
        const prom = _assets.loadAssetAsync('nope');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.fail(`We were not supposed to get data but did: ${data}`))
          .catch(err => assert.match(err, /unknown assetID/i));
      });

      it('returns a promise rejected if we can not get the data', () => {
        fetchMock
          .mockGlobal()
          .route(/\/data\/intro_graph\.min\.json/i, {
            body: JSON.stringify(''),  // empty response
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

        const prom = _assets.loadAssetAsync('intro_graph');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.fail(`We were not supposed to get data but did: ${data}`))
          .catch(err => {
            assert.match(err, /no data/i);
            assert.lengthOf(spyError.mock.calls, 1);   // console.error called once
            assert.match(spyError.mock.lastCall[0], /no data/i);
          })
          .finally(() => fetchMock.hardReset());
      });

      it('returns a promise to fetch data if we do not already have the data', () => {
        fetchMock
          .mockGlobal()
          .route(/\/data\/intro_graph\.min\.json/i, {
            body: JSON.stringify({ value: 'success' }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

        const prom = _assets.loadAssetAsync('intro_graph');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.deepEqual(data, { value: 'success' }))
          .finally(() => fetchMock.hardReset());
      });

      it('delegates to loadBundleAssetAsync if assetID is a registered bundle', () => {
        // Register a bundle and pre-load its data
        const parts = {
          part1: { preferred: 'part1.json' },
          part2: { preferred: 'part2.json' },
        };
        const cached = {
          assetID: 'test_bundle',
          part1: 'data1',
          part2: 'data2'
        };

        _assets.registerBundleAsset('test_bundle', parts);
        _assets._loaded.test_bundle = cached;

        const prom = _assets.loadAssetAsync('test_bundle');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => {
            assert.deepEqual(data, cached);
          });
      });
    });


    describe('registerBundleAsset', () => {
      it('registers a bundle asset with multiple parts', () => {
        const parts = {
          part1: { preferred: 'part1.json' },
          part2: { preferred: 'part2.json' },
        };
        _assets.registerBundleAsset('test_bundle', parts);
        assert.deepEqual(_assets.bundles['test_bundle'], { parts });
      });

      it('throws if the assetID is a reserved word', () => {
        const parts = {
          part1: { preferred: 'part1.json' },
          part2: { preferred: 'part2.json' },
        };
        assert.throws(() => _assets.registerBundleAsset('default', parts), /reserved word/i);
      });
    });


    describe('loadBundleAssetAsync', () => {
      const origError = console.error;
      const spyError = mock();

      beforeAll(() => {
        console.error = spyError;

        // Register a test bundle
        _assets.registerBundleAsset('my_bundle', {
          categories: { preferred: 'data/categories.json' },
          presets:    { preferred: 'data/presets.json' },
          fields:     { preferred: 'data/fields.json' }
        });
      });

      beforeEach(() => {
        spyError.mockClear();  // reset call count
      });

      afterAll(() => {
        console.error = origError;
      });

      it('returns a promise resolved if we already have the data', () => {
        _assets._loaded.my_bundle = {
          assetID: 'my_bundle',
          categories: { category1: {} },
          presets: { preset1: {} },
          fields: { field1: {} }
        };

        const prom = _assets.loadBundleAssetAsync('my_bundle');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => {
            assert.strictEqual(data.assetID, 'my_bundle');
            assert.deepEqual(data.categories, { category1: {} });
            assert.deepEqual(data.presets, { preset1: {} });
            assert.deepEqual(data.fields, { field1: {} });
          })
          .finally(() => delete _assets._loaded.my_bundle);
      });

      it('returns a promise rejected if the bundle assetID is unknown', () => {
        const prom = _assets.loadBundleAssetAsync('unknown_bundle');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.fail(`We were not supposed to get data but did: ${data}`))
          .catch(err => assert.match(err, /unknown bundle assetID/i));
      });

      it('returns a promise to fetch all bundle parts and combine them', () => {
        delete _assets._loaded.my_bundle;  // ensure not cached

        fetchMock
          .mockGlobal()
          .route(/\/data\/categories\.json/i, {
            body: JSON.stringify({ category_road: {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
          .route(/\/data\/presets\.json/i, {
            body: JSON.stringify({ 'highway/residential': {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
          .route(/\/data\/fields\.json/i, {
            body: JSON.stringify({ name: { type: 'text' } }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

        const prom = _assets.loadBundleAssetAsync('my_bundle');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => {
            assert.strictEqual(data.assetID, 'my_bundle');
            assert.deepEqual(data.categories, { category_road: {} });
            assert.deepEqual(data.presets, { 'highway/residential': {} });
            assert.deepEqual(data.fields, { name: { type: 'text' } });
          })
          .finally(() => fetchMock.hardReset());
      });

      it('caches the combined result after loading', () => {
        delete _assets._loaded.my_bundle;

        fetchMock
          .mockGlobal()
          .route(/\/data\/categories\.json/i, {
            body: JSON.stringify({ cached_category: {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
          .route(/\/data\/presets\.json/i, {
            body: JSON.stringify({ cached_preset: {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
          .route(/\/data\/fields\.json/i, {
            body: JSON.stringify({ cached_field: {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

        return _assets.loadBundleAssetAsync('my_bundle')
          .then(() => {
            // Now check that it's cached
            const cached = _assets._loaded.my_bundle;
            assert.isObject(cached);
            assert.strictEqual(cached.assetID, 'my_bundle');
            assert.deepEqual(cached.categories, { cached_category: {} });
          })
          .finally(() => fetchMock.hardReset());
      });

      it('handles partial failures gracefully (some parts fail to load)', () => {
        delete _assets._loaded.my_bundle;

        fetchMock
          .mockGlobal()
          .route(/\/data\/categories\.json/i, {
            body: JSON.stringify({ good_category: {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
          .route(/\/data\/presets\.json/i, {
            status: 404  // simulate failure
          })
          .route(/\/data\/fields\.json/i, {
            body: JSON.stringify({ good_field: {} }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

        const prom = _assets.loadBundleAssetAsync('my_bundle');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => {
            // Should still return successful parts
            assert.strictEqual(data.assetID, 'my_bundle');
            assert.deepEqual(data.categories, { good_category: {} });
            assert.deepEqual(data.fields, { good_field: {} });
            // Failed part should be undefined
            assert.isUndefined(data.presets);
            assert.lengthOf(spyError.mock.calls, 1);   // console.error called once
            assert.match(spyError.mock.lastCall[0], /not found/i);
          })
          .finally(() => {
            fetchMock.hardReset();
          });
      });

      it('uses origin fallback when preferred is not specified', () => {
        // Register a bundle without 'preferred', only 'latest' and 'local'
        _assets.registerBundleAsset('origin_bundle', {
          data: { latest: 'data/origin_latest.json', local: 'data/origin_local.json' }
        });
        _assets.origin = 'latest';

        fetchMock
          .mockGlobal()
          .route(/\/data\/origin_latest\.json/i, {
            body: JSON.stringify({ source: 'latest' }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

        return _assets.loadBundleAssetAsync('origin_bundle')
          .then(data => {
            assert.strictEqual(data.assetID, 'origin_bundle');
            assert.deepEqual(data.data, { source: 'latest' });
          })
          .finally(() => fetchMock.hardReset());
      });
    });

  });
});
