import { afterAll, beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('AssetSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
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
        assert.strictEqual(assets.origin, 'latest');
        assert.strictEqual(assets.filePath, '');
        assert.deepEqual(assets.fileReplacements, {});

        assert.isObject(assets._loaded);
        assert.isObject(assets._inflight);
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
          .catch(err => assert.match(err, /no data loaded/i))
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
    });

  });
});
