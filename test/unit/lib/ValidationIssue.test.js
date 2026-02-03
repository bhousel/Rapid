import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('ValidationIssue', () => {
  const context = new Rapid.MockContext();


  it('should construct a ValidationIssue object and test its methods', () => {
    const props = {
      type: 'Test Type',
      subtype: 'Test Subtype',
      severity: 'warning',
      entityIds: ['1', '2', '3'],
      loc: [0, 0],
      data: {},
      hash: 'Test Hash',
      autoArgs: {}
    };

    const result = new Rapid.ValidationIssue(context, props);

    // Test properties
    assert.deepInclude(result, props);
    assert.include(result.id, 'Test Type');
    assert.include(result.key, result.id);

    // Test extent method
    const extent = result.extent();
    assert.deepEqual(extent.min, [0, 0]);
    assert.deepEqual(extent.max, [0, 0]);

    // Test fixes method
    const fixes = result.fixes();
    assert.lengthOf(fixes, 1);
    assert.strictEqual(fixes[0].title, 'Ignore this issue');  // no l10n, fallback string
    assert.strictEqual(fixes[0].issue, result);
  });
});
