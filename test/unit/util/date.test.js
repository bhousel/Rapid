import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilDate', () => {
  it('passes dates through unaltered', () => {
    const val = new Date();
    const d = Rapid.utilDate(val);
    assert.strictEqual(val, d);
  });

  it('treats numbers as timestamps', () => {
    const d = Rapid.utilDate(1735696800000);
    assert.instanceOf(d, Date);
    assert.strictEqual(d.toISOString(), '2025-01-01T02:00:00.000Z');
  });

  it('accepts ISO strings without time', () => {
    const d = Rapid.utilDate('2025-01-01');
    assert.instanceOf(d, Date);
    assert.strictEqual(d.toISOString(), '2025-01-01T00:00:00.000Z');
  });

  it('accepts ISO strings with time', () => {
    const d = Rapid.utilDate('2025-01-01T02:00:00');  // Will append Z to treat as UTC
    assert.instanceOf(d, Date);
    assert.strictEqual(d.toISOString(), '2025-01-01T02:00:00.000Z');
  });

  it('accepts ISO strings with timezone Z', () => {
    const d = Rapid.utilDate('2025-01-01T02:00:00Z');  // Won't append a Z if already there
    assert.instanceOf(d, Date);
    assert.strictEqual(d.toISOString(), '2025-01-01T02:00:00.000Z');
  });

  it('accepts ISO strings with timezone', () => {
    const d = Rapid.utilDate('2024-12-31T22:00:00-04:00');  // Won't append a Z if timezone exists
    assert.instanceOf(d, Date);
    assert.strictEqual(d.toISOString(), '2025-01-01T02:00:00.000Z');
  });

  it('accepts non ISO strings', () => {
    const d = Rapid.utilDate('Dec 31, 2024 22:00:00 UTC-4');
    assert.instanceOf(d, Date);
    assert.strictEqual(d.toISOString(), '2025-01-01T02:00:00.000Z');
  });

  it('returns null for invalid inputs', () => {
    assert.isNull(Rapid.utilDate());
    assert.isNull(Rapid.utilDate({}));
    assert.isNull(Rapid.utilDate([]));
    assert.isNull(Rapid.utilDate(''));
    assert.isNull(Rapid.utilDate(null));
    assert.isNull(Rapid.utilDate(Infinity));
  });
});


describe('utilDateString', () => {
  it('returns a short ISO date', () => {
    const s = Rapid.utilDateString('2025-01-01T02:00:00Z');
    assert.strictEqual(s, '2025-01-01');
  });

  it('returns empty string for invalid inputs', () => {
    assert.strictEqual('', Rapid.utilDateString());
    assert.strictEqual('', Rapid.utilDateString({}));
    assert.strictEqual('', Rapid.utilDateString([]));
    assert.strictEqual('', Rapid.utilDateString(''));
    assert.strictEqual('', Rapid.utilDateString(null));
    assert.strictEqual('', Rapid.utilDateString(Infinity));
  });
});
