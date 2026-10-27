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
    let _server, _responses, _uploads, _loads;

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
        for (const name of ['resultSuccess', 'resultErrors', 'resultConflicts', 'resultNoChanges']) {
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
        storage: new Rapid.MockSystem(_context)
      };

      _server = new Map();
      _responses = [];
      _uploads = [];
      _loads = [];
      _context.services.osm = {
        authenticated: () => true,
        authenticate: (callback) => callback(),
        changesetURL: (changesetID) => `https://example.com/changeset/${changesetID}`,
        userURL: (user) => `https://example.com/user/${user}`,
        loadEntityVersionsAsync: (versions) => {
          _loads.push([...versions.keys()]);
          return Promise.resolve([...versions.keys()].map(id => _server.get(id)).filter(Boolean));
        },
        sendChangeset: (changeset, changes, callback) => {
          _uploads.push(changes);
          const err = _responses.shift() ?? null;
          setTimeout(() => callback(err, changeset), 0);
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

      const result = resultAsync();
      _uploader.save(false, true);
      const { name } = await result;

      assert.strictEqual(name, 'resultSuccess');
      assert.deepEqual(_loads, [['w1', 'n1', 'n2'], ['n3']]);   // the remote way's new node, loaded after
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

    it('says when it can\'t tell whether a lost upload went through, with a link to the changeset', async () => {
      _editor.merge([ node('n1', 1, { name: 'A' }) ]);
      _editor.perform(Rapid.actionChangeTags('n1', { name: 'B' }));
      _editor.commit({ stringID: 'changed the name' });
      _responses.push({ status: -6, message: 'Failed to fetch' });

      const result = resultAsync();
      _uploader.save();
      const { name, args } = await result;

      assert.strictEqual(name, 'resultErrors');
      assert.strictEqual(args[0][0].msg, 'save.upload_unknown');
      assert.deepEqual(args[0][0].details, ['https://example.com/changeset/1', 'Failed to fetch']);
    });
  });

});
