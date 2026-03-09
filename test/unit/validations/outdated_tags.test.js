import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validationOutdatedTags', () => {

  const context = new Rapid.MockContext();
  context.systems = {
    l10n:       new Rapid.LocalizationSystem(context),
    locations:  new Rapid.LocationSystem(context),
    map:        new Rapid.MapSystem(context),
    schema:     new Rapid.SchemaSystem(context)
  };

  let validator;
  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await schema.initAsync();
    schema.merge(osmRulesets);
    const deprecated = [{ old: { highway: 'no' } }, { old: { highway: 'ford' }, replace: { ford: '*' } }];
    schema.merge({
      assetID: 'test_deprecated',
      scopes: [{ scope: 'osm', deprecated }]
    });
    validator = Rapid.validationOutdatedTags(context);
  });


  it('has no errors on good tags', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'unclassified' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.deepEqual(issues, []);
  });

  it('flags deprecated tag with replacement', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'ford' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'outdated_tags',
      subtype:   'deprecated_tags',
      severity:  'warning',
      entityIds: [w.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags deprecated tag with no replacement', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'no' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'outdated_tags',
      subtype:   'deprecated_tags',
      severity:  'warning',
      entityIds: [w.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('ignores multipolygon tagged on the relation', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, {
      tags: { building: 'yes', type: 'multipolygon' },
      members: [{ id: w.id, role: 'outer' }]
    });
    const g = new Rapid.Graph(context, [w, r]);
    const wIssues = validator(w, g);
    const rIssues = validator(r, g);
    assert.deepEqual(wIssues, []);
    assert.deepEqual(rIssues, []);
  });

});
