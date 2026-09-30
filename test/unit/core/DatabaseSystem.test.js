import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('DatabaseSystem', () => {
  let context;
  let database;

  function makeSession(id, extra = {}) {
    return {
      id,
      origin: 'https://example.test',
      label: id,
      createdAt: 1000,
      updatedAt: 1000,
      editCount: 1,
      backupVersion: 3,
      data: { version: 3 },
      ...extra
    };
  }

  beforeEach(async () => {
    context = new Rapid.MockContext();
    context.version = '3.0.0-test';
    database = new Rapid.DatabaseSystem(context);
    context.systems.database = database;
    await database.initAsync();
    await database.clear('sessions');
  });

  afterEach(async () => {
    await database.clear('sessions');
  });


  describe('lifecycle', () => {
    it('constructs a DatabaseSystem from a context', () => {
      const db = new Rapid.DatabaseSystem(context);
      assert.instanceOf(db, Rapid.DatabaseSystem);
      assert.strictEqual(db.id, 'database');
      assert.strictEqual(db.context, context);
    });

    it('reports the schema version and store names', () => {
      assert.strictEqual(database.databaseVersion, 1);
      assert.include(database.storeNames, 'sessions');
    });

    it('is available when IndexedDB is present', () => {
      assert.isTrue(database.isAvailable);
    });
  });


  describe('single-record CRUD', () => {
    it('puts and gets a record', async () => {
      const key = await database.put('sessions', makeSession('a'));
      assert.strictEqual(key, 'a');

      const got = await database.get('sessions', 'a');
      assert.strictEqual(got.id, 'a');
      assert.strictEqual(got.label, 'a');
    });

    it('returns undefined for a missing record', async () => {
      const got = await database.get('sessions', 'nope');
      assert.isUndefined(got);
    });

    it('has() reports presence', async () => {
      assert.isFalse(await database.has('sessions', 'a'));
      await database.put('sessions', makeSession('a'));
      assert.isTrue(await database.has('sessions', 'a'));
    });

    it('overwrites an existing record on put', async () => {
      await database.put('sessions', makeSession('a', { editCount: 1 }));
      await database.put('sessions', makeSession('a', { editCount: 9 }));
      const got = await database.get('sessions', 'a');
      assert.strictEqual(got.editCount, 9);
    });

    it('deletes a record', async () => {
      await database.put('sessions', makeSession('a'));
      await database.delete('sessions', 'a');
      assert.isFalse(await database.has('sessions', 'a'));
    });
  });


  describe('bulk / iteration', () => {
    beforeEach(async () => {
      await database.putMany('sessions', [
        { value: makeSession('a') },
        { value: makeSession('b') },
        { value: makeSession('c') }
      ]);
    });

    it('putMany writes multiple records', async () => {
      assert.strictEqual(await database.count('sessions'), 3);
    });

    it('getAll returns all records', async () => {
      const all = await database.getAll('sessions');
      assert.strictEqual(all.length, 3);
    });

    it('getAllKeys returns all keys', async () => {
      const keys = await database.getAllKeys('sessions');
      assert.sameMembers(keys, ['a', 'b', 'c']);
    });

    it('iterate visits every record', async () => {
      const seen = [];
      await database.iterate('sessions', (value) => seen.push(value.id));
      assert.sameMembers(seen, ['a', 'b', 'c']);
    });

    it('deleteMany removes multiple records', async () => {
      await database.deleteMany('sessions', ['a', 'b']);
      const keys = await database.getAllKeys('sessions');
      assert.sameMembers(keys, ['c']);
    });

    it('clear empties the store', async () => {
      await database.clear('sessions');
      assert.strictEqual(await database.count('sessions'), 0);
    });
  });


  describe('index queries', () => {
    beforeEach(async () => {
      await database.putMany('sessions', [
        { value: makeSession('a', { updatedAt: 300, origin: 'https://a.test' }) },
        { value: makeSession('b', { updatedAt: 100, origin: 'https://b.test' }) },
        { value: makeSession('c', { updatedAt: 200, origin: 'https://a.test' }) }
      ]);
    });

    it('getAllFromIndex returns records sorted by the index key', async () => {
      const byTime = await database.getAllFromIndex('sessions', 'by-updatedAt');
      assert.deepEqual(byTime.map(s => s.id), ['b', 'c', 'a']);
    });

    it('getAllFromIndex filters by an exact index key', async () => {
      const forOrigin = await database.getAllFromIndex('sessions', 'by-origin', 'https://a.test');
      assert.sameMembers(forOrigin.map(s => s.id), ['a', 'c']);
    });

    it('getFromIndex returns a single matching record', async () => {
      const one = await database.getFromIndex('sessions', 'by-origin', 'https://b.test');
      assert.strictEqual(one.id, 'b');
    });

    it('getAllKeysFromIndex returns primary keys without loading values', async () => {
      const all = await database.getAllKeysFromIndex('sessions', 'by-updatedAt');
      assert.sameMembers(all, ['a', 'b', 'c']);

      const forOrigin = await database.getAllKeysFromIndex('sessions', 'by-origin', 'https://a.test');
      assert.sameMembers(forOrigin, ['a', 'c']);
    });
  });


  describe('transactions', () => {
    it('runs multiple operations atomically', async () => {
      const result = await database.transaction(['sessions'], 'readwrite', async (tx) => {
        await tx.put('sessions', makeSession('a'));
        await tx.put('sessions', makeSession('b'));
        return (await tx.getAll('sessions')).length;
      });
      assert.strictEqual(result, 2);
      assert.strictEqual(await database.count('sessions'), 2);
    });
  });


  describe('blob storage', () => {
    it('round-trips a Blob', async () => {
      const blob = new Blob(['{"type":"FeatureCollection"}'], { type: 'application/json' });
      await database.put('sessions', makeSession('file', { data: blob }));

      const got = await database.get('sessions', 'file');
      assert.instanceOf(got.data, Blob);
      const text = await got.data.text();
      assert.strictEqual(text, '{"type":"FeatureCollection"}');
    });
  });


  describe('storage management', () => {
    it('usageByStoreAsync reports per-store counts and bytes', async () => {
      await database.putMany('sessions', [
        { value: makeSession('a') },
        { value: makeSession('b') }
      ]);
      const usage = await database.usageByStoreAsync();
      const sessions = usage.get('sessions');
      assert.strictEqual(sessions.count, 2);
      assert.isAbove(sessions.bytes, 0);
    });

    it('estimateQuotaAsync returns null or an estimate object', async () => {
      const estimate = await database.estimateQuotaAsync();
      assert.isTrue(estimate === null || typeof estimate === 'object');
    });

    it('requestPersistentAsync resolves to a boolean', async () => {
      const persisted = await database.requestPersistentAsync();
      assert.isBoolean(persisted);
    });
  });


  describe('graceful degradation (no IndexedDB)', () => {
    let mockContext;
    let mockDatabase;
    let savedIndexedDB;

    beforeEach(async () => {
      savedIndexedDB = globalThis.indexedDB;
      // Simulate a browser that denies IndexedDB (e.g. private mode).
      delete globalThis.indexedDB;

      mockContext = new Rapid.MockContext();
      mockContext.version = '3.0.0-test';
      mockDatabase = new Rapid.DatabaseSystem(mockContext);
      mockContext.systems.database = mockDatabase;
      await mockDatabase.initAsync();
    });

    afterEach(() => {
      globalThis.indexedDB = savedIndexedDB;
    });

    it('falls back to an in-memory store and reports unavailable', () => {
      assert.isFalse(mockDatabase.isAvailable);
    });

    it('still supports CRUD in memory', async () => {
      await mockDatabase.put('sessions', makeSession('a'));
      const got = await mockDatabase.get('sessions', 'a');
      assert.strictEqual(got.id, 'a');
    });

    it('still supports index queries in memory', async () => {
      await mockDatabase.putMany('sessions', [
        { value: makeSession('a', { updatedAt: 300 }) },
        { value: makeSession('b', { updatedAt: 100 }) }
      ]);
      const byTime = await mockDatabase.getAllFromIndex('sessions', 'by-updatedAt');
      assert.deepEqual(byTime.map(s => s.id), ['b', 'a']);
    });
  });
});
