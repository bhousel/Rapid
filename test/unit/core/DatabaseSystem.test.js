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
    await database.clear('files');
  });

  afterEach(async () => {
    await database.clear('sessions');
    await database.clear('files');
  });


  describe('lifecycle', () => {
    it('constructs a DatabaseSystem from a context', () => {
      const db = new Rapid.DatabaseSystem(context);
      assert.instanceOf(db, Rapid.DatabaseSystem);
      assert.strictEqual(db.id, 'database');
      assert.strictEqual(db.context, context);
    });

    it('reports the schema version and store names', () => {
      assert.strictEqual(database.databaseVersion, 2);
      assert.include(database.storeNames, 'sessions');
      assert.include(database.storeNames, 'files');
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
    it('usageByStoreAsync is O(1) — counts and bytes updated at write time', async () => {
      // Counts should reflect writes immediately (stats updated at write, not read).
      await database.putMany('sessions', [
        { value: makeSession('a') },
        { value: makeSession('b') }
      ]);
      const usage = await database.usageByStoreAsync();
      const sessions = usage.get('sessions');
      assert.strictEqual(sessions.count, 2);
      assert.isAbove(sessions.bytes, 0);
    });

    it('usageByStoreAsync count decrements on delete', async () => {
      await database.put('sessions', makeSession('a'));
      await database.put('sessions', makeSession('b'));
      await database.delete('sessions', 'a');
      const usage = await database.usageByStoreAsync();
      assert.strictEqual(usage.get('sessions').count, 1);
    });

    it('usageByStoreAsync resets count and bytes on clear', async () => {
      await database.put('sessions', makeSession('a'));
      await database.clear('sessions');
      const usage = await database.usageByStoreAsync();
      const sessions = usage.get('sessions');
      assert.strictEqual(sessions.count, 0);
      assert.strictEqual(sessions.bytes, 0);
    });

    it('usageByStoreAsync seeded count reflects records already in IDB at init', async () => {
      // Pre-populate via the existing `database` instance, then open a fresh one on the same DB.
      await database.put('sessions', makeSession('x'));
      await database.put('sessions', makeSession('y'));

      const db2 = new Rapid.DatabaseSystem(context);
      await db2.initAsync();
      const usage = await db2.usageByStoreAsync();
      assert.strictEqual(usage.get('sessions').count, 2);
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


  describe('files', () => {
    function makeFile(name = 'buildings.geojson', body = '{"type":"FeatureCollection","features":[]}') {
      return new File([body], name, { type: 'application/geo+json' });
    }

    it('stores a File and captures its metadata', async () => {
      const record = await database.putFileAsync(makeFile());
      assert.isString(record.id);
      assert.strictEqual(record.name, 'buildings.geojson');
      assert.strictEqual(record.extension, '.geojson');
      assert.strictEqual(record.type, 'application/geo+json');
      assert.isAbove(record.size, 0);
      assert.isNumber(record.createdAt);
      assert.instanceOf(record.blob, Blob);
    });

    it('round-trips the blob natively (no base64/arraybuffer)', async () => {
      const record = await database.putFileAsync(makeFile('a.json', '{"hello":"world"}'));
      const got = await database.getFileAsync(record.id);
      assert.instanceOf(got.blob, Blob);
      assert.strictEqual(await got.blob.text(), '{"hello":"world"}');
    });

    it('stores a plain Blob with an explicit name/type', async () => {
      const blob = new Blob(['<gpx/>'], { type: 'application/gpx+xml' });
      const record = await database.putFileAsync(blob, { name: 'track.gpx' });
      assert.strictEqual(record.name, 'track.gpx');
      assert.strictEqual(record.extension, '.gpx');
      assert.strictEqual(record.type, 'application/gpx+xml');
    });

    it('defaults the name to "untitled" for a nameless blob', async () => {
      const record = await database.putFileAsync(new Blob(['x']));
      assert.strictEqual(record.name, 'untitled');
      assert.strictEqual(record.extension, '');
    });

    it('upserts when given a stable id, preserving createdAt', async () => {
      const first = await database.putFileAsync(makeFile('v1.json', 'one'), { id: 'fixed' });
      await new Promise(r => { setTimeout(r, 5); });
      const second = await database.putFileAsync(makeFile('v2.json', 'two'), { id: 'fixed' });

      assert.strictEqual(second.id, 'fixed');
      assert.strictEqual(second.createdAt, first.createdAt);   // preserved
      assert.isAtLeast(second.updatedAt, first.updatedAt);

      const all = await database.listFilesAsync();
      assert.lengthOf(all.filter(f => f.id === 'fixed'), 1);   // replaced, not duplicated
      assert.strictEqual(await (await database.getFileAsync('fixed')).blob.text(), 'two');
    });

    it('lists files newest first', async () => {
      await database.putFileAsync(makeFile('old.json'), { id: 'old' });
      await new Promise(r => { setTimeout(r, 5); });
      await database.putFileAsync(makeFile('new.json'), { id: 'new' });

      const list = await database.listFilesAsync();
      assert.deepEqual(list.map(f => f.id), ['new', 'old']);
    });

    it('deletes a file', async () => {
      const record = await database.putFileAsync(makeFile());
      await database.deleteFileAsync(record.id);
      assert.isUndefined(await database.getFileAsync(record.id));
    });

    it('usageByStoreAsync reflects real blob bytes for the files store', async () => {
      const body = 'x'.repeat(10000);
      await database.putFileAsync(new Blob([body]), { name: 'big.bin' });

      const usage = await database.usageByStoreAsync();
      const files = usage.get('files');
      assert.strictEqual(files.count, 1);
      assert.isAtLeast(files.bytes, 10000);   // counts the actual blob bytes, not a placeholder
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

    it('still stores and retrieves files in memory', async () => {
      const record = await mockDatabase.putFileAsync(
        new File(['{"a":1}'], 'x.json', { type: 'application/json' })
      );
      const got = await mockDatabase.getFileAsync(record.id);
      assert.strictEqual(got.name, 'x.json');
      assert.strictEqual(await got.blob.text(), '{"a":1}');
    });

    it('usageByStoreAsync returns stats from the in-memory mock (bytes/count from writes)', async () => {
      await mockDatabase.put('sessions', makeSession('a'));
      const usage = await mockDatabase.usageByStoreAsync();
      assert.strictEqual(usage.get('sessions').count, 1);
      assert.isAtLeast(usage.get('sessions').bytes, 0);
    });
  });
});
