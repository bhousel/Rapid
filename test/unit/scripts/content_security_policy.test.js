import { describe, it } from 'bun:test';
import { assert } from 'chai';

import { contentSecurityPolicy, scriptHash, updateContentSecurityPolicy } from '../../../scripts/content_security_policy.ts';


describe('Content Security Policy', () => {
  it('hashes inline scripts and delegates dynamic loading to trusted scripts', () => {
    const html = `
      <script>alert('Hello, world.');</script>
      <script src='https://browser-update.org/update.js'></script>
    `;
    const policy = contentSecurityPolicy(html);

    assert.include(policy, scriptHash(`alert('Hello, world.');`));
    assert.include(policy, 'https://browser-update.org');
    assert.include(policy, 'https://cdn.jsdelivr.net');
    assert.include(policy, `'strict-dynamic'`);
    assert.include(policy, `style-src 'self' 'unsafe-inline' https:`);
    assert.include(policy, `font-src 'self' data: https:`);
    assert.notMatch(policy, /script-src [^;]*'unsafe-inline'/);
    assert.notMatch(policy, /script-src [^;]*'unsafe-eval'/);
  });

  it('can opt editor extensions into runtime expression compilation', () => {
    const policy = contentSecurityPolicy('<script>startRapid();</script>', {
      allowUnsafeEval: true
    });

    assert.match(policy, /script-src [^;]*'unsafe-eval'/);
    assert.notMatch(policy, /script-src [^;]*'unsafe-inline'/);
  });

  it('inserts the policy immediately after the charset declaration', () => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset='utf-8'>
    <title>Test</title>
  </head>
</html>
`;
    const updated = updateContentSecurityPolicy(html);

    assert.match(updated, /<meta charset='utf-8'>\n {4}<meta http-equiv="Content-Security-Policy"/);
    assert.strictEqual(updateContentSecurityPolicy(updated), updated);
  });

  it('rejects documents without an early charset declaration', () => {
    assert.throws(
      () => updateContentSecurityPolicy('<html></html>'),
      'missing UTF-8 charset meta element'
    );
  });
});
