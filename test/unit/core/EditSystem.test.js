import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import sinon from 'sinon';
import * as Rapid from '../../../modules/headless.js';


describe('EditSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.MockSystem(context)
  };

  let _editor;

  function actionAddNode(nodeID) {
    return (graph) => graph.replace(new Rapid.OsmNode(context, { id: nodeID })).commit();
  }

  function actionTransitionNoop() {
    const action = (graph, t) => graph;
    action.transitionable = true;
    return action;
  }

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
    _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });

    _editor.perform(Rapid.actionChangeTags('n2', { natural: 'tree' } ));
    _editor.commit({ annotation: 'updated n2', selectedIDs: ['n2'] });

    _editor.perform(Rapid.actionDeleteNode('n3'));
    _editor.commit({ annotation: 'deleted n3', selectedIDs: [] });
  }


  beforeEach(() => {
    _editor = new Rapid.EditSystem(context);
    return _editor.initAsync();
  });


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
    it('returns an promise to init', () => {
      const editor = new Rapid.EditSystem(context);
      const prom = editor.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const editor = new Rapid.EditSystem(context);
      editor.requiredDependencies.add('missing');
      const prom = editor.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const editor = new Rapid.EditSystem(context);
      const prom = editor.initAsync().then(() => editor.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(editor.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });


  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const editor = new Rapid.EditSystem(context);
      const prom = editor.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('clears the history stack', () => {
      _editor.commit({ annotation: 'one' });
      _editor.commit({ annotation: 'two' });
      _editor.undo();

      const prom = _editor.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(() => {
          assert.isArray(_editor._history, Array);
          assert.lengthOf(_editor._history, 1);
          assert.strictEqual(_editor._index, 0);
        });
    });

    it('emits events', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      const onHistoryJump = sinon.spy();
      const onBackupStatusChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);
      _editor.on('historyjump', onHistoryJump);
      _editor.on('backupstatuschange', onBackupStatusChange);

      const prom = _editor.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(() => {
          assert.isOk(onStagingChange.calledOnceWithExactly(_editor._fullDifference));
          assert.isOk(onStableChange.calledOnceWithExactly(_editor._fullDifference));
          assert.isOk(onHistoryJump.calledOnceWithExactly(0, 0));
          assert.isOk(onBackupStatusChange.calledOnceWithExactly(true));
        });
    });
  });


  describe('base', () => {
    it('returns the base edit', () => {
      assert.instanceOf(_editor.base, Rapid.Edit);
      assert.strictEqual(_editor.base, _editor._history[0]);
    });
  });

  describe('stable', () => {
    it('returns the stable edit', () => {
      _editor.commit({ annotation: 'one' });
      assert.instanceOf(_editor.stable, Rapid.Edit);
      assert.strictEqual(_editor.stable, _editor._history[1]);
    });
  });

  describe('staging', () => {
    it('returns the staging edit', () => {
      _editor.commit({ annotation: 'one' });
      assert.instanceOf(_editor.staging, Rapid.Edit);
      assert.notStrictEqual(_editor.staging, _editor.stable);
      assert.notStrictEqual(_editor.staging, _editor.base);
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
      const onMerge = sinon.spy();
      _editor.on('merge', onMerge);
      _editor.merge([n]);
      assert.isTrue(onMerge.calledOnceWith(new Set([n.id])));
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
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      const action = Rapid.actionNoop();
      const difference = _editor.perform(action);
      assert.isTrue(onStagingChange.calledOnceWithExactly(difference));
      assert.isTrue(onStableChange.notCalled);
    });

    it('performs multiple actions, emits a single stagingchange event', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      const action1 = actionAddNode('n-1');
      const action2 = actionAddNode('n-2');
      const difference = _editor.perform(action1, action2);
      assert.isTrue(onStagingChange.calledOnceWithExactly(difference));
      assert.isTrue(onStableChange.notCalled);
    });
  });


  describe('performAsync', () => {
    it('returns a rejected Promise when passed no args', () => {
      const prom = _editor.performAsync();
      assert.instanceOf(prom, Promise);
      return prom.then(
        () => {
          assert.fail('Promise was fulfilled but should have been rejected');
        },
        () => {
          assert.isTrue(true);
        }
      );
    });

    it('returns a resolved Promise when passed a non-transitionable action', () => {
      const action = actionAddNode('n-1');
      const prom = _editor.performAsync(action);
      assert.instanceOf(prom, Promise);
      return prom.then(
        () => {
          assert.isOk(_editor.staging.graph.hasEntity('n-1'));
        },
        () => {
          assert.fail('Promise was rejected but should have been fulfilled');
        }
      );
    });

    it('returns a Promise to perform transitionable action, emits stagingchange events only', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      const action = actionTransitionNoop();
      const prom = _editor.performAsync(action);
      assert.instanceOf(prom, Promise);
      return prom.then(
        () => {
          assert.isAbove(onStagingChange.callCount, 2);
          assert.isTrue(onStableChange.notCalled);
        },
        () => {
          assert.fail('Promise was rejected but should have been fulfilled');
        }
      );
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

      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      _editor.revert();
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 0);
    });

    it('does nothing if no work in progress', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      const staging = _editor.staging;
      const stable = _editor.stable;

      _editor.revert();
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);
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
      _editor.commit({ annotation: 'added a node', selectedIDs: ['n-1'] });

      assert.lengthOf(_editor.history, 2);
      assert.strictEqual(_editor.index, 1);
      assert.isOk(_editor.staging.graph.hasEntity('n-1'));
      assert.isUndefined(_editor.staging.graph.hasEntity('n-2'));

      _editor.perform(actionAddNode('n-2'));
      _editor.commit({ annotation: 'added a node', selectedIDs: ['n-2'] });

      assert.lengthOf(_editor.history, 3);
      assert.strictEqual(_editor.index, 2);
      assert.isOk(_editor.staging.graph.hasEntity('n-1'));
      assert.isOk(_editor.staging.graph.hasEntity('n-2'));
    });

    it('emits stagingchange and stablechange events', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added a node', selectedIDs: ['n-1'] });
      assert.strictEqual(onStagingChange.callCount, 2);
      assert.strictEqual(onStableChange.callCount, 1);

      _editor.perform(actionAddNode('n-2'));
      assert.strictEqual(onStagingChange.callCount, 3);
      assert.strictEqual(onStableChange.callCount, 1);

      _editor.commit({ annotation: 'added a node', selectedIDs: ['n-2'] });
      assert.strictEqual(onStagingChange.callCount, 4);
      assert.strictEqual(onStableChange.callCount, 2);
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
      _editor.commit({ annotation: 'added a node', selectedIDs: ['n-1'] });

      assert.lengthOf(_editor.history, 2);
      assert.strictEqual(_editor.index, 1);
      assert.isOk(_editor.staging.graph.hasEntity('n-1'));
      assert.isUndefined(_editor.staging.graph.hasEntity('n-2'));

      _editor.perform(actionAddNode('n-2'));
      _editor.commitAppend({ annotation: 'added a node', selectedIDs: ['n-2'] });  // commitAppend

      assert.lengthOf(_editor.history, 2);   // still 2
      assert.strictEqual(_editor.index, 1);  // still 1
      assert.isOk(_editor.staging.graph.hasEntity('n-1'));
      assert.isOk(_editor.staging.graph.hasEntity('n-2'));
    });

    it('emits stagingchange and stablechange events', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added a node', selectedIDs: ['n-1'] });
      assert.strictEqual(onStagingChange.callCount, 2);
      assert.strictEqual(onStableChange.callCount, 1);

      _editor.perform(actionAddNode('n-2'));
      assert.strictEqual(onStagingChange.callCount, 3);
      assert.strictEqual(onStableChange.callCount, 1);

      _editor.commitAppend({ annotation: 'added a node', selectedIDs: ['n-2'] });  // commitAppend
      assert.strictEqual(onStagingChange.callCount, 4);
      assert.strictEqual(onStableChange.callCount, 2);
    });
  });


  describe('undo / #redo', () => {
    it('can undo and redo edits', () => {
      _editor.perform(actionAddNode('n-1'));
      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      _editor.perform(actionAddNode('n-2'));
      _editor.commit({ annotation: 'added n-2', selectedIDs: ['n-2'] });
      _editor.perform(actionAddNode('n-3'));
      _editor.commit({ annotation: 'added n-3', selectedIDs: ['n-3'] });

      assert.strictEqual(_editor.getUndoAnnotation(), 'added n-3');
      assert.isUndefined(_editor.getRedoAnnotation());
      assert.isOk(_editor.stable.graph.hasEntity('n-3'));

      _editor.undo();

      assert.strictEqual(_editor.getUndoAnnotation(), 'added n-2');
      assert.strictEqual(_editor.getRedoAnnotation(), 'added n-3');
      assert.isUndefined(_editor.stable.graph.hasEntity('n-3'));

      _editor.redo();

      assert.strictEqual(_editor.getUndoAnnotation(), 'added n-3');
      assert.isUndefined(_editor.getRedoAnnotation());
      assert.isOk(_editor.stable.graph.hasEntity('n-3'));
    });

    it('emits stagingchange, stablechange, and historyjump events', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      const onHistoryJump = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);
      _editor.on('historyjump', onHistoryJump);

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 0);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      assert.strictEqual(onStagingChange.callCount, 2);
      assert.strictEqual(onStableChange.callCount, 1);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.perform(actionAddNode('n-2'));
      assert.strictEqual(onStagingChange.callCount, 3);
      assert.strictEqual(onStableChange.callCount, 1);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.commit({ annotation: 'added n-2', selectedIDs: ['n-2'] });
      assert.strictEqual(onStagingChange.callCount, 4);
      assert.strictEqual(onStableChange.callCount, 2);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.perform(actionAddNode('n-3'));
      assert.strictEqual(onStagingChange.callCount, 5);
      assert.strictEqual(onStableChange.callCount, 2);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.commit({ annotation: 'added n-3', selectedIDs: ['n-3'] });
      assert.strictEqual(onStagingChange.callCount, 6);
      assert.strictEqual(onStableChange.callCount, 3);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.undo();
      assert.strictEqual(onStagingChange.callCount, 7);
      assert.strictEqual(onStableChange.callCount, 4);
      assert.strictEqual(onHistoryJump.callCount, 1);

      _editor.redo();
      assert.strictEqual(onStagingChange.callCount, 8);
      assert.strictEqual(onStableChange.callCount, 5);
      assert.strictEqual(onHistoryJump.callCount, 2);
    });

    it('does nothing if nothing to undo', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      const onHistoryJump = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);
      _editor.on('historyjump', onHistoryJump);

      _editor.undo();
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);
      assert.strictEqual(onHistoryJump.callCount, 0);
    });

    it('does nothing if nothing to redo', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      const onHistoryJump = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);
      _editor.on('historyjump', onHistoryJump);

      _editor.redo();
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);
      assert.strictEqual(onHistoryJump.callCount, 0);
    });
  });


  describe('setCheckpoint / #restoreCheckpoint', () => {
    it('can set and restore checkpoints', () => {
      _editor.perform(actionAddNode('n-1'));
      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });

      _editor.setCheckpoint('checkpoint');

      _editor.perform(actionAddNode('n-2'));
      _editor.commit({ annotation: 'added n-2', selectedIDs: ['n-2'] });
      _editor.perform(actionAddNode('n-3'));
      _editor.commit({ annotation: 'added n-3', selectedIDs: ['n-3'] });

      _editor.restoreCheckpoint('checkpoint');

      assert.strictEqual(_editor.getUndoAnnotation(), 'added n-1');
      assert.isUndefined(_editor.getRedoAnnotation());
      assert.isOk(_editor.stable.graph.hasEntity('n-1'));
      assert.isUndefined(_editor.stable.graph.hasEntity('n-2'));
      assert.isUndefined(_editor.stable.graph.hasEntity('n-3'));
    });

    it('emits stagingchange, stablechange, and historyjump events', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      const onHistoryJump = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);
      _editor.on('historyjump', onHistoryJump);

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 0);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      _editor.setCheckpoint('checkpoint');
      assert.strictEqual(onStagingChange.callCount, 2);
      assert.strictEqual(onStableChange.callCount, 1);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.perform(actionAddNode('n-2'));
      assert.strictEqual(onStagingChange.callCount, 3);
      assert.strictEqual(onStableChange.callCount, 1);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.commit({ annotation: 'added n-2', selectedIDs: ['n-2'] });
      assert.strictEqual(onStagingChange.callCount, 4);
      assert.strictEqual(onStableChange.callCount, 2);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.perform(actionAddNode('n-3'));
      assert.strictEqual(onStagingChange.callCount, 5);
      assert.strictEqual(onStableChange.callCount, 2);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.commit({ annotation: 'added n-3', selectedIDs: ['n-3'] });
      assert.strictEqual(onStagingChange.callCount, 6);
      assert.strictEqual(onStableChange.callCount, 3);
      assert.strictEqual(onHistoryJump.callCount, 0);

      _editor.restoreCheckpoint('checkpoint');
      assert.strictEqual(onStagingChange.callCount, 7);
      assert.strictEqual(onStableChange.callCount, 4);
      assert.strictEqual(onHistoryJump.callCount, 1);
    });

    it('does nothing if checkpointID is missing or invalid', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      const onHistoryJump = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);
      _editor.on('historyjump', onHistoryJump);

      _editor.restoreCheckpoint();
      _editor.restoreCheckpoint('fake');
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);
      assert.strictEqual(onHistoryJump.callCount, 0);
    });
  });


  describe('beginTransaction / #endTransaction', () => {
    it('prevents change events from getting dispatched in a transaction', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      _editor.beginTransaction();

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.perform(actionAddNode('n-2'));
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added n-2', selectedIDs: ['n-2'] });
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.endTransaction();   // events emit here
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 1);

      // diff should contain all things changed during the transaction
      const diff = onStagingChange.lastCall.firstArg;
      assert.instanceOf(diff, Rapid.Difference);
      assert.instanceOf(diff.changes, Map);
      assert.hasAllKeys(diff.changes, ['n-1', 'n-2']);
    });

    it('does nothing if endTransaction called without beginTransaction', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      _editor.endTransaction();

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      assert.strictEqual(onStagingChange.callCount, 2);
      assert.strictEqual(onStableChange.callCount, 1);
    });

    it('uses earliest difference if beginTransaction called multiple times', () => {
      const onStagingChange = sinon.spy();
      const onStableChange = sinon.spy();
      _editor.on('stagingchange', onStagingChange);
      _editor.on('stablechange', onStableChange);

      _editor.beginTransaction();

      _editor.perform(actionAddNode('n-1'));
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      // This beginTransaction has no effect - we are already in a transaction
      _editor.beginTransaction();

      _editor.perform(actionAddNode('n-2'));
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.commit({ annotation: 'added n-2', selectedIDs: ['n-2'] });
      assert.strictEqual(onStagingChange.callCount, 0);
      assert.strictEqual(onStableChange.callCount, 0);

      _editor.endTransaction();   // events emit here
      assert.strictEqual(onStagingChange.callCount, 1);
      assert.strictEqual(onStableChange.callCount, 1);

      // diff should contain all things changed during the transaction
      const diff = onStagingChange.lastCall.firstArg;
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


  describe('toJSON', () => {
    it('doesn\'t generate unsaveable changes', () => {
      _editor.perform(actionAddNode('n-1'));
      _editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });
      _editor.perform(Rapid.actionDeleteNode('n-1'));
      _editor.commit({ annotation: 'deleted n-1', selectedIDs: [] });

      assert.isUndefined(_editor.toJSON());
    });

    it('generates v3 JSON', () => {
      prepareTestHistory();

      const node_1_json = { id: 'n-1' };  // without `visible: true`
      const node1_json = { id: 'n1' };
      const node2_json = { id: 'n2' };
      const node3_json = { id: 'n3' };
      const node2upd = _editor.stable.graph.entity('n2');
      const node2upd_json = { id: 'n2', tags: { natural: 'tree' }, v: node2upd.v };

      const json = JSON.parse(_editor.toJSON());
      assert.strictEqual(json.version, 3);

      // base entities - before all edits
      assert.notDeepInclude(json.baseEntities, node_1_json);    // n-1 was not in the base
      assert.notDeepInclude(json.baseEntities, node1_json);     // n1 was never edited
      assert.deepInclude(json.baseEntities, node2_json);        // n2 is in base and was edited
      assert.deepInclude(json.baseEntities, node3_json);        // n3 is in base and was edited
      assert.notDeepInclude(json.baseEntities, node2upd_json);

      // edited entities
      assert.deepInclude(json.entities, node_1_json);     // n-1 was added
      assert.deepInclude(json.entities, node2upd_json);   // n2 was updated
      assert.notDeepInclude(json.entities, node1_json);   // n1 was never updated
      assert.notDeepInclude(json.entities, node2_json);   // n2 is in the base, not here
      assert.notDeepInclude(json.entities, node3_json);   // n3 is now deleted
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
          assert.strictEqual(_editor.getUndoAnnotation(), 'Added a point.');
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
          assert.strictEqual(_editor.getUndoAnnotation(), 'Moved a point.');
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
          assert.strictEqual(_editor.getUndoAnnotation(), 'Deleted a point.');
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
});
