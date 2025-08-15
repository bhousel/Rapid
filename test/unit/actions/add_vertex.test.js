import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionAddVertex', () => {
  const context = new Rapid.MockContext();

  it('adds a vertex to the specified way at the specified index', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 1] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionAddVertex('w1', 'n2', 1)(graph);
    assert.instanceOf(result, Rapid.Graph);

    const w1 = result.hasEntity('w1');
    assert.instanceOf(w1, Rapid.OsmWay);
    assert.deepEqual(w1.nodes, ['n1', 'n2']);
  });
});
