import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Variable', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('requires an id', () => {
      assert.throws(() => new Rapid.Variable(context, {}), /Missing id/);
    });

    it('requires a value', () => {
      assert.throws(() => new Rapid.Variable(context, { id: 'test' }), /Missing value/);
    });

    it('creates a Variable with a string value', () => {
      const v = new Rapid.Variable(context, { id: 'greeting', value: 'hello' });
      assert.strictEqual(v.id, 'greeting');
      assert.strictEqual(v.value, 'hello');
      assert.strictEqual(v.context, context);
    });

    it('creates a Variable with a number value', () => {
      const v = new Rapid.Variable(context, { id: 'speed_limit', value: 65 });
      assert.strictEqual(v.id, 'speed_limit');
      assert.strictEqual(v.value, 65);
    });

    it('creates a Variable with a string array value', () => {
      const v = new Rapid.Variable(context, {
        id: 'lifecycle_prefixes',
        value: ['abandoned', 'construction', 'disused']
      });
      assert.strictEqual(v.id, 'lifecycle_prefixes');
      assert.deepEqual(v.value, ['abandoned', 'construction', 'disused']);
    });

    it('creates a Variable with a number array value', () => {
      const v = new Rapid.Variable(context, {
        id: 'zoom_levels',
        value: [12, 14, 16, 18]
      });
      assert.deepEqual(v.value, [12, 14, 16, 18]);
    });

    it('stores assetID and scopeID', () => {
      const v = new Rapid.Variable(context, {
        id: 'test',
        assetID: 'osm_rulesets',
        scopeID: 'osm',
        value: 'hello'
      });
      assert.strictEqual(v.props.assetID, 'osm_rulesets');
      assert.strictEqual(v.props.scopeID, 'osm');
    });

    it('deep clones props to avoid mutations', () => {
      const value = ['a', 'b', 'c'];
      const v = new Rapid.Variable(context, { id: 'test', value });
      value.push('d');
      assert.lengthOf(v.value, 3);  // original not affected
    });
  });


  describe('#asSet', () => {
    it('returns a Set for string array values', () => {
      const v = new Rapid.Variable(context, {
        id: 'test',
        value: ['abandoned', 'construction', 'disused']
      });
      const set = v.asSet();
      assert.instanceOf(set, Set);
      assert.strictEqual(set.size, 3);
      assert.isTrue(set.has('abandoned'));
      assert.isTrue(set.has('construction'));
      assert.isTrue(set.has('disused'));
      assert.isFalse(set.has('proposed'));
    });

    it('returns a Set for number array values', () => {
      const v = new Rapid.Variable(context, {
        id: 'test',
        value: [12, 14, 16]
      });
      const set = v.asSet();
      assert.instanceOf(set, Set);
      assert.strictEqual(set.size, 3);
      assert.isTrue(set.has(12));
    });

    it('returns a single-element Set for scalar string values', () => {
      const v = new Rapid.Variable(context, { id: 'test', value: 'motorway' });
      const set = v.asSet();
      assert.strictEqual(set.size, 1);
      assert.isTrue(set.has('motorway'));
    });

    it('returns a single-element Set for scalar number values', () => {
      const v = new Rapid.Variable(context, { id: 'test', value: 42 });
      const set = v.asSet();
      assert.strictEqual(set.size, 1);
      assert.isTrue(set.has(42));
    });

    it('caches the Set on repeated calls', () => {
      const v = new Rapid.Variable(context, { id: 'test', value: ['a', 'b'] });
      const s1 = v.asSet();
      const s2 = v.asSet();
      assert.strictEqual(s1, s2);  // same reference
    });
  });


  describe('#asArray', () => {
    it('returns the array directly for array values', () => {
      const v = new Rapid.Variable(context, {
        id: 'test',
        value: ['a', 'b', 'c']
      });
      const arr = v.asArray();
      assert.deepEqual(arr, ['a', 'b', 'c']);
    });

    it('wraps scalar string in an array', () => {
      const v = new Rapid.Variable(context, { id: 'test', value: 'hello' });
      assert.deepEqual(v.asArray(), ['hello']);
    });

    it('wraps scalar number in an array', () => {
      const v = new Rapid.Variable(context, { id: 'test', value: 42 });
      assert.deepEqual(v.asArray(), [42]);
    });
  });


  describe('#toJSON', () => {
    it('returns a JSON-serializable object', () => {
      const v = new Rapid.Variable(context, {
        id: 'lifecycle_prefixes',
        value: ['abandoned', 'disused']
      });
      const json = v.toJSON();
      assert.deepEqual(json, {
        id: 'lifecycle_prefixes',
        value: ['abandoned', 'disused']
      });
    });

    it('deep clones the result', () => {
      const v = new Rapid.Variable(context, {
        id: 'test',
        value: ['a', 'b']
      });
      const json1 = v.toJSON();
      json1.value = 'mutated';
      const json2 = v.toJSON();
      assert.deepEqual(json2.value, ['a', 'b']);  // not mutated
    });
  });


  describe('#toString', () => {
    it('shows id and item count for arrays', () => {
      const v = new Rapid.Variable(context, {
        id: 'lifecycle_prefixes',
        value: ['abandoned', 'disused']
      });
      assert.strictEqual(v.toString(), 'Variable(lifecycle_prefixes, [2 items])');
    });

    it('shows id and value for scalars', () => {
      const v = new Rapid.Variable(context, { id: 'speed', value: 65 });
      assert.strictEqual(v.toString(), 'Variable(speed, 65)');
    });
  });
});


