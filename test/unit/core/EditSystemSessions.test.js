import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('EditSystem sessions (Phase 2)', () => {
  let context;
  let database;
  let editor;

  const ORIGIN = 'headless';
  const LEGACY_KEY = 'Rapid_headless_saved_history';

  // A minimal valid v3 backup object.
  function makeBackup(overrides = {}) {
    return {
      version: 3,
      entities: [{ id: 'n-1', loc: [1, 2], v: 0, tags: { building: 'yes' } }],
      baseEntities: [],
      stack: [ {}, { modified: ['n-1v0'], annotation: 'added a building' } ],
      nextIDs: { node: 2 },
      index: 1,
      timestamp: Date.now(),
      ...overrides
    };
  }

  function seedSession(id, overrides = {}) {
    return database.put('sessions', {
      id,
      origin: ORIGIN,
      createdAt: 1000,
      updatedAt: 1000,
      editCount: 1,
      summary: ['building'],
      backupVersion: 3,
      data: makeBackup(),
      ...overrides
    });
  }

  function actionAddTaggedNode(id, loc, tags) {
    return (graph) => graph.replace(new Rapid.OsmNode(context, { id, loc, tags })).commit();
  }

  beforeEach(async () => {
    context = new Rapid.MockContext();
    context.version = '3.0.0-test';
    database = new Rapid.DatabaseSystem(context);
    editor = new Rapid.EditSystem(context);
    context.systems = {
      database,
      editor,
      spatial: new Rapid.SpatialSystem(context),
      storage: new Rapid.StorageSystem(context)
    };
    await database.initAsync();
    await database.clear('sessions');
    context.systems.storage.removeItem(LEGACY_KEY);
    await editor.initAsync();
  });

  afterEach(async () => {
    await database.clear('sessions');
    context.systems.storage.removeItem(LEGACY_KEY);
  });


  describe('multiple concurrent sessions', () => {
    it('mints a unique session id on first backup', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'add building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();

      assert.isString(editor._sessionID);
      assert.notStrictEqual(editor._sessionID, LEGACY_KEY);
    });

    it('writes separate records for separate sessions', async () => {
      // First session
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();
      const firstID = editor._sessionID;

      // Reset clears the session id; the next edit starts a fresh session
      await editor.resetAsync();
      editor.perform(actionAddTaggedNode('n-2', [3, 4], { highway: 'residential' }));
      editor.commit({ annotation: 'road', selectedIDs: ['n-2'] });
      await editor.immediateBackup();
      const secondID = editor._sessionID;

      assert.notStrictEqual(firstID, secondID);
      const records = await database.getAllFromIndex('sessions', 'by-origin', ORIGIN);
      assert.lengthOf(records, 2);
    });

    it('no longer writes edits to localStorage', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();

      assert.isFalse(context.systems.storage.hasItem(LEGACY_KEY));
    });

    it('stores metadata (editCount, bbox, summary) on the record', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();

      const record = await database.get('sessions', editor._sessionID);
      assert.isAtLeast(record.editCount, 1);
      assert.include(record.summary, 'building');
      assert.isDefined(record.bbox);
      assert.strictEqual(record.bbox.minX, 1);
      assert.strictEqual(record.bbox.minY, 2);
    });
  });


  describe('#listRestorableSessionsAsync', () => {
    it('returns IndexedDB sessions for this origin, newest first', async () => {
      await seedSession('s-old', { updatedAt: 1000 });
      await seedSession('s-new', { updatedAt: 5000 });

      const list = await editor.listRestorableSessionsAsync();
      assert.deepEqual(list.map(s => s.id), ['s-new', 's-old']);
    });

    it('includes a synthetic legacy localStorage session', async () => {
      context.systems.storage.setItem(LEGACY_KEY, JSON.stringify(makeBackup()));

      const list = await editor.listRestorableSessionsAsync();
      const legacy = list.find(s => s.legacy);
      assert.isDefined(legacy);
      assert.strictEqual(legacy.id, LEGACY_KEY);
      assert.include(legacy.summary, 'building');
    });

    it('does not duplicate the legacy session when an IndexedDB record supersedes it', async () => {
      context.systems.storage.setItem(LEGACY_KEY, JSON.stringify(makeBackup()));
      await seedSession(LEGACY_KEY, { updatedAt: 9000 });   // an IDB record under the legacy id

      const list = await editor.listRestorableSessionsAsync();
      assert.lengthOf(list.filter(s => s.id === LEGACY_KEY), 1);
      assert.isUndefined(list.find(s => s.legacy));
    });
  });


  describe('#restoreSessionAsync', () => {
    it('continues an existing IndexedDB session under its own id', async () => {
      await seedSession('s-1');

      await editor.restoreSessionAsync('s-1');
      assert.strictEqual(editor._sessionID, 's-1');
      assert.isFalse(editor.canRestoreBackup);
      assert.isOk(editor.staging.graph.hasEntity('n-1'));
    });

    it('upgrades a legacy localStorage session and removes the legacy key', async () => {
      context.systems.storage.setItem(LEGACY_KEY, JSON.stringify(makeBackup()));

      await editor.restoreSessionAsync(LEGACY_KEY);

      // A new IndexedDB session id (not the legacy key), legacy key removed
      assert.isString(editor._sessionID);
      assert.notStrictEqual(editor._sessionID, LEGACY_KEY);
      assert.isFalse(context.systems.storage.hasItem(LEGACY_KEY));

      const record = await database.get('sessions', editor._sessionID);
      assert.isDefined(record);
      assert.isOk(editor.staging.graph.hasEntity('n-1'));
    });
  });


  describe('#deleteSessionAsync', () => {
    it('removes an IndexedDB session', async () => {
      await seedSession('s-1');
      await editor.deleteSessionAsync('s-1');
      assert.isUndefined(await database.get('sessions', 's-1'));
    });

    it('removes the legacy localStorage key', async () => {
      context.systems.storage.setItem(LEGACY_KEY, JSON.stringify(makeBackup()));
      await editor.deleteSessionAsync(LEGACY_KEY);
      assert.isFalse(context.systems.storage.hasItem(LEGACY_KEY));
    });
  });


  describe('#dismissRestore', () => {
    it('clears the restore flag without deleting sessions', async () => {
      await seedSession('s-1');
      editor._canRestoreBackup = true;

      editor.dismissRestore();
      assert.isFalse(editor.canRestoreBackup);
      assert.isDefined(await database.get('sessions', 's-1'));   // session is kept
    });
  });


  describe('liveness heartbeat', () => {
    const OWN_KEY = 'Rapid_headless_active_session';
    let savedSessionStorage;

    beforeEach(() => {
      // bare Bun has no sessionStorage — install a minimal in-memory mock
      savedSessionStorage = globalThis.sessionStorage;
      const map = new Map();
      globalThis.sessionStorage = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear()
      };
    });

    afterEach(() => {
      globalThis.sessionStorage = savedSessionStorage;
    });

    it('bumps heartbeatAt on the active session without clobbering its data', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();

      const before = (await database.get('sessions', editor._sessionID)).heartbeatAt;
      await new Promise(r => { setTimeout(r, 5); });
      await editor._heartbeatAsync();

      const after = await database.get('sessions', editor._sessionID);
      assert.isAbove(after.heartbeatAt, before);
      assert.isOk(after.data);                        // data preserved
      assert.include(after.summary, 'building');      // metadata preserved
    });

    it('excludes a session that is live in another tab (fresh heartbeat)', async () => {
      await seedSession('s-live', { heartbeatAt: Date.now(), updatedAt: 5000 });
      const list = await editor.listRestorableSessionsAsync();
      assert.notInclude(list.map(s => s.id), 's-live');
    });

    it('offers a session whose heartbeat is stale', async () => {
      await seedSession('s-stale', { heartbeatAt: Date.now() - 5 * 60 * 1000, updatedAt: 5000 });
      const list = await editor.listRestorableSessionsAsync();
      assert.include(list.map(s => s.id), 's-stale');
    });

    it('still offers this tab\'s own session after a reload, despite a fresh heartbeat', async () => {
      await seedSession('s-mine', { heartbeatAt: Date.now(), updatedAt: 5000 });
      globalThis.sessionStorage.setItem(OWN_KEY, 's-mine');   // simulate this tab having owned it pre-reload

      const list = await editor.listRestorableSessionsAsync();
      assert.include(list.map(s => s.id), 's-mine');
    });

    it('records the owned session id in sessionStorage on backup', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();

      assert.strictEqual(globalThis.sessionStorage.getItem(OWN_KEY), editor._sessionID);
    });

    it('clears the owned session id when the active session is deleted', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ annotation: 'building', selectedIDs: ['n-1'] });
      await editor.immediateBackup();
      const id = editor._sessionID;

      await editor.deleteSessionAsync(id);
      assert.isNull(globalThis.sessionStorage.getItem(OWN_KEY));
    });
  });
});
