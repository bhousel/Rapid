import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationIncompatibleSource', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  const validator = Rapid.validationIncompatibleSource(context);


  it('ignores way with no source tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { amenity: 'cafe', building: 'yes', name: 'Key Largo Café' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores way with okay source tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { amenity: 'cafe', building: 'yes', name: 'Key Largo Café', source: 'survey' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('ignores way with excepted source tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { amenity: 'cafe', building: 'yes', name: 'Key Largo Café', source: 'Google drive' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('flags way with incompatible source tag', () => {
    const n = new Rapid.OsmNode(context, { tags: { amenity: 'cafe', building: 'yes', name: 'Key Largo Café', source: 'Google Maps' }});
    const issues = validator(n);
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:      'incompatible_source',
      entityIds: [n.id]
    };
    assert.deepInclude(issues[0], expected);
  });

  it('does not flag buildings in the google-africa-buildings dataset', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'yes', source: 'esri/Google_Africa_Buildings' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

  it('does not flag buildings in one of the many the google-open-buildings datasets', () => {
    const n = new Rapid.OsmNode(context, { tags: { building: 'yes', source: 'esri/Google_Open_Buildings' }});
    const issues = validator(n);
    assert.deepEqual(issues, []);
  });

});
