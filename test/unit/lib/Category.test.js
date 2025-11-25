import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Category', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:     new Rapid.AssetSystem(context),
    l10n:       new Rapid.LocalizationSystem(context),
    presets:    new Rapid.PresetSystem(context)
  };

  const residential = new Rapid.Preset(context, 'highway/residential', { tags: { highway: 'residential' }, geometry: ['line'] });
  context.systems.presets.allPresets['highway/residential'] = residential;

  const props = {
    'geometry': 'line',
    'icon': 'highway',
    'name': 'roads',
    'members': [ 'highway/residential' ]
  };
  const category = new Rapid.Category(context, 'road', props);

  it('maps members names to preset instances', () => {
    assert.instanceOf(category.members, Rapid.Collection);
    assert.deepEqual(category.members.array[0], residential);
  });

  describe('matchGeometry', () => {
    it('matches the type of an entity', () => {
      assert.isTrue(category.matchGeometry('line'));
      assert.isFalse(category.matchGeometry('point'));
    });
  });
});
