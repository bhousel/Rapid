import { afterAll, beforeAll, describe, it } from 'bun:test';
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
    let _preset, _suggestion, _star;

    beforeAll(() => {
      _preset = new Rapid.Preset(context, sample.presetProps);
      _suggestion = new Rapid.Preset(context, sample.suggestionProps);
      _star = new Rapid.Preset(context, sample.starProps);

      schema.presets.set(_preset.id, _preset);
      schema.presets.set(_suggestion.id, _suggestion);
      schema.presets.set(_star.id, _star);

      _preset.reset();
      _suggestion.reset();
      _star.reset();
    });

    describe('geometries', () => {
      it('computes geometries as a Set of all supported geometries for the Preset', () => {
        assert.instanceOf(_preset.geometries, Set);
        assert.hasAllKeys(_preset.geometries, ['point', 'area']);
      });
    });

    describe('strings (normal)', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_preset._strings, Map);
        assert.hasAllKeys(_preset._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_preset._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _preset._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _preset._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.presetStrings);
      });
    });

    describe('strings (suggestion)', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_suggestion._strings, Map);
        assert.hasAllKeys(_suggestion._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_suggestion._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _suggestion._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _suggestion._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.suggestionStrings);
      });
    });

    describe('name', () => {
      it('returns the prelocalized name', () => {
        assert.strictEqual(_preset.name(), _preset._currStrings.name);
        assert.strictEqual(_preset.name(), sample.presetStrings.name);

        assert.strictEqual(_suggestion.name(), _suggestion._currStrings.name);
        assert.strictEqual(_suggestion.name(), sample.suggestionStrings.name);
      });
    });

    describe('aliases', () => {
      it('returns the prelocalized aliases', () => {
        assert.deepEqual(_preset.aliases(), _preset._currStrings.aliases);
        assert.deepEqual(_preset.aliases(), sample.presetStrings.aliases);

        assert.deepEqual(_suggestion.aliases(), _suggestion._currStrings.aliases);
        assert.deepEqual(_suggestion.aliases(), sample.suggestionStrings.aliases);
      });
    });

    describe('terms', () => {
      it('returns the prelocalized terms', () => {
        assert.deepEqual(_preset.terms(), _preset._currStrings.terms);
        assert.deepEqual(_preset.terms(), sample.presetStrings.terms);

        assert.deepEqual(_suggestion.terms(), _suggestion._currStrings.terms);
        assert.deepEqual(_suggestion.terms(), sample.suggestionStrings.terms);
      });
    });

    describe('subtitle', () => {
      it('returns null for normal presets', () => {
        assert.isNull(_preset.subtitle());
      });
      it('returns the preset name for suggestion presets', () => {
        // This preset doesn't exist in the SchemaSystem, so it returns the fallback presetID.
        assert.strictEqual(_suggestion.subtitle(), 'amenity/cafe/coffee_shop');
      });
    });

    describe('reference', () => {
      it('returns key/value for normal presets', () => {
        assert.deepEqual(_preset.reference(), { key: 'shop', value: 'second_hand' });
      });

      it('returns key only for star presets', () => {
        assert.deepEqual(_star.reference(), { key: 'traffic_calming' });
      });

      it('returns QID for suggestion presets', () => {
        assert.deepEqual(_suggestion.reference(), { qid: 'Q37158' });
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
