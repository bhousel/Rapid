import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
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
      assert.strictEqual(database.databaseVersion, 3);
      assert.include(database.storeNames, 'sessions');
      assert.include(database.storeNames, 'files');
      assert.include(database.storeNames, 'datasets');
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
    it('estimateQuotaAsync returns null or an estimate object', async () => {
      const estimate = await database.estimateQuotaAsync();
      assert.isTrue(estimate === null || typeof estimate === 'object');
    });

    it('canStoreAsync returns a viability verdict with the raw figures', async () => {
      const result = await database.canStoreAsync(1000);
      assert.strictEqual(result.requested, 1000);
      assert.isBoolean(result.ok);
      assert.include(['ok', 'insufficient', 'unavailable'], result.reason);
      assert.isNumber(result.available);
      assert.isNumber(result.quota);
      assert.isNumber(result.usage);
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

    it('listFilesAsync exposes each file size (for summing in a management UI)', async () => {
      const body = 'x'.repeat(10000);
      await database.putFileAsync(new Blob([body]), { name: 'big.bin' });

      const files = await database.listFilesAsync();
      assert.lengthOf(files, 1);
      assert.isAtLeast(files[0].size, 10000);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      assert.isAtLeast(totalBytes, 10000);
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

    it('canStoreAsync reports unavailable when mocked', async () => {
      const result = await mockDatabase.canStoreAsync(1000);
      assert.isFalse(result.ok);
      assert.strictEqual(result.reason, 'unavailable');
      assert.strictEqual(result.available, 0);
    });

    it('reports its status as unavailable', () => {
      assert.strictEqual(mockDatabase.status, 'unavailable');
    });
  });


  // Other Rapid tabs on the same origin, running older or newer versions of Rapid.
  // Each test gets its own empty IndexedDB, standing in for one origin.
  describe('other tabs', () => {
    let savedIndexedDB;
    let others;

    beforeEach(() => {
      savedIndexedDB = globalThis.indexedDB;
      globalThis.indexedDB = new IDBFactory();
      others = [];
    });

    afterEach(() => {
      for (const db of others) db.close();
      globalThis.indexedDB = savedIndexedDB;
    });

    // Opens the database the way another tab's Rapid would, with the stores that version had.
    async function openOtherTab(version, storeNames, { closesWhenAsked = false } = {}) {
      const db = await openDB('Rapid', version, {
        upgrade(db) {
          for (const name of storeNames) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            store.createIndex('by-updatedAt', 'updatedAt');
            if (name === 'sessions') store.createIndex('by-origin', 'origin');
            if (name === 'files') store.createIndex('by-name', 'name');
          }
        },
        blocking: closesWhenAsked ? () => db.close() : undefined
      });
      others.push(db);
      return db;
    }

    async function startDatabase() {
      const ctx = new Rapid.MockContext();
      ctx.version = '3.0.0-test';
      const db = new Rapid.DatabaseSystem(ctx);
      ctx.systems.database = db;
      await db.initAsync();
      return db;
    }

    it('reports ok when it opens IndexedDB', async () => {
      const db = await startDatabase();
      assert.strictEqual(db.status, 'ok');
      assert.isTrue(db.isAvailable);
    });

    it('upgrades at once when an older tab closes its connection when asked', async () => {
      await openOtherTab(2, ['sessions', 'files'], { closesWhenAsked: true });
      const started = Date.now();
      const db = await startDatabase();
      assert.isBelow(Date.now() - started, 1000, 'did not wait for the other tab');
      assert.strictEqual(db.status, 'ok');
      await db.put('datasets', { id: 'd1', updatedAt: 1 });
      assert.strictEqual((await db.get('datasets', 'd1')).id, 'd1', 'the v3 store exists');
    });

    it('starts on the in-memory fallback when an older tab holds up the upgrade', async () => {
      const older = await openOtherTab(2, ['sessions', 'files']);
      await older.put('sessions', makeSession('older'));

      const db = await startDatabase();
      assert.strictEqual(db.status, 'blocked');
      assert.isFalse(db.isAvailable);
      await db.put('sessions', makeSession('a'));
      assert.deepEqual(await db.getAllKeys('sessions'), ['a'], 'works in memory');

      // Once the older tab closes, the upgrade that was held up runs, and the next start uses it.
      older.close();
      await new Promise(resolve => { setTimeout(resolve, 50); });
      const next = await startDatabase();
      assert.strictEqual(next.status, 'ok');
      assert.deepEqual(await next.getAllKeys('sessions'), ['older'], 'kept the older tab\'s data');
    }, 10000);

    it('closes its connection when a newer tab needs to upgrade', async () => {
      const db = await startDatabase();
      await db.put('sessions', makeSession('a'));
      const statuses = [];
      db.on('statuschange', status => statuses.push(status));

      const newer = await openOtherTab(4, ['extra']);   // would hang if `db` held on
      assert.deepEqual(statuses, ['closed']);
      assert.strictEqual(db.status, 'closed');
      assert.isFalse(db.isAvailable);
      assert.include([...newer.objectStoreNames], 'sessions', 'the newer tab upgraded the same database');

      await db.put('sessions', makeSession('b'));
      assert.deepEqual(await db.getAllKeys('sessions'), ['b'], 'carries on in memory');
    });

    it('opens a database that a newer Rapid already upgraded', async () => {
      const newer = await openOtherTab(4, ['sessions', 'files', 'datasets', 'extra']);
      await newer.put('sessions', makeSession('newer'));
      newer.close();

      const db = await startDatabase();
      assert.strictEqual(db.status, 'ok');
      assert.deepEqual(await db.getAllKeys('sessions'), ['newer']);
      const sorted = await db.getAllFromIndex('sessions', 'by-updatedAt');
      assert.strictEqual(sorted.length, 1, 'the manifest\'s indexes work');
    });

    it('closes a newer database that is missing a store it uses', async () => {
      const newer = await openOtherTab(4, ['sessions', 'files']);
      newer.close();

      const db = await startDatabase();
      assert.strictEqual(db.status, 'unavailable');
      assert.isFalse(db.isAvailable);

      // Its connection is closed, so it doesn't hold up a later upgrade.
      const later = await openOtherTab(5, ['datasets']);
      assert.strictEqual(later.version, 5);
    });
  });
});
