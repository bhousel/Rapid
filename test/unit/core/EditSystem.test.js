import { afterEach, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('EditSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.MockSystem(context)
  };

  function actionAddNode(nodeID) {
    return (graph) => graph.replace(new Rapid.OsmNode(context, { id: nodeID })).commit();
  }

  function actionTransitionNoop() {
    const action = (graph, t) => graph;
    action.transitionable = true;
    return action;
  }

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an EditSystem from a context', () => {
        const editor = new Rapid.EditSystem(context);
        assert.instanceOf(editor, Rapid.EditSystem);
        assert.strictEqual(editor.id, 'editor');
        assert.strictEqual(editor.context, context);
        assert.instanceOf(editor.requiredDependencies, Set);
        assert.instanceOf(editor.optionalDependencies, Set);
        assert.isTrue(editor.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const editor = new Rapid.EditSystem(context);
        const prom = editor.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const editor = new Rapid.EditSystem(context);
        editor.requiredDependencies.add('missing');
        const prom = editor.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const editor = new Rapid.EditSystem(context);
        const prom = editor.initAsync().then(() => editor.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(editor.started));
      });
    });


    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const editor = new Rapid.EditSystem(context);
        const prom = editor.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('clears the history stack', () => {
        const editor = new Rapid.EditSystem(context);
        return editor.initAsync()
          .then(() => editor.startAsync())
          .then(() => {
            editor.commit({ stringID: 'one' });
            editor.commit({ stringID: 'two' });
            editor.undo();
          })
          .then(() => editor.resetAsync())
          .then(() => {
            assert.isArray(editor._history, Array);
            assert.lengthOf(editor._history, 1);
            assert.strictEqual(editor._index, 0);
          });
      });

      it('emits events', () => {
        const editor = new Rapid.EditSystem(context);
        const onStagingChange = mock();
        const onStableChange = mock();
        const onHistoryJump = mock();
        const onBackupStatusChange = mock();
        editor.on('stagingchange', onStagingChange);
        editor.on('stablechange', onStableChange);
        editor.on('historyjump', onHistoryJump);
        editor.on('backupstatuschange', onBackupStatusChange);

        const prom = editor.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.lengthOf(onStagingChange.mock.calls, 1);
            assert.lengthOf(onStableChange.mock.calls, 1);
            assert.lengthOf(onHistoryJump.mock.calls, 1);
            assert.lengthOf(onBackupStatusChange.mock.calls, 1);

            assert.deepEqual(onStagingChange.mock.lastCall[0], editor._fullDifference);
            assert.deepEqual(onStableChange.mock.lastCall[0], editor._fullDifference);
            assert.strictEqual(onHistoryJump.mock.lastCall[0], 0);
            assert.strictEqual(onHistoryJump.mock.lastCall[1], 0);
            assert.strictEqual(onBackupStatusChange.mock.lastCall[0], true);
          });
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _editor;

    beforeEach(() => {
      _editor = new Rapid.EditSystem(context);
      return _editor.initAsync().then(() => _editor.startAsync());
    });


    // Some tests use this to prepare the EditSystem for testing add, update, remove, differences.
    // After calling this, the history will contain:
    //   Base graph contains "n1", "n2", "n3"
    //   Edit1:  "added n-1"
    //   Edit2:  "updated n2"
    //   Edit3:  "deleted n3"
    function prepareTestHistory() {
      const node_1 = new Rapid.OsmNode(context, { id: 'n-1' });
      const node1 = new Rapid.OsmNode(context, { id: 'n1' });
      const node2 = new Rapid.OsmNode(context, { id: 'n2' });
      const node3 = new Rapid.OsmNode(context, { id: 'n3' });

      _editor.merge([node1, node2, node3]);   // merge base entities

      _editor.perform(Rapid.actionAddEntity(node_1));
      _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });

      _editor.perform(Rapid.actionChangeTags('n2', { natural: 'tree' } ));
      _editor.commit({ stringID: 'updated n2', selection: ['n2'] });

      _editor.perform(Rapid.actionDeleteNode('n3'));
      _editor.commit({ stringID: 'deleted n3', selection: []});
    }


    describe('base', () => {
      it('returns the base edit', () => {
        assert.instanceOf(_editor.base, Rapid.Edit);
        assert.strictEqual(_editor.base, _editor._history[0]);
      });
    });

    describe('stable', () => {
      it('returns the stable edit', () => {
        _editor.commit({ stringID: 'one' });
        assert.instanceOf(_editor.stable, Rapid.Edit);
        assert.strictEqual(_editor.stable, _editor._history[1]);
      });
    });

    describe('staging', () => {
      it('returns the staging edit', () => {
        _editor.commit({ stringID: 'one' });
        assert.instanceOf(_editor.staging, Rapid.Edit);
        assert.notStrictEqual(_editor.staging, _editor.stable);
        assert.notStrictEqual(_editor.staging, _editor.base);
      });
    });

    describe('finding OSM data by data ID', () => {
      it('finds the current version of an entity in the staging graph', () => {
        const spatial = context.systems.spatial;
        const node1 = new Rapid.OsmNode(context, { id: 'n1' });
        _editor.merge([node1]);
        assert.strictEqual(spatial.getData('n1'), node1);

        _editor.perform(Rapid.actionChangeTags('n1', { natural: 'tree' }));
        assert.deepEqual(spatial.getData('n1').tags, { natural: 'tree' });   // staging, not base

        _editor.perform(Rapid.actionDeleteNode('n1'));
        assert.isUndefined(spatial.getData('n1'));
      });
    });

    describe('history', () => {
      it('returns the history', () => {
        assert.isArray(_editor.history, Array);
        assert.lengthOf(_editor.history, 1);
      });
    });

    describe('index', () => {
      it('returns the index', () => {
        assert.strictEqual(_editor.index, 0);
      });
    });

    describe('hasWorkInProgress', () => {
      it('returns true when work has been performed on the staging edit', () => {
        assert.isFalse(_editor.hasWorkInProgress);
        _editor.perform(Rapid.actionNoop());
        assert.isTrue(_editor.hasWorkInProgress);
      });
    });


    describe('merge', () => {
      it('merges the entities into all graph versions', () => {
        const n = new Rapid.OsmNode(context, { id: 'n1' });
        _editor.merge([n]);
        assert.strictEqual(_editor.base.graph.entity('n1'), n);
        assert.strictEqual(_editor.stable.graph.entity('n1'), n);
        assert.strictEqual(_editor.staging.graph.entity('n1'), n);
      });

      it('emits a merge event with the new entities', () => {
        const n = new Rapid.OsmNode(context, { id: 'n1' });
        const onMerge = mock();
        _editor.on('merge', onMerge);
        _editor.merge([n]);
        assert.lengthOf(onMerge.mock.calls, 1);
        assert.deepEqual(onMerge.mock.lastCall[0], new Set([n.id]));  // first argument
      });

      it('doesn\'t replace entities already in the base graph', () => {
        const n = new Rapid.OsmNode(context, { id: 'n1', version: 1 });
        _editor.merge([n]);
        _editor.merge([n.update({ version: 2 })]);
        assert.strictEqual(_editor.base.graph.entity('n1'), n);
      });
    });

    describe('updateBase', () => {
      it('replaces entities in the base graph, where the user didn\'t change them', () => {
        const n1 = new Rapid.OsmNode(context, { id: 'n1', version: 1 });
        const n2 = new Rapid.OsmNode(context, { id: 'n2', version: 1 });
        _editor.merge([n1, n2]);
        _editor.perform(Rapid.actionDeleteNode('n2'));
        _editor.commit({ stringID: 'deleted n2' });

        const n1v2 = n1.update({ version: 2 });
        const n2v2 = n2.update({ version: 2 });
        _editor.updateBase([n1v2, n2v2]);

        assert.strictEqual(_editor.base.graph.entity('n1'), n1v2);
        assert.strictEqual(_editor.stable.graph.entity('n1'), n1v2);
        assert.isUndefined(_editor.stable.graph.hasEntity('n2'));      // still deleted
        assert.strictEqual(_editor.difference().deleted()[0].version, 2);   // deleted against the newer version
      });
    });


    describe('waySegments', () => {
      // Two ways crossing at the origin:  w1 is vertical (n1-n2), w2 is horizontal (n3-n4)
      function mergeCrossingWays() {
        const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, -1] });
        const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0,  1] });
        const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [-1, 0] });
        const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [ 1, 0] });
        const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
        const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'] });
        _editor.merge([n1, n2, n3, n4, w1, w2]);
      }

      it('indexes way segments and finds them by extent', () => {
        mergeCrossingWays();
        const extent = new Rapid.sdk.Extent([-0.5, -0.5], [0.5, 0.5]);
        const segments = _editor.waySegments(extent, _editor.base.graph);
        const wayIDs = new Set(segments.map(s => s.wayID));
        assert.isTrue(wayIDs.has('w1'));
        assert.isTrue(wayIDs.has('w2'));
      });

      it('returns no segments outside the queried extent', () => {
        mergeCrossingWays();
        const extent = new Rapid.sdk.Extent([10, 10], [11, 11]);  // far away
        const segments = _editor.waySegments(extent, _editor.base.graph);
        assert.isEmpty(segments);
      });

      it('removes a way\'s segments from the stable cache when the way is deleted', () => {
        mergeCrossingWays();
        const extent = new Rapid.sdk.Extent([-0.5, -0.5], [0.5, 0.5]);
        assert.isNotEmpty(_editor.waySegments(extent, _editor.base.graph));

        _editor.perform(Rapid.actionDeleteWay('w1'));
        _editor.commit({ stringID: 'deleted w1' });

        const segments = _editor.waySegments(extent, _editor.stable.graph);
        const wayIDs = new Set(segments.map(s => s.wayID));
        assert.isFalse(wayIDs.has('w1'));  // w1 segments gone
        assert.isTrue(wayIDs.has('w2'));   // w2 segments remain
      });
    });


    describe('perform', () => {
      it('returns a Difference', () => {
        const diff = _editor.perform(Rapid.actionNoop());
        assert.instanceOf(diff, Rapid.Difference);
        assert.instanceOf(diff.changes, Map);
        assert.isEmpty(diff.changes);
      });

      it('returns an empty Difference when passed no args', () => {
        const diff = _editor.perform();
        assert.instanceOf(diff, Rapid.Difference);
        assert.instanceOf(diff.changes, Map);
        assert.isEmpty(diff.changes);
      });

      it('updates the staging graph only', () => {
        const staging = _editor.staging.graph;
        const stagingKey = staging.key;
        const stable = _editor.stable.graph;
        const stableKey = stable.key;

        _editor.perform(actionAddNode('n-1'));
        assert.isUndefined(_editor.base.graph.hasEntity('n-1'));
        assert.isUndefined(_editor.stable.graph.hasEntity('n-1'));
        assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        assert.notStrictEqual(_editor.staging.graph.key, stagingKey);  // staging changed
        assert.strictEqual(_editor.stable.graph.key, stableKey);       // same stable
      });

      it('emits an stagingchange event only', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        const action = Rapid.actionNoop();
        const difference = _editor.perform(action);
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.deepEqual(onStagingChange.mock.lastCall[0], difference);  // first argument
        assert.lengthOf(onStableChange.mock.calls, 0);
      });

      it('performs multiple actions, emits a single stagingchange event', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        const action1 = actionAddNode('n-1');
        const action2 = actionAddNode('n-2');
        const difference = _editor.perform(action1, action2);
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.deepEqual(onStagingChange.mock.lastCall[0], difference);  // first argument
        assert.lengthOf(onStableChange.mock.calls, 0);
      });
    });


    describe('performAsync', () => {
      it('returns a rejected Promise when passed no args', () => {
        const prom = _editor.performAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(() => assert.isTrue(true));
      });

      it('returns a resolved Promise when passed a non-transitionable action', () => {
        const action = actionAddNode('n-1');
        const prom = _editor.performAsync(action);
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.isOk(_editor.staging.graph.hasEntity('n-1'));
          });
      });

      it('resolves a transitionable action, emits stagingchange not stablechange', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        const action = actionTransitionNoop();
        const prom = _editor.performAsync(action);
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // With no DOM (headless/unit), the action is applied immediately rather than animated,
            // but it still emits stagingchange (work-in-progress) and never stablechange (uncommitted).
            assert.isAtLeast(onStagingChange.mock.calls.length, 1);
            assert.lengthOf(onStableChange.mock.calls, 0);
          });
      });
    });


    describe('revert', () => {
      it('replaces staging with a fresh copy of stable', () => {
        _editor.perform(actionAddNode('n-1'));
        assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        assert.isTrue(_editor.hasWorkInProgress);

        const staging = _editor.staging;
        const stable = _editor.stable;

        _editor.revert();
        assert.isUndefined(_editor.staging.graph.hasEntity('n-1'));
        assert.isFalse(_editor.hasWorkInProgress);
        assert.notStrictEqual(_editor.staging, staging);  // new staging
        assert.strictEqual(_editor.stable, stable);       // same stable
      });

      it('emits stagingchange and stablechange events', () => {
        _editor.perform(actionAddNode('n-1'));

        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        _editor.revert();
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 0);
      });

      it('does nothing if no work in progress', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        const staging = _editor.staging;
        const stable = _editor.stable;

        _editor.revert();
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);
        assert.strictEqual(_editor.staging, staging);   // same staging
        assert.strictEqual(_editor.stable, stable);     // same stable
      });
    });


    describe('commit', () => {
      it('commit work in progress to history', () => {
        assert.isArray(_editor.history, Array);
        assert.lengthOf(_editor.history, 1);
        assert.strictEqual(_editor.index, 0);
        assert.isUndefined(_editor.staging.graph.hasEntity('n-1'));
        assert.isUndefined(_editor.staging.graph.hasEntity('n-2'));

        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added a node', selection: ['n-1'] });

        assert.lengthOf(_editor.history, 2);
        assert.strictEqual(_editor.index, 1);
        assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        assert.isUndefined(_editor.staging.graph.hasEntity('n-2'));

        _editor.perform(actionAddNode('n-2'));
        _editor.commit({ stringID: 'added a node', selection: ['n-2'] });

        assert.lengthOf(_editor.history, 3);
        assert.strictEqual(_editor.index, 2);
        assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        assert.isOk(_editor.staging.graph.hasEntity('n-2'));
      });

      it('emits stagingchange and stablechange events', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added a node', selection: ['n-1'] });
        assert.lengthOf(onStagingChange.mock.calls, 2);
        assert.lengthOf(onStableChange.mock.calls, 1);

        _editor.perform(actionAddNode('n-2'));
        assert.lengthOf(onStagingChange.mock.calls, 3);
        assert.lengthOf(onStableChange.mock.calls, 1);

        _editor.commit({ stringID: 'added a node', selection: ['n-2'] });
        assert.lengthOf(onStagingChange.mock.calls, 4);
        assert.lengthOf(onStableChange.mock.calls, 2);
      });

      it('keeps the props passed to it, including props of other systems', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({
          type: 'test_edit',
          stringID: 'added a node',
          stringParams: { n: 1 },
          selection: ['n-1'],
          testID: 'abc'
        });

        const props = _editor.stable.props;
        assert.strictEqual(props.type, 'test_edit');
        assert.strictEqual(props.stringID, 'added a node');
        assert.deepEqual(props.stringParams, { n: 1 });
        assert.deepEqual(props.selection, ['n-1']);
        assert.strictEqual(props.testID, 'abc');
        assert.isObject(props.transform);
      });

      it('keeps data sources passed to it', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added a node', sources: { data: ['Some dataset'] } });

        assert.deepEqual(_editor.stable.props.sources.data, ['Some dataset']);
        assert.include(_editor.sourcesUsed().data, 'Some dataset');
      });

      it('copies the props, so later changes by the caller do not change the edit', () => {
        const selection = ['n-1'];
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added a node', selection: selection });
        selection.push('n-2');

        assert.deepEqual(_editor.stable.props.selection, ['n-1']);
      });

      it('records where the change is, from the nodes and ways that changed', () => {
        const a = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 1] });
        const b = new Rapid.OsmNode(context, { id: 'n2', loc: [2, 3] });
        const c = new Rapid.OsmNode(context, { id: 'n3', loc: [5, 5] });
        const w = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
        _editor.merge([a, b, c, w]);

        _editor.perform(Rapid.actionChangeTags('w1', { highway: 'footway' }));
        _editor.commit({ stringID: 'changed tags' });
        assert.deepEqual(_editor.stable.props.extent, [1, 1, 2, 3]);   // the way's nodes

        _editor.perform(Rapid.actionDeleteNode('n3'));
        _editor.commit({ stringID: 'deleted a node' });
        assert.deepEqual(_editor.stable.props.extent, [5, 5, 5, 5]);   // where the deleted node was
      });

      it('keeps an extent passed to it, for edits that change no OSM data', () => {
        _editor.perform(Rapid.actionNoop());
        _editor.commit({ type: 'test_ignore', stringID: 'ignored a feature', extent: [1, 2, 3, 4] });
        assert.deepEqual(_editor.stable.props.extent, [1, 2, 3, 4]);
      });

      it('has no extent when no located data changed', () => {
        _editor.perform(Rapid.actionNoop());
        _editor.commit({ stringID: 'did nothing' });
        assert.notProperty(_editor.stable.props, 'extent');
      });

      it('records what was selected before the edit', () => {
        context.mode = { selectedIDs: ['ds:d1'] };
        try {
          _editor.perform(actionAddNode('n-1'));
          _editor.commit({ stringID: 'accepted a feature', selection: ['n-1'] });
        } finally {
          context.mode = undefined;
        }
        assert.deepEqual(_editor.stable.props.selectionBefore, ['ds:d1']);
        assert.deepEqual(_editor.stable.props.selection, ['n-1']);
      });
    });


    describe('commitAppend', () => {
      it('throws if you try to commitAppend to the base edit', () => {
        _editor.perform(actionAddNode('n-1'));
        const fn = () => _editor.commitAppend('added a node');
        assert.throws(fn, /can not commitAppend to the base edit/i);
      });

      it('commitAppend work in progress to history', () => {
        assert.isArray(_editor.history, Array);
        assert.lengthOf(_editor.history, 1);
        assert.strictEqual(_editor.index, 0);
        assert.isUndefined(_editor.staging.graph.hasEntity('n-1'));
        assert.isUndefined(_editor.staging.graph.hasEntity('n-2'));

        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added a node', selection: ['n-1'] });

        assert.lengthOf(_editor.history, 2);
        assert.strictEqual(_editor.index, 1);
        assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        assert.isUndefined(_editor.staging.graph.hasEntity('n-2'));

        _editor.perform(actionAddNode('n-2'));
        _editor.commitAppend({ stringID: 'added a node', selection: ['n-2'] });  // commitAppend

        assert.lengthOf(_editor.history, 2);   // still 2
        assert.strictEqual(_editor.index, 1);  // still 1
        assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        assert.isOk(_editor.staging.graph.hasEntity('n-2'));
      });

      it('emits stagingchange and stablechange events', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added a node', selection: ['n-1'] });
        assert.lengthOf(onStagingChange.mock.calls, 2);
        assert.lengthOf(onStableChange.mock.calls, 1);

        _editor.perform(actionAddNode('n-2'));
        assert.lengthOf(onStagingChange.mock.calls, 3);
        assert.lengthOf(onStableChange.mock.calls, 1);

        _editor.commitAppend({ stringID: 'added a node', selection: ['n-2'] });  // commitAppend
        assert.lengthOf(onStagingChange.mock.calls, 4);
        assert.lengthOf(onStableChange.mock.calls, 2);
      });
    });


    describe('undo / #redo', () => {
      it('can undo and redo edits', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        _editor.perform(actionAddNode('n-2'));
        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        _editor.perform(actionAddNode('n-3'));
        _editor.commit({ stringID: 'added n-3', selection: ['n-3'] });

        assert.strictEqual(_editor.getUndoEdit()?.props.stringID, 'added n-3');
        assert.isUndefined(_editor.getRedoEdit()?.props.stringID);
        assert.isOk(_editor.stable.graph.hasEntity('n-3'));

        _editor.undo();

        assert.strictEqual(_editor.getUndoEdit()?.props.stringID, 'added n-2');
        assert.strictEqual(_editor.getRedoEdit()?.props.stringID, 'added n-3');
        assert.isUndefined(_editor.stable.graph.hasEntity('n-3'));

        _editor.redo();

        assert.strictEqual(_editor.getUndoEdit()?.props.stringID, 'added n-3');
        assert.strictEqual(_editor.getRedoEdit()?.props.stringID, 'redo.return_view');  // see 'return view' below
        assert.isOk(_editor.stable.graph.hasEntity('n-3'));
      });

      it('emits stagingchange, stablechange, and historyjump events', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        const onHistoryJump = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);
        _editor.on('historyjump', onHistoryJump);

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 0);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        assert.lengthOf(onStagingChange.mock.calls, 2);
        assert.lengthOf(onStableChange.mock.calls, 1);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.perform(actionAddNode('n-2'));
        assert.lengthOf(onStagingChange.mock.calls, 3);
        assert.lengthOf(onStableChange.mock.calls, 1);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        assert.lengthOf(onStagingChange.mock.calls, 4);
        assert.lengthOf(onStableChange.mock.calls, 2);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.perform(actionAddNode('n-3'));
        assert.lengthOf(onStagingChange.mock.calls, 5);
        assert.lengthOf(onStableChange.mock.calls, 2);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.commit({ stringID: 'added n-3', selection: ['n-3'] });
        assert.lengthOf(onStagingChange.mock.calls, 6);
        assert.lengthOf(onStableChange.mock.calls, 3);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.undo();
        assert.lengthOf(onStagingChange.mock.calls, 7);
        assert.lengthOf(onStableChange.mock.calls, 4);
        assert.lengthOf(onHistoryJump.mock.calls, 1);

        _editor.redo();
        assert.lengthOf(onStagingChange.mock.calls, 8);
        assert.lengthOf(onStableChange.mock.calls, 5);
        assert.lengthOf(onHistoryJump.mock.calls, 2);
      });

      it('does nothing if nothing to undo', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        const onHistoryJump = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);
        _editor.on('historyjump', onHistoryJump);

        _editor.undo();
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);
        assert.lengthOf(onHistoryJump.mock.calls, 0);
      });

      it('does nothing if nothing to redo', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        const onHistoryJump = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);
        _editor.on('historyjump', onHistoryJump);

        _editor.redo();
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);
        assert.lengthOf(onHistoryJump.mock.calls, 0);
      });
    });


    describe('return view', () => {
      function commitThree() {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        _editor.perform(actionAddNode('n-2'));
        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        _editor.perform(actionAddNode('n-3'));
        _editor.commit({ stringID: 'added n-3', selection: ['n-3'] });
      }

      it('remembers where the user was when they first undo away from the newest edit', () => {
        commitThree();
        assert.isNull(_editor.returnEdit);

        context.viewport.transform = { x: 10, y: 20, z: 17 };
        context.mode = { selectedIDs: ['ds:d1'] };
        try {
          _editor.undo();
        } finally {
          context.mode = undefined;
        }

        const returnEdit = _editor.returnEdit;
        assert.instanceOf(returnEdit, Rapid.Edit);
        assert.strictEqual(returnEdit.props.stringID, 'redo.return_view');
        assert.deepEqual(returnEdit.props.selection, ['ds:d1']);
        assert.include(returnEdit.props.transform, { x: 10, y: 20, z: 17 });
      });

      it('keeps the first place the user left from, through more undos and redos', () => {
        commitThree();
        context.viewport.transform = { x: 10, y: 20, z: 17 };
        _editor.undo();
        context.viewport.transform = { x: 99, y: 99, z: 15 };
        _editor.undo();
        _editor.redo();
        _editor.redo();
        _editor.undo();   // leaves the newest edit again
        assert.include(_editor.returnEdit.props.transform, { x: 10, y: 20, z: 17 });
      });

      it('is offered as one more redo past the newest edit, and emits returnview', () => {
        const onReturnView = mock();
        const onHistoryJump = mock();
        _editor.on('returnview', onReturnView);
        commitThree();
        _editor.undo();
        _editor.redo();
        _editor.on('historyjump', onHistoryJump);

        const returnEdit = _editor.returnEdit;
        assert.strictEqual(_editor.getRedoEdit(), returnEdit);

        _editor.redo();
        assert.lengthOf(onReturnView.mock.calls, 1);
        assert.strictEqual(onReturnView.mock.calls[0][0], returnEdit);
        assert.lengthOf(onHistoryJump.mock.calls, 0);
        assert.strictEqual(_editor.index, 3);       // the history didn't move
        assert.isNull(_editor.returnEdit);          // used up
        assert.isUndefined(_editor.getRedoEdit());
      });

      it('is not offered before redo reaches the newest edit', () => {
        commitThree();
        _editor.undo();
        _editor.undo();
        _editor.redo();
        assert.strictEqual(_editor.getRedoEdit()?.props.stringID, 'added n-3');
      });

      it('is cleared by a new edit', () => {
        commitThree();
        _editor.undo();
        _editor.perform(actionAddNode('n-4'));
        _editor.commit({ stringID: 'added n-4' });
        assert.isNull(_editor.returnEdit);
      });

      it('is cleared by clearReturnEdit and by reset', async () => {
        commitThree();
        _editor.undo();
        _editor.clearReturnEdit();
        assert.isNull(_editor.returnEdit);

        _editor.redo();
        _editor.undo();
        assert.isOk(_editor.returnEdit);
        await _editor.resetAsync();
        assert.isNull(_editor.returnEdit);
      });

      it('is not backed up', () => {
        commitThree();
        _editor.undo();
        _editor.redo();
        const backup = _editor.toBackup();
        assert.notInclude(JSON.stringify(backup), 'redo.return_view');
      });
    });


    describe('setCheckpoint / #restoreCheckpoint', () => {
      it('can set and restore checkpoints', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });

        _editor.setCheckpoint('checkpoint');

        _editor.perform(actionAddNode('n-2'));
        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        _editor.perform(actionAddNode('n-3'));
        _editor.commit({ stringID: 'added n-3', selection: ['n-3'] });

        _editor.restoreCheckpoint('checkpoint');

        assert.strictEqual(_editor.getUndoEdit()?.props.stringID, 'added n-1');
        assert.isUndefined(_editor.getRedoEdit()?.props.stringID);
        assert.isOk(_editor.stable.graph.hasEntity('n-1'));
        assert.isUndefined(_editor.stable.graph.hasEntity('n-2'));
        assert.isUndefined(_editor.stable.graph.hasEntity('n-3'));
      });

      it('emits stagingchange, stablechange, and historyjump events', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        const onHistoryJump = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);
        _editor.on('historyjump', onHistoryJump);

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 0);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        _editor.setCheckpoint('checkpoint');
        assert.lengthOf(onStagingChange.mock.calls, 2);
        assert.lengthOf(onStableChange.mock.calls, 1);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.perform(actionAddNode('n-2'));
        assert.lengthOf(onStagingChange.mock.calls, 3);
        assert.lengthOf(onStableChange.mock.calls, 1);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        assert.lengthOf(onStagingChange.mock.calls, 4);
        assert.lengthOf(onStableChange.mock.calls, 2);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.perform(actionAddNode('n-3'));
        assert.lengthOf(onStagingChange.mock.calls, 5);
        assert.lengthOf(onStableChange.mock.calls, 2);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.commit({ stringID: 'added n-3', selection: ['n-3'] });
        assert.lengthOf(onStagingChange.mock.calls, 6);
        assert.lengthOf(onStableChange.mock.calls, 3);
        assert.lengthOf(onHistoryJump.mock.calls, 0);

        _editor.restoreCheckpoint('checkpoint');
        assert.lengthOf(onStagingChange.mock.calls, 7);
        assert.lengthOf(onStableChange.mock.calls, 4);
        assert.lengthOf(onHistoryJump.mock.calls, 1);
      });

      it('does nothing if checkpointID is missing or invalid', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        const onHistoryJump = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);
        _editor.on('historyjump', onHistoryJump);

        _editor.restoreCheckpoint();
        _editor.restoreCheckpoint('fake');
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);
        assert.lengthOf(onHistoryJump.mock.calls, 0);
      });
    });


    describe('beginTransaction / #endTransaction', () => {
      it('prevents change events from getting dispatched in a transaction', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        _editor.beginTransaction();

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.perform(actionAddNode('n-2'));
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.endTransaction();   // events emit here
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 1);

        // diff should contain all things changed during the transaction
        const diff = onStagingChange.mock.lastCall[0];  // first argument
        assert.instanceOf(diff, Rapid.Difference);
        assert.instanceOf(diff.changes, Map);
        assert.hasAllKeys(diff.changes, ['n-1', 'n-2']);
      });

      it('does nothing if endTransaction called without beginTransaction', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        _editor.endTransaction();

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        assert.lengthOf(onStagingChange.mock.calls, 2);
        assert.lengthOf(onStableChange.mock.calls, 1);
      });

      it('uses earliest difference if beginTransaction called multiple times', () => {
        const onStagingChange = mock();
        const onStableChange = mock();
        _editor.on('stagingchange', onStagingChange);
        _editor.on('stablechange', onStableChange);

        _editor.beginTransaction();

        _editor.perform(actionAddNode('n-1'));
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        // This beginTransaction has no effect - we are already in a transaction
        _editor.beginTransaction();

        _editor.perform(actionAddNode('n-2'));
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        assert.lengthOf(onStagingChange.mock.calls, 0);
        assert.lengthOf(onStableChange.mock.calls, 0);

        _editor.endTransaction();   // events emit here
        assert.lengthOf(onStagingChange.mock.calls, 1);
        assert.lengthOf(onStableChange.mock.calls, 1);

        // diff should contain all things changed during the transaction
        const diff = onStagingChange.mock.lastCall[0];  // first argument
        assert.instanceOf(diff, Rapid.Difference);
        assert.instanceOf(diff.changes, Map);
        assert.hasAllKeys(diff.changes, ['n-1', 'n-2']);
      });
    });


    describe('difference / #hasChanges / #changes', () => {
      it('returns the difference between base -> stable', () => {
        prepareTestHistory();

        assert.isTrue(_editor.hasChanges());

        const diff = _editor.difference();
        assert.instanceOf(diff, Rapid.Difference);
        assert.instanceOf(diff.changes, Map);
        assert.hasAllKeys(diff.changes, ['n-1', 'n2', 'n3']);

        const detail = _editor.changes();
        assert.isObject(detail);
        assert.hasAllKeys(detail, ['created', 'modified', 'deleted']);

        const stable = _editor.stable.graph;
        const base = _editor.base.graph;
        assert.strictEqual(detail.created[0], stable.entity('n-1'));
        assert.strictEqual(detail.modified[0], stable.entity('n2'));
        assert.strictEqual(detail.deleted[0], base.entity('n3'));
      });
    });


    describe('hasWork', () => {
      it('is false when nothing was done', () => {
        assert.isFalse(_editor.hasWork());
      });

      it('is true when the graph changed', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added a node' });
        assert.isTrue(_editor.hasChanges());
        assert.isTrue(_editor.hasWork());
      });

      it('is true for a kept edit with a type, even if the graph did not change', () => {
        _editor.perform(Rapid.actionNoop());
        _editor.commit({ type: 'test_ignore', stringID: 'ignored a feature' });
        assert.isFalse(_editor.hasChanges());
        assert.isTrue(_editor.hasWork());
      });

      it('is false once that edit is undone', () => {
        _editor.perform(Rapid.actionNoop());
        _editor.commit({ type: 'test_ignore', stringID: 'ignored a feature' });
        _editor.undo();
        assert.isFalse(_editor.hasWork());
      });
    });


    describe('toJSON', () => {
      it('doesn\'t generate unsaveable changes', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        _editor.perform(Rapid.actionDeleteNode('n-1'));
        _editor.commit({ stringID: 'deleted n-1', selection: []});

        assert.isUndefined(_editor.toJSON());
      });

      it('generates v4 JSON', () => {
        prepareTestHistory();

        const node_1_json = { id: 'n-1' };  // without `visible: true`
        const node1_json = { id: 'n1' };
        const node2_json = { id: 'n2' };
        const node3_json = { id: 'n3' };
        const node2upd = _editor.stable.graph.entity('n2');
        const node2upd_json = { id: 'n2', tags: { natural: 'tree' }, v: node2upd.v };

        const json = JSON.parse(_editor.toJSON());
        assert.strictEqual(json.version, 4);
        assert.notProperty(json, 'baseEntities');
        assert.deepEqual(json.baseVersions, {});   // these test nodes have no OSM versions

        // edited entities
        assert.deepInclude(json.entities, node_1_json);     // n-1 was added
        assert.deepInclude(json.entities, node2upd_json);   // n2 was updated
        assert.notDeepInclude(json.entities, node1_json);   // n1 was never updated
        assert.notDeepInclude(json.entities, node2_json);   // n2 is in the base, not here
        assert.notDeepInclude(json.entities, node3_json);   // n3 is now deleted
      });

      it('saves the versions that edited entities, their child nodes and parent ways were edited from', () => {
        // Base graph:  w1 [n1, n2],  w2 [n4, n5],  n3,  n6 (no version)
        _editor.merge([
          new Rapid.OsmNode(context, { id: 'n1', version: 1, loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'n2', version: 2, loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'n3', version: 3, loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'n4', version: 1, loc: [3, 0] }),
          new Rapid.OsmNode(context, { id: 'n5', version: 1, loc: [4, 0] }),
          new Rapid.OsmNode(context, { id: 'n6', loc: [5, 0] }),
          new Rapid.OsmWay(context, { id: 'w1', version: 4, nodes: ['n1', 'n2'] }),
          new Rapid.OsmWay(context, { id: 'w2', version: 1, nodes: ['n4', 'n5'] })
        ]);

        _editor.perform(Rapid.actionChangeTags('n2', { natural: 'tree' }));
        _editor.commit({ stringID: 'updated n2' });
        _editor.perform(Rapid.actionDeleteNode('n3'));
        _editor.commit({ stringID: 'deleted n3' });
        _editor.perform(Rapid.actionChangeTags('n6', { natural: 'tree' }));
        _editor.commit({ stringID: 'updated n6' });
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added n-1' });

        const backup = _editor.toBackup();
        // n2 and n3 were edited, w1 is n2's parent way, and n1 is w1's other child node.
        // n6 has no version, n-1 is new, and w2, n4 and n5 weren't touched.
        assert.deepEqual(backup.baseVersions, { n1: 1, n2: 2, n3: 3, w1: 4 });
        assert.deepInclude(backup.entities, { id: 'n2', version: 2, loc: [1, 0], tags: { natural: 'tree' }, v: _editor.stable.graph.entity('n2').v });
      });
    });


    describe('fromJSONAsync', () => {
      it('restores from v3 JSON (creation)', () => {
        const json = {
          version: 3,
          entities: [{ id: 'n-1', loc: [1, 2], v: 0 }],
          baseEntities: [],
          stack: [
            { },
            { modified: ['n-1v0'], imageryUsed: ['Bing'], annotation: 'Added a point.' }
          ],
          nextIDs: { node: 2, way: 1, relation: 1 },
          index: 1
        };
        return _editor.fromJSONAsync(JSON.stringify(json))
          .then(() => {
            const restored = _editor.staging.graph.entity('n-1');
            assert.instanceOf(restored, Rapid.OsmNode);
            assert.strictEqual(restored.id, 'n-1');
            assert.deepEqual(restored.loc, [1, 2]);
            assert.strictEqual(restored.v, 0);
            assert.strictEqual(_editor.getUndoEdit().label, 'Added a point.');
            assert.include(_editor.sourcesUsed().imagery, 'Bing');
            assert.lengthOf(_editor.difference().created(), 1);
            assert.deepInclude(context.sequences, { node: 2, way: 1, relation: 1 });
          });
      });

      it('restores from v3 JSON (modification)', () => {
        const json = {
          version: 3,
          entities: [{ loc: [2, 3], id: 'n1', v: 1 }],
          baseEntities: [{ loc: [1, 2], id: 'n1' }],
          stack: [
            { },
            { modified: ['n1v1'], imageryUsed: ['Bing'], annotation: 'Moved a point.' }
          ],
          nextIDs: { node: 2, way: 1, relation: 1 },
          index: 1
        };
        return _editor.fromJSONAsync(JSON.stringify(json))
          .then(() => {
            const restored = _editor.staging.graph.entity('n1');
            assert.instanceOf(restored, Rapid.OsmNode);
            assert.strictEqual(restored.id, 'n1');
            assert.deepEqual(restored.loc, [2, 3]);
            assert.strictEqual(restored.v, 1);
            assert.strictEqual(_editor.getUndoEdit().label, 'Moved a point.');
            assert.include(_editor.sourcesUsed().imagery, 'Bing');
            assert.lengthOf(_editor.difference().modified(), 1);
            assert.deepInclude(context.sequences, { node: 2, way: 1, relation: 1 });
          });
      });

      it('restores from v3 JSON (deletion)', () => {
        const json = {
          version: 3,
          entities: [],
          baseEntities: [{ loc: [1, 2], id: 'n1' }],
          stack: [
            { },
            { deleted: ['n1'], imageryUsed: ['Bing'], annotation: 'Deleted a point.' }
          ],
          nextIDs: { node: 1, way: 2, relation: 3 },
          index: 1
        };
        return _editor.fromJSONAsync(JSON.stringify(json))
          .then(() => {
            assert.isUndefined(_editor.staging.graph.hasEntity('n1'));
            assert.strictEqual(_editor.getUndoEdit().label, 'Deleted a point.');
            assert.include(_editor.sourcesUsed().imagery, 'Bing');
            assert.lengthOf(_editor.difference().deleted(), 1);
            assert.deepInclude(context.sequences, { node: 1, way: 2, relation: 3 });
          });
      });

      it('converts legacy negative nextIDs to positive nextIDs', () => {
        const json = {
          version: 3,
          entities: [{ id: 'n-1', loc: [1, 2], v: 0 }],
          baseEntities: [],
          stack: [
            { },
            { modified: ['n-1v0'], imageryUsed: ['Bing'], annotation: 'Added a point.' }
          ],
          nextIDs: { node: -2, way: -1, relation: -1 },
          index: 1
        };
        return _editor.fromJSONAsync(JSON.stringify(json))
          .then(() => {
            assert.deepInclude(context.sequences, { node: 2, way: 1, relation: 1 });
          });
      });
    });


    describe('toBackup / #fromBackupAsync', () => {
      it('toBackup returns the structured object that toJSON stringifies', () => {
        prepareTestHistory();

        const backup = _editor.toBackup();
        assert.isObject(backup);
        assert.strictEqual(backup.version, 4);
        // The structured object must match the parsed JSON string exactly.
        assert.deepEqual(backup, JSON.parse(_editor.toJSON()));
      });

      it('toBackup returns undefined when there are no changes', () => {
        assert.isUndefined(_editor.toBackup());
      });

      it('toBackup leaves out the redo part of the history', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({ stringID: 'added n-1', selection: ['n-1'] });
        _editor.perform(actionAddNode('n-2'));
        _editor.commit({ stringID: 'added n-2', selection: ['n-2'] });
        _editor.undo();   // n-2 is only in the redo part now

        const backup = _editor.toBackup();
        assert.lengthOf(backup.stack, 2);   // the base edit, and adding n-1
        assert.strictEqual(backup.index, 1);
        assert.deepEqual(backup.stack.map(item => item.props?.stringID), [undefined, 'added n-1']);
        assert.isFalse(backup.entities.some(entity => entity.id === 'n-2'));
      });

      it('fromBackupAsync restores directly from a structured object (no JSON string)', () => {
        const backup = {
          version: 3,
          entities: [{ id: 'n-1', loc: [1, 2], v: 0 }],
          baseEntities: [],
          stack: [
            { },
            { modified: ['n-1v0'], annotation: 'Added a point.' }
          ],
          nextIDs: { node: 2 },
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            const restored = _editor.staging.graph.entity('n-1');
            assert.instanceOf(restored, Rapid.OsmNode);
            assert.deepEqual(restored.loc, [1, 2]);
          });
      });

      it('fromBackupAsync throws on an unsupported backup version', () => {
        assert.throws(() => _editor.fromBackupAsync({ version: 2 }), /version 2 not supported/i);
      });

      it('backs up a session with only typed edits that change nothing in the graph', () => {
        _editor.perform(Rapid.actionNoop());
        _editor.commit({ type: 'test_ignore', stringID: 'ignored a feature', testID: 'abc' });

        const backup = _editor.toBackup();
        assert.isObject(backup);
        assert.strictEqual(backup.stack[1].props.type, 'test_ignore');
        assert.strictEqual(backup.stack[1].props.testID, 'abc');
      });

      it('saves each edit\'s props and restores them as they were', () => {
        _editor.perform(actionAddNode('n-1'));
        _editor.commit({
          type: 'test_edit',
          stringID: 'added a node',
          stringParams: { n: 1 },
          selection: ['n-1'],
          sources: { data: ['Some dataset'] },
          testID: 'abc'
        });
        const props = structuredClone(_editor.stable.props);
        const backup = _editor.toBackup();

        const restored = new Rapid.EditSystem(context);
        return restored.initAsync()
          .then(() => restored.fromBackupAsync(backup))
          .then(() => {
            assert.deepEqual(restored.stable.props, props);
            assert.isTrue(restored.getUndoEdit().isLabeled({ stringID: 'added a node', stringParams: { n: 1 } }));
            assert.isTrue(restored.hasWork());
          });
      });

      it('restores a v3 object annotation (Rapid edits) as props', () => {
        const backup = {
          version: 3,
          entities: [],
          baseEntities: [],
          stack: [
            { },
            {
              annotation: { type: 'rapid_ignore_feature', description: 'Ignored a feature.', ignoreID: 'd1' },
              selectedIDs: ['n1'],
              dataUsed: ['Some dataset']
            }
          ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            const props = _editor.stable.props;
            assert.strictEqual(props.type, 'rapid_ignore_feature');
            assert.strictEqual(props.ignoreID, 'd1');
            assert.strictEqual(props.annotation, 'Ignored a feature.');
            assert.notProperty(props, 'description');
            assert.deepEqual(props.selection, ['n1']);
            assert.deepEqual(props.sources.data, ['Some dataset']);
            assert.strictEqual(_editor.getUndoEdit().label, 'Ignored a feature.');
            assert.isTrue(_editor.hasWork());
          });
      });

      it('restores edit props that have `selectedIDs` as a selection', () => {
        const backup = {
          version: 3,
          entities: [],
          baseEntities: [],
          stack: [
            { },
            { props: { stringID: 'added a node', selectedIDs: ['n1'] } }
          ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            const props = _editor.stable.props;
            assert.deepEqual(props.selection, ['n1']);
            assert.notProperty(props, 'selectedIDs');
          });
      });

      it('flattens a selection grouped by layer into data IDs', () => {
        const backup = {
          version: 3,
          entities: [],
          baseEntities: [],
          stack: [
            { },
            { props: { stringID: 'accepted a feature', selection: { osm: ['n1'] }, selectionBefore: { rapid: ['ds:d1'], osm: ['w1'] } } }
          ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            const props = _editor.stable.props;
            assert.deepEqual(props.selection, ['n1']);
            assert.sameMembers(props.selectionBefore, ['ds:d1', 'w1']);
          });
      });
    });


    describe('restoring base entities from the OSM API', () => {
      // A fake OSM service. `elements` are what the API has, by id and version, with `current: true`
      // on the current version. Like the real one, it leaves out versions it can't find.
      let _calls;
      function useOsm(elements, fail = false) {
        _calls = [];
        context.services.osm = {
          loadEntityVersionsAsync: (versions) => {
            _calls.push([...versions]);
            if (fail) return Promise.reject(new Error('offline'));

            const results = [];
            for (const [entityID, version] of versions) {
              const found = elements.find(e => e.id === entityID && (version === undefined ? e.current : e.version === version));
              if (found) {
                const props = { ...found };
                delete props.current;
                results.push(props);
              }
            }
            return Promise.resolve(results);
          }
        };
      }

      afterEach(() => {
        delete context.services.osm;
      });

      it('fetches the versions the edits were made from, all at once', () => {
        useOsm([
          { type: 'node', id: 'n1', version: 1, visible: true, loc: [0, 0], tags: {} },
          { type: 'node', id: 'n2', version: 1, visible: true, loc: [1, 0], tags: {} },
          { type: 'way', id: 'w1', version: 2, visible: true, nodes: ['n1', 'n2'], tags: { highway: 'path' } }
        ]);
        const backup = {
          version: 4,
          entities: [{ id: 'n1', version: 1, loc: [0, 1], v: 1 }],
          baseVersions: { n1: 1, n2: 1, w1: 2 },
          stack: [ {}, { modified: ['n1v1'], props: { stringID: 'moved a node' } } ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            assert.deepEqual(_calls, [ [['n1', 1], ['n2', 1], ['w1', 2]] ]);
            const base = _editor.base.graph;
            assert.deepEqual(base.entity('n1').loc, [0, 0]);
            assert.deepEqual(base.entity('w1').nodes, ['n1', 'n2']);
            const graph = _editor.stable.graph;
            assert.deepEqual(graph.entity('n1').loc, [0, 1]);
            assert.deepEqual(graph.childNodes(graph.entity('w1')).map(n => n.id), ['n1', 'n2']);
            assert.isTrue(_editor.hasChanges());
          });
      });

      it('falls back to the current version, or to the version before it was deleted', () => {
        useOsm([
          { type: 'node', id: 'n1', version: 5, visible: true, loc: [0, 0], tags: {}, current: true },   // v3 is redacted
          { type: 'node', id: 'n2', version: 4, visible: false, current: true },                     // deleted in v4
          { type: 'node', id: 'n2', version: 3, visible: true, loc: [1, 0], tags: {} }
        ]);                                                                                          // n3 can't be found at all
        const backup = {
          version: 4,
          entities: [{ id: 'n-1', loc: [1, 2], v: 0 }],
          baseVersions: { n1: 3, n2: 2, n3: 1 },
          stack: [ {}, { modified: ['n-1v0'], props: { stringID: 'added a node' } } ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            assert.deepEqual(_calls, [
              [['n1', 3], ['n2', 2], ['n3', 1]],
              [['n1', undefined], ['n2', undefined], ['n3', undefined]],
              [['n2', 3]]
            ]);
            const base = _editor.base.graph;
            assert.strictEqual(base.entity('n1').version, 5);
            assert.strictEqual(base.entity('n2').version, 3);
            assert.isUndefined(base.hasEntity('n3'));
            assert.isOk(_editor.stable.graph.hasEntity('n-1'));
          });
      });

      it('rejects if the OSM API can\'t be reached, leaving the history empty', () => {
        useOsm([], true);
        const backup = {
          version: 4,
          entities: [{ id: 'n1', version: 1, loc: [0, 1], v: 1 }],
          baseVersions: { n1: 1 },
          stack: [ {}, { modified: ['n1v1'], props: { stringID: 'moved a node' } } ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => {
            assert.match(err.message, /offline/);
            assert.lengthOf(_editor.history, 1);
            assert.strictEqual(_editor.index, 0);
          });
      });

      it('fetches the child nodes a v3 backup is missing, at their current version', () => {
        useOsm([
          { type: 'node', id: 'n2', version: 7, visible: true, loc: [1, 0], tags: {}, current: true }
        ]);
        const backup = {
          version: 3,
          entities: [{ id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'path' }, v: 1 }],
          baseEntities: [{ id: 'n1', loc: [0, 0] }, { id: 'w1', nodes: ['n1', 'n2'] }],
          stack: [ {}, { modified: ['w1v1'], annotation: 'Changed the tags.' } ],
          nextIDs: {},
          index: 1
        };
        return _editor.fromBackupAsync(backup)
          .then(() => {
            assert.deepEqual(_calls, [ [['n2', undefined]] ]);
            assert.strictEqual(_editor.base.graph.entity('n2').version, 7);
            const graph = _editor.stable.graph;
            assert.deepEqual(graph.childNodes(graph.entity('w1')).map(n => n.id), ['n1', 'n2']);
          });
      });
    });

  });
});
