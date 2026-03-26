import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validatePrivateData', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:    new Rapid.LocalizationSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };

  let validator;
  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await schema.initAsync();
    schema.merge(osmRulesets);
    validator = Rapid.validatePrivateData(context);
  });


  it('ignores way with no tags', () => {
    const n = new Rapid.OsmNode(context, { tags: {} });
    const issues = validator(n).issues;
    assert.deepEqual(issues, []);
  });

  it('ignores way with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { phone: '123-456-7890' }});
    const issues = validator(n).issues;
    assert.deepEqual(issues, []);
  });

  it('ignores generic building with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'yes', phone: '123-456-7890' }});
    const issues = validator(n).issues;
    assert.deepEqual(issues, []);
  });

  it('ignores guest house with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'house', phone: '123-456-7890', tourism: 'guest_house' }});
    const issues = validator(n).issues;
    assert.deepEqual(issues, []);
  });

  it('flags house with phone tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'house', phone: '123-456-7890' }});
    const issues = validator(n).issues;
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'private_data',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

});
