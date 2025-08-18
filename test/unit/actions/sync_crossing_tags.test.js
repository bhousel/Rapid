import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionSyncCrossingTags', () => {
  const context = new Rapid.MockContext();

  it('synchronizes parent way to child node', () => {
    //
    //       n4         w1: [n1, n2, n3],  highway=crossing
    //        |         w2: [n4, n2, n5],  highway=primary
    // n1 -- n2 -- n3
    //        |
    //       n5
    //
    const n2before = { highway: 'crossing' };
    const w1before = { highway: 'footway', footway: 'crossing', 'crossing:markings': 'zebra' };
    const w2before = { highway: 'primary' };

    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [-1,  0], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [ 0,  0], tags: n2before }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [ 1,  0], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [ 0,  1], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n5', loc: [ 0, -1], tags: {} }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: w1before }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5'], tags: w2before })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionSyncCrossingTags('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);

    // n2: 'crossing:markings=zebra' synced from w1, legacy 'crossing=marked' tag added
    const n2after = { highway: 'crossing', 'crossing': 'marked', 'crossing:markings': 'zebra' };
    // w1: legacy 'crossing=marked' tag added
    const w1after = { highway: 'footway', footway: 'crossing', 'crossing': 'marked', 'crossing:markings': 'zebra' };
    // w2: no change to the tagging of the road
    const w2after = w2before;

    assert.deepEqual(result.entity('n2').tags, n2after);
    assert.deepEqual(result.entity('w1').tags, w1after);
    assert.deepEqual(result.entity('w2').tags, w2after);
  });

  it('synchronizes child node to parent way', () => {
    //
    //       n4         w1: [n1, n2, n3],  highway=crossing
    //        |         w2: [n4, n2, n5],  highway=primary
    // n1 -- n2 -- n3
    //        |
    //       n5
    //
    const n2before = { highway: 'crossing', 'crossing:markings': 'zebra' };
    const w1before = { highway: 'footway', footway: 'crossing' };
    const w2before = { highway: 'primary' };

    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [-1,  0], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [ 0,  0], tags: n2before }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [ 1,  0], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [ 0,  1], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n5', loc: [ 0, -1], tags: {} }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: w1before }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5'], tags: w2before })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionSyncCrossingTags('n2')(graph);
    assert.instanceOf(result, Rapid.Graph);

    // n2: legacy 'crossing=marked' tag added
    const n2after = { highway: 'crossing', 'crossing': 'marked', 'crossing:markings': 'zebra' };
    // w1: 'crossing:markings=zebra' synced from n1, legacy 'crossing=marked' tag added
    const w1after = { highway: 'footway', footway: 'crossing', 'crossing': 'marked', 'crossing:markings': 'zebra' };
    // w2: no change to the tagging of the road
    const w2after = w2before;

    assert.deepEqual(result.entity('n2').tags, n2after);
    assert.deepEqual(result.entity('w1').tags, w1after);
    assert.deepEqual(result.entity('w2').tags, w2after);
  });
});
