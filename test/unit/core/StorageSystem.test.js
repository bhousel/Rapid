import { beforeAll, describe, it } from 'bun:test';
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
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const storage = new Rapid.StorageSystem(context);
        storage.requiredDependencies.add('missing');
        const prom = storage.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const storage = new Rapid.StorageSystem(context);
        const prom = storage.initAsync().then(() => storage.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(storage.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const storage = new Rapid.StorageSystem(context);
        const prom = storage.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _storage;

    beforeAll(() => {
      _storage = new Rapid.StorageSystem(context);
      return _storage.initAsync().then(() => _storage.startAsync());
    });

    describe('hasItem', () => {
      it('returns false for non-existent keys', () => {
        assert.isFalse(_storage.hasItem('nonexistent-key-12345'));
      });

      it('returns true for existing keys', () => {
        _storage.setItem('test-key', 'test-value');
        assert.isTrue(_storage.hasItem('test-key'));
        _storage.removeItem('test-key');
      });

      it('returns false for keys that were removed', () => {
        _storage.setItem('temp-key', 'temp-value');
        _storage.removeItem('temp-key');
        assert.isFalse(_storage.hasItem('temp-key'));
      });
    });

    describe('getItem', () => {
      it('returns null for non-existent keys', () => {
        assert.isNull(_storage.getItem('nonexistent-key-12345'));
      });

      it('returns the stored value for existing keys', () => {
        _storage.setItem('test-key', 'test-value');
        assert.strictEqual(_storage.getItem('test-key'), 'test-value');
        _storage.removeItem('test-key');
      });

      it('returns null for keys that were removed', () => {
        _storage.setItem('temp-key', 'temp-value');
        _storage.removeItem('temp-key');
        assert.isNull(_storage.getItem('temp-key'));
      });

      it('can store and retrieve complex string values', () => {
        const complexValue = JSON.stringify({ foo: 'bar', num: 42, arr: [1, 2, 3] });
        _storage.setItem('complex-key', complexValue);
        assert.strictEqual(_storage.getItem('complex-key'), complexValue);
        _storage.removeItem('complex-key');
      });
    });

    describe('setItem', () => {
      it('stores a value and returns true on success', () => {
        const result = _storage.setItem('test-key', 'test-value');
        // Will return true for real localStorage, false for mock
        assert.isBoolean(result);
        assert.strictEqual(_storage.getItem('test-key'), 'test-value');
        _storage.removeItem('test-key');
      });

      it('updates an existing value', () => {
        _storage.setItem('update-key', 'original-value');
        assert.strictEqual(_storage.getItem('update-key'), 'original-value');
        _storage.setItem('update-key', 'updated-value');
        assert.strictEqual(_storage.getItem('update-key'), 'updated-value');
        _storage.removeItem('update-key');
      });

      it('can store empty strings', () => {
        _storage.setItem('empty-key', '');
        assert.strictEqual(_storage.getItem('empty-key'), '');
        _storage.removeItem('empty-key');
      });

      it('stores multiple key-value pairs independently', () => {
        _storage.setItem('key1', 'value1');
        _storage.setItem('key2', 'value2');
        _storage.setItem('key3', 'value3');
        assert.strictEqual(_storage.getItem('key1'), 'value1');
        assert.strictEqual(_storage.getItem('key2'), 'value2');
        assert.strictEqual(_storage.getItem('key3'), 'value3');
        _storage.removeItem('key1');
        _storage.removeItem('key2');
        _storage.removeItem('key3');
      });
    });

    describe('removeItem', () => {
      it('removes an existing item', () => {
        _storage.setItem('remove-key', 'remove-value');
        assert.isTrue(_storage.hasItem('remove-key'));
        _storage.removeItem('remove-key');
        assert.isFalse(_storage.hasItem('remove-key'));
      });
      it('does nothing for non-existent keys', () => {
        // Should not throw
        assert.doesNotThrow(() => {
          _storage.removeItem('nonexistent-key-12345');
        });
      });

      it('can remove multiple items', () => {
        _storage.setItem('key1', 'value1');
        _storage.setItem('key2', 'value2');
        _storage.removeItem('key1');
        assert.isFalse(_storage.hasItem('key1'));
        assert.isTrue(_storage.hasItem('key2'));
        _storage.removeItem('key2');
        assert.isFalse(_storage.hasItem('key2'));
      });
    });

    describe('keys', () => {
      it('returns an empty array when no items are stored', () => {
        _storage.clear();
        assert.deepEqual(_storage.keys(), []);
      });

      it('lists all stored keys', () => {
        _storage.clear();
        _storage.setItem('keys-a', '1');
        _storage.setItem('keys-b', '2');
        const keys = _storage.keys();
        assert.sameMembers(keys, ['keys-a', 'keys-b']);
        _storage.clear();
      });

      it('reflects removals', () => {
        _storage.clear();
        _storage.setItem('keys-a', '1');
        _storage.setItem('keys-b', '2');
        _storage.removeItem('keys-a');
        assert.sameMembers(_storage.keys(), ['keys-b']);
        _storage.clear();
      });
    });

    describe('clear', () => {
      it('removes all stored items', () => {
        // Add several items
        _storage.setItem('clear-key1', 'value1');
        _storage.setItem('clear-key2', 'value2');
        _storage.setItem('clear-key3', 'value3');
        assert.isTrue(_storage.hasItem('clear-key1'));
        assert.isTrue(_storage.hasItem('clear-key2'));
        assert.isTrue(_storage.hasItem('clear-key3'));

        // Clear all
        _storage.clear();

        // Verify all are gone
        assert.isFalse(_storage.hasItem('clear-key1'));
        assert.isFalse(_storage.hasItem('clear-key2'));
        assert.isFalse(_storage.hasItem('clear-key3'));
      });

      it('can add items after clearing', () => {
        _storage.setItem('before-clear', 'value');
        _storage.clear();
        _storage.setItem('after-clear', 'new-value');
        assert.isFalse(_storage.hasItem('before-clear'));
        assert.isTrue(_storage.hasItem('after-clear'));
        assert.strictEqual(_storage.getItem('after-clear'), 'new-value');
        _storage.removeItem('after-clear');
      });
    });
  });

});
