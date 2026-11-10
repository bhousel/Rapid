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
      editor.commit({ stringID:'add building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();

      assert.isString(editor._sessionID);
      assert.notStrictEqual(editor._sessionID, LEGACY_KEY);
    });

    it('writes separate records for separate sessions', async () => {
      // First session
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const firstID = editor._sessionID;

      // Reset clears the session id; the next edit starts a fresh session
      await editor.resetAsync();
      editor.perform(actionAddTaggedNode('n-2', [3, 4], { highway: 'residential' }));
      editor.commit({ stringID:'road', selectionAfter: ['n-2'] });
      await editor.immediateBackup();
      const secondID = editor._sessionID;

      assert.notStrictEqual(firstID, secondID);
      const records = await database.getAllFromIndex('sessions', 'by-origin', ORIGIN);
      assert.lengthOf(records, 2);
    });

    it('a reset and a restore of the same edits (the walkthrough) continues their session', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const sessionID = editor.sessionID;
      const json = editor.toJSON();

      await editor.resetAsync();
      await editor.fromJSONAsync(json);
      await editor.immediateBackup();      // a backup that ran before the session was continued
      editor.continueSession(sessionID);
      await editor.immediateBackup();
      await Bun.sleep(5);                  // let the best-effort delete land

      assert.strictEqual(editor.sessionID, sessionID);
      const records = await database.getAllFromIndex('sessions', 'by-origin', ORIGIN);
      assert.deepEqual(records.map(r => r.id), [sessionID]);   // one session, not two
    });

    it('a backup still being written when the session is continued doesn\'t bring back the session it replaced', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const sessionID = editor.sessionID;
      const json = editor.toJSON();

      await editor.resetAsync();
      await editor.fromJSONAsync(json);
      const pending = editor.immediateBackup();   // starts a new session, still writing
      editor.continueSession(sessionID);
      await pending;
      await Bun.sleep(5);                         // let the best-effort delete land

      assert.strictEqual(editor._activeSession?.id ?? sessionID, sessionID);
      const records = await database.getAllFromIndex('sessions', 'by-origin', ORIGIN);
      assert.deepEqual(records.map(r => r.id), [sessionID]);
    });

    it('after an upload clears the backup, doesn\'t back up the uploaded edits again before the reset', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();

      editor.clearBackup();                // the upload succeeded
      assert.isFalse(editor.hasWork());    // no "Leave site?" prompt for edits already on OSM
      editor.perform(actionAddTaggedNode('n-2', [3, 4], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-2'] });
      await editor.immediateBackup();
      await Bun.sleep(5);                  // let the best-effort delete land
      assert.isEmpty(await database.getAllFromIndex('sessions', 'by-origin', ORIGIN));

      await editor.resetAsync();           // the edits after the reset are work again
      editor.perform(actionAddTaggedNode('n-3', [5, 6], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-3'] });
      assert.isTrue(editor.hasWork());
      await editor.immediateBackup();
      assert.lengthOf(await database.getAllFromIndex('sessions', 'by-origin', ORIGIN), 1);
    });

    it('removes the session when the user undoes all of its edits', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const sessionID = editor._sessionID;
      assert.isOk(await database.get('sessions', sessionID));

      editor.undo();   // the edit is only in the redo part of the history now
      await editor.immediateBackup();

      assert.isUndefined(await database.get('sessions', sessionID));
      assert.isEmpty(await editor.listRestorableSessionsAsync());
      assert.isNull(editor._sessionID);   // the next edit starts a new session
    });

    it('no longer writes edits to localStorage', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();

      assert.isFalse(context.systems.storage.hasItem(LEGACY_KEY));
    });

    it('stores metadata (editCount, bbox, summary) on the record', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();

      const record = await database.get('sessions', editor._sessionID);
      assert.isAtLeast(record.editCount, 1);
      assert.include(record.summary, 'building');
      assert.isDefined(record.bbox);
      assert.strictEqual(record.bbox.minX, 1);
      assert.strictEqual(record.bbox.minY, 2);
    });

    it('includes what was deleted in the bbox (from the edit\'s extent)', async () => {
      editor.merge([ new Rapid.OsmNode(context, { id: 'n1', version: 1, loc: [5, 6] }) ]);
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      editor.perform(Rapid.actionDeleteNode('n1'));
      editor.commit({ stringID:'deleted', selectionAfter: [] });
      await editor.immediateBackup();

      const record = await database.get('sessions', editor._sessionID);
      assert.deepEqual(record.bbox, { minX: 1, minY: 2, maxX: 5, maxY: 6 });
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


  describe('sessions made on another OSM API', () => {
    const LIVE = 'https://api.openstreetmap.org';
    const DEV = 'https://master.apis.dev.openstreetmap.org';

    beforeEach(() => {
      context.services.osm = { apiroot: LIVE, initAsync: () => Promise.resolve() };
    });

    it('records the API the edits were made on', async () => {
      context.services.osm.apiroot = DEV;
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();

      const record = await database.get('sessions', editor._sessionID);
      assert.strictEqual(record.apiURL, DEV);
    });

    it('offers only sessions made on the API we\'re connected to, and older ones that don\'t say', async () => {
      await seedSession('s-live', { apiURL: LIVE });
      await seedSession('s-dev', { apiURL: DEV });
      await seedSession('s-old');

      const list = await editor.listRestorableSessionsAsync();
      assert.sameMembers(list.map(s => s.id), ['s-live', 's-old']);
      const all = await editor.listRestorableSessionsAsync(true);
      assert.sameMembers(all.map(s => s.id), ['s-live', 's-dev', 's-old']);
    });

    it('doesn\'t restore a session made on another API', async () => {
      await seedSession('s-dev', { apiURL: DEV });

      await editor.restoreSessionAsync('s-dev');
      assert.isNull(editor._sessionID);
      assert.isUndefined(editor.staging.graph.hasEntity('n-1'));
      assert.isDefined(await database.get('sessions', 's-dev'));   // kept for when the user is on that API
    });

    it('decides at start, once a host\'s preauthenticated connection has switched the API', async () => {
      const CUSTOM = 'https://osm.example.org';
      await seedSession('s-custom', { apiURL: CUSTOM });

      // Systems init on the default API, so the session counts there: backups wait for the user.
      editor = new Rapid.EditSystem(context);
      context.systems.editor = editor;
      await editor.initAsync();
      editor._canRestoreBackup = await editor._hasRestorableSessionsAsync(true);   // initAsync skips this in tests
      assert.isTrue(editor.canRestoreBackup);

      context.services.osm.apiroot = CUSTOM;   // the host's preauth switch
      await editor.startAsync();
      assert.isTrue(editor.canRestoreBackup);

      // On live, the same session isn't offered.
      context.services.osm.apiroot = LIVE;
      editor = new Rapid.EditSystem(context);
      context.systems.editor = editor;
      await editor.initAsync();
      editor._canRestoreBackup = await editor._hasRestorableSessionsAsync(true);
      await editor.startAsync();
      assert.isFalse(editor.canRestoreBackup);
    });

    it('finds the sessions made on the API the source switcher changed to', async () => {
      await seedSession('s-dev', { apiURL: DEV });

      // Startup is always on live, so the dev session isn't offered
      editor._canRestoreBackup = await editor._hasRestorableSessionsAsync(true);
      await editor.startAsync();
      assert.isFalse(editor.canRestoreBackup);

      context.services.osm.apiroot = DEV;   // switched to dev
      assert.isTrue(await editor.findRestorableSessionsAsync());
      assert.isTrue(editor.canRestoreBackup);
      assert.deepEqual((await editor.listRestorableSessionsAsync()).map(s => s.id), ['s-dev']);

      context.services.osm.apiroot = LIVE;  // and back
      assert.isFalse(await editor.findRestorableSessionsAsync());
    });

    it('settles an interrupted upload made on the API it switched to', async () => {
      const upload = { changesetID: '7', apiURL: DEV, startedAt: Date.now() - 1000 };
      await seedSession('s-dev', { apiURL: DEV, upload: upload });
      const requests = [];
      context.services.osm.loadChangesetAsync = (id) => {
        requests.push(id);
        return Promise.resolve({ id: id, changes_count: 3, open: false });   // it went through
      };

      await editor.findRestorableSessionsAsync();   // on live: not this API's to settle
      assert.deepEqual(requests, []);
      assert.isDefined(await database.get('sessions', 's-dev'));

      context.services.osm.apiroot = DEV;
      assert.isFalse(await editor.findRestorableSessionsAsync());   // nothing left to offer
      assert.deepEqual(requests, ['7']);
      assert.isUndefined(await database.get('sessions', 's-dev'));
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
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
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

    it('keeps a held session live while the walkthrough resets the editor, and after it continues', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const json = editor.toJSON();

      const sessionID = editor.holdSession();
      await editor.resetAsync();
      const before = (await database.get('sessions', sessionID)).heartbeatAt;
      await new Promise(r => { setTimeout(r, 5); });
      await editor._heartbeatAsync();
      const during = await database.get('sessions', sessionID);
      assert.isAbove(during.heartbeatAt, before);
      assert.include(during.summary, 'building');   // the user's session, not the walkthrough's

      await editor.fromJSONAsync(json);
      editor.continueSession(sessionID);
      await new Promise(r => { setTimeout(r, 5); });
      await editor._heartbeatAsync();               // before the next backup
      const after = await database.get('sessions', sessionID);
      assert.isAbove(after.heartbeatAt, during.heartbeatAt);
    });

    it('keeps a held session live that this tab hasn\'t backed up yet', async () => {
      await seedSession('s-held', { heartbeatAt: 1000 });
      editor.continueSession('s-held');   // e.g. a walkthrough that already ended once

      editor.holdSession();
      await editor.resetAsync();
      await new Promise(r => { setTimeout(r, 5); });   // let it read the record
      await editor._heartbeatAsync();
      assert.isAbove((await database.get('sessions', 's-held')).heartbeatAt, 1000);
    });

    it('stops keeping a released session live', async () => {
      await seedSession('s-held', { heartbeatAt: 1000 });
      editor.continueSession('s-held');
      editor.holdSession();
      await editor.resetAsync();
      await new Promise(r => { setTimeout(r, 5); });

      editor.releaseSession();   // e.g. the walkthrough couldn't give the edits back
      await editor._heartbeatAsync();
      assert.strictEqual((await database.get('sessions', 's-held')).heartbeatAt, 1000);
    });

    it('still offers this tab\'s own session after a reload, despite a fresh heartbeat', async () => {
      await seedSession('s-mine', { heartbeatAt: Date.now(), updatedAt: 5000 });
      globalThis.sessionStorage.setItem(OWN_KEY, 's-mine');   // simulate this tab having owned it pre-reload

      const list = await editor.listRestorableSessionsAsync();
      assert.include(list.map(s => s.id), 's-mine');
    });

    it('keeps the owned session after a reload, which marked the page as gone', async () => {
      await seedSession('s-mine', { heartbeatAt: Date.now(), updatedAt: 5000 });
      globalThis.sessionStorage.setItem(OWN_KEY, 's-mine');
      editor._markPageHidden(true);    // `pagehide`, before the reload

      editor._forgetCopiedSession();   // the new page starts
      const list = await editor.listRestorableSessionsAsync();
      assert.include(list.map(s => s.id), 's-mine');
    });

    it('a duplicated tab doesn\'t treat the session open in the original tab as its own', async () => {
      await seedSession('s-theirs', { heartbeatAt: Date.now(), updatedAt: 5000 });
      globalThis.sessionStorage.setItem(OWN_KEY, 's-theirs');   // copied from the tab, which is still open

      editor._forgetCopiedSession();   // the duplicate starts
      assert.isNull(globalThis.sessionStorage.getItem(OWN_KEY));
      const list = await editor.listRestorableSessionsAsync();
      assert.notInclude(list.map(s => s.id), 's-theirs');   // live in the other tab
    });

    it('records the owned session id in sessionStorage on backup', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();

      assert.strictEqual(globalThis.sessionStorage.getItem(OWN_KEY), editor._sessionID);
    });

    it('clears the owned session id when the active session is deleted', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID:'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const id = editor._sessionID;

      await editor.deleteSessionAsync(id);
      assert.isNull(globalThis.sessionStorage.getItem(OWN_KEY));
    });
  });


  // A session is marked while its edits are uploaded. If the tab closed during the upload, the next
  // tab asks the OSM API about the changeset before offering the session (iD#5200).
  describe('interrupted uploads', () => {
    const API = 'https://api.example.com';
    let _changesets, _requests;

    function upload(overrides = {}) {
      return { changesetID: '7', apiURL: API, startedAt: Date.now() - 1000, ...overrides };
    }

    // Start a new tab's editor, which settles the marked sessions before offering them
    async function startNewTabAsync() {
      editor = new Rapid.EditSystem(context);
      context.systems.editor = editor;
      await editor.initAsync();
      editor._canRestoreBackup = await editor._hasRestorableSessionsAsync();   // initAsync skips this in tests
      await editor.startAsync();
    }

    beforeEach(() => {
      _changesets = new Map();
      _requests = [];
      context.services.osm = {
        apiroot: API,
        initAsync: () => Promise.resolve(),
        resetAsync: () => Promise.resolve(),
        loadChangesetAsync: (id) => {
          _requests.push(id);
          const changeset = _changesets.get(id);
          return changeset ? Promise.resolve(changeset) : Promise.reject(new TypeError('Failed to fetch'));
        }
      };
    });

    it('marks the session when uploading, and keeps the mark through later backups', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.markUploadAsync('7', API);

      let record = await database.get('sessions', editor._sessionID);
      assert.include(record.upload, { changesetID: '7', apiURL: API });
      assert.strictEqual(record.data.index, 1);

      editor.perform(actionAddTaggedNode('n-2', [3, 4], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-2'] });
      await editor.immediateBackup();
      record = await database.get('sessions', editor._sessionID);
      assert.strictEqual(record.upload.changesetID, '7');

      await editor.clearUploadMarkAsync('8');   // another changeset's failure
      record = await database.get('sessions', editor._sessionID);
      assert.strictEqual(record.upload.changesetID, '7', 'kept');

      await editor.clearUploadMarkAsync('7');
      record = await database.get('sessions', editor._sessionID);
      assert.isUndefined(record.upload);
    });

    it('lets go of a marked session for the next start to settle', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.markUploadAsync('7', API);
      const sessionID = editor._sessionID;

      assert.isTrue(await editor.releaseSessionAsync());

      const record = await database.get('sessions', sessionID);
      assert.strictEqual(record.upload.changesetID, '7', 'still marked');
      assert.strictEqual(record.heartbeatAt, 0, 'no tab takes it for an open one');
      assert.isNull(editor._sessionID);
      assert.isNull(editor._ownedSessionID());

      // Starting over, this tab's next edits go to a new session.
      await editor.resetAsync();
      editor.perform(actionAddTaggedNode('n-1', [5, 6], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      assert.notStrictEqual(editor._sessionID, sessionID);
      assert.strictEqual((await database.get('sessions', sessionID)).data.entities.length, 1, 'untouched');
    });

    it('doesn\'t let go of a session that isn\'t marked', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.immediateBackup();
      const sessionID = editor._sessionID;

      assert.isFalse(await editor.releaseSessionAsync());
      assert.strictEqual(editor._sessionID, sessionID);
    });

    it('settles a session it let go of: deleted if the upload went through, offered if not', async () => {
      editor.perform(actionAddTaggedNode('n-1', [1, 2], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.markUploadAsync('7', API);
      const landedID = editor._sessionID;
      await editor.releaseSessionAsync();
      await editor.resetAsync();

      editor.perform(actionAddTaggedNode('n-1', [3, 4], { building: 'yes' }));
      editor.commit({ stringID: 'building', selectionAfter: ['n-1'] });
      await editor.markUploadAsync('8', API);
      const lostID = editor._sessionID;
      await editor.releaseSessionAsync();

      _changesets.set('7', { id: 'c7', open: false, changes_count: 1 });
      _changesets.set('8', { id: 'c8', open: false, changes_count: 0 });
      await startNewTabAsync();   // e.g. the user reloads

      assert.isUndefined(await database.get('sessions', landedID));
      const list = await editor.listRestorableSessionsAsync();
      assert.deepEqual(list.map(s => s.id), [lostID]);
      assert.isUndefined(list[0].upload);
    });

    it('deletes the session quietly if the upload went through', async () => {
      await seedSession('s-up', { upload: upload() });
      _changesets.set('7', { id: 'c7', open: false, changes_count: 3 });

      await startNewTabAsync();

      assert.isFalse(editor.canRestoreBackup);
      assert.isUndefined(await database.get('sessions', 's-up'));
    });

    it('offers the session normally if the upload never landed', async () => {
      await seedSession('s-closed', { upload: upload() });
      await seedSession('s-old', { upload: upload({ changesetID: '8', startedAt: Date.now() - 10 * 60 * 1000 }) });
      _changesets.set('7', { id: 'c7', open: false, changes_count: 0 });
      _changesets.set('8', { id: 'c8', open: 'true', changes_count: '0' });   // XML gives strings

      await startNewTabAsync();

      assert.isTrue(editor.canRestoreBackup);
      const list = await editor.listRestorableSessionsAsync();
      assert.sameMembers(list.map(s => s.id), ['s-closed', 's-old']);
      assert.isTrue(list.every(s => !s.upload));
    });

    it('doesn\'t offer the session yet if the server may still be working on the upload', async () => {
      await seedSession('s-pending', { upload: upload() });
      _changesets.set('7', { id: 'c7', open: true, changes_count: 0 });

      await startNewTabAsync();

      assert.isFalse(editor.canRestoreBackup);
      const record = await database.get('sessions', 's-pending');
      assert.isOk(record.upload);   // checked again next time
    });

    it('warns if the API can\'t be asked, or it\'s a different API', async () => {
      await seedSession('s-offline', { upload: upload() });
      await seedSession('s-other', { upload: upload({ changesetID: '9', apiURL: 'https://api.other.example.com' }) });

      await startNewTabAsync();

      assert.deepEqual(_requests, ['7']);   // not the other API's changeset
      const list = await editor.listRestorableSessionsAsync();
      assert.sameMembers(list.map(s => s.id), ['s-offline', 's-other']);
      assert.isTrue(list.every(s => s.upload));
    });

    it('doesn\'t check a session open in another tab', async () => {
      await seedSession('s-live', { upload: upload(), heartbeatAt: Date.now() });
      await seedSession('s-other', { updatedAt: 5000 });   // so there's something to restore

      await startNewTabAsync();

      assert.lengthOf(_requests, 0);
      assert.isOk(await database.get('sessions', 's-live'));
    });

    it('clears the mark when the user restores the session anyway', async () => {
      await seedSession('s-offline', { upload: upload() });
      await startNewTabAsync();

      await editor.restoreSessionAsync('s-offline');

      const record = await database.get('sessions', 's-offline');
      assert.isUndefined(record.upload);
    });
  });
});
