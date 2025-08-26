import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationMissingRole', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  const validator = Rapid.validationMissingRole(context);


  it('ignores ways with no relations', () => {
    const w = new Rapid.OsmWay(context);
    const g = new Rapid.Graph(context, [w]);
    const issues = validator(w, g);
    assert.deepEqual(issues, []);
  });

  it('ignores member with missing role in non-multipolygon relation', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, { tags: { type: 'boundary' }, members: [{ id: w.id, role: '' }] });
    const g = new Rapid.Graph(context, [w, r]);
    const rIssues = validator(r, g);
    const wIssues = validator(w, g);
    assert.deepEqual(rIssues, []);
    assert.deepEqual(wIssues, []);
  });

  it('ignores way with outer role in multipolygon', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon' }, members: [{ id: w.id, role: 'outer' }] });
    const g = new Rapid.Graph(context, [w, r]);
    const rIssues = validator(r, g);
    const wIssues = validator(w, g);
    assert.deepEqual(rIssues, []);
    assert.deepEqual(wIssues, []);
  });

  it('ignores way with inner role in multipolygon', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon' }, members: [{ id: w.id, role: 'inner' }] });
    const g = new Rapid.Graph(context, [w, r]);
    const rIssues = validator(r, g);
    const wIssues = validator(w, g);
    assert.deepEqual(rIssues, []);
    assert.deepEqual(wIssues, []);
  });

  it('flags way with missing role in multipolygon', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon' }, members: [{ id: w.id, role: '' }] });
    const g = new Rapid.Graph(context, [w, r]);
    const rIssues = validator(r, g);
    const wIssues = validator(w, g);
    assert.isArray(rIssues);
    assert.lengthOf(rIssues, 1);
    assert.isArray(wIssues);
    assert.lengthOf(wIssues, 1);
    assert.strictEqual(rIssues[0].hash, wIssues[0].hash);

    const expected = {
      type:      'missing_role',
      entityIds: [r.id, w.id]
    };
    assert.deepInclude(rIssues[0], expected);
  });

  it('flags way with whitespace string role in multipolygon', () => {
    const w = new Rapid.OsmWay(context);
    const r = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon' }, members: [{ id: w.id, role: '  ' }] });
    const g = new Rapid.Graph(context, [w, r]);
    const rIssues = validator(r, g);
    const wIssues = validator(w, g);
    assert.isArray(rIssues);
    assert.lengthOf(rIssues, 1);
    assert.isArray(wIssues);
    assert.lengthOf(wIssues, 1);
    assert.strictEqual(rIssues[0].hash, wIssues[0].hash);

    const expected = {
      type:      'missing_role',
      entityIds: [r.id, w.id]
    };
    assert.deepInclude(rIssues[0], expected);
  });

});
