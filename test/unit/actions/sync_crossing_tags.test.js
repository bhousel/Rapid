import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionSyncCrossingTags', () => {
  const context = new Rapid.MockContext();

  it('synchronizes crossing tags between parent ways and child nodes', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { highway: 'crossing' } });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'footway', footway: 'crossing' } });
    const graph = new Rapid.Graph(context, [n1, n2, w1]);

    const result = Rapid.actionSyncCrossingTags('w1')(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.ok(result.hasEntity('n1'));
    assert.ok(result.hasEntity('n2'));
    assert.ok(result.hasEntity('w1'));
    assert.equal(result.entity('n1').tags.highway, 'crossing');
    assert.equal(result.entity('w1').tags.highway, 'footway');
    assert.equal(result.entity('w1').tags.footway, 'crossing');
  });
});
