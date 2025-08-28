import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('ValidationFix', () => {
  it('constructs a ValidationFix object', () => {
    const props = {
      title: 'Test Title',
      // eslint-disable-next-line no-console
      onClick: () => console.log('Clicked'),
      disabledReason: 'Test Reason',
      icon: 'Test Icon',
      entityIds: ['1', '2', '3']
    };

    const result = new Rapid.ValidationFix(props);
    assert.deepInclude(result, props);
    assert.isNull(result.issue);
  });
});
