import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionRapidAcceptFeature', () => {
  const context = new Rapid.MockContext();

  it('accepts a node', () => {
    const fromGraph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] })
    ]);
    const result = Rapid.actionRapidAcceptFeature('n-1', fromGraph)(new Rapid.Graph());
    assert.ok(result.hasEntity('n-1'));
  });

  it('accepts a way', () => {
    const fromGraph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n-2', loc: [1, 1] }),
      new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1', 'n-2'] })
    ]);
    const result = Rapid.actionRapidAcceptFeature('w-1', fromGraph)(new Rapid.Graph());
    assert.ok(result.hasEntity('w-1'));
  });

  it('accepts a relation', () => {
    const fromGraph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] }),
      new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1'] }),
      new Rapid.OsmRelation(context, { id: 'r-1', members: [{ id: 'w-1' }] }),
    ]);
    const result = Rapid.actionRapidAcceptFeature('r-1', fromGraph)(new Rapid.Graph());
    assert.ok(result.hasEntity('r-1'));
  });
});
