import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';

describe('ValidationIssue', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  const l10n = context.systems.l10n;
  l10n.preferredLocaleCodes = 'en';
  l10n._cache = {
    en: {
      core: {
        issues: {
          fix: {
            ignore_issue: {
              title: 'Ignore Issue'
            }
          }
        }
      }
    }
  };


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
    assert.strictEqual(fixes[0].title, 'Ignore Issue');
    assert.strictEqual(fixes[0].issue, result);
  });
});
