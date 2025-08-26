import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationOutdatedTags', () => {

  const context = new Rapid.MockContext();
  context.systems = {
    assets:     new Rapid.AssetSystem(context),
    l10n:       new Rapid.LocalizationSystem(context),
    locations:  new Rapid.LocationSystem(context),
    map:        new Rapid.MapSystem(context),
    presets:    new Rapid.PresetSystem(context)
  };

  const validator = Rapid.validationOutdatedTags(context);


  before(() => {
    const deprecated = [{ old: { highway: 'no' } }, { old: { highway: 'ford' }, replace: { ford: '*' } }];
    Rapid.osmSetDeprecatedTags(deprecated);

    const l10n = context.systems.l10n;
    l10n.preferredLocaleCodes = 'en';
    l10n._cache = {
      en: {
        core: {
          issues: {
            fix: {
              upgrade_tags: {
                annotation: 'upgraded tags'
              },
              move_tags: {
                annotation: 'moved tags'
              }
            }
          }
        }
      }
    };
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

  it('flags multipolygon tagged on the outer way', () => {
    const w = new Rapid.OsmWay(context, { tags: { building: 'yes' } });
    const r = new Rapid.OsmRelation(context, {
      tags: { type: 'multipolygon' },
      members: [{ id: w.id, role: 'outer' }]
    });
    const g = new Rapid.Graph(context, [w, r]);
    const wIssues = validator(w, g);
    const rIssues = validator(r, g);

    assert.deepEqual(rIssues, []);

    assert.isArray(wIssues);
    assert.lengthOf(wIssues, 1);
    const expected = {
      type:      'outdated_tags',
      subtype:   'old_multipolygon',
      severity:  'warning',
      entityIds: [w.id, r.id]
    };
    assert.deepInclude(wIssues[0], expected);
  });

});
