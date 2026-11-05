import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { DragNodeMode } from '../../../modules/modes/DragNodeMode.ts';


describe('DragNodeMode', () => {
  let context, graph, mode, commits, entered;

  beforeEach(() => {
    context = new Rapid.MockContext();
    graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] })
    ]);
    commits = [];
    entered = [];

    const noop = () => {};
    const emitter = { on: () => emitter, off: () => emitter, allow: noop };

    context.systems = {
      editor: { staging: { graph: graph }, commit: props => commits.push(props) },
      filters: { hasHiddenConnections: () => false },
      gfx: { scene: { setClass: noop, clearClass: noop } },
      l10n: { t: id => id },
      ui: {}
    };
    context.behaviors = {
      drag: { ...emitter, lastDown: { coord: { world: [0, 0] } } },
      mapNudge: emitter
    };
    context.enableBehaviors = noop;
    context.enter = (modeID, options) => entered.push([modeID, options]);

    mode = new DragNodeMode(context);
  });


  it('records what was selected when the drag started as the edit\'s `selectionBefore`', () => {
    assert.isTrue(mode.enter({ nodeID: 'n1', reselectIDs: ['w1'], selectionBefore: ['w1'] }));
    assert.deepEqual(mode.selectedIDs, ['n1']);       // the node being dragged
    assert.deepEqual(mode.selectionBefore, ['w1']);   // undo while dragging goes back to this

    mode._end({ coord: { world: [0, 0] } });
    assert.lengthOf(commits, 1);
    assert.deepEqual(commits[0].selectionAfter, ['w1']);   // what it selects next, so redo selects it too
    assert.deepEqual(commits[0].selectionBefore, ['w1']);
    assert.deepEqual(entered, [['select', { selection: ['w1'] }]]);
  });

  it('records an empty `selectionBefore` for a drag that started with nothing selected', () => {
    mode.enter({ nodeID: 'n1', selectionBefore: [] });
    mode._end({ coord: { world: [0, 0] } });
    assert.deepEqual(commits[0].selectionBefore, []);
  });
});
