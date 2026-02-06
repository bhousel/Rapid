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
  });

});
