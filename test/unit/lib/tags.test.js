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


describe('osmTagSuggestingArea', () => {
  const areaKeys = { leisure: {} };

  it('handles features with a lifecycle prefixes', () => {
    let result = Rapid.osmTagSuggestingArea({ leisure: 'stadium' }, areaKeys);
    assert.deepEqual(result, { leisure: 'stadium' });

    result = Rapid.osmTagSuggestingArea({ 'disused:leisure': 'stadium' }, areaKeys);
    assert.deepEqual(result, { 'disused:leisure': 'stadium' });

    result = Rapid.osmTagSuggestingArea({ 'ex:leisure': 'stadium' }, areaKeys);
    assert.isNull(result);
  });
});
