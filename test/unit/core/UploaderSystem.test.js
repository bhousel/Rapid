import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('UploaderSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.MockSystem(context),
    l10n:     new Rapid.MockSystem(context)
  };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an UploaderSystem from a context', () => {
        const uploader = new Rapid.UploaderSystem(context);
        assert.instanceOf(uploader, Rapid.UploaderSystem);
        assert.strictEqual(uploader.id, 'uploader');
        assert.strictEqual(uploader.context, context);
        assert.instanceOf(uploader.requiredDependencies, Set);
        assert.instanceOf(uploader.optionalDependencies, Set);
        assert.isTrue(uploader.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const uploader = new Rapid.UploaderSystem(context);
        const prom = uploader.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const uploader = new Rapid.UploaderSystem(context);
        uploader.requiredDependencies.add('missing');
        const prom = uploader.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const uploader = new Rapid.UploaderSystem(context);
        const prom = uploader.initAsync().then(() => uploader.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(uploader.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const uploader = new Rapid.UploaderSystem(context);
        const prom = uploader.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  // These save against a fake OSM API: `_server` is what it has now, by entityID, and `_responses` are
  // what it answers to each upload in turn (`null` for success).
  describe('saving', () => {
    let _context, _editor, _uploader;
    let _server, _redacted, _responses, _uploads, _loads;

    function node(id, version, tags = {}, loc = [0, 0]) {
      return new Rapid.OsmNode(_context, { id, version, tags, loc });
    }

    function serverNode(id, version, tags = {}, loc = [0, 0], visible = true) {
      _server.set(id, { type: 'node', id, version, tags, loc, visible, user: 'other' });
    }

    function mismatch(entityID) {
      const type = { n: 'Node', w: 'Way', r: 'Relation' }[entityID[0]];
      return { status: 409, message: '409 Conflict', body: `Version mismatch: Provided 1, server had: 2 of ${type} ${entityID.slice(1)}` };
    }

    // Resolves with the next result event and its arguments
    function resultAsync() {
      return new Promise(resolve => {
        for (const name of ['resultSuccess', 'resultErrors', 'resultConflicts', 'resultNoChanges', 'resultUnknown']) {
          _uploader.once(name, (...args) => resolve({ name, args }));
        }
      });
    }

    beforeEach(() => {
      _context = new Rapid.MockContext();
      _editor = new Rapid.EditSystem(_context);
      _context.systems = {
        editor:  _editor,
        l10n:    { t: (stringID) => stringID, displayName: () => '', displayType: () => 'Point', initAsync: () => Promise.resolve() },
        spatial: new Rapid.SpatialSystem(_context),
        storage: new Rapid.StorageSystem(_context)
      };

      _server = new Map();
      _redacted = new Set();   // versions like 'n1v1' that the API leaves out
      _responses = [];
      _uploads = [];
      _loads = [];
      _context.services.osm = {
        authenticated: () => true,
        authenticate: (callback) => callback(),
        changesetURL: (changesetID) => `https://example.com/changeset/${changesetID}`,
        userURL: (user) => `https://example.com/user/${user}`,
        // Answers with the current version, even for an old one (the tests only check what's left out)
        loadEntityVersionsAsync: (versions) => {
          const requested = [...versions].map(([id, version]) => version ? `${id}v${version}` : id);
          _loads.push(requested);
          return Promise.resolve([...versions.keys()]
            .filter((id, i) => !_redacted.has(requested[i]))
            .map(id => _server.get(id))
            .filter(Boolean));
        },
        sendChangeset: (changeset, changes, callback, beforeUpload) => {
          _uploads.push(changes);
          const err = _responses.shift() ?? null;
          Promise.resolve(beforeUpload?.(changeset))
            .then(() => setTimeout(() => callback(err, changeset), 0));
        }
      };

      _uploader = new Rapid.UploaderSystem(_context);
      _uploader.changeset = { id: '1' };
      return _editor.initAsync()
        .then(() => _uploader.initAsync());
    });


    it('after a 409, merges the other mapper\'s changes and uploads against their version', async () => {
      _editor.merge([ node('n1', 1, { amenity: 'cafe', name: 'A' }) ]);
      _editor.perform(Rapid.actionChangeTags('n1', { amenity: 'cafe', name: 'B' }));
      _editor.commit({ stringID: 'changed the name' });
      serverNode('n1', 2, { amenity: 'pub', name: 'A' });   // another mapper changed the amenity
      _responses.push(mismatch('n1'));

      const result = resultAsync();
      _uploader.save();
      const { name } = await result;

      assert.strictEqual(name, 'resultSuccess');
      assert.lengthOf(_uploads, 2);
      const uploaded = _uploads[1].modified[0];
      assert.strictEqual(uploaded.version, 2);
      assert.deepEqual(uploaded.tags, { amenity: 'pub', name: 'B' });
      assert.strictEqual(_editor.stable.props.stringID, 'save.conflict.annotation');   // the merge was committed
    });

    it('reports an error if the OSM API can\'t be reached during the check', async () => {
      _editor.merge([ node('n1', 1, { name: 'A' }) ]);
      _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
      _editor.commit({ stringID: 'changed the name' });
      _context.services.osm.loadEntityVersionsAsync = () => Promise.reject(new TypeError('Failed to fetch'));

      const result = resultAsync();
      _uploader.save(false, true);
      const { name, args } = await result;

      assert.strictEqual(name, 'resultErrors');
      assert.strictEqual(args[0][0].msg, 'Failed to fetch');
      assert.lengthOf(_uploads, 0);
    });

    it('checks what the user deleted, and keeps the deletion against the other mapper\'s version', async () => {
      _editor.merge([ node('n1', 1, { amenity: 'cafe' }) ]);
      _editor.perform(Rapid.actionDeleteNode('n1'));
      _editor.commit({ stringID: 'deleted' });
      serverNode('n1', 2, { amenity: 'pub' });

      let result = resultAsync();
      _uploader.save(false, true);
      let { name, args } = await result;

      assert.strictEqual(name, 'resultConflicts');
      const conflicts = args[1];
      assert.lengthOf(conflicts, 1);
      assert.deepEqual(conflicts[0].details, ['merge_remote_changes.conflict.deleted_locally']);
      assert.deepEqual(conflicts[0].choices.map(c => [c.type, c.text]), [['local', 'save.conflict.delete'], ['remote', 'save.conflict.restore']]);
      assert.strictEqual(conflicts[0].chosen, 'remote');

      // the user chooses "Leave Deleted"
      conflicts[0].chosen = 'local';
      conflicts[0].choices[0].action();
      result = resultAsync();
      _uploader.processResolvedConflicts();
      ({ name } = await result);

      assert.strictEqual(name, 'resultSuccess');
      assert.lengthOf(_uploads, 1);
      assert.strictEqual(_uploads[0].deleted[0].id, 'n1');
      assert.strictEqual(_uploads[0].deleted[0].version, 2);
    });

    it('drops the user\'s change when they choose "Use theirs"', async () => {
      _editor.merge([ node('n1', 1, { amenity: 'cafe' }) ]);
      _editor.perform(Rapid.actionDeleteNode('n1'));
      _editor.commit({ stringID: 'deleted' });
      serverNode('n1', 2, { amenity: 'pub' });

      let result = resultAsync();
      _uploader.save(false, true);
      const { args } = await result;
      const conflicts = args[1];
      conflicts[0].choices[1].action();   // "Restore" is already chosen

      result = resultAsync();
      _uploader.processResolvedConflicts();
      const { name } = await result;

      assert.strictEqual(name, 'resultNoChanges');
      assert.lengthOf(_uploads, 0);
      assert.deepEqual(_editor.stable.graph.entity('n1').tags, { amenity: 'pub' });   // the other mapper's version
    });

    it('leaves the base alone when the user cancels, so the next save asks again', async () => {
      _editor.merge([ node('n1', 1, { amenity: 'cafe' }) ]);
      _editor.perform(Rapid.actionDeleteNode('n1'));
      _editor.commit({ stringID: 'deleted' });
      serverNode('n1', 2, { amenity: 'pub' });   // another mapper changed it
      _responses.push(mismatch('n1'));

      let result = resultAsync();
      _uploader.save();
      let { name } = await result;
      assert.strictEqual(name, 'resultConflicts');

      _uploader.cancelConflictResolution();
      assert.strictEqual(_editor.base.graph.entity('n1').version, 1, 'the base is as it was');

      // Saving again doesn't delete their version unasked
      _responses.push(mismatch('n1'));
      result = resultAsync();
      _uploader.save();
      ({ name } = await result);
      assert.strictEqual(name, 'resultConflicts');
      assert.isUndefined(_uploads.find(changes => changes.deleted.some(entity => entity.version === 2)));
    });

    it('"Use theirs" for a way keeps the user\'s change to a node another way shares', async () => {
      _editor.merge([
        node('n1', 1, {}, [0, 0]), node('n2', 1, {}, [1, 0]), node('n3', 1, {}, [2, 0]),
        new Rapid.OsmWay(_context, { id: 'w1', version: 1, nodes: ['n1', 'n2'], tags: { highway: 'path' } }),
        new Rapid.OsmWay(_context, { id: 'w2', version: 1, nodes: ['n2', 'n3'], tags: { highway: 'path' } })
      ]);
      _editor.perform(Rapid.actionMoveNode('n2', [1, 1]));   // the junction, which w2 uses too
      _editor.perform(Rapid.actionChangeTags('w1', { highway: 'footway' }));
      _editor.commit({ stringID: 'edits' });
      for (const [id, loc] of [['n1', [0, 0]], ['n2', [1, 0]], ['n3', [2, 0]]]) {
        serverNode(id, 1, {}, loc);
      }
      _server.set('w1', { type: 'way', id: 'w1', version: 2, visible: true, nodes: ['n1', 'n2'], tags: { highway: 'cycleway' }, user: 'other' });
      _responses.push(mismatch('w1'));

      let result = resultAsync();
      _uploader.save();
      let { name, args } = await result;
      assert.strictEqual(name, 'resultConflicts');
      assert.deepEqual(args[1].map(c => c.id), ['w1']);
      args[1][0].choices[1].action();   // "Use theirs", the default

      result = resultAsync();
      _uploader.processResolvedConflicts();
      ({ name } = await result);

      assert.strictEqual(name, 'resultSuccess');
      const uploaded = _uploads.at(-1);
      assert.deepEqual(uploaded.modified.map(entity => entity.id), ['n2']);
      assert.deepEqual(uploaded.modified[0].loc, [1, 1]);
      assert.deepEqual(_editor.stable.graph.entity('w1').tags, { highway: 'path' });   // not the user's change
    });

    it('"Use theirs" for a way drops the user\'s change to a node only that way uses', async () => {
      _editor.merge([
        node('n1', 1, {}, [0, 0]), node('n2', 1, {}, [1, 0]),
        new Rapid.OsmWay(_context, { id: 'w1', version: 1, nodes: ['n1', 'n2'], tags: { highway: 'path' } })
      ]);
      _editor.perform(Rapid.actionMoveNode('n2', [1, 1]));
      _editor.perform(Rapid.actionChangeTags('w1', { highway: 'footway' }));
      _editor.commit({ stringID: 'edits' });
      serverNode('n1', 1, {}, [0, 0]);
      serverNode('n2', 1, {}, [1, 0]);
      _server.set('w1', { type: 'way', id: 'w1', version: 2, visible: true, nodes: ['n1', 'n2'], tags: { highway: 'cycleway' }, user: 'other' });
      _responses.push(mismatch('w1'));

      let result = resultAsync();
      _uploader.save();
      let { args } = await result;
      args[1][0].choices[1].action();   // "Use theirs"

      result = resultAsync();
      _uploader.processResolvedConflicts();
      const { name } = await result;

      assert.strictEqual(name, 'resultNoChanges');
      assert.deepEqual(_editor.stable.graph.entity('n2').loc, [1, 0]);
    });

    it('a choice replaces the one applied before it (the default)', async () => {
      _editor.merge([
        node('n1', 1, {}, [0, 0]), node('n2', 1, {}, [1, 0]),
        new Rapid.OsmWay(_context, { id: 'w1', version: 1, nodes: ['n1', 'n2'], tags: { highway: 'path' } })
      ]);
      _editor.perform(Rapid.actionMoveNode('n1', [0, 1]));
      _editor.commit({ stringID: 'move' });
      _server.set('n1', { type: 'node', id: 'n1', version: 2, visible: false, user: 'other' });   // they deleted it
      _responses.push(mismatch('n1'));

      let result = resultAsync();
      _uploader.save();
      let { name, args } = await result;
      assert.strictEqual(name, 'resultConflicts');
      const conflict = args[1][0];
      conflict.choices[1].action();   // the screen applies the default, "Use theirs": delete n1 (and take it out of w1)
      assert.deepEqual(_editor.staging.graph.entity('w1').nodes, ['n2']);
      conflict.chosen = 'local';
      conflict.choices[0].action();   // then the user picks "Keep mine"
      assert.deepEqual(_editor.staging.graph.entity('w1').nodes, ['n1', 'n2'], 'w1 is as the merges left it');

      result = resultAsync();
      _uploader.processResolvedConflicts();
      ({ name } = await result);

      assert.strictEqual(name, 'resultSuccess');
      const uploaded = _uploads.at(-1);
      assert.deepEqual(uploaded.modified.map(entity => entity.id), ['n1']);
      assert.deepEqual(uploaded.modified[0].loc, [0, 1]);
    });

    describe('when the version the edits were made from was redacted', () => {
      it('leaves out the user\'s changes, even to the redacted tag', async () => {
        _editor.merge([ node('n1', 1, { amenity: 'cafe', name: 'Copied' }) ]);
        _editor.perform(Rapid.actionChangeTags('n1', { amenity: 'cafe', name: 'Copied Cafe' }));
        _editor.commit({ stringID: 'changed the name' });
        serverNode('n1', 2, { amenity: 'cafe', cuisine: 'pizza' });   // the redaction removed the name
        _redacted.add('n1v1');
        _responses.push(mismatch('n1'));

        let result = resultAsync();
        _uploader.save();
        let { name, args } = await result;

        assert.strictEqual(name, 'resultConflicts');
        const conflicts = args[1];
        assert.lengthOf(conflicts, 1);
        assert.deepEqual(conflicts[0].details, ['save.conflict.redacted']);
        assert.deepEqual(conflicts[0].choices.map(c => [c.type, c.text]), [['remote', 'save.conflict.keep_remote']]);
        conflicts[0].choices[0].action();

        result = resultAsync();
        _uploader.processResolvedConflicts();
        ({ name } = await result);

        assert.strictEqual(name, 'resultNoChanges');
        assert.lengthOf(_uploads, 1);   // only the first try, which got the 409
        const n1 = _editor.stable.graph.entity('n1');
        assert.strictEqual(n1.version, 2);
        assert.deepEqual(n1.tags, { amenity: 'cafe', cuisine: 'pizza' });
        assert.strictEqual(_editor.base.graph.entity('n1').version, 2, 'the base has the current version');
      });

      it('puts back a way the user deleted, with its nodes', async () => {
        _editor.merge([
          node('n1', 1, {}, [0, 0]), node('n2', 1, {}, [1, 0]),
          new Rapid.OsmWay(_context, { id: 'w1', version: 1, nodes: ['n1', 'n2'], tags: { highway: 'path' } })
        ]);
        _editor.perform(Rapid.actionDeleteWay('w1'));   // deletes its untagged nodes too
        _editor.commit({ stringID: 'deleted' });
        serverNode('n1', 1, {}, [0, 0]);
        serverNode('n2', 1, {}, [1, 0]);
        _server.set('w1', { type: 'way', id: 'w1', version: 2, visible: true, nodes: ['n1', 'n2'], tags: { highway: 'footway' }, user: 'other' });
        _redacted.add('w1v1');

        let result = resultAsync();
        _uploader.save(false, true);
        let { name, args } = await result;

        assert.strictEqual(name, 'resultConflicts');
        assert.deepEqual(args[1].map(c => c.id), ['w1']);
        assert.deepEqual(args[1][0].choices.map(c => [c.type, c.text]), [['remote', 'save.conflict.restore']]);
        args[1][0].choices[0].action();

        result = resultAsync();
        _uploader.processResolvedConflicts();
        ({ name } = await result);

        assert.strictEqual(name, 'resultNoChanges');
        const graph = _editor.stable.graph;
        const w1 = graph.entity('w1');
        assert.strictEqual(w1.version, 2);
        assert.deepEqual(w1.tags, { highway: 'footway' });
        assert.deepEqual(graph.childNodes(w1).map(n => n.id), ['n1', 'n2']);
      });

      it('isn\'t asked about when nothing changed remotely', async () => {
        _editor.merge([ node('n1', 1, { name: 'A' }) ]);
        _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
        _editor.commit({ stringID: 'changed the name' });
        serverNode('n1', 1, { name: 'A' });

        const result = resultAsync();
        _uploader.save(false, true);
        const { name } = await result;

        assert.strictEqual(name, 'resultSuccess');
        assert.deepEqual(_loads, [['n1']]);
      });

      it('lets the safe merge decide when the version is still there', async () => {
        _editor.merge([ node('n1', 1, { amenity: 'cafe', name: 'A' }) ]);
        _editor.perform(Rapid.actionChangeTags('n1', { amenity: 'cafe', name: 'B' }));
        _editor.commit({ stringID: 'changed the name' });
        serverNode('n1', 2, { amenity: 'cafe', name: 'C' });

        const result = resultAsync();
        _uploader.save(false, true);
        const { name, args } = await result;

        assert.strictEqual(name, 'resultConflicts');
        assert.deepEqual(_loads, [['n1'], ['n1v1']]);
        assert.deepEqual(args[1][0].choices.map(c => c.type), ['local', 'remote']);
      });
    });


    it('merges a way that gained a node only the server has', async () => {
      _editor.merge([
        node('n1', 1, {}, [0, 0]),
        node('n2', 1, {}, [2, 0]),
        new Rapid.OsmWay(_context, { id: 'w1', version: 1, nodes: ['n1', 'n2'], tags: { highway: 'path' } })
      ]);
      _editor.perform(Rapid.actionChangeTags('w1', { highway: 'footway' }));
      _editor.commit({ stringID: 'changed the tags' });
      serverNode('n1', 1, {}, [0, 0]);
      serverNode('n2', 1, {}, [2, 0]);
      serverNode('n3', 1, {}, [1, 0]);
      _server.set('w1', { type: 'way', id: 'w1', version: 2, nodes: ['n1', 'n3', 'n2'], tags: { highway: 'path' }, visible: true, user: 'other' });

      const mergedIDs = new Set();
      _editor.on('merge', entityIDs => { for (const entityID of entityIDs) mergedIDs.add(entityID); });
      let indexed;   // whether searches of each graph find the new node, before the upload resets everything
      _uploader.once('willAttemptUpload', () => {
        const n3 = _editor.base.graph.entity('n3');
        const n3Box = _editor.base.graph.geometry(n3).world.extent.bbox();
        const has = (graph) => _editor.entitiesInBox(n3Box, graph).some(entity => entity.id === 'n3');
        indexed = { base: has(_editor.base.graph), stable: has(_editor.stable.graph), staging: has(_editor.staging.graph) };
      });

      const result = resultAsync();
      _uploader.save(false, true);
      const { name } = await result;

      assert.strictEqual(name, 'resultSuccess');
      // the remote way's new node, loaded after, then the version the edit was made from (still there)
      assert.deepEqual(_loads, [['w1', 'n1', 'n2'], ['n3'], ['w1v1']]);
      // The new node went into the base like downloaded data: a merge, and in every index.
      assert.isTrue(mergedIDs.has('n3'));
      assert.deepEqual(indexed, { base: true, stable: true, staging: true });
      const uploaded = _uploads[0].modified.find(e => e.id === 'w1');
      assert.strictEqual(uploaded.version, 2);
      assert.deepEqual(uploaded.nodes, ['n1', 'n3', 'n2']);
      assert.deepEqual(uploaded.tags, { highway: 'footway' });
    });

    it('stops when the API reports the same version mismatch again', async () => {
      _editor.merge([ node('n1', 1, { name: 'A' }) ]);
      _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
      _editor.commit({ stringID: 'changed the name' });
      serverNode('n1', 1, { name: 'A' });   // what the check sees doesn't explain the mismatch
      _responses.push(mismatch('n1'), mismatch('n1'));

      const result = resultAsync();
      _uploader.save();
      const { name, args } = await result;

      assert.strictEqual(name, 'resultErrors');
      assert.strictEqual(args[0][0].msg, 'save.conflict.unresolved');
      assert.include(args[0][0].details, mismatch('n1').body);
      assert.lengthOf(_uploads, 2);
    });

    it('stops after a few checks for conflicts', async () => {
      const ids = ['n1', 'n2', 'n3', 'n4'];
      _editor.merge(ids.map(id => node(id, 1, { name: 'A' })));
      for (const id of ids) {
        _editor.perform(Rapid.actionChangeTags(id, { name: 'B' }));
        serverNode(id, 1, { name: 'A' });
      }
      _editor.commit({ stringID: 'changed the names' });
      _responses.push(...ids.map(mismatch));

      const result = resultAsync();
      _uploader.save();
      const { name, args } = await result;

      assert.strictEqual(name, 'resultErrors');
      assert.strictEqual(args[0][0].msg, 'save.conflict.unresolved');
      assert.lengthOf(_uploads, 4);   // the first upload, then one after each of 3 checks
    });

    it('stops when the changeset was closed', async () => {
      _editor.merge([ node('n1', 1, { name: 'A' }) ]);
      _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
      _editor.commit({ stringID: 'changed the name' });
      const closed = 'The changeset 1 was closed at 2026-10-27 12:00:00 UTC';
      _responses.push({ status: 409, message: '409 Conflict', body: closed });

      const result = resultAsync();
      _uploader.save();
      const { name, args } = await result;

      assert.strictEqual(name, 'resultErrors');
      assert.strictEqual(args[0][0].msg, closed);
      assert.lengthOf(_uploads, 1);
      assert.lengthOf(_loads, 0);
    });

    it('keeps the edits when it can\'t tell whether a lost upload went through, and there\'s no backup to leave them in', async () => {
      _editor.merge([ node('n1', 1, { name: 'A' }) ]);
      _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
      _editor.commit({ stringID: 'changed the name' });
      _responses.push({ status: -6, message: 'Failed to fetch' });

      const result = resultAsync();
      _uploader.save();
      const { name, args } = await result;

      assert.strictEqual(name, 'resultErrors');   // no database in this test
      assert.strictEqual(args[0][0].msg, 'save.upload_unknown_kept');
      assert.deepEqual(args[0][0].details, ['https://example.com/changeset/1', 'Failed to fetch']);
    });

    describe('the session backup', () => {
      let _calls;

      beforeEach(() => {
        _calls = [];
        _context.services.osm.apiroot = 'https://api.example.com';
        _editor.markUploadAsync = (changesetID, apiURL) => { _calls.push(['mark', changesetID, apiURL]); return Promise.resolve(); };
        _editor.clearUploadMarkAsync = (changesetID) => { _calls.push(['unmark', changesetID]); return Promise.resolve(); };
        _editor.clearBackup = () => { _calls.push(['clear']); };
        _editor.releaseSessionAsync = () => { _calls.push(['release']); return Promise.resolve(true); };

        _editor.merge([ node('n1', 1, { name: 'A' }) ]);
        _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
        _editor.commit({ stringID: 'changed the name' });
      });

      it('is marked before uploading, and deleted once the upload succeeds', async () => {
        const result = resultAsync();
        _uploader.save();
        const { name } = await result;

        assert.strictEqual(name, 'resultSuccess');
        assert.deepEqual(_calls, [['mark', '1', 'https://api.example.com'], ['clear']]);
      });

      it('is unmarked but kept when the upload fails', async () => {
        _responses.push({ status: -5, message: 'Failed to fetch' });

        const result = resultAsync();
        _uploader.save();
        await result;

        assert.deepEqual(_calls, [['mark', '1', 'https://api.example.com'], ['unmark', '1']]);
      });

      it('isn\'t unmarked when the save fails before a changeset is created', async () => {
        _uploader.changeset = { id: undefined };
        _context.services.osm.sendChangeset = (changeset, changes, callback) => {
          setTimeout(() => callback({ message: 'Failed to fetch' }, changeset), 0);   // offline at create
        };

        const result = resultAsync();
        _uploader.save();
        const { name } = await result;

        assert.strictEqual(name, 'resultErrors');
        assert.deepEqual(_calls, []);
      });

      it('is deleted when the conflicts leave nothing to upload', async () => {
        serverNode('n1', 2, { name: 'C' });   // another mapper renamed it too
        _responses.push(mismatch('n1'));

        let result = resultAsync();
        _uploader.save();
        const { args } = await result;
        args[1][0].choices[1].action();   // "Use theirs"

        result = resultAsync();
        _uploader.processResolvedConflicts();
        const { name } = await result;

        assert.strictEqual(name, 'resultNoChanges');
        assert.deepEqual(_calls.at(-1), ['clear']);
      });

      it('stays marked, and is left for the next start, when we can\'t tell whether the upload went through', async () => {
        _responses.push({ status: -6, message: 'Failed to fetch' });

        const result = resultAsync();
        _uploader.save();
        const { name, args } = await result;

        assert.strictEqual(name, 'resultUnknown');
        assert.strictEqual(args[0][0].msg, 'save.upload_unknown');
        assert.deepEqual(_calls, [['mark', '1', 'https://api.example.com'], ['release']]);
      });
    });
  });

});
