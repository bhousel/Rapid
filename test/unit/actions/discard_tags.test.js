import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionDiscardTags', () => {
  const context = new Rapid.MockContext();
  const discardTags = { created_by: true };

  it('defaults to empty discardTags', () => {
    const way = new Rapid.OsmWay(context, { id: 'w1', tags: { created_by: 'Potlatch' } });
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base).replace(way);
    const action = Rapid.actionDiscardTags(new Rapid.Difference(base, graph));  // no discardTags
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.strictEqual(result.entity('w1'), way);
  });

  it('discards obsolete tags from modified entities', () => {
    const way = new Rapid.OsmWay(context, { id: 'w1', tags: { created_by: 'Potlatch' } });
    const base = new Rapid.Graph(context, [way]);
    const graph = new Rapid.Graph(base).replace(way.update({ tags: { created_by: 'Potlatch', foo: 'bar' } }));
    const action = Rapid.actionDiscardTags(new Rapid.Difference(base, graph), discardTags);
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w1').tags, {foo: 'bar'});
  });

  it('discards obsolete tags from created entities', () => {
    const way = new Rapid.OsmWay(context, { id: 'w1', tags: { created_by: 'Potlatch' } });
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base).replace(way);
    const action = Rapid.actionDiscardTags(new Rapid.Difference(base, graph), discardTags);
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w1').tags, {});
  });

  it('doesn\'t modify entities without obsolete tags', () => {
    const way = new Rapid.OsmWay(context, { id: 'w1' });
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base).replace(way);
    const action = Rapid.actionDiscardTags(new Rapid.Difference(base, graph), discardTags);
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.strictEqual(result.entity('w1'), way);
  });

  it('discards tags with empty values', () => {
    const way = new Rapid.OsmWay(context, { id: 'w1', tags: { lmnop: '' } });
    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base).replace(way);
    const action = Rapid.actionDiscardTags(new Rapid.Difference(base, graph), discardTags);
    const result = action(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w1').tags, {});
  });

});
