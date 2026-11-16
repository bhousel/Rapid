import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validateOutdatedTags', () => {

  const context = new Rapid.MockContext();
  context.systems = {
    l10n:       new Rapid.LocalizationSystem(context),
    locations:  new Rapid.LocationSystem(context),
    schema:     new Rapid.SchemaSystem(context)
  };

  let validator;
  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await context.initAsync()
      .then(() => {
        schema.merge(osmRulesets);

        const deprecated = [{ old: { highway: 'no' } }, { old: { highway: 'ford' }, replace: { ford: '*' } }];
        schema.merge({
          assetID: 'test_deprecated',
          scopes: [{ scope: 'osm', deprecated }]
        });
      })
      .then(() => context.startAsync());

    validator = Rapid.validateOutdatedTags(context);
  });


  it('has no errors on good tags', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'unclassified' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g).issues;
    assert.deepEqual(issues, []);
  });

  it('flags deprecated tag with replacement', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'ford' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g).issues;
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
    const issues = validator(w, g).issues;
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

  it('upgrade fix changes the deprecated tags', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'ford' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g).issues;
    const [action] = issues[0].autoArgs;

    const result = action(new Rapid.Graph(g));
    assert.deepEqual(result.entity(w.id).tags, { ford: 'yes' });
  });

  it('upgrade fix leaves the entity untouched when the tags are already upgraded', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'ford' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g).issues;
    const [action] = issues[0].autoArgs;

    const upgraded = w.update({ tags: { ford: 'yes' } });
    const graph = new Rapid.Graph(new Rapid.Graph(context, [upgraded]));

    const result = action(graph);
    assert.strictEqual(result.hasEntity(w.id), upgraded);
  });

  it('tag-as-not fix leaves the entity untouched when it is already tagged as not that brand', () => {
    // A name-suggestion-index match for the brand that the node is already tagged as not
    const matched = { mainTag: 'brand:wikidata', tags: { 'brand:wikidata': 'Q1' }, displayName: 'Brand' };
    const nsi = {
      status: 'ok',
      upgradeTags: tags => ({ newTags: { ...tags, brand: 'Brand', 'brand:wikidata': 'Q1' }, matched: matched })
    };
    let performed;
    const editor = { perform: action => { performed = action; }, commit: () => {} };

    const prevEditor = context.systems.editor;
    context.systems.editor = editor;
    context.services.nsi = nsi;
    try {
      const nsiValidator = Rapid.validateOutdatedTags(context);
      const n = new Rapid.OsmNode(context, {
        loc: [0, 0],
        tags: { amenity: 'cafe', name: 'Brand', 'not:brand:wikidata': 'Q1' }
      });
      const g = new Rapid.Graph(context, [n]);
      const issues = nsiValidator(n, g).issues;
      assert.lengthOf(issues, 1);

      const fixes = issues[0].dynamicFixes();
      assert.lengthOf(fixes, 2);
      fixes[1].onClick();   // "tag as not Brand"

      const graph = new Rapid.Graph(g);
      const result = performed(graph);
      assert.strictEqual(result.hasEntity(n.id), n);
    } finally {
      context.systems.editor = prevEditor;
      delete context.services.nsi;
    }
  });

  it('ignores multipolygon tagged on the relation', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, {
      tags: { building: 'yes', type: 'multipolygon' },
      members: [{ id: w.id, role: 'outer' }]
    });
    const g = new Rapid.Graph(context, [w, r]);
    const wIssues = validator(w, g).issues;
    const rIssues = validator(r, g).issues;
    assert.deepEqual(wIssues, []);
    assert.deepEqual(rIssues, []);
  });

});
