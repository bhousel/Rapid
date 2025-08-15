import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionUnrestrictTurn', () => {
  const context = new Rapid.MockContext();

  it('removes a restriction from a restricted turn', () => {
    //
    // u === * --- w
    //
    const base = new Rapid.Graph(context, [
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
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionUnrestrictTurn({ restrictionID: 'r' })(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isUndefined(result.hasEntity('r'));
  });
});
