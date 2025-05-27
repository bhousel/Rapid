import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionUnrestrictTurn', () => {
  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();

  it('removes a restriction from a restricted turn', () => {
    //
    // u === * --- w
    //
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'u' }),
      new Rapid.OsmNode(context, { id: '*' }),
      new Rapid.OsmNode(context, { id: 'w' }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['u', '*'], tags: { highway: 'residential' } }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['*', 'w'], tags: { highway: 'residential' } }),
      new Rapid.OsmRelation(context, {
        id: 'r',
        tags: { type: 'restriction' },
        members: [
          { id: '=', role: 'from', type: 'way' },
          { id: '-', role: 'to', type: 'way' },
          { id: '*', role: 'via', type: 'node' }
        ]
      })
    ]);
    const action = Rapid.actionUnrestrictTurn({ restrictionID: 'r' });
    const result = action(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.equal(result.hasEntity('r'), undefined);
  });
});
