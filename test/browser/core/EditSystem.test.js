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


describe('EditSystem', () => {
  describe('performAsync', () => {
    it('emits staging going back to stable when a frame throws', async () => {
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
      await editor.performAsync(action).catch(err => { error = err; });
      assert.match(error?.message ?? '', /boom/);

      assert.deepEqual(lastEmitted, editor.staging.graph.entity('n1').loc);
      assert.deepEqual(box(), before);
    });
  });
});
