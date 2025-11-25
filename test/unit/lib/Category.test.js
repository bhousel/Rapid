import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Category', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    presets: new Rapid.PresetSystem(context)
  };

  const residential = new Rapid.Preset(context, { id: 'highway/residential', tags: { highway: 'residential' }, geometry: ['line'] });
  context.systems.presets.allPresets['highway/residential'] = residential;


  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.Category(context), /missing id/i);
    });

    it('constructs a Category from a context and props', () => {
      const props = {
        id: 'road',
        geometry: 'line',
        icon: 'highway',
        name: 'roads',
        members: [ 'highway/residential' ]
      };
      const a = new Rapid.Category(context, props);
      assert.instanceOf(a, Rapid.Category);
      assert.strictEqual(a.context, context);
    });
  });

  // Test an already-constructed Category..
  describe('methods', () => {
    const props = {
      id: 'road',
      geometry: 'line',
      icon: 'highway',
      name: 'roads',
      members: [ 'highway/residential' ]
    };
    const category = new Rapid.Category(context, props);

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

});
