import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { DrawLineMode } from '../../../modules/modes/DrawLineMode.ts';


describe('DrawLineMode', () => {
  let context, editor, mode, entered, jumps;

  function actionAddNode(nodeID) {
    return graph => graph.replace(new Rapid.OsmNode(context, { id: nodeID, loc: [0, 0] })).commit();
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    entered = [];
    jumps = [];

    const noop = () => {};
    const emitter = { on: () => emitter, off: () => emitter };

    editor = new Rapid.EditSystem(context);
    context.systems = {
      editor: editor,
      gfx: { eventManager: { setCursor: noop }, scene: { clearClass: noop, setClass: noop, layers: new Map() } },
      map: {   // selects what any other undo or redo would, which leaves this mode
        restoreJumpSelection: (prevIndex, currIndex) => {
          jumps.push([prevIndex, currIndex]);
          context.enter('select');
        }
      },
      spatial: new Rapid.SpatialSystem(context),
      storage: new Rapid.MockSystem(context)
    };
    context.behaviors = {
      draw: emitter,
      hover: emitter,
      mapInteraction: { doubleClickEnabled: true },
      mapNudge: emitter
    };
    context.enableBehaviors = noop;
    context.enter = modeID => {
      entered.push(modeID);
      mode.exit();
    };

    mode = new DrawLineMode(context);
    return editor.initAsync().then(() => editor.startAsync());
  });


  it('undo before the first click undoes the previous edit, and leaves draw mode the way any undo selects', () => {
    editor.perform(actionAddNode('n-1'));
    editor.commit({ annotation: 'added a node', selectionAfter: ['n-1'] });
    assert.strictEqual(editor.index, 1);

    assert.isTrue(mode.enter());
    editor.undo();

    assert.strictEqual(editor.index, 0);   // the undo stays done
    assert.isNotOk(editor.stable.graph.hasEntity('n-1'));
    assert.deepEqual(jumps, [[1, 0]]);     // MapSystem selects what was selected before the undone edit
    assert.deepEqual(entered, ['select']);
  });

  it('goes to browse mode when there\'s no MapSystem to select with', () => {
    delete context.systems.map;
    editor.perform(actionAddNode('n-1'));
    editor.commit({ annotation: 'added a node', selectionAfter: ['n-1'] });

    assert.isTrue(mode.enter());
    editor.undo();
    assert.deepEqual(entered, ['browse']);
  });

  it('cancelling undoes the edits made while drawing', () => {
    assert.isTrue(mode.enter());

    // As if the user had clicked twice: a line, committed, with its snapshot.
    editor.perform(graph => {
      graph.replace(new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] }));
      graph.replace(new Rapid.OsmNode(context, { id: 'n-2', loc: [0.001, 0] }));
      return graph.replace(new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1', 'n-2'] })).commit();
    });
    editor.commit({ annotation: 'started a line', selectionAfter: ['w-1'] });
    mode.drawWayID = 'w-1';
    mode._takeSnapshot('n-1', 'n-2');
    assert.strictEqual(editor.index, 1);

    mode._cancel();
    assert.strictEqual(editor.index, 0);
    assert.isNotOk(editor.stable.graph.hasEntity('w-1'));
  });

  it('redo before the first click redoes the next edit, and leaves draw mode', () => {
    editor.perform(actionAddNode('n-1'));
    editor.commit({ annotation: 'added a node', selectionAfter: ['n-1'] });
    editor.undo();

    assert.isTrue(mode.enter());
    editor.redo();

    assert.strictEqual(editor.index, 1);   // the redo stays done
    assert.isOk(editor.stable.graph.hasEntity('n-1'));
    assert.deepEqual(jumps, [[0, 1]]);
    assert.deepEqual(entered, ['select']);
  });
});
