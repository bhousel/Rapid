import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationPrivateData', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  const validator = Rapid.validationPrivateData(context);


  it('ignores way with no tags', () => {
    const n = new Rapid.OsmNode(context, { tags: {} });
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores way with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { phone: '123-456-7890' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores generic building with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'yes', phone: '123-456-7890' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores guest house with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'house', phone: '123-456-7890', tourism: 'guest_house' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('flags house with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'house', phone: '123-456-7890' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'private_data',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

});
