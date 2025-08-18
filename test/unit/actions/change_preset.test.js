import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionChangePreset', () => {
  const context = new Rapid.MockContext();
  const oldPreset = new Rapid.Preset(context, 'old', { tags: { old: 'true' } });
  const newPreset = new Rapid.Preset(context, 'new', { tags: { new: 'true' } });

  it('changes from one preset\'s tags to another\'s', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', tags: { old: 'true' } });
    const base = new Rapid.Graph(context, [n1]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionChangePreset('n1', oldPreset, newPreset);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('n1').tags, { new: 'true' });
  });

  it('adds the tags of a new preset to an entity without an old preset', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', tags: { } });
    const base = new Rapid.Graph(context, [n1]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionChangePreset('n1', null, newPreset);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('n1').tags, { new: 'true' });
  });

  it('removes the tags of an old preset from an entity without a new preset', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', tags: { old: 'true' } });
    const base = new Rapid.Graph(context, [n1]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionChangePreset('n1', oldPreset, null);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('n1').tags, {});
  });


  it('syncs crossing tags if changing a crossing preset', () => {
    //
    //       n4         w1: [n1, n2, n3],  untagged line we will apply the crossing preset to
    //        |         w2: [n4, n2, n5],  highway=primary
    // n1 -- n2 -- n3
    //        |
    //       n5
    //
    const n2before = { highway: 'crossing' };
    const w2before = { highway: 'primary' };
    const newPreset = new Rapid.Preset(context, 'crossing', { tags: { highway: 'footway', footway: 'crossing', 'crossing:markings': 'zebra' } });

    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [-1,  0], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [ 0,  0], tags: n2before }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [ 1,  0], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [ 0,  1], tags: {} }),
      new Rapid.OsmNode(context, { id: 'n5', loc: [ 0, -1], tags: {} }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: {} }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5'], tags: w2before })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionChangePreset('w1', null, newPreset)(graph);
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
});
