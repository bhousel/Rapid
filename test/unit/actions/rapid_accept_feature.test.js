import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionRapidAcceptFeature', () => {
  const context = new Rapid.MockContext();

  it('accepts a node', () => {
    const fromGraph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] })
    ]);
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionRapidAcceptFeature('n-1', fromGraph)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('n-1'));
  });

  it('accepts a way', () => {
    const fromGraph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n-2', loc: [1, 1] }),
      new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1', 'n-2'] })
    ]);
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionRapidAcceptFeature('w-1', fromGraph)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('w-1'));
  });

  it('accepts a relation', () => {
    const fromGraph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] }),
      new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1'] }),
      new Rapid.OsmRelation(context, { id: 'r-1', members: [{ id: 'w-1' }] }),
    ]);
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionRapidAcceptFeature('r-1', fromGraph)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('r-1'));
  });
});
