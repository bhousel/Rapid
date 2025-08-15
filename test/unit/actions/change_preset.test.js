import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionChangePreset', () => {
  const context = new Rapid.MockContext();
  const oldPreset = new Rapid.Preset(context, 'old', { tags: { old: 'true' } });
  const newPreset = new Rapid.Preset(context, 'new', { tags: { new: 'true' } });

  it('changes from one preset\'s tags to another\'s', () => {
    const entity = new Rapid.OsmNode(context, { tags: { old: 'true' } });
    const base = new Rapid.Graph(context, [entity]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionChangePreset(entity.id, oldPreset, newPreset);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity(entity.id).tags, { new: 'true' });
  });

  it('adds the tags of a new preset to an entity without an old preset', () => {
    const entity = new Rapid.OsmNode(context);
    const base = new Rapid.Graph(context, [entity]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionChangePreset(entity.id, null, newPreset);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity(entity.id).tags, { new: 'true' });
  });

  it('removes the tags of an old preset from an entity without a new preset', () => {
    const entity = new Rapid.OsmNode(context, { tags: { old: 'true' } });
    const base = new Rapid.Graph(context, [entity]);
    const graph = new Rapid.Graph(base);
    const action = Rapid.actionChangePreset(entity.id, oldPreset, null);
    const result = action(graph);

    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity(entity.id).tags, {});
  });
});
