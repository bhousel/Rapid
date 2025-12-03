import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Category', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    presets: new Rapid.PresetSystem(context)
  };

  const presets = context.systems.presets;

  beforeAll(() => {
    return presets.initAsync().then(() => {
      const presetData = {
        presets: {
          'highway/residential': {
            tags: { highway: 'residential' },
            geometry: ['line']
          }
        }
      };
      presets.merge(presetData);
    });
  });


  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.Category(context), /missing id/i);
    });

    it('constructs a Category from a context and props', () => {
      const props = {
        id: 'road',
        icon: 'rapid-highway-unclassified',
        name: 'Minor Roads',
        members: ['highway/residential']
      };

      const category = new Rapid.Category(context, props);
      assert.instanceOf(category, Rapid.Category);
      assert.strictEqual(category.context, context);
    });
  });

  // Test an already-constructed Category..
  describe('methods', () => {
    const props = {
      id: 'road',
      icon: 'rapid-highway-unclassified',
      name: 'Minor Roads',
      members: ['highway/residential']
    };

    const category = new Rapid.Category(context, props);
    const residential = presets.item('highway/residential');
    it('maps members presetIDs to preset instances', () => {
      assert.instanceOf(category.members, Rapid.Collection);
      assert.deepEqual(category.members.array[0], residential);
    });

//    describe('matchGeometry', () => {
//      it('matches the type of an entity', () => {
//        assert.isTrue(category.matchGeometry('line'));
//        assert.isFalse(category.matchGeometry('point'));
//      });
//    });
  });

});
