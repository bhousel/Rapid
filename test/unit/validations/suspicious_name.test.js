import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationSuspiciousName', () => {

  class MockNsi {
    constructor() {
      this.status = 'ok';
    }
    isGenericName(tags) {
      const name = tags.name ?? '';
      // simulate global exclude
      if (/^stores?$/.test(name)) return true;
      // simulate category exclude
      if (/^(mini|super)?\s?(market|mart|mercado)( municipal)?$/.test(name)) return true;
      return false;
    }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };
  context.services = {
    nsi:   new MockNsi(context)
  };


  const validator = Rapid.validationSuspiciousName(context);

  it('ignores feature with no tags', () => {
    const n = new Rapid.OsmNode(context);
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores feature with no name', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores feature with a specific name', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lou\'s' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores feature with a specific name that includes a generic name', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lou\'s Store' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores feature matching excludeNamed pattern in name-suggestion-index', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'famiglia cooperativa' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('flags feature matching a excludeGeneric pattern in name-suggestion-index', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'super mercado' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'suspicious_name',
      subtype:   'generic_name',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags feature matching a global exclude pattern in name-suggestion-index', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'store' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'suspicious_name',
      subtype:   'generic_name',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags feature with a name that is just a defining tag key', () => {
    const n = new Rapid.OsmNode(context, { tags: { amenity: 'drinking_water', name: 'Amenity' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'suspicious_name',
      subtype:   'generic_name',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags feature with a name that is just a defining tag value', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'red_bicycle_emporium', name: 'Red Bicycle Emporium' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'suspicious_name',
      subtype:   'generic_name',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('ignores feature with a non-matching `not:name` tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lou\'s', 'not:name': 'Lous' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('flags feature with a matching `not:name` tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lous', 'not:name': 'Lous' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'suspicious_name',
      subtype:   'not_name',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('flags feature with a matching a semicolon-separated `not:name` tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { shop: 'supermarket', name: 'Lous', 'not:name': 'Louis\';Lous;Louis\'s' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);
    const expected = {
      type:      'suspicious_name',
      subtype:   'not_name',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

});