describe('isVarRef', () => {
  it('returns true for var() references', () => {
    assert.isTrue(Rapid.isVarRef('var(lifecycle_prefixes)'));
    assert.isTrue(Rapid.isVarRef('var(a, b, c)'));
    assert.isTrue(Rapid.isVarRef('var(a)'));
  });

  it('returns false for non-var strings', () => {
    assert.isFalse(Rapid.isVarRef('motorway'));
    assert.isFalse(Rapid.isVarRef(''));
    assert.isFalse(Rapid.isVarRef('var'));
    assert.isFalse(Rapid.isVarRef('var()'));
  });
});


describe('resolveVarRef', () => {
  const context = new Rapid.MockContext();

  const variables = new Map();
  variables.set('major', new Rapid.Variable(context, {
    id: 'major',
    value: ['motorway', 'trunk', 'primary']
  }));
  variables.set('minor', new Rapid.Variable(context, {
    id: 'minor',
    value: ['service', 'track']
  }));
  variables.set('speed', new Rapid.Variable(context, {
    id: 'speed',
    value: 65
  }));

  it('resolves a single variable reference', () => {
    const result = Rapid.resolveVarRef('var(major)', variables);
    assert.deepEqual(result, ['motorway', 'trunk', 'primary']);
  });

  it('resolves a scalar variable reference', () => {
    const result = Rapid.resolveVarRef('var(speed)', variables);
    assert.strictEqual(result, 65);
  });

  it('resolves multiple variable references as a flat union', () => {
    const result = Rapid.resolveVarRef('var(major, minor)', variables);
    assert.deepEqual(result, ['motorway', 'trunk', 'primary', 'service', 'track']);
  });

  it('returns undefined for non-var strings', () => {
    const result = Rapid.resolveVarRef('motorway', variables);
    assert.isUndefined(result);
  });

  it('returns undefined for unresolved references', () => {
    const result = Rapid.resolveVarRef('var(nonexistent)', variables);
    assert.isUndefined(result);
  });

  it('returns undefined if any reference in a multi-var is unresolved', () => {
    const result = Rapid.resolveVarRef('var(major, nonexistent)', variables);
    assert.isUndefined(result);
  });

  it('handles whitespace in names', () => {
    const result = Rapid.resolveVarRef('var(  major  ,  minor  )', variables);
    assert.deepEqual(result, ['motorway', 'trunk', 'primary', 'service', 'track']);
  });
});
