import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('osmRemoveLifecyclePrefix', () => {
  it('removes a lifecycle prefix from a tag key', () => {
    const result = Rapid.osmRemoveLifecyclePrefix('was:natural');
    assert.strictEqual(result, 'natural');
  });

  it('handles keys with multiple colons', () => {
    const result = Rapid.osmRemoveLifecyclePrefix('destroyed:seamark:type');
    assert.strictEqual(result, 'seamark:type');
  });

  it('ignores unrecognized lifecycle prefixes', () => {
    const result = Rapid.osmRemoveLifecyclePrefix('ex:leisure');
    assert.strictEqual(result, 'ex:leisure');
  });
});
