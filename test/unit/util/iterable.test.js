import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilIterable', () => {
  it('accepts Arrays', () => {
    const v = [1, 2, 3];
    const result = Rapid.utilIterable(v);
    assert.strictEqual(result, v);
  });

  it('accepts Sets', () => {
    const v = new Set([1, 2, 3]);
    const result = Rapid.utilIterable(v);
    assert.strictEqual(result, v);
  });

  it('accepts string value', () => {
    const v = 'hello';
    const result = Rapid.utilIterable(v);
    assert.deepEqual(result, ['hello']);
  });

  it('accepts numeric value', () => {
    const v = 1;
    const result = Rapid.utilIterable(v);
    assert.deepEqual(result, [1]);
  });

  it('handles null', () => {
    const v = null;
    const result = Rapid.utilIterable(v);
    assert.deepEqual(result, []);
  });

  it('handles undefined', () => {
    const result = Rapid.utilIterable();
    assert.deepEqual(result, []);
  });

});
