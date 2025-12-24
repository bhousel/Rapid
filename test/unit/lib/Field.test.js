import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './Field.sample.js';


describe('Field', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };

  const schema = context.systems.schema;

  beforeAll(() => {
    return schema.initAsync();
  });


  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.Field(context), /missing id/i);
    });

    it('constructs a Field from a context and props', () => {
      const field = new Rapid.Field(context, { id: 'test' });
      assert.instanceOf(field, Rapid.Field);
      assert.strictEqual(field.context, context);
    });

    it('accepts geometry property as an Array', () => {
      const field = new Rapid.Field(context, { id: 'test', geometry: ['point', 'area'] });
      assert.deepEqual(field.props.geometry, ['point', 'area']);
    });

    it('accepts geometry property as a string, wrapping it in an Array', () => {
      const field = new Rapid.Field(context, { id: 'test', geometry: 'point' });
      assert.deepEqual(field.props.geometry, ['point']);
    });
  });


  // Test some already-constructed Fields..
  describe('methods', () => {
    let _one, _two;

    beforeAll(() => {
      _one = new Rapid.Field(context, sample.field1Props);
      _two = new Rapid.Field(context, sample.field2Props);

      schema.fields.set(_one.id, _one);
      schema.fields.set(_two.id, _two);

      _one.reset();
      _two.reset();
    });

    describe('geometries', () => {
      it('computes geometries as a Set of all supported geometries for the Field', () => {
        assert.instanceOf(_one.geometries, Set);
        assert.hasAllKeys(_one.geometries, ['point', 'area']);
      });
    });

    describe('strings (normal)', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_one._strings, Map);
        assert.hasAllKeys(_one._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_one._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _one._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _one._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.field1Strings);
      });
    });

    describe('label', () => {
      it('returns the prelocalized label', () => {
        assert.strictEqual(_one.label(), _one._currStrings.label);
        assert.strictEqual(_one.label(), sample.field1Strings.label);

        assert.strictEqual(_two.label(), _two._currStrings.label);
        assert.strictEqual(_two.label(), sample.field2Strings.label);
      });
    });

    describe('terms', () => {
      it('returns the prelocalized terms', () => {
        assert.deepEqual(_one.terms(), _one._currStrings.terms);
        assert.deepEqual(_one.terms(), sample.field1Strings.terms);

        assert.deepEqual(_two.terms(), _two._currStrings.terms);
        assert.deepEqual(_two.terms(), sample.field2Strings.terms);
      });
    });

    describe('placeholder', () => {
      it('returns the prelocalized placeholder', () => {
        assert.deepEqual(_one.placeholder(), _one._currStrings.placeholder);
        assert.deepEqual(_one.placeholder(), sample.field1Strings.placeholder);

        assert.deepEqual(_two.placeholder(), _two._currStrings.placeholder);
        assert.deepEqual(_two.placeholder(), sample.field2Strings.placeholder);
      });
    });

    describe('_resolveReference', () => {
      const orig = console.warn;
      const spyWarn = mock();

      beforeAll(() => {
        console.warn = spyWarn;
      });

      beforeEach(() => {
        spyWarn.mockClear();  // reset call count
      });

      afterAll(() => {
        console.warn = orig;
      });

      it('a Field property without a reference resolves to itself', () => {
        assert.strictEqual(_two._resolveReference('name'), _two);
      });

      it('a Field property with a reference to a known Field resolves to the other Field', () => {
        assert.strictEqual(_two._resolveReference('placeholder'), _one);
      });

      it('a Field property with a reference to an unknown Field resolves to itself and issues a warning', () => {
        assert.strictEqual(_two._resolveReference('dummy'), _two);
        assert.lengthOf(spyWarn.mock.calls, 1);   // console.warn called once
        assert.match(spyWarn.mock.lastCall[0], /^unable to resolve/i);
      });
    });

  });
});
