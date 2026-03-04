import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('PropMatcher', () => {

  describe('constructor', () => {
    it('requires a key', () => {
      assert.throws(() => new Rapid.PropMatcher({}), /key is required/);
    });

    it('creates a matcher with just a key', () => {
      const m = new Rapid.PropMatcher({ key: 'highway' });
      assert.strictEqual(m.key, 'highway');
      assert.strictEqual(m.op, 'exists');  // default when no value
      assert.isUndefined(m.value);
    });

    it('creates a matcher with key and value', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', value: 'motorway' });
      assert.strictEqual(m.key, 'highway');
      assert.strictEqual(m.op, '=');  // default when value provided
      assert.strictEqual(m.value, 'motorway');
    });

    it('respects explicit operator', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '!=', value: 'motorway' });
      assert.strictEqual(m.op, '!=');
    });

    it('throws on invalid regex', () => {
      assert.throws(
        () => new Rapid.PropMatcher({ key: 'test', op: '~', value: '[invalid' }),
        /invalid regex/
      );
    });
  });


  describe('exists operator', () => {
    it('matches when key exists with any value', () => {
      const m = new Rapid.PropMatcher({ key: 'highway' });
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isTrue(m.matches({ highway: 'residential' }));
      assert.isTrue(m.matches({ highway: 'yes' }));
    });

    it('does not match when key is missing', () => {
      const m = new Rapid.PropMatcher({ key: 'highway' });
      assert.isFalse(m.matches({ building: 'yes' }));
      assert.isFalse(m.matches({}));
    });

    it('does not match null or undefined values', () => {
      const m = new Rapid.PropMatcher({ key: 'highway' });
      assert.isFalse(m.matches({ highway: null }));
      assert.isFalse(m.matches({ highway: undefined }));
    });
  });


  describe('!exists operator', () => {
    it('matches when key does not exist', () => {
      const m = new Rapid.PropMatcher({ key: 'tunnel', op: '!exists' });
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isTrue(m.matches({}));
    });

    it('matches when key is null or undefined', () => {
      const m = new Rapid.PropMatcher({ key: 'tunnel', op: '!exists' });
      assert.isTrue(m.matches({ tunnel: null }));
      assert.isTrue(m.matches({ tunnel: undefined }));
    });

    it('does not match when key exists', () => {
      const m = new Rapid.PropMatcher({ key: 'tunnel', op: '!exists' });
      assert.isFalse(m.matches({ tunnel: 'yes' }));
      assert.isFalse(m.matches({ tunnel: 'building_passage' }));
    });
  });


  describe('= operator', () => {
    it('matches exact string value', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', value: 'motorway' });
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isFalse(m.matches({ highway: 'motorway_link' }));
      assert.isFalse(m.matches({ highway: 'trunk' }));
    });

    it('matches wildcard * for any truthy value', () => {
      const m = new Rapid.PropMatcher({ key: 'building', value: '*' });
      assert.isTrue(m.matches({ building: 'yes' }));
      assert.isTrue(m.matches({ building: 'residential' }));
      assert.isFalse(m.matches({ building: '' }));
      assert.isFalse(m.matches({ building: null }));
      assert.isFalse(m.matches({}));
    });

    it('handles numeric comparisons with type coercion', () => {
      const m = new Rapid.PropMatcher({ key: 'lanes', value: 2 });
      assert.isTrue(m.matches({ lanes: 2 }));
      assert.isTrue(m.matches({ lanes: '2' }));  // OSM tags are strings
      assert.isFalse(m.matches({ lanes: 3 }));
    });
  });


  describe('!= operator', () => {
    it('matches when value is different', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '!=', value: 'motorway' });
      assert.isTrue(m.matches({ highway: 'trunk' }));
      assert.isTrue(m.matches({ highway: 'residential' }));
      assert.isFalse(m.matches({ highway: 'motorway' }));
    });
  });


  describe('~ operator (regex)', () => {
    it('matches regex pattern with string', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '~', value: '^(trunk|primary)$' });
      assert.isTrue(m.matches({ highway: 'trunk' }));
      assert.isTrue(m.matches({ highway: 'primary' }));
      assert.isFalse(m.matches({ highway: 'trunk_link' }));
      assert.isFalse(m.matches({ highway: 'motorway' }));
    });

    it('matches regex pattern with RegExp object', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '~', value: /^motorway/ });
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isTrue(m.matches({ highway: 'motorway_link' }));
      assert.isFalse(m.matches({ highway: 'trunk' }));
    });

    it('is case-insensitive by default for string patterns', () => {
      const m = new Rapid.PropMatcher({ key: 'name', op: '~', value: 'main street' });
      assert.isTrue(m.matches({ name: 'Main Street' }));
      assert.isTrue(m.matches({ name: 'MAIN STREET' }));
    });
  });


  describe('!~ operator (regex negation)', () => {
    it('matches when regex does not match', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '!~', value: '^(trunk|primary)$' });
      assert.isFalse(m.matches({ highway: 'trunk' }));
      assert.isFalse(m.matches({ highway: 'primary' }));
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isTrue(m.matches({ highway: 'residential' }));
    });
  });


  describe('in operator', () => {
    it('matches when value is in array', () => {
      const m = new Rapid.PropMatcher({
        key: 'surface',
        op: 'in',
        value: ['asphalt', 'concrete', 'paved']
      });
      assert.isTrue(m.matches({ surface: 'asphalt' }));
      assert.isTrue(m.matches({ surface: 'concrete' }));
      assert.isTrue(m.matches({ surface: 'paved' }));
      assert.isFalse(m.matches({ surface: 'gravel' }));
      assert.isFalse(m.matches({ surface: 'dirt' }));
    });
  });


  describe('!in operator', () => {
    it('matches when value is not in array', () => {
      const m = new Rapid.PropMatcher({
        key: 'surface',
        op: '!in',
        value: ['asphalt', 'concrete', 'paved']
      });
      assert.isFalse(m.matches({ surface: 'asphalt' }));
      assert.isTrue(m.matches({ surface: 'gravel' }));
      assert.isTrue(m.matches({ surface: 'dirt' }));
    });
  });


  describe('numeric comparison operators', () => {
    it('> matches when value is greater', () => {
      const m = new Rapid.PropMatcher({ key: 'lanes', op: '>', value: 2 });
      assert.isTrue(m.matches({ lanes: 3 }));
      assert.isTrue(m.matches({ lanes: '4' }));  // string coercion
      assert.isFalse(m.matches({ lanes: 2 }));
      assert.isFalse(m.matches({ lanes: 1 }));
    });

    it('>= matches when value is greater or equal', () => {
      const m = new Rapid.PropMatcher({ key: 'lanes', op: '>=', value: 2 });
      assert.isTrue(m.matches({ lanes: 3 }));
      assert.isTrue(m.matches({ lanes: 2 }));
      assert.isFalse(m.matches({ lanes: 1 }));
    });

    it('< matches when value is less', () => {
      const m = new Rapid.PropMatcher({ key: 'maxspeed', op: '<', value: 50 });
      assert.isTrue(m.matches({ maxspeed: 30 }));
      assert.isFalse(m.matches({ maxspeed: 50 }));
      assert.isFalse(m.matches({ maxspeed: 70 }));
    });

    it('<= matches when value is less or equal', () => {
      const m = new Rapid.PropMatcher({ key: 'maxspeed', op: '<=', value: 50 });
      assert.isTrue(m.matches({ maxspeed: 30 }));
      assert.isTrue(m.matches({ maxspeed: 50 }));
      assert.isFalse(m.matches({ maxspeed: 70 }));
    });

    it('returns false for non-numeric actual values', () => {
      const m = new Rapid.PropMatcher({ key: 'lanes', op: '>', value: 2 });
      assert.isFalse(m.matches({ lanes: 'many' }));
      assert.isFalse(m.matches({ lanes: null }));
    });
  });


  describe('edge cases', () => {
    it('handles null object', () => {
      const m = new Rapid.PropMatcher({ key: 'highway' });
      assert.isFalse(m.matches(null));
    });

    it('handles undefined object', () => {
      const m = new Rapid.PropMatcher({ key: 'highway' });
      assert.isFalse(m.matches(undefined));
    });

    it('handles !exists with null object', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '!exists' });
      assert.isTrue(m.matches(null));
    });
  });


  describe('static methods', () => {
    describe('from', () => {
      it('creates from props object', () => {
        const m = Rapid.PropMatcher.from({ key: 'highway', value: 'motorway' });
        assert.instanceOf(m, Rapid.PropMatcher);
        assert.isTrue(m.matches({ highway: 'motorway' }));
      });

      it('creates from simple string "key=value"', () => {
        const m = Rapid.PropMatcher.from('highway=motorway');
        assert.strictEqual(m.key, 'highway');
        assert.strictEqual(m.value, 'motorway');
        assert.isTrue(m.matches({ highway: 'motorway' }));
      });

      it('creates from simple string "key" (existence)', () => {
        const m = Rapid.PropMatcher.from('highway');
        assert.strictEqual(m.key, 'highway');
        assert.strictEqual(m.op, 'exists');
        assert.isTrue(m.matches({ highway: 'anything' }));
      });
    });

    describe('matchAll', () => {
      it('returns true when all matchers match', () => {
        const matchers = [
          new Rapid.PropMatcher({ key: 'highway', value: 'residential' }),
          new Rapid.PropMatcher({ key: 'surface', value: 'asphalt' })
        ];
        assert.isTrue(Rapid.PropMatcher.matchAll(matchers, {
          highway: 'residential',
          surface: 'asphalt',
          name: 'Main St'
        }));
      });

      it('returns false when any matcher fails', () => {
        const matchers = [
          new Rapid.PropMatcher({ key: 'highway', value: 'residential' }),
          new Rapid.PropMatcher({ key: 'surface', value: 'asphalt' })
        ];
        assert.isFalse(Rapid.PropMatcher.matchAll(matchers, {
          highway: 'residential',
          surface: 'gravel'
        }));
      });

      it('returns true for empty matchers array', () => {
        assert.isTrue(Rapid.PropMatcher.matchAll([], { highway: 'motorway' }));
      });
    });

    describe('matchAny', () => {
      it('returns true when any matcher matches', () => {
        const matchers = [
          new Rapid.PropMatcher({ key: 'highway', value: 'motorway' }),
          new Rapid.PropMatcher({ key: 'highway', value: 'trunk' })
        ];
        assert.isTrue(Rapid.PropMatcher.matchAny(matchers, { highway: 'trunk' }));
      });

      it('returns false when no matcher matches', () => {
        const matchers = [
          new Rapid.PropMatcher({ key: 'highway', value: 'motorway' }),
          new Rapid.PropMatcher({ key: 'highway', value: 'trunk' })
        ];
        assert.isFalse(Rapid.PropMatcher.matchAny(matchers, { highway: 'residential' }));
      });

      it('returns false for empty matchers array', () => {
        assert.isFalse(Rapid.PropMatcher.matchAny([], { highway: 'motorway' }));
      });
    });
  });


  describe('serialization', () => {
    it('toJSON returns props object', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', value: 'motorway' });
      const json = m.toJSON();
      assert.deepEqual(json, { key: 'highway', value: 'motorway' });
    });

    it('toJSON omits default operator', () => {
      const m1 = new Rapid.PropMatcher({ key: 'highway', value: 'motorway' });
      assert.notProperty(m1.toJSON(), 'op');

      const m2 = new Rapid.PropMatcher({ key: 'highway' });
      assert.notProperty(m2.toJSON(), 'op');
    });

    it('toJSON includes explicit operator', () => {
      const m = new Rapid.PropMatcher({ key: 'lanes', op: '>', value: 2 });
      assert.strictEqual(m.toJSON().op, '>');
    });

    it('toJSON converts RegExp to string', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', op: '~', value: /^motor/ });
      const json = m.toJSON();
      assert.strictEqual(json.value, '^motor');
    });

    it('toString returns readable format', () => {
      const m1 = new Rapid.PropMatcher({ key: 'highway', value: 'motorway' });
      assert.include(m1.toString(), 'highway');
      assert.include(m1.toString(), 'motorway');

      const m2 = new Rapid.PropMatcher({ key: 'building' });
      assert.strictEqual(m2.toString(), '[building]');

      const m3 = new Rapid.PropMatcher({ key: 'tunnel', op: '!exists' });
      assert.strictEqual(m3.toString(), '[!tunnel]');
    });

    it('toJSON includes keyOp when not default', () => {
      const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~' });
      const json = m.toJSON();
      assert.strictEqual(json.keyOp, '~');
      assert.strictEqual(json.key, '^tiger:');
    });

    it('toJSON omits keyOp when it is the default', () => {
      const m = new Rapid.PropMatcher({ key: 'highway', value: 'motorway' });
      assert.notProperty(m.toJSON(), 'keyOp');
    });

    it('toString wraps key in slashes for key patterns', () => {
      const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~' });
      assert.strictEqual(m.toString(), '[/^tiger:/]');
    });
  });


  describe('keyOp (key-pattern matching)', () => {
    describe('keyOp ~ with op exists', () => {
      it('matches when any key matches the key pattern', () => {
        const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~' });
        assert.isTrue(m.matches({ 'tiger:source': 'census' }));
        assert.isTrue(m.matches({ 'tiger:upload_uuid': '123' }));
        assert.isTrue(m.matches({ 'tiger:tlid': '456', highway: 'motorway' }));
      });

      it('does not match when no key matches the pattern', () => {
        const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~' });
        assert.isFalse(m.matches({ highway: 'motorway' }));
        assert.isFalse(m.matches({ source: 'tiger' }));
        assert.isFalse(m.matches({}));
      });

      it('matches patterns with alternation', () => {
        const m = new Rapid.PropMatcher({ key: '^KSJ2:(curve_id|lat|long)$', keyOp: '~' });
        assert.isTrue(m.matches({ 'KSJ2:lat': '35.6' }));
        assert.isTrue(m.matches({ 'KSJ2:long': '139.7' }));
        assert.isTrue(m.matches({ 'KSJ2:curve_id': '42' }));
        assert.isFalse(m.matches({ 'KSJ2:filename': 'test.xml' }));
        assert.isFalse(m.matches({ 'KSJ2:ADS': 'yes' }));
      });

      it('matches patterns with optional groups', () => {
        const m = new Rapid.PropMatcher({ key: '^source(_ref)?(:|$)', keyOp: '~' });
        assert.isTrue(m.matches({ 'source': 'bing' }));
        assert.isTrue(m.matches({ 'source:name': 'official' }));
        assert.isTrue(m.matches({ 'source_ref': 'abc' }));
        assert.isTrue(m.matches({ 'source_ref:date': '2020' }));
        assert.isFalse(m.matches({ 'sourcery': 'magic' }));
      });

      it('handles null/undefined objects', () => {
        const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~' });
        assert.isFalse(m.matches(null));
        assert.isFalse(m.matches(undefined));
      });
    });

    describe('keyOp ~ with op !exists', () => {
      it('returns true when no key matches the pattern', () => {
        const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~', op: '!exists' });
        assert.isTrue(m.matches({ highway: 'motorway' }));
        assert.isTrue(m.matches({}));
      });

      it('returns false when a key matches the pattern', () => {
        const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~', op: '!exists' });
        assert.isFalse(m.matches({ 'tiger:source': 'census' }));
      });
    });

    describe('keyOp ~ with value operators', () => {
      it('matches key pattern with exact value', () => {
        const m = new Rapid.PropMatcher({ key: '^addr:', keyOp: '~', value: 'yes' });
        assert.isTrue(m.matches({ 'addr:interpolation': 'yes' }));
        assert.isFalse(m.matches({ 'addr:interpolation': 'no' }));
        assert.isFalse(m.matches({ highway: 'yes' }));
      });

      it('matches key pattern with value regex', () => {
        const m = new Rapid.PropMatcher({ key: '^name:', keyOp: '~', op: '~', value: '^St' });
        assert.isTrue(m.matches({ 'name:en': 'St James' }));
        assert.isFalse(m.matches({ 'name:en': 'Main Street' }));
        assert.isFalse(m.matches({ name: 'St James' }));  // 'name' doesn't match ^name:
      });

      it('matches key pattern with wildcard value', () => {
        const m = new Rapid.PropMatcher({ key: '^tiger:', keyOp: '~', value: '*' });
        assert.isTrue(m.matches({ 'tiger:source': 'census' }));
        assert.isFalse(m.matches({ 'tiger:source': '' }));
        assert.isFalse(m.matches({ highway: 'motorway' }));
      });
    });

    describe('constructor validation', () => {
      it('throws on invalid key regex pattern', () => {
        assert.throws(
          () => new Rapid.PropMatcher({ key: '[invalid', keyOp: '~' }),
          /invalid key regex/
        );
      });

      it('defaults keyOp to exact match', () => {
        const m = new Rapid.PropMatcher({ key: 'highway' });
        assert.strictEqual(m.keyOp, '=');
      });
    });
  });


  describe('RegExp key (inferred keyOp ~)', () => {
    it('infers keyOp ~ from RegExp key', () => {
      const m = new Rapid.PropMatcher({ key: /^tiger:/ });
      assert.strictEqual(m.keyOp, '~');
      assert.strictEqual(m.key, '^tiger:');  // normalized to source string
    });

    it('matches when any key matches the RegExp pattern', () => {
      const m = new Rapid.PropMatcher({ key: /^tiger:/ });
      assert.isTrue(m.matches({ 'tiger:source': 'census' }));
      assert.isTrue(m.matches({ 'tiger:tlid': '456' }));
      assert.isFalse(m.matches({ highway: 'motorway' }));
    });

    it('works with op !exists', () => {
      const m = new Rapid.PropMatcher({ key: /^tiger:/, op: '!exists' });
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isFalse(m.matches({ 'tiger:source': 'bing' }));
    });

    it('works with value matching', () => {
      const m = new Rapid.PropMatcher({ key: /^addr:/, value: 'yes' });
      assert.isTrue(m.matches({ 'addr:interpolation': 'yes' }));
      assert.isFalse(m.matches({ 'addr:interpolation': 'no' }));
    });

    it('preserves RegExp flags', () => {
      const m = new Rapid.PropMatcher({ key: /^TIGER:/i });
      assert.isTrue(m.matches({ 'tiger:source': 'census' }));
      assert.isTrue(m.matches({ 'TIGER:source': 'census' }));
    });

    it('toJSON converts RegExp key to source string with keyOp', () => {
      const m = new Rapid.PropMatcher({ key: /^tiger:/ });
      const json = m.toJSON();
      assert.strictEqual(json.key, '^tiger:');
      assert.strictEqual(json.keyOp, '~');
    });

    it('toString wraps key in slashes', () => {
      const m = new Rapid.PropMatcher({ key: /^tiger:/ });
      assert.strictEqual(m.toString(), '[/^tiger:/]');
    });
  });


  describe('string[] key (inferred keyOp in)', () => {
    it('infers keyOp in from string[] key', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon', 'latitude', 'longitude'] });
      assert.strictEqual(m.keyOp, 'in');
      assert.deepEqual(m.key, ['lat', 'lon', 'latitude', 'longitude']);
    });

    it('matches when any listed key exists', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon', 'latitude', 'longitude'] });
      assert.isTrue(m.matches({ lat: '35.6' }));
      assert.isTrue(m.matches({ longitude: '139.7' }));
      assert.isTrue(m.matches({ lat: '35.6', lon: '139.7' }));
      assert.isFalse(m.matches({ highway: 'motorway' }));
      assert.isFalse(m.matches({}));
    });

    it('does not match null/undefined values', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'] });
      assert.isFalse(m.matches({ lat: null }));
      assert.isFalse(m.matches({ lat: undefined }));
    });

    it('works with op !exists', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'], op: '!exists' });
      assert.isTrue(m.matches({ highway: 'motorway' }));
      assert.isTrue(m.matches({}));
      assert.isFalse(m.matches({ lat: '35.6' }));
      assert.isFalse(m.matches({ lon: '139.7' }));
    });

    it('works with value matching', () => {
      const m = new Rapid.PropMatcher({ key: ['source', 'source_ref'], value: 'bing' });
      assert.isTrue(m.matches({ source: 'bing' }));
      assert.isTrue(m.matches({ source_ref: 'bing' }));
      assert.isFalse(m.matches({ source: 'mapbox' }));
      assert.isFalse(m.matches({ highway: 'bing' }));
    });

    it('works with wildcard value', () => {
      const m = new Rapid.PropMatcher({ key: ['source', 'source_ref'], value: '*' });
      assert.isTrue(m.matches({ source: 'bing' }));
      assert.isTrue(m.matches({ source_ref: 'abc' }));
      assert.isFalse(m.matches({ source: '' }));
      assert.isFalse(m.matches({ highway: 'motorway' }));
    });

    it('works with regex value', () => {
      const m = new Rapid.PropMatcher({ key: ['name', 'name:en'], op: '~', value: '^St' });
      assert.isTrue(m.matches({ name: 'St James' }));
      assert.isTrue(m.matches({ 'name:en': 'St Andrew' }));
      assert.isFalse(m.matches({ name: 'Main Road' }));
    });

    it('throws on empty array', () => {
      assert.throws(() => new Rapid.PropMatcher({ key: [] }), /key is required/);
    });

    it('handles null/undefined objects', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'] });
      assert.isFalse(m.matches(null));
      assert.isFalse(m.matches(undefined));
    });

    it('handles !exists with null/undefined objects', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'], op: '!exists' });
      assert.isTrue(m.matches(null));
      assert.isTrue(m.matches(undefined));
    });

    it('toJSON includes array key without keyOp (default inferred)', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'] });
      const json = m.toJSON();
      assert.deepEqual(json.key, ['lat', 'lon']);
      assert.notProperty(json, 'keyOp');  // 'in' is the default for arrays
    });

    it('toJSON includes keyOp when overridden for array key', () => {
      // Unusual but valid: array key with explicit keyOp
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'], keyOp: 'in' });
      const json = m.toJSON();
      assert.notProperty(json, 'keyOp');  // still the default, so omitted
    });

    it('toString wraps keys in parens', () => {
      const m = new Rapid.PropMatcher({ key: ['lat', 'lon'] });
      assert.strictEqual(m.toString(), '[(lat, lon)]');
    });

    it('toString shows value ops with array keys', () => {
      const m = new Rapid.PropMatcher({ key: ['source', 'source_ref'], value: 'bing' });
      assert.strictEqual(m.toString(), '[(source, source_ref)=bing]');
    });
  });

});
