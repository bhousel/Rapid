import { before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../../modules/headless.js';


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
  beforeEach(() => {
    Rapid.osmSetAreaKeys({ leisure: {} });
  });

  it('handles features with a lifecycle prefixes', () => {
    let result = Rapid.osmTagSuggestingArea({ leisure: 'stadium' });
    assert.deepEqual(result, { leisure: 'stadium' });

    result = Rapid.osmTagSuggestingArea({ 'disused:leisure': 'stadium' });
    assert.deepEqual(result, { 'disused:leisure': 'stadium' });

    result = Rapid.osmTagSuggestingArea({ 'ex:leisure': 'stadium' });
    assert.isNull(result);
  });
});


describe('getDeprecatedTags', () => {
  const deprecated = [
    { old: { highway: 'no' } },
    { old: { amenity: 'toilet' }, replace: { amenity: 'toilets' } },
    { old: { speedlimit: '*' }, replace: { maxspeed: '$1' } },
    { old: { man_made: 'water_tank' }, replace: { man_made: 'storage_tank', content: 'water' } },
    { old: { amenity: 'gambling', gambling: 'casino' }, replace: { amenity: 'casino' } }
  ];

  before(() => {
    Rapid.osmSetDeprecatedTags(deprecated);
  });

  it('returns none if entity has no tags', () => {
    assert.deepEqual(Rapid.getDeprecatedTags({}), []);
  });

  it('returns none when no tags are deprecated', () => {
    assert.deepEqual(Rapid.getDeprecatedTags({ amenity: 'toilets' }), []);
  });

  it('returns 1:0 replacement', () => {
    const tags = { highway: 'no' };
    const expected = [{ old: { highway: 'no' }}];
    assert.deepEqual(Rapid.getDeprecatedTags(tags), expected);
  });

  it('returns 1:1 replacement', () => {
    const tags = { amenity: 'toilet' };
    const expected = [{ old: { amenity: 'toilet' }, replace: { amenity: 'toilets' } }];
    assert.deepEqual(Rapid.getDeprecatedTags(tags), expected);
  });

  it('returns 1:1 wildcard', () => {
    const tags = { speedlimit: '50' };
    const expected = [{ old: { speedlimit: '*' }, replace: { maxspeed: '$1' } }];
    assert.deepEqual(Rapid.getDeprecatedTags(tags), expected);
  });

  it('returns 1:2 total replacement', () => {
    const tags = { man_made: 'water_tank' };
    const expected = [{ old: { man_made: 'water_tank' }, replace: { man_made: 'storage_tank', content: 'water' } }];
    assert.deepEqual(Rapid.getDeprecatedTags(tags), expected);
  });

  it('returns 1:2 partial replacement', () => {
    const tags = { man_made: 'water_tank', content: 'water' };
    const expected = [{ old: { man_made: 'water_tank' }, replace: { man_made: 'storage_tank', content: 'water' } }];
    assert.deepEqual(Rapid.getDeprecatedTags(tags), expected);
  });

  it('returns 2:1 replacement', () => {
    const tags = { amenity: 'gambling', gambling: 'casino' };
    const expected = [{ old: { amenity: 'gambling', gambling: 'casino' }, replace: { amenity: 'casino' } }];
    assert.deepEqual(Rapid.getDeprecatedTags(tags), expected);
  });
});
