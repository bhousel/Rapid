import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionSyncCrossingTags', () => {
  const context = new Rapid.MockContext();

  it('synchronizes crossing tags between parent ways and child nodes', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { highway: 'crossing' } });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'footway', footway: 'crossing' } });
    const base = new Rapid.Graph(context, [n1, n2, w1]);
    const graph = new Rapid.Graph(base);

    const result = Rapid.actionSyncCrossingTags('w1')(graph);
    assert.instanceOf(result, Rapid.Graph);

    assert.isOk(result.hasEntity('n1'));
    assert.isOk(result.hasEntity('n2'));
    assert.isOk(result.hasEntity('w1'));
    assert.strictEqual(result.entity('n1').tags.highway, 'crossing');
    assert.strictEqual(result.entity('w1').tags.highway, 'footway');
    assert.strictEqual(result.entity('w1').tags.footway, 'crossing');
  });
});
