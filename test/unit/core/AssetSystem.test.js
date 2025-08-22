import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('AssetSystem', () => {
  const context = new Rapid.MockContext();
  let _assets;


  beforeEach(() => {
    _assets = new Rapid.AssetSystem(context);
    return _assets.initAsync();
  });


  describe('origin', () => {
    it('sets and gets origin', () => {
      assert.strictEqual(_assets.origin, 'latest');

      _assets.origin = 'local';
      assert.strictEqual(_assets.origin, 'local');
    });
  });


  describe('filePath', () => {
    it('sets and gets filePath', () => {
      assert.strictEqual(_assets.filePath, '');

      _assets.filePath = 'test/';
      assert.strictEqual(_assets.filePath, 'test/');
    });
  });


  describe('fileReplacements', () => {
    const TESTMAP = { 'test/img/loader.gif': '/assets/test/img/loader-b66184b5c4afbccc25f.gif' };

    it('sets and gets fileReplacements', () => {
      assert.deepEqual(_assets.fileReplacements, {});

      _assets.fileReplacements = TESTMAP;
      assert.deepEqual(_assets.fileReplacements, TESTMAP);
    });
  });


  describe('sources', () => {
    it('gets the sources', () => {
      const sources = _assets.sources;
      assert.hasAllKeys(sources, ['latest', 'local']);
    });
  });


  describe('getFileURL', () => {
    const TESTMAP = { 'test/img/loader.gif': '/assets/test/img/loader-b66184b5c4afbccc25f.gif' };

    beforeEach(() => {
      _assets.filePath = 'test/';
      _assets.fileReplacements = TESTMAP;
    });

    it('ignores urls', () => {
      assert.strictEqual(_assets.getFileURL('HTTP://hello'), 'HTTP://hello');
      assert.strictEqual(_assets.getFileURL('https://world'), 'https://world');
    });

    it('looks first in fileReplacements', () => {
      assert.strictEqual(_assets.getFileURL('img/loader.gif'), '/assets/test/img/loader-b66184b5c4afbccc25f.gif');
    });

    it('falls back to prepending assetPath', () => {
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
      assert.throws(() => _assets.getAssetURL('intro_graph'), /Unknown origin/);
    });

    it('throws if key is invalid', () => {
      _assets.origin = 'latest';
      assert.throws(() => _assets.getAssetURL('nope'), /Unknown asset key/);
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
        .then(data => {
          assert.deepEqual(data, { hello: 'world' });
        });
    });

    it('returns a promise rejected if we can not get the data', () => {
      const prom = _assets.loadAssetAsync('wat');
      assert.instanceOf(prom, Promise);
      return prom
        .then(data => {
          assert.fail(`We were not supposed to get data but did: ${data}`);
        })
        .catch(err => {
          assert.match(err, /^Unknown asset/);
        });
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
        .then(data => {
          assert.deepEqual(data, { value: 'success' });
          fetchMock.unmockGlobal();
        });
    });

  });
});
