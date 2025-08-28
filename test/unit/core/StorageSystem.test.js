import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('StorageSystem', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs an StorageSystem from a context', () => {
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
    it('returns an promise to init', () => {
      const storage = new Rapid.StorageSystem(context);
      const prom = storage.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
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
        .then(val => assert.isTrue(storage.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const storage = new Rapid.StorageSystem(context);
      const prom = storage.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
