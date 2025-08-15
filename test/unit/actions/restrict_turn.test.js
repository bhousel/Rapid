import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionRestrictTurn', () => {
  const context = new Rapid.MockContext();

  it('adds a via node restriction to an unrestricted turn', () => {
    //
    // u === * --- w
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'u' }),
      new Rapid.OsmNode(context, { id: '*' }),
      new Rapid.OsmNode(context, { id: 'w' }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['u', '*'] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['*', 'w'] })
    ]);
    const graph = new Rapid.Graph(base);

    const turn = {
      from: { node: 'u', way: '=' },
      via: { node: '*' },
      to: { node: 'w', way: '-' }
    };

    const action = Rapid.actionRestrictTurn(turn, 'no_straight_on', 'r');
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);

    const r = result.entity('r');
    assert.deepEqual(r.tags, { type: 'restriction', restriction: 'no_straight_on' });

    const f = r.memberByRole('from');
    assert.strictEqual(f.id, '=');
    assert.strictEqual(f.type, 'way');

    const v = r.memberByRole('via');
    assert.strictEqual(v.id, '*');
    assert.strictEqual(v.type, 'node');

    const t = r.memberByRole('to');
    assert.strictEqual(t.id, '-');
    assert.strictEqual(t.type, 'way');
  });


  it('adds a via way restriction to an unrestricted turn', () => {
    //
    // u === v1
    //       |
    // w --- v2
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'u' }),
      new Rapid.OsmNode(context, { id: 'v1' }),
      new Rapid.OsmNode(context, { id: 'v2' }),
      new Rapid.OsmNode(context, { id: 'w' }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['u', 'v1'] }),
      new Rapid.OsmWay(context, { id: '|', nodes: ['v1', 'v2'] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['v2', 'w'] })
    ]);
    const graph = new Rapid.Graph(base);

    const turn = {
      from: { node: 'u', way: '=' },
      via: { ways: ['|'] },
      to: { node: 'w', way: '-' }
    };

    const action = Rapid.actionRestrictTurn(turn, 'no_u_turn', 'r');
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);

    const r = result.entity('r');
    assert.deepEqual(r.tags, { type: 'restriction', restriction: 'no_u_turn' });

    const f = r.memberByRole('from');
    assert.strictEqual(f.id, '=');
    assert.strictEqual(f.type, 'way');

    const v = r.memberByRole('via');
    assert.strictEqual(v.id, '|');
    assert.strictEqual(v.type, 'way');

    const t = r.memberByRole('to');
    assert.strictEqual(t.id, '-');
    assert.strictEqual(t.type, 'way');
  });
});
