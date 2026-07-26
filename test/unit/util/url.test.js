import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilSafeURL', () => {
  it('allows web, contact, and relative URLs', () => {
    assert.strictEqual(Rapid.utilSafeURL('https://example.com/path'), 'https://example.com/path');
    assert.strictEqual(Rapid.utilSafeURL('http://example.com'), 'http://example.com');
    assert.strictEqual(Rapid.utilSafeURL('mailto:mapper@example.com'), 'mailto:mapper@example.com');
    assert.strictEqual(Rapid.utilSafeURL('/relative/path'), '/relative/path');
    assert.strictEqual(Rapid.utilSafeURL('#section'), '#section');
  });

  it('rejects executable and malformed URLs', () => {
    // eslint-disable-next-line no-script-url -- this test verifies that script URLs are rejected
    assert.isNull(Rapid.utilSafeURL('javascript:alert(1)'));
    assert.isNull(Rapid.utilSafeURL('java\nscript:alert(1)'));
    assert.isNull(Rapid.utilSafeURL('data:text/html,<script>alert(1)</script>'));
    assert.isNull(Rapid.utilSafeURL('https://[invalid'));
  });

  it('returns null for empty values', () => {
    assert.isNull(Rapid.utilSafeURL());
    assert.isNull(Rapid.utilSafeURL(null));
    assert.isNull(Rapid.utilSafeURL('  '));
  });
});
