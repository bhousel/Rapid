import { afterAll, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './Preset.sample.js';


describe('Preset', () => {
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
      assert.throws(() => new Rapid.Preset(context), /missing id/i);
    });

    it('constructs a Preset from a context and props', () => {
      const preset = new Rapid.Preset(context, { id: 'test' });
      assert.instanceOf(preset, Rapid.Preset);
      assert.strictEqual(preset.context, context);
    });

    it('accepts geometry property as an Array', () => {
      const preset = new Rapid.Preset(context, { id: 'test', geometry: ['point', 'area'] });
      assert.deepEqual(preset.props.geometry, ['point', 'area']);
    });

    it('accepts geometry property as a string, wrapping it in an Array', () => {
      const preset = new Rapid.Preset(context, { id: 'test', geometry: 'point' });
      assert.deepEqual(preset.props.geometry, ['point']);
    });
  });


  // Test some already-constructed Presets..
  describe('methods', () => {
    let _name, _phone, _shopping, _secondhand;
    let _shop, _thrift, _coffee, _starbucks;

    beforeAll(() => {
      // Fields
      _name = new Rapid.Field(context, sample.nameProps);
      _phone = new Rapid.Field(context, sample.phoneProps);
      _shopping = new Rapid.Field(context, sample.shoppingProps);
      _secondhand = new Rapid.Field(context, sample.secondhandProps);

      schema.fields.set(_name.id, _name);
      schema.fields.set(_phone.id, _phone);
      schema.fields.set(_shopping.id, _shopping);
      schema.fields.set(_secondhand.id, _secondhand);

      _name.reset();
      _phone.reset();
      _shopping.reset();
      _secondhand.reset();

      // Presets
      _shop = new Rapid.Preset(context, sample.shopProps);
      _thrift = new Rapid.Preset(context, sample.thriftProps);
      _coffee = new Rapid.Preset(context, sample.coffeeProps);
      _starbucks = new Rapid.Preset(context, sample.starbucksProps);

      schema.presets.set(_shop.id, _shop);
      schema.presets.set(_thrift.id, _thrift);
      schema.presets.set(_coffee.id, _coffee);
      schema.presets.set(_starbucks.id, _starbucks);

      _shop.reset();
      _thrift.reset();
      _coffee.reset();
      _starbucks.reset();
    });

    describe('geometries', () => {
      it('computes geometries as a Set of all supported geometries for the Preset', () => {
        assert.instanceOf(_thrift.geometries, Set);
        assert.hasAllKeys(_thrift.geometries, ['point', 'area']);
      });
    });

    describe('strings (normal preset)', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_thrift._strings, Map);
        assert.hasAllKeys(_thrift._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_thrift._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _thrift._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _thrift._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.thriftStrings);
      });
    });

    describe('strings (suggestion preset)', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_starbucks._strings, Map);
        assert.hasAllKeys(_starbucks._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_starbucks._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _starbucks._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _starbucks._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.starbucksStrings);
      });
    });

    describe('name', () => {
      it('returns the prelocalized name', () => {
        assert.strictEqual(_thrift.name, _thrift._currStrings.name);
        assert.strictEqual(_thrift.name, sample.thriftStrings.name);

        assert.strictEqual(_starbucks.name, _starbucks._currStrings.name);
        assert.strictEqual(_starbucks.name, sample.starbucksStrings.name);
      });
    });

    describe('aliases', () => {
      it('returns the prelocalized aliases', () => {
        assert.deepEqual(_thrift.aliases, _thrift._currStrings.aliases);
        assert.deepEqual(_thrift.aliases, sample.thriftStrings.aliases);

        assert.deepEqual(_starbucks.aliases, _starbucks._currStrings.aliases);
        assert.deepEqual(_starbucks.aliases, sample.starbucksStrings.aliases);
      });
    });

    describe('terms', () => {
      it('returns the prelocalized terms', () => {
        assert.deepEqual(_thrift.terms, _thrift._currStrings.terms);
        assert.deepEqual(_thrift.terms, sample.thriftStrings.terms);

        assert.deepEqual(_starbucks.terms, _starbucks._currStrings.terms);
        assert.deepEqual(_starbucks.terms, sample.starbucksStrings.terms);
      });
    });

    describe('subtitle', () => {
      it('returns null for normal presets', () => {
        assert.isNull(_thrift.subtitle());
      });
      it('returns the preset name for suggestion presets', () => {
        assert.strictEqual(_starbucks.subtitle(), 'Coffeehouse');
      });
    });

    describe('reference', () => {
      it('returns key/value for normal presets', () => {
        assert.deepEqual(_thrift.reference(), { key: 'shop', value: 'second_hand' });
      });

      it('returns key only for star presets', () => {
        assert.deepEqual(_shop.reference(), { key: 'shop' });
      });

      it('returns QID for suggestion presets', () => {
        assert.deepEqual(_starbucks.reference(), { qid: 'Q37158' });
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

      it('a Preset property without a reference resolves to itself', () => {
        assert.strictEqual(_thrift._resolveReference('name'), _thrift);
      });

      it('a Preset property with a reference to a known Preset resolves to the other Preset', () => {
        assert.strictEqual(_thrift._resolveReference('icon'), _shop);
      });

      it('a Preset property with a reference to an unknown Preset resolves to itself and issues a warning', () => {
        assert.strictEqual(_thrift._resolveReference('dummy'), _thrift);
        assert.lengthOf(spyWarn.mock.calls, 1);   // console.warn called once
        assert.match(spyWarn.mock.lastCall[0], /^unable to resolve/i);
      });
    });

    describe('_resolveFields', () => {
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

      it(`resolves 'fields' directly`, () => {
        assert.deepEqual(_shop._resolveFields('fields'), [_name, _shopping]);

        assert.lengthOf(spyWarn.mock.calls, 1);   // console.warn called once
        assert.match(spyWarn.mock.lastCall[0], /^unable to resolve referenced fieldid.*fake1/i);
      });

      it(`resolves 'moreFields' directly`, () => {
        assert.deepEqual(_shop._resolveFields('moreFields'), [_phone]);

        assert.lengthOf(spyWarn.mock.calls, 1);   // console.warn called once
        assert.match(spyWarn.mock.lastCall[0], /^unable to resolve referenced fieldid.*fake2/i);
      });

      it('returns empty array for invalid property name', () => {
        assert.deepEqual(_shop._resolveFields('dummy'), []);
      });

      it(`resolves 'fields' that reference another presetID`, () => {
        assert.deepEqual(_thrift._resolveFields('fields'), [_name, _shopping, _secondhand]);

        assert.lengthOf(spyWarn.mock.calls, 2);   // console.warn called twice
        assert.match(spyWarn.mock.calls[0][0], /^unable to resolve referenced fieldid.*fake1/i);
        assert.match(spyWarn.mock.calls[1][0], /^unable to resolve referenced presetid.*dummy1/i);
      });

      it(`resolves 'moreFields' that reference another presetID`, () => {
        assert.deepEqual(_thrift._resolveFields('moreFields'), [_phone]);

        assert.lengthOf(spyWarn.mock.calls, 2);   // console.warn called twice
        assert.match(spyWarn.mock.calls[0][0], /^unable to resolve referenced fieldid.*fake2/i);
        assert.match(spyWarn.mock.calls[1][0], /^unable to resolve referenced presetid.*dummy2/i);
      });

      it(`inherits 'fields' from parent Preset if there are no 'fields'`, () => {
        assert.deepEqual(_starbucks._resolveFields('fields'), [_name]);
      });

      it(`inherits 'moreFields' from parent Preset if there are no 'moreFields'`, () => {
        assert.deepEqual(_starbucks._resolveFields('moreFields'), [_phone]);
      });
    });
  });


  describe('fields', () => {
    it('has no fields by default', () => {
      const preset = new Rapid.Preset(context, { id: 'test' });
      assert.deepEqual(preset.fields(), []);
    });
  });

  describe('moreFields', () => {
    it('has no moreFields by default', () => {
      const preset = new Rapid.Preset(context, { id: 'test' });
      assert.deepEqual(preset.moreFields(), []);
    });
  });

  describe('matchScore', () => {
    it('returns -1 if preset does not match tags', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { foo: 'bar' } });
      const entity = new Rapid.OsmWay(context, { tags: { highway: 'motorway' } });
      assert.strictEqual(preset.matchScore(entity.tags), -1);
    });

    it('returns the value of the matchScore property when matched', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { highway: 'motorway' }, matchScore: 0.2 });
      const entity = new Rapid.OsmWay(context, { tags: { highway: 'motorway' } });
      assert.strictEqual(preset.matchScore(entity.tags), 0.2);
    });

    it('defaults to the number of matched tags', () => {
      let preset = new Rapid.Preset(context, { id: 'test', tags: { highway: 'residential' } });
      let entity = new Rapid.OsmWay(context, { tags: { highway: 'residential' } });
      assert.strictEqual(preset.matchScore(entity.tags), 1);

      preset = new Rapid.Preset(context, { id: 'test', tags: { highway: 'service', service: 'alley' } });
      entity = new Rapid.OsmWay(context, { tags: { highway: 'service', service: 'alley' } });
      assert.strictEqual(preset.matchScore(entity.tags), 2);
    });

    it('counts * as a match for any value with score 0.5', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { building: '*' } });
      const entity = new Rapid.OsmWay(context, { tags: { building: 'yep' } });
      assert.strictEqual(preset.matchScore(entity.tags), 0.5);
    });

    it('boosts matchScore for additional matches in addTags', () => {
      const presetSupercenter = new Rapid.Preset(context, {
        id: 'shop/supermarket/walmart_supercenter',
        tags: { 'brand:wikidata': 'Q483551', 'shop': 'supermarket' },
        addTags: { 'name': 'Walmart Supercenter'  }
      });
      const presetMarket = new Rapid.Preset(context, {
        id: 'shop/supermarket/walmart_market',
        tags: { 'brand:wikidata': 'Q483551', 'shop': 'supermarket' },
        addTags: { 'name': 'Walmart Neighborhood Market'  }
      });

      const supercenter = new Rapid.OsmWay(context, { tags: {
        'brand:wikidata': 'Q483551',
        'shop': 'supermarket',
        'name': 'Walmart Supercenter'
      } });
      const market = new Rapid.OsmWay(context, { tags: {
        'brand:wikidata': 'Q483551',
        'shop': 'supermarket',
        'name': 'Walmart Neighborhood Market'
      } });

      const centerMatchCenter = presetSupercenter.matchScore(supercenter.tags);
      const centerMatchMarket = presetMarket.matchScore(supercenter.tags);
      assert.isAbove(centerMatchCenter, centerMatchMarket);

      const marketMatchCenter = presetSupercenter.matchScore(market.tags);
      const marketMatchMarket = presetMarket.matchScore(market.tags);
      assert.isAbove(marketMatchMarket, marketMatchCenter);
    });
  });


  describe('isFallback', () => {
    it('returns true for the special fallback presets', () => {
      const presets = schema.presets;
      assert.isTrue(presets.get('point')?.isFallback());
      assert.isTrue(presets.get('line')?.isFallback());
      assert.isTrue(presets.get('area')?.isFallback());
      assert.isTrue(presets.get('relation')?.isFallback());
    });

    it('returns false for other presets', () => {
      const preset = new Rapid.Preset(context, { id: 'building', tags: { building: 'yes' } });
      assert.isFalse(preset.isFallback());
    });
  });


  describe('setTags', () => {
    let _savedAreaKeys;

    beforeAll(() => {
      _savedAreaKeys = Rapid.osmAreaKeys;
      Rapid.osmSetAreaKeys({ building: {}, natural: {} });
    });

    afterAll(() => {
      Rapid.osmSetAreaKeys(_savedAreaKeys);
    });

    it('adds match tags', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { highway: 'residential' } });
      assert.deepEqual(preset.setTags({}, 'line'), { highway: 'residential' });
    });

    it('adds wildcard tags with value \'yes\'', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { natural: '*' } });
      assert.deepEqual(preset.setTags({}, 'area'), { natural: 'yes' });
    });

    it('prefers to add tags of addTags property', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { building: '*' }, addTags: { building: 'ok' } });
      assert.deepEqual(preset.setTags({}, 'area'), { building: 'ok' });
    });

    it('adds default tags of fields with matching geometry', () => {
      const field = new Rapid.Field(context, { id: 'field', key: 'building', geometry: ['area'], default: 'yes' });
      schema.fields.set(field.id, field);

      const preset = new Rapid.Preset(context, { id: 'test', fields: ['field'] });
      assert.deepEqual(preset.setTags({}, 'area'), { area: 'yes', building: 'yes' });
    });

    it('adds no default tags of fields with non-matching geometry', () => {
      const field = new Rapid.Field(context, { id: 'field', key: 'building', geometry: ['area'], default: 'yes' });
      schema.fields.set(field.id, field);

      const preset = new Rapid.Preset(context, { id: 'test', fields: ['field'] });
      assert.deepEqual(preset.setTags({}, 'point'), {});
    });


    describe('for a preset with no tag in areaKeys', () => {
      const preset = new Rapid.Preset(context, { id: 'test', geometry: ['line', 'area'], tags: { name: 'testname', highway: 'pedestrian' } });

      it('doesn\'t add area=yes to non-areas', () => {
        assert.deepEqual(preset.setTags({}, 'line'), { name: 'testname', highway: 'pedestrian' });
      });

      it('adds area=yes to areas', () => {
        assert.deepEqual(preset.setTags({}, 'area'), { name: 'testname', highway: 'pedestrian', area: 'yes' });
      });
    });


    describe('for a preset with a tag in areaKeys', () => {
      it('doesn\'t add area=yes automatically', () => {
        const preset = new Rapid.Preset(context, { id: 'test', geometry: ['area'], tags: { name: 'testname', building: 'yes' } });
        assert.deepEqual(preset.setTags({}, 'area'), { name: 'testname', building: 'yes' });
      });

      it('does add area=yes if asked to', () => {
        const preset = new Rapid.Preset(context, { id: 'test', geometry: ['area'], tags: { name: 'testname', area: 'yes' } });
        assert.deepEqual(preset.setTags({}, 'area'), { name: 'testname', area: 'yes' });
      });
    });
  });


  describe('unsetTags', () => {
    it('removes tags that match preset tags', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { highway: 'residential' } });
      assert.deepEqual(preset.unsetTags({ highway: 'residential' }, 'area'), {});
    });

    it('removes tags that match field default tags', () => {
      const field = new Rapid.Field(context, { id: 'field', key: 'building', geometry: ['area'], default: 'yes' });
      schema.fields.set(field.id, field);

      const preset = new Rapid.Preset(context, { id: 'test', fields: ['field'] });
      assert.deepEqual(preset.unsetTags({ building: 'yes' }, 'area'), {});
    });

    it('removes area=yes', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { highway: 'pedestrian' } });
      assert.deepEqual(preset.unsetTags({ highway: 'pedestrian', area: 'yes' }, 'area'), {});
    });

    it('preserves tags that do not match field default tags', () => {
      const field = new Rapid.Field(context, { id: 'field', key: 'building', geometry: ['area'], default: 'yes' });
      schema.fields.set(field.id, field);

      const preset = new Rapid.Preset(context, { id: 'test', fields: ['field'] });
      assert.deepEqual(preset.unsetTags({ building: 'yep' }, 'area'), { building: 'yep' });
    });

    it('preserves tags that are not listed in removeTags', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { a: 'b' }, removeTags: {} });
      assert.deepEqual(preset.unsetTags({ a: 'b' }, 'area'), { a: 'b' });
    });

    it('uses tags from addTags if removeTags is not defined', () => {
      const preset = new Rapid.Preset(context, { id: 'test', tags: { a: 'b' }, addTags: { remove: 'me' } });
      assert.deepEqual(preset.unsetTags({ a: 'b', remove: 'me' }, 'area'), { a: 'b' });
    });
  });

});
