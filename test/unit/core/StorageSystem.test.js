import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('StorageSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a StorageSystem from a context', () => {
        const storage = new Rapid.StorageSystem(context);
        assert.instanceOf(storage, Rapid.StorageSystem);
        assert.strictEqual(storage.id, 'storage');
        assert.strictEqual(storage.context, context);
        assert.instanceOf(storage.requiredDependencies, Set);
        assert.instanceOf(storage.optionalDependencies, Set);
        assert.isTrue(storage.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const storage = new Rapid.StorageSystem(context);
        const prom = storage.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const storage = new Rapid.StorageSystem(context);
        storage.requiredDependencies.add('missing');
        const prom = storage.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const storage = new Rapid.StorageSystem(context);
        const prom = storage.initAsync().then(() => storage.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(storage.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const storage = new Rapid.StorageSystem(context);
        const prom = storage.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _storage;

    before(() => {
      _storage = new Rapid.StorageSystem(context);
      return _storage.initAsync().then(() => _storage.startAsync());
    });
  });

});
