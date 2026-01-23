import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './Category.sample.js';


describe('Category', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };

  const schema = context.systems.schema;

  beforeAll(() => {
    return schema.initAsync().then(() => {
      const presetData = {
        assetID: 'test',
        presets: {
          'highway/residential': {
            tags: { highway: 'residential' },
            geometry: ['line']
          }
        }
      };
      schema.merge(presetData);
    });
  });


  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.Category(context), /missing id/i);
    });

    it('constructs a Category from a context and props', () => {
      const category = new Rapid.Category(context, sample.categoryProps);
      assert.instanceOf(category, Rapid.Category);
      assert.strictEqual(category.context, context);
    });
  });


  // Test an already-constructed Category..
  describe('methods', () => {
    let _category;

    beforeAll(() => {
      _category = new Rapid.Category(context, sample.categoryProps);
      schema.categories.set(_category.id, _category);
      _category.reset();
    });

    describe('presets', () => {
      it('maps members presetIDs to known presets', () => {
        const residential = schema.item('highway/residential');
        assert.isArray(_category.presets);
        assert.deepEqual(_category.presets, [residential]);
      });
    });

    describe('geometries', () => {
      it('computes geometries as a Set of all supported geometries for the known Presets', () => {
        assert.instanceOf(_category.geometries, Set);
        assert.hasAllKeys(_category.geometries, ['line']);
      });
    });

    describe('strings', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_category._strings, Map);
        assert.hasAllKeys(_category._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_category._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _category._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _category._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.categoryStrings);
      });
    });

    describe('name', () => {
      it('returns the prelocalized name', () => {
        assert.strictEqual(_category.name, _category._currStrings.name);
        assert.strictEqual(_category.name, sample.categoryStrings.name);
      });
    });

    describe('aliases', () => {
      it('returns the prelocalized aliases', () => {
        assert.deepEqual(_category.aliases, []);   // always [] for Categories
      });
    });

    describe('terms', () => {
      it('returns the prelocalized terms', () => {
        assert.deepEqual(_category.terms, []);   // always [] for Categories
      });
    });

    describe('matchScore', () => {
      it('returns -1 matchScore', () => {
        assert.strictEqual(_category.matchScore(), -1);   // always -1 for Categories
      });
    });

    describe('isFallback', () => {
      it('returns false isFallback', () => {
        assert.isFalse(_category.isFallback());   // always false for Categories
      });
    });
  });

  describe('isBuiltin', () => {
    it('returns true for Categories with no assetID', () => {
      const category = new Rapid.Category(context, { id: 'test' });
      assert.isTrue(category.isBuiltin());
    });

    it('returns false for Categories with a assetID', () => {
      const category = new Rapid.Category(context, { id: 'test', assetID: 'hello' });
      assert.isFalse(category.isBuiltin());
    });
  });

});
