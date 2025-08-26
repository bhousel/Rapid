import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationMissingTag', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  const validator = Rapid.validationMissingTag(context);

  it('ignores way with descriptive tags', () => {
    const w = new Rapid.OsmWay(context,  { tags: { leisure: 'park' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.deepEqual(issues, []);
  });

  it('ignores multipolygon with descriptive tags', () => {
    const r = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon', leisure: 'park' }, members: [] });
    const g = new Rapid.Graph(context, [r]);
    const issues = validator(r, g);
    assert.deepEqual(issues, []);
  });

  it('flags missing tags', () => {
    const w = new Rapid.OsmWay(context);
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'missing_tag',
      subtype:   'any',
      entityIds: [w.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags missing descriptive tags on a way', () => {
    const w = new Rapid.OsmWay(context, { tags: { name: 'Main Street', source: 'Bing' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'missing_tag',
      subtype:   'descriptive',
      entityIds: [w.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags missing descriptive tags on multipolygon', () => {
    const r = new Rapid.OsmRelation(context, { tags: { name: 'City Park', source: 'Bing', type: 'multipolygon' }, members: [] });
    const g = new Rapid.Graph(context, [r]);
    const issues = validator(r, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'missing_tag',
      subtype:   'descriptive',
      entityIds: [r.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags missing type tag on relation', () => {
    const r = new Rapid.OsmRelation(context, { tags: { name: 'City Park', source: 'Bing', leisure: 'park' }, members: [] });
    const g = new Rapid.Graph(context, [r]);
    const issues = validator(r, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'missing_tag',
      subtype:   'relation_type',
      entityIds: [r.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('ignores highway with classification', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'primary' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.deepEqual(issues, []);
  });

  it('flags highway=road', () => {
    const w = new Rapid.OsmWay(context, { tags: { highway: 'road' }});
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'missing_tag',
      subtype:   'highway_classification',
      entityIds: [w.id]
    };
    assert.deepInclude(issues[0], expected);
  });

});
