import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilDeepMerge', () => {

  it('returns the target object', () => {
    const target = {};
    const result = Rapid.utilDeepMerge(target, { a: 1 });
    assert.strictEqual(result, target);
  });

  it('merges a flat source into the target', () => {
    const result = Rapid.utilDeepMerge({}, { a: 1, b: 'hello' });
    assert.deepEqual(result, { a: 1, b: 'hello' });
  });

  it('merges multiple sources left to right', () => {
    const result = Rapid.utilDeepMerge({}, { a: 1 }, { b: 2 }, { a: 3 });
    assert.deepEqual(result, { a: 3, b: 2 });
  });

  it('recursively merges nested plain objects', () => {
    const target = { x: { a: 1, b: 2 } };
    const result = Rapid.utilDeepMerge(target, { x: { b: 99, c: 3 } });
    assert.deepEqual(result, { x: { a: 1, b: 99, c: 3 } });
  });

  it('mutates the target in place', () => {
    const target = { a: 1 };
    Rapid.utilDeepMerge(target, { b: 2 });
    assert.equal(target.a, 1);
    assert.equal(target.b, 2);
  });

  it('replaces arrays rather than merging them', () => {
    const result = Rapid.utilDeepMerge({ arr: [1, 2] }, { arr: [3, 4, 5] });
    assert.deepEqual(result.arr, [3, 4, 5]);
  });

  it('skips source values that are undefined', () => {
    const result = Rapid.utilDeepMerge({ a: 1 }, { a: undefined, b: 2 });
    assert.equal(result.a, 1);
    assert.equal(result.b, 2);
  });

  it('handles null and undefined sources gracefully', () => {
    const target = { a: 1 };
    Rapid.utilDeepMerge(target, null, undefined, { b: 2 });
    assert.deepEqual(target, { a: 1, b: 2 });
  });

  it('does not deep-merge class instances (only plain objects)', () => {
    class Foo { constructor() { this.x = 42; } }
    const src = new Foo();
    const result = Rapid.utilDeepMerge({}, { foo: src });
    // class instance is assigned by reference, not merged
    assert.strictEqual(result.foo, src);
  });

  it('handles deeply nested structures', () => {
    const a = { level1: { level2: { level3: { val: 1 } } } };
    const b = { level1: { level2: { level3: { val: 2, extra: true } } } };
    Rapid.utilDeepMerge(a, b);
    assert.equal(a.level1.level2.level3.val, 2);
    assert.isTrue(a.level1.level2.level3.extra);
  });

  it('does not share references between the target and source nested objects', () => {
    const defaults = { style: { color: 0xCCCCCC, width: 2 } };
    const r1 = Rapid.utilDeepMerge({}, defaults);
    const r2 = Rapid.utilDeepMerge({}, defaults, { style: { color: 0xFF0000 } });
    assert.equal(r1.style.color, 0xCCCCCC, 'r1 should not be affected by r2 merge');
    assert.equal(defaults.style.color, 0xCCCCCC, 'defaults must not be mutated');
    assert.equal(r2.style.color, 0xFF0000);
  });

});
