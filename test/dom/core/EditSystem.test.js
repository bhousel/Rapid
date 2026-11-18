import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


async function makeEditor() {
  const context = new Rapid.MockContext();
  const spatial = new Rapid.SpatialSystem(context);
  context.systems = {
    spatial: spatial,
    storage: new Rapid.MockSystem(context)
  };
  const editor = new Rapid.EditSystem(context);
  context.systems.editor = editor;
  await editor.initAsync();
  await editor.startAsync();
  return { context, editor, spatial };
}


// A way to animate: move n1 from [0, 0] to [0, 0.01]
async function makeMove() {
  const { context, editor, spatial } = await makeEditor();
  editor.merge([
    new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
    new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1, tags: {} })
  ]);
  const action = Rapid.actionMoveNode('n1', [0, 0.01]);
  action.transitionable = true;
  return { context, editor, spatial, action };
}

const nextFrame = () => new Promise(resolve => { setTimeout(resolve, 40); });


describe('EditSystem', () => {
  describe('animateAndCommitAsync', () => {
    it('animates, then commits the action as its own edit', async () => {
      const { editor, action } = await makeMove();
      const locs = [];
      editor.on('stagingchange', () => locs.push(editor.staging.graph.entity('n1').loc[1]));

      await editor.animateAndCommitAsync(action, { stringID: 'moved' });

      assert.isAbove(locs.filter(y => y > 0 && y < 0.01).length, 0, 'some frames were in between');
      assert.strictEqual(editor.index, 1);
      assert.strictEqual(editor.stable.props.stringID, 'moved');
      assert.deepEqual(editor.stable.graph.entity('n1').loc, [0, 0.01]);
      assert.isFalse(editor.hasWorkInProgress);
    });

    it('commits the action before an undo while it animates, so the undo undoes it', async () => {
      const { editor, action } = await makeMove();

      const prom = editor.animateAndCommitAsync(action, { stringID: 'moved' });
      await nextFrame();
      assert.isTrue(editor.hasWorkInProgress, 'it is animating');
      editor.undo();
      await prom;

      assert.lengthOf(editor.history, 2);
      assert.strictEqual(editor.index, 0);
      assert.deepEqual(editor.stable.graph.entity('n1').loc, [0, 0]);
      editor.redo();
      assert.strictEqual(editor.stable.props.stringID, 'moved');
      assert.deepEqual(editor.stable.graph.entity('n1').loc, [0, 0.01]);
    });

    it('commits the action before another edit while it animates, so each is its own edit', async () => {
      const { editor, action } = await makeMove();

      const prom = editor.animateAndCommitAsync(action, { stringID: 'moved' });
      await nextFrame();
      assert.isTrue(editor.hasWorkInProgress, 'it is animating');
      editor.perform(Rapid.actionChangeTags('n2', { name: 'B' }));
      editor.commit({ stringID: 'tagged' });
      await prom;

      assert.deepEqual(editor.history.map(edit => edit.props.stringID), [undefined, 'moved', 'tagged']);
      const moved = editor.history[1].graph;
      assert.deepEqual(moved.entity('n1').loc, [0, 0.01]);
      assert.deepEqual(moved.entity('n2').tags, {});
      assert.isFalse(editor._inTransition, 'backups can run again');
    });

    it('commits the action even when interrupted before it starts', async () => {
      const { editor, action } = await makeMove();

      const prom = editor.animateAndCommitAsync(action, { stringID: 'moved' });
      editor.undo();   // same tick: the transition hasn't started
      await prom;

      assert.lengthOf(editor.history, 2);
      assert.strictEqual(editor.index, 0);
      assert.isFalse(editor._inTransition);
    });

    it('doesn\'t animate in a transaction', async () => {
      const { editor, action } = await makeMove();

      editor.beginTransaction();
      const prom = editor.animateAndCommitAsync(action, { stringID: 'moved' });
      assert.strictEqual(editor.index, 1);   // committed already
      editor.endTransaction();
      await prom;
      assert.deepEqual(editor.stable.graph.entity('n1').loc, [0, 0.01]);
    });

    it('emits staging going back to stable when a frame throws, and commits nothing', async () => {
      const { context, editor, spatial } = await makeEditor();
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], version: 1 })
      ]);
      // The box staging's searches use for w1: staging's own (its local index), else the base's
      const box = () => {
        const item = spatial.getCache('editor_staging').items.get('w1') ?? spatial.getCache('editor_base').items.get('w1');
        return [item.minX, item.minY, item.maxX, item.maxY];
      };
      const before = box();

      let lastEmitted = null;
      editor.on('stagingchange', () => { lastEmitted = editor.staging.graph.entity('n1').loc; });

      const move = Rapid.actionMoveNode('n1', [0, 0.01]);
      const action = (graph, t) => {
        if (t > 0.5) throw new Error('boom');
        return move(graph, t);
      };
      action.transitionable = true;

      let error;
      await editor.animateAndCommitAsync(action, { stringID: 'moved' }).catch(err => { error = err; });
      assert.match(error?.message ?? '', /boom/);

      assert.deepEqual(lastEmitted, editor.staging.graph.entity('n1').loc);
      assert.deepEqual(box(), before);
      assert.strictEqual(editor.index, 0);
      assert.isFalse(editor._inTransition);
    });
  });
});
