import { after, before, describe, it } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('AssetSystem', () => {
  const context = new Rapid.MockContext();


  describe('constructor', () => {
    it('constructs an AssetSystem from a context', () => {
      const assets = new Rapid.AssetSystem(context);
      assert.instanceOf(assets, Rapid.AssetSystem);
      assert.strictEqual(assets.id, 'assets');
      assert.strictEqual(assets.context, context);
      assert.isEmpty(assets.dependencies);
      assert.isTrue(assets.autoStart);

      assert.isObject(assets.sources);
      assert.hasAllKeys(assets.sources, ['latest', 'local']);
      assert.strictEqual(assets.origin, 'latest');
      assert.strictEqual(assets.filePath, '');
      assert.deepEqual(assets.fileReplacements, {});

      assert.isObject(assets._cache);
      assert.isObject(assets._inflight);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const assets = new Rapid.AssetSystem(context);
      const prom = assets.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const assets = new Rapid.AssetSystem(context);
      assets.dependencies.add('missing');
      const prom = assets.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const assets = new Rapid.AssetSystem(context);
      const prom = assets.initAsync().then(() => assets.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(assets.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const assets = new Rapid.AssetSystem(context);
      const prom = assets.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
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
      assert.isObject(sources);
      assert.hasAllKeys(sources, ['latest', 'local']);
    });
  });


  describe('methods', () => {
    let _assets;

    // init and start
    before(() => {
      _assets = new Rapid.AssetSystem(context);
      return Promise.resolve()
        .then(() => _assets.initAsync())
        .then(() => _assets.startAsync());
    });

    describe('getFileURL', () => {
      const TESTMAP = { 'test/img/loader.gif': '/assets/test/img/loader-b66184b5c4afbccc25f.gif' };

      before(() => {
        _assets.filePath = 'test/';
        _assets.fileReplacements = TESTMAP;
      });

      after(() => {
        _assets.filePath = '';
        _assets.fileReplacements = {};
      });

      it('ignores urls', () => {
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
      it('ignores urls', () => {
        assert.strictEqual(_assets.getAssetURL('HTTP://hello'), 'HTTP://hello');
        assert.strictEqual(_assets.getAssetURL('https://world'), 'https://world');
      });

      it('throws if origin is invalid', () => {
        _assets.origin = 'nope';
        assert.throws(() => _assets.getAssetURL('intro_graph'), /unknown origin/i);
      });

      it('throws if key is invalid', () => {
        _assets.origin = 'latest';
        assert.throws(() => _assets.getAssetURL('nope'), /unknown asset key/i);
      });

      it('returns the URL if the key is valid', () => {
        _assets.origin = 'latest';
        assert.strictEqual(_assets.getAssetURL('intro_graph'), 'data/intro_graph.min.json');
      });
    });


    describe('loadAssetAsync', () => {
      it('returns a promise resolved if we already have the data', () => {
        _assets._cache.test = { hello: 'world' };

        const prom = _assets.loadAssetAsync('test');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.deepEqual(data, { hello: 'world' }));
      });

      it('returns a promise rejected if the asset key is invalid', () => {
        const prom = _assets.loadAssetAsync('nope');
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.fail(`We were not supposed to get data but did: ${data}`))
          .catch(err => assert.match(err, /unknown asset key/i));
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
