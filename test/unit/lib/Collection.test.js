import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Collection', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };

  const schema = context.systems.schema;
  let _collection;

  beforeAll(() => {
    return schema.initAsync().then(() => {
      const presetData = {
        schemaID: 'test',
        presets: {
          'amenity/bbq': {
            name: 'Grill', tags: { amenity: 'bbq' }, geometry: ['point'], terms: []
          },
          'amenity/grit_bin': {
            name: 'Sandpit', tags: { amenity: 'grit_bin' }, geometry: ['point'], terms: []
          },
          'highway/residential': {
            name: 'Residential Area', tags: { highway: 'residential' }, geometry: ['point', 'area'], terms: []
          },
          'landuse/grass1': {
            name: 'Grass', tags: { landuse: 'grass' }, geometry: ['point', 'area'], terms: []
          },
          'landuse/grass2': {
            name: 'Ğṝȁß', tags: { landuse: 'ğṝȁß' }, geometry: ['point', 'area'], terms: []
          },
          'leisure/park': {
            name: 'Park', tags: { leisure: 'park' }, geometry: ['point', 'area'], terms: [ 'grass' ], matchScore: 0.5
          },
          'amenity/parking': {
            name: 'Parking', tags: { amenity: 'parking' }, geometry: ['point', 'area'], terms: [ 'cars' ]
          },
          'leisure/pitch/soccer': {
            name: 'Soccer Field', tags: { leisure: 'pitch', sport: 'soccer' }, geometry: ['point', 'area'], terms: ['fußball']
          },
          'leisure/pitch/american_football': {
            name: 'Football Field', tags: { leisure: 'pitch', sport: 'american_football' }, geometry: ['point', 'area'], terms: ['gridiron']
          },
          'amenity/excluded': {
            name: 'Excluded', tags: { amenity: 'excluded' }, geometry: ['point'], terms: [], searchable: false
          }
        }
      };
      schema.merge(presetData);

      // construct the Collection
      _collection = new Rapid.Collection(context, [
        schema.item('amenity/bbq'),
        schema.item('amenity/grit_bin'),
        schema.item('highway/residential'),
        schema.item('landuse/grass1'),
        schema.item('landuse/grass2'),
        schema.item('leisure/park'),
        schema.item('amenity/parking'),
        schema.item('leisure/pitch/soccer'),
        schema.item('leisure/pitch/american_football'),
        schema.item('amenity/excluded')
      ]);

    });
  });


  describe('constructor', () => {
    it('constructs a Collection from a context and an Array of Presets', () => {
      assert.instanceOf(_collection, Rapid.Collection);
      assert.strictEqual(_collection.context, context);
      assert.isArray(_collection.array);
    });
  });

  describe.skip('search', () => {
//// TODO fix - these are all messed up
    it('matches leading name', () => {
      const result = _collection.search('resid', 'area').array;
      const residential = schema.item('highway/residential');
      assert.equal(result.indexOf(residential), 0);  // 1. 'Residential' (by name)
    });

    it.skip('returns alternate matches in correct order', () => {
////      const result = collection.search('gri', 'point').matchGeometry('point').array;

//// as of today it is returning
//['amenity/grit_bin',
// 'amenity/bbq',
// 'leisure/park',
// 'landuse/grass1',
// 'landuse/grass2',
// 'amenity/parking',
// 'highway/residential',
// 'leisure/pitch/soccer',
// 'leisure/pitch/american_football'
// ]
//
//      expect(result.indexOf(p.grill), 'Grill').to.eql(0);            // 1. 'Grill' (leading name)
//      expect(result.indexOf(p.football), 'Football').to.eql(1);      // 2. 'Football' (leading term 'gridiron')
//      expect(result.indexOf(p.sandpit), 'Sandpit').to.eql(2);        // 3. 'Sandpit' (leading tag value 'grit_bin')
//      expect(result.indexOf(p.grass1), 'Grass').to.be.within(3,5);   // 4. 'Grass' (similar name)
//      expect(result.indexOf(p.grass2), 'Ğṝȁß').to.be.within(3,5);    // 5. 'Ğṝȁß' (similar name)
//      expect(result.indexOf(p.park), 'Park').to.be.within(3,5);      // 6. 'Park' (similar term 'grass')
    });

    it('sorts preset with matchScore penalty below others', () => {
      const parking = schema.item('amenity/parking');
      const park = schema.item('leisure/park');
      const result = _collection.search('par', 'point').array;
      assert.equal(result.indexOf(parking), 0, 'Parking');   // 1. 'Parking' (default matchScore)
      assert.equal(result.indexOf(park), 1, 'Park');         // 2. 'Park' (low matchScore)
    });

    it('ignores matchScore penalty for exact name match', () => {
      const parking = schema.item('amenity/parking');
      const park = schema.item('leisure/park');
      const result = _collection.search('park', 'point').array;
      assert.equal(result.indexOf(park), 0, 'Park');         // 1. 'Park' (low matchScore)
      assert.equal(result.indexOf(parking), 1, 'Parking');   // 2. 'Parking' (default matchScore)
    });

    it('considers diacritics on exact matches', () => {
      const grass1 = schema.item('landuse/grass1');
      const grass2 = schema.item('landuse/grass2');
      const result = _collection.search('ğṝȁ', 'point').array;
      assert.equal(result.indexOf(grass2), 0, 'Ğṝȁß');    // 1. 'Ğṝȁß'  (leading name)
      assert.equal(result.indexOf(grass1), 1, 'Grass');   // 2. 'Grass' (similar name)
    });

    it('replaces diacritics on fuzzy matches', () => {
      const grass1 = schema.item('landuse/grass1');
      const grass2 = schema.item('landuse/grass2');
      const result = _collection.search('graß', 'point').array;
      assert.ok(result.indexOf(grass1) < 2, 'Grass');   // 1. 'Grass' (similar name)
      assert.ok(result.indexOf(grass2) < 2, 'Ğṝȁß');    // 2. 'Ğṝȁß'  (similar name)
    });

    // it('includes the appropriate fallback preset', () => {
    //   assert.ok(collection.search('foo', 'point').array.includes(p.point), 'point');
    //   assert.ok(collection.search('foo', 'line').array.includes(p.line), 'line');
    //   assert.ok(collection.search('foo', 'area').array.includes(p.area), 'area');
    // });

    it('excludes presets with searchable: false', () => {
      const excluded = schema.item('amenity/excluded');
      const result = _collection.search('excluded', 'point').array;
      assert.ok(!result.includes(excluded));
    });
  });
});
