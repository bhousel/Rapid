import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionChangeTags', () => {
  const context = new Rapid.MockContext();

  it('changes an entity\'s tags', () => {
    const entity = new Rapid.OsmEntity(context);
    const setTags = { foo: 'bar' };
    const base = new Rapid.Graph(context, [entity]);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionChangeTags(entity.id, setTags)(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity(entity.id).tags, setTags);
  });
});
