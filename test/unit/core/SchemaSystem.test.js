import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock, spyOn } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './SchemaSystem.sample.js';


describe('SchemaSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:    new Rapid.AssetSystem(context),
    l10n:      new Rapid.LocalizationSystem(context),
    locations: new Rapid.LocationSystem(context),
    urlhash:   new Rapid.UrlHashSystem(context)
  };


  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a SchemaSystem from a context', () => {
        const schema = new Rapid.SchemaSystem(context);
        assert.instanceOf(schema, Rapid.SchemaSystem);
        assert.strictEqual(schema.id, 'schema');
        assert.strictEqual(schema.context, context);
        assert.instanceOf(schema.requiredDependencies, Set);
        assert.instanceOf(schema.optionalDependencies, Set);
        assert.isTrue(schema.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const schema = new Rapid.SchemaSystem(context);
        schema.requiredDependencies.add('missing');
        const prom = schema.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });

      it('sets addablePresetIDs, if present in the urlhash', () => {
        const urlhash = context.systems.urlhash;
        urlhash.initialHashParams.set('presets', 'one,two,three');

        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.deepEqual(schema.addablePresetIDs, new Set(['one', 'two', 'three']));
          })
          .finally(() => {
            urlhash.initialHashParams.delete('presets');
          });
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.initAsync().then(() => schema.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(schema.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  // The tests in here need to run serially, because we rely on being able to
  // merge multiple preset schemas into the SchemaSystem and then matching against them.
  describe.serial('methods', () => {
    const spySchemaChange = mock();
    let _schema, _savedAreaKeys;

    beforeAll(() => {
      _schema = new Rapid.SchemaSystem(context);
      context.systems.schema = _schema;
      return _schema.initAsync()
        .then(() => _schema.startAsync())
        .then(() => _schema.on('schemachange', spySchemaChange));
    });

    beforeEach(() => {
      _savedAreaKeys = Rapid.osmAreaKeys;
    });

    afterEach(() => {
      Rapid.osmSetAreaKeys(_savedAreaKeys);
    });

    describe('properties', () => {
      it('geometryTypes', () => {
        assert.deepEqual(_schema.geometryTypes, new Set(['point', 'vertex', 'line', 'area', 'relation']));
      });

      it('fieldTypes', () => {
        assert.instanceOf(_schema.fieldTypes, Set);
        // It might seem silly to test the field types this way, but if this list changes,
        // things in the user interface may break.  Do not add a new field type without
        // also adding a user interface component to support that field type.
        assert.hasAllKeys(_schema.fieldTypes, [
          'access', 'address', 'check', 'combo', 'cycleway', 'defaultCheck', 'email',
          'identifier', 'lanes', 'localized', 'roadspeed', 'roadheight', 'manyCombo',
          'multiCombo', 'networkCombo', 'number', 'onewayCheck', 'radio', 'restrictions',
          'semiCombo', 'structureRadio', 'tel', 'text', 'textarea', 'typeCombo', 'url',
          'wikidata', 'wikipedia'
        ]);
      });

      it('bundles', () => {
        assert.instanceOf(_schema.bundles, Set);

        const keys = [..._schema.bundles];
        // merged 'id-tagging-schema' data at init...
        assert.isTrue(keys.some(key => /^id-tagging-schema@/.test(key)));
        // merged 'rapid-schema-overrides' data at init...
        assert.isTrue(keys.some(key => /^rapid-schema-overrides@/.test(key)));
      });

      it('presets', () => {
        assert.instanceOf(_schema.presets, Map);
      });

      it('fields', () => {
        assert.instanceOf(_schema.fields, Map);
      });

      it('categories', () => {
        assert.instanceOf(_schema.categories, Map);
      });

      it('universal', () => {
        assert.instanceOf(_schema.universal, Map);
      });

      it('defaults', () => {
        assert.instanceOf(_schema.defaults, Map);
        assert.hasAllKeys(_schema.defaults, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('_matchIndex', () => {
        assert.instanceOf(_schema._matchIndex, Map);
        assert.hasAllKeys(_schema._matchIndex, ['point', 'vertex', 'line', 'area', 'relation']);
      });
    });


    describe('merge', () => {
      it('throws if bundleID is missing', () => {
        const schemaData = {};
        assert.throws(() => _schema.merge(schemaData), /missing bundleID/i);
      });

      it('throws if bundleID has already been merged', () => {
        const schemaData = { bundleID: 'test1' };
        assert.doesNotHaveAnyKeys(_schema.bundles, ['test1']);
        assert.doesNotThrow(() => _schema.merge(schemaData));
        assert.containsAllKeys(_schema.bundles, ['test1']);
        assert.throws(() => _schema.merge(schemaData), /already merged/i);
      });

      describe('merge add', () => {
        const orig = console.warn;

        beforeAll(() => {
          console.warn = () => {};   // temporarily silence the warning
          spySchemaChange.mockClear();  // reset call count
          _schema.merge(sample.addSurfData);
        });

        afterAll(() => {
          console.warn = orig;  // restore console.warn
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
        });

        it('adds the merged bundleID to the bundles Set', () => {
          assert.containsAllKeys(_schema.bundles, ['add-surf-data']);
        });

        describe('fields', () => {
          it('adds a new field', () => {
            const surfField = _schema.fields.get('surf/type');
            assert.instanceOf(surfField, Rapid.Field);
            assert.deepInclude(surfField.props, {
              bundleID: 'add-surf-data',
              id: 'surf/type',
              label: 'Surf Type',
              key: 'surf:type',
              type: 'combo'
            });
          });

          it('ignores unrecognized field types', () => {
            assert.isUndefined(_schema.fields.get('weather'));
          });
        });

        describe('presets', () => {
          it('adds a new preset', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            assert.instanceOf(surfPreset, Rapid.Preset);
            assert.deepInclude(surfPreset.props, {
              bundleID: 'add-surf-data',
              id: 'amenity/shop/surf',
              name: 'Surf Shop'
            });
          });

          it('rewrites icon names from iD- to rapid-', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            assert.deepEqual(surfPreset.props.icon, 'rapid-surfing');
          });

          it('references merged fields', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            const fields = surfPreset.fields();
            assert.deepEqual(fields, [ _schema.fields.get('name'), _schema.fields.get('surf/type') ]);
          });

          it('references merged morefields', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            const fields = surfPreset.moreFields();
            assert.deepEqual(fields, [ _schema.fields.get('board/type') ]);
          });
        });

        describe('categories', () => {
          it('adds a new category', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            assert.instanceOf(surfCategory, Rapid.Category);
            assert.deepInclude(surfCategory.props, {
              bundleID: 'add-surf-data',
              id: 'category-surfing',
              name: 'Surf Features'
            });
          });

          it('rewrites icon names from iD- to rapid-', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            assert.deepEqual(surfCategory.props.icon, 'rapid-surfing');
          });

          it('references merged presets, ignores unknown presets', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            const presets = surfCategory.presets;
            assert.deepEqual(presets, [ _schema.presets.get('amenity/shop/surf') ]);
          });
        });

        describe('defaults', () => {
          it('adds itemIDs to the specified Sets', () => {
            const expected = ['amenity/shop/surf', 'club/surf'];
            assert.containsAllKeys(_schema.defaults.get('point'), expected);
            assert.containsAllKeys(_schema.defaults.get('area'), expected);
          });
          it('ignores invalid geometry types', () => {
            assert.isUndefined(_schema.defaults.get('dummy'));
          });
        });

        describe('locations', () => {
          it('adds custom locations in FeatureCollection', () => {
            const loco = context.systems.locations._loco;
            assert.isOk(loco._cache.get('surf-city-nj.geojson'));  // added to LocationConflation cache
          });

          it('resolved custom locations on fields', () => {
            const surfField = _schema.fields.get('surf/type');
            assert.deepEqual(surfField.props.locationSetID, '+[surf-city-nj.geojson]');
          });

          it('resolved custom locations on presets', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            assert.deepEqual(surfPreset.props.locationSetID, '+[surf-city-nj.geojson]');
          });

          it('resolved custom locations on fields', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            assert.deepEqual(surfCategory.props.locationSetID, '+[surf-city-nj.geojson]');
          });
        });
      });


      describe('merge update', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();  // reset call count
          _schema.merge(sample.updateSurfData);
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
        });

        it('adds the merged bundleID to the bundles Set', () => {
          assert.containsAllKeys(_schema.bundles, ['add-surf-data', 'update-surf-data']);
        });

        describe('fields', () => {
          it('updates an existing field', () => {
            const surfField = _schema.fields.get('surf/type');
            assert.instanceOf(surfField, Rapid.Field);
            assert.deepInclude(surfField.props, {
              bundleID: 'update-surf-data',  // new bundleID
              id: 'surf/type',
              label: 'Surfing Type',  // new name
              key: 'surf:type',
              type: 'combo'
            });
          });
        });

        describe('presets', () => {
          it('updates an existing preset', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            assert.instanceOf(surfPreset, Rapid.Preset);
            assert.deepInclude(surfPreset.props, {
              bundleID: 'update-surf-data',  // new bundleID
              id: 'amenity/shop/surf',
              name: 'Surfing Shop'   // new name
            });
          });
        });

        describe('categories', () => {
          it('updates an existing category', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            assert.instanceOf(surfCategory, Rapid.Category);
            assert.deepInclude(surfCategory.props, {
              bundleID: 'update-surf-data',   // new bundleID
              id: 'category-surfing',
              name: 'Surfing Features'  // new name
            });
          });

          it('references merged presets, ignores unknown presets', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            const presets = surfCategory.presets;
            assert.deepEqual(presets, [
              _schema.presets.get('amenity/shop/surf'),
              _schema.presets.get('club/surf')   // newly added
            ]);
          });
        });

        describe('locations', () => {
          it('adds custom locations in FeatureCollection', () => {
            const loco = context.systems.locations._loco;
            assert.isOk(loco._cache.get('surf-city-nc.geojson'));  // added to LocationConflation cache
          });

          it('resolved custom locations on fields', () => {
            const surfField = _schema.fields.get('surf/type');
            assert.deepEqual(surfField.props.locationSetID, '+[surf-city-nc.geojson,surf-city-nj.geojson]');
          });

          it('resolved custom locations on presets', () => {
            const surfPreset = _schema.presets.get('amenity/shop/surf');
            assert.deepEqual(surfPreset.props.locationSetID, '+[surf-city-nc.geojson,surf-city-nj.geojson]');
          });

          it('resolved custom locations on fields', () => {
            const surfCategory = _schema.categories.get('category-surfing');
            assert.deepEqual(surfCategory.props.locationSetID, '+[surf-city-nc.geojson,surf-city-nj.geojson]');
          });
        });
      });

      describe('merge delete', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();  // reset call count
          _schema.merge(sample.deleteSurfData);
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
        });

        it('adds the merged bundleID to the bundles Set', () => {
          assert.containsAllKeys(_schema.bundles, ['add-surf-data', 'update-surf-data', 'delete-surf-data']);
        });

        describe('fields', () => {
          it('deletes an existing fieldID', () => {
            assert.isUndefined(_schema.fields.get('board/type'));
          });

          it(`deletes wildcard fieldIDs containing '?'`, () => {
            assert.isUndefined(_schema.fields.get('field/foo1'));
            assert.isUndefined(_schema.fields.get('field/foo2'));
          });

          it(`deletes wildcard fieldIDs containing '*'`, () => {
            assert.isUndefined(_schema.fields.get('field/ban'));
            assert.isUndefined(_schema.fields.get('field/bun'));
          });
        });

        describe('presets', () => {
          it('deletes an existing presetID', () => {
            assert.isUndefined(_schema.presets.get('club/surf'));
          });

          it(`deletes wildcard presetIDs containing '?'`, () => {
            assert.isUndefined(_schema.fields.get('preset/foo1'));
            assert.isUndefined(_schema.fields.get('preset/foo2'));
          });

          it(`deletes wildcard presetIDs containing '*'`, () => {
            assert.isUndefined(_schema.fields.get('preset/ban'));
            assert.isUndefined(_schema.fields.get('preset/bun'));
          });
        });

        describe('categories', () => {
          it('deletes an existing categoryID', () => {
            assert.isUndefined(_schema.categories.get('category-shopping'));
          });

          it(`deletes wildcard categoryIDs containing '?'`, () => {
            assert.isUndefined(_schema.fields.get('category-foo1'));
            assert.isUndefined(_schema.fields.get('category-foo2'));
          });

          it(`deletes wildcard categoryIDs containing '*'`, () => {
            assert.isUndefined(_schema.fields.get('category-ban'));
            assert.isUndefined(_schema.fields.get('category-bun'));
          });
        });
      });
    });   // merge


    describe('item', () => {
      it('gets a preset by its presetID', () => {
        const result = _schema.item('amenity/shop/surf');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'amenity/shop/surf');
      });

      it('gets a category by its categoryID', () => {
        const result = _schema.item('category-surfing');
        assert.instanceOf(result, Rapid.Category);
        assert.deepEqual(result.id, 'category-surfing');
      });

      it('returns undefined if no presetID or categoryID found', () => {
        assert.isUndefined(_schema.item('invalid'));
      });
    });


    describe('field', () => {
      it('gets a field by its fieldID', () => {
        const result = _schema.field('surf/type');
        assert.instanceOf(result, Rapid.Field);
        assert.deepEqual(result.id, 'surf/type');
      });

      it('returns undefined if no fieldID found', () => {
        assert.isUndefined(_schema.field('invalid'));
      });
    });


    describe('search', () => {
      beforeAll(() => {
        _schema._resetAll();   // remove the surf data
        _schema.merge(sample.searchData);
      });

      it('returns nothing if no query', () => {
        assert.deepEqual(_schema.search(), []);
      });

      it('returns nothing if no geometries', () => {
        assert.deepEqual(_schema.search('resid'), []);
      });

      it('scores exact primary match above fuzzy primary match', () => {
        const results = _schema.search('park', ['area']);
        // console.log(`\nsearch for 'park'`);
        // console.log(results);
        assert.lengthOf(results, 2);

        assert.strictEqual(results[0].id, 'leisure/park');   // "Park"
        assert.deepEqual(results[0].terms, ['park']);
        assert.deepEqual(results[0].match.park, ['primary']);
        assert.isAbove(results[0].score, 50);   // exact primary match has high score

        assert.strictEqual(results[1].id, 'amenity/parking');  // "Parking"
        assert.deepEqual(results[1].terms, ['parking']);
        assert.deepEqual(results[1].match.parking, ['primary']);
        assert.isBelow(results[1].score, 10);   // fuzzy match has low score
      });

      it('scores exact alternate match above fuzzy primary match', () => {
        const results = _schema.search('sand', ['point']);
        // console.log(`\nsearch for 'sand'`);
        // console.log(results);
        assert.lengthOf(results, 2);

        assert.strictEqual(results[0].id, 'amenity/shop/surf');   // "Surf Shop"
        assert.deepEqual(results[0].terms, ['sand']);
        assert.deepEqual(results[0].match.sand, ['alternate']);
        assert.isBelow(results[0].score, 50);   // exact alternate match has medium score
        assert.isAbove(results[0].score, 10);

        assert.strictEqual(results[1].id, 'amenity/grit_bin');  // "Sandpit"
        assert.deepEqual(results[1].terms, ['sandpit']);
        assert.deepEqual(results[1].match.sandpit, ['primary']);
        assert.isBelow(results[1].score, 10);   // fuzzy match has low score
      });

      it('returns alternate matches in correct order', () => {
        const results = _schema.search('gri', 'point');
        // console.log(`\nsearch for 'gri'`);
        // console.log(results);
        assert.lengthOf(results, 3);

        assert.strictEqual(results[0].id, 'amenity/bbq');
        assert.deepEqual(results[0].terms, ['grill']);
        assert.deepEqual(results[0].match.grill, ['primary']);

        assert.strictEqual(results[1].id, 'amenity/grit_bin');
        assert.deepEqual(results[1].terms, ['grit']);
        assert.deepEqual(results[1].match.grit, ['alternate']);

        assert.strictEqual(results[2].id, 'leisure/pitch/american_football');
        assert.deepEqual(results[2].terms, ['gridiron']);
        assert.deepEqual(results[2].match.gridiron, ['alternate']);
      });

      it('preserves diacritics in the query, allowing for exact diacritic matches', () => {
        const results = _schema.search('ğṝȁ', 'area');
        // console.log(`\nsearch for 'ğṝȁ'`);
        // console.log(results);
        assert.lengthOf(results, 1);

        assert.strictEqual(results[0].id, 'landuse/grass2');
        assert.deepEqual(results[0].terms, ['ğṝȁß']);
        assert.deepEqual(results[0].match.ğṝȁß, ['primary']);
      });

      it('matches diacritic-folded terms as alternate matches', () => {
        const results = _schema.search('grass', 'area');
        // console.log(`\nsearch for 'grass'`);
        // console.log(results);
        assert.lengthOf(results, 3);

        assert.strictEqual(results[0].id, 'landuse/grass1');    // name: "Grass"
        assert.deepEqual(results[0].terms, ['grass']);
        assert.deepEqual(results[0].match.grass, ['primary']);
        assert.isAbove(results[0].score, 50);       // exact match has high score

        assert.strictEqual(results[1].id, 'landuse/grass2');    // name: "Ğṝȁß"
        assert.deepEqual(results[1].terms, ['grass']);
        assert.deepEqual(results[1].match.grass, ['alternate']);
        assert.isBelow(results[1].score, 50);

        assert.strictEqual(results[2].id, 'leisure/park');    // name: "Park", terms includes "grass"
        assert.deepEqual(results[2].terms, ['grass']);
        assert.deepEqual(results[2].match.grass, ['alternate']);
        assert.isBelow(results[2].score, 50);
      });

      it('filtered results must be valid for geometries requested', () => {
        const results = _schema.search('sand', ['point', 'area']);
        // console.log(`\nsearch for 'sand'`);
        // console.log(results);
        assert.lengthOf(results, 1);
        // no "Grit Bin" - it only supports "point" and not "area"

        assert.strictEqual(results[0].id, 'amenity/shop/surf');
        assert.deepEqual(results[0].terms, ['sand']);
        assert.deepEqual(results[0].match.sand, ['alternate']);
      });

      it('filtered results must be valid at location requested', () => {
        const results = _schema.search('sand', ['point'], [-75.1638, 39.9526]);
        // console.log(`\nsearch for 'sand'`);
        // console.log(results);
        assert.lengthOf(results, 1);
        // no "Surf Shop" - it is not supported at the given location

        assert.strictEqual(results[0].id, 'amenity/grit_bin');  // "Sandpit"
        assert.deepEqual(results[0].terms, ['sandpit']);
        assert.deepEqual(results[0].match.sandpit, ['primary']);
      });


      it('excludes presets with searchable: false', () => {
        const results = _schema.search('excluded', 'point');
        // console.log(`\nsearch for 'excluded'`);
        // console.log(results);
        assert.isEmpty(results);
      });

      it('throws if no search index available', () => {  // run this test last!
        _schema._currSearchIndex = null;
        assert.throws(() => _schema.search('grass'), /not ready/i);
      });

    });  // search


    describe('getFallback', () => {
      it('gets the fallback point Preset', () => {
        const result = _schema.getFallback('point');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'point');
        assert.isTrue(result.isFallback());
      });

      it('returns the fallback point Preset for vertex', () => {
        const result = _schema.getFallback('vertex');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'point');
        assert.isTrue(result.isFallback());
      });

      it('gets the fallback line Preset', () => {
        const result = _schema.getFallback('line');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'line');
        assert.isTrue(result.isFallback());
      });

      it('gets the fallback area Preset', () => {
        const result = _schema.getFallback('area');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'area');
        assert.isTrue(result.isFallback());
      });

      it('gets the fallback relation Preset', () => {
        const result = _schema.getFallback('relation');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'relation');
        assert.isTrue(result.isFallback());
      });

      it('returns undefined for unrecognized geometry type values', () => {
        assert.isUndefined(_schema.getFallback('fake'));
      });
    });


    describe('setMostRecent', () => {
      beforeAll(() => {
        _schema._resetAll();
        _schema.merge(sample.searchData);  // use the sample search data
        _schema._recentIDs = null;
      });

      it('ignores invalid preset parameter', () => {
        assert.doesNotThrow(() => _schema.setMostRecent());
        assert.isNull(_schema._recentIDs);
      });

      it('ignores unsearchable presets', () => {
        const excluded = _schema.item('amenity/excluded');
        _schema.setMostRecent(excluded);
        assert.isNull(_schema._recentIDs);
      });

      it('adds searchable presets in reverse order', () => {
        const sandpit = _schema.item('amenity/grit_bin');
        const surfing = _schema.item('amenity/shop/surf');
        _schema.setMostRecent(sandpit);
        _schema.setMostRecent(surfing);
        assert.deepEqual(_schema._recentIDs, ['amenity/shop/surf', 'amenity/grit_bin']);
      });

      it('removes seen duplicates', () => {
        const sandpit = _schema.item('amenity/grit_bin');
        _schema.setMostRecent(sandpit);   // Prepend "Sandpit" back to the beginning of the list
        assert.deepEqual(_schema._recentIDs, ['amenity/grit_bin', 'amenity/shop/surf']);
      });
    });


    describe('getRecents', () => {
      beforeAll(() => {
        _schema._resetAll();
        _schema.merge(sample.searchData);  // use the sample search data
        _schema._recentIDs = null;
      });

      it('if no recentIDs, returns an empty array', () => {
        const result = _schema.getRecents();
        assert.deepEqual(result, []);
        assert.deepEqual(_schema._recentIDs, []);
      });

      it('converts recognized recentIDs to Presets', () => {
        const sandpit = _schema.item('amenity/grit_bin');
        const surfing = _schema.item('amenity/shop/surf');
        _schema._recentIDs = [surfing.id, sandpit.id];
        const result = _schema.getRecents();
        assert.deepEqual(result, [surfing, sandpit]);
      });

      it('ignores unrecognized recentIDs', () => {
        _schema._recentIDs = ['amenity/fake'];
        const result = _schema.getRecents();
        assert.deepEqual(result, []);
      });
    });


    describe('getDefaults', () => {
      beforeAll(() => {
        _schema._resetAll();
        _schema.merge(sample.searchData);  // use the sample search data
      });

      it('if no geometry, returns an empty array', () => {
        const result = _schema.getDefaults();
        assert.deepEqual(result, []);
      });

      it('no recents and no defaults, returns only the fallback preset', () => {
        _schema._recentIDs = [];
        _schema.defaults.set('point', []);
        _schema.addablePresetIDs = null;

        const point = _schema.item('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [point]);
      });

      it('has recents but no defaults, returns recents and fallback preset', () => {
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        _schema.defaults.set('point', []);
        _schema.addablePresetIDs = null;

        const sandpit = _schema.item('amenity/grit_bin');
        const surfing = _schema.item('amenity/shop/surf');
        const point = _schema.item('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [sandpit, surfing, point]);
      });

      it('has defaults but no recents, returns defaults and fallback preset', () => {
        _schema._recentIDs = [];
        _schema.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = null;

        const bbq = _schema.item('amenity/bbq');
        const point = _schema.item('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [bbq, point]);
      });

      it('has recents and defaults, returns recents, then defaults, then fallback preset', () => {
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        _schema.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = null;

        const sandpit = _schema.item('amenity/grit_bin');
        const surfing = _schema.item('amenity/shop/surf');
        const bbq = _schema.item('amenity/bbq');
        const point = _schema.item('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [sandpit, surfing, bbq, point]);
      });

      it('optionally uses the addablePresetIDs instead of the defaults', () => {
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        _schema.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = new Set(['amenity/parking']);

        const sandpit = _schema.item('amenity/grit_bin');
        const surfing = _schema.item('amenity/shop/surf');
        const parking = _schema.item('amenity/parking');
        const point = _schema.item('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [sandpit, surfing, parking, point]);
      });

      it('optionally skips the recents', () => {
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        _schema.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = new Set(['amenity/parking']);

        const parking = _schema.item('amenity/parking');
        const point = _schema.item('point');

        const result = _schema.getDefaults('point', false  /* no recents */);
        assert.deepEqual(result, [parking, point]);
      });

      it('optionally filters by location, if location provided', () => {
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        _schema.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = null;

        const sandpit = _schema.item('amenity/grit_bin');
        const bbq = _schema.item('amenity/bbq');
        const point = _schema.item('point');

        const result = _schema.getDefaults('point', true, [-75.1638, 39.9526]);
        assert.deepEqual(result, [sandpit, bbq, point]);
        // no "Surf Shop" - it is not supported at the given location
      });
    });


    describe('_localeChanged', () => {
      let field, preset, category;
      let fieldSpy, presetSpy, categorySpy;

      beforeAll(() => {
        field = new Rapid.Field(context, { id: 'wikidata', type: 'wikidata', key: 'wikidata', universal: true });
        preset = new Rapid.Preset(context, { id: 'residential', geometry: ['line'], tags: { highway: 'residential' } });
        category = new Rapid.Category(context, { id: 'roads', members: ['residential'] });

        fieldSpy = spyOn(field, 'setLocale');
        presetSpy = spyOn(preset, 'setLocale');
        categorySpy = spyOn(category, 'setLocale');

        _schema.fields.set(field.id, field);
        _schema.presets.set(preset.id, preset);
        _schema.categories.set(category.id, category);
      });

      it(`defaults to en-US, calls 'setLocale' on Fields, Presets, Categories`, () => {
        fieldSpy.mockClear();
        presetSpy.mockClear();
        categorySpy.mockClear();

        _schema._currLocaleCode = null;
        _schema._localeChanged();

        assert.strictEqual(_schema._currLocaleCode, 'en-US');

        assert.lengthOf(fieldSpy.mock.calls, 1);     // setLocale called once
        assert.lengthOf(presetSpy.mock.calls, 1);    // setLocale called once
        assert.lengthOf(categorySpy.mock.calls, 1);  // setLocale called once

        assert.deepEqual(fieldSpy.mock.lastCall, ['en-US']);
        assert.deepEqual(presetSpy.mock.lastCall, ['en-US']);
        assert.deepEqual(categorySpy.mock.lastCall, ['en-US']);
      });

      it(`accepts a localeCode, calls 'setLocale' on Fields, Presets, Categories`, () => {
        fieldSpy.mockClear();
        presetSpy.mockClear();
        categorySpy.mockClear();

        _schema._currLocaleCode = null;
        _schema._localeChanged('de');

        assert.strictEqual(_schema._currLocaleCode, 'de');

        assert.lengthOf(fieldSpy.mock.calls, 1);     // setLocale called once
        assert.lengthOf(presetSpy.mock.calls, 1);    // setLocale called once
        assert.lengthOf(categorySpy.mock.calls, 1);  // setLocale called once

        assert.deepEqual(fieldSpy.mock.lastCall, ['de']);
        assert.deepEqual(presetSpy.mock.lastCall, ['de']);
        assert.deepEqual(categorySpy.mock.lastCall, ['de']);
      });
    });


    describe('_prepareSearchIndex', () => {
      it(`defaults to 'en-US', creates a search index`, () => {
        _schema._searchIndexes.clear();
        _schema._currLocaleCode = null;
        _schema._currSearchIndex = null;

        _schema._prepareSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'en-US');
        const index = _schema._searchIndexes.get('en-US');
        assert.strictEqual(index.constructor.name, 'MiniSearch');
        assert.strictEqual(_schema._currSearchIndex, index);
      });

      it(`reuses an existing search index when changing locales`, () => {
        _schema._searchIndexes.clear();
        _schema._currSearchIndex = null;

        _schema._currLocaleCode = 'en-US';
        _schema._prepareSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'en-US');
        const index1 = _schema._currSearchIndex;

        _schema._currLocaleCode = 'de';
        _schema._prepareSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'de');
        const index2 = _schema._currSearchIndex;

        _schema._currLocaleCode = 'en-US';
        _schema._prepareSearchIndex();
        const index3 = _schema._currSearchIndex;

        assert.notStrictEqual(index1, index2);
        assert.strictEqual(index1, index3);
      });
    });


    describe('_rebuildSearchIndex', () => {
      it(`calls '_prepareSearchIndex' if needed`, () => {
        _schema._searchIndexes.clear();
        _schema._currLocaleCode = null;
        _schema._currSearchIndex = null;

        _schema._rebuildSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'en-US');
        const index = _schema._currSearchIndex;
        assert.strictEqual(index.constructor.name, 'MiniSearch');
      });

      it(`rebuilds the search index`, () => {
        _schema._searchIndexes.clear();
        _schema._currSearchIndex = null;

        _schema._currLocaleCode = 'en-US';
        _schema._prepareSearchIndex();

        const index = _schema._currSearchIndex;
        index.removeAll();  // clear it
        assert.strictEqual(index.documentCount, 0);  // has no documents

        _schema._rebuildSearchIndex();
        assert.isAbove(index.documentCount, 0);  // has documents
      });
    });


    describe('_schemaChanged', () => {
      let field, preset, category;
      let fieldSpy, presetSpy, categorySpy;

      beforeAll(() => {
        field = new Rapid.Field(context, { id: 'wikidata', type: 'wikidata', key: 'wikidata', universal: true });
        preset = new Rapid.Preset(context, { id: 'residential', geometry: ['line'], tags: { highway: 'residential' } });
        category = new Rapid.Category(context, { id: 'roads', members: ['residential'] });

        fieldSpy = spyOn(field, 'reset');
        presetSpy = spyOn(preset, 'reset');
        categorySpy = spyOn(category, 'reset');

        _schema.fields.set(field.id, field);
        _schema.presets.set(preset.id, preset);
        _schema.categories.set(category.id, category);

        _schema._schemaChanged();
      });

      it(`calls 'reset' on Fields, Presets, and Categories`, () => {
        assert.lengthOf(fieldSpy.mock.calls, 1);     // reset called once
        assert.lengthOf(presetSpy.mock.calls, 1);    // reset called once
        assert.lengthOf(categorySpy.mock.calls, 1);  // reset called once
      });

      it('updates the universal field cache', () => {
        assert.strictEqual(_schema.universal.get('wikidata'), field);
      });
    });


    describe('_resetAll', () => {
      beforeAll(() => {
        spySchemaChange.mockClear();  // reset call count
        _schema._resetAll();
      });

      it('resets bundles', () => {
        assert.instanceOf(_schema.bundles, Set);
        assert.isEmpty(_schema.bundles);
      });

      it('resets fields', () => {
        assert.instanceOf(_schema.fields, Map);
        assert.isEmpty(_schema.fields);
      });

      it('resets presets', () => {
        assert.instanceOf(_schema.presets, Map);
        assert.hasAllKeys(_schema.presets, ['point', 'line', 'area', 'relation']);
      });

      it('resets categories', () => {
        assert.instanceOf(_schema.categories, Map);
        assert.isEmpty(_schema.categories);
      });

      it('resets universal', () => {
        assert.instanceOf(_schema.universal, Map);
        assert.isEmpty(_schema.universal);
      });

      it('resets defaults', () => {
        assert.instanceOf(_schema.defaults, Map);
        assert.hasAllKeys(_schema.defaults, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('resets _matchIndex', () => {
        assert.instanceOf(_schema._matchIndex, Map);
        assert.hasAllKeys(_schema._matchIndex, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('emits schemachange after merging', () => {
        assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
      });
    });

  });  // methods


  describe('match', () => {
    beforeEach(() => {
      const testPresets = {
        residential: { tags: { highway: 'residential' }, geometry: ['line'] },
        park: { tags: { leisure: 'park' }, geometry: ['point', 'area'] }
      };
      context.systems.assets._cache.iD_schema_presets = testPresets;
    });

    it('returns a collection containing presets matching a geometry and tags', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        const way = new Rapid.OsmWay(context, { tags: { highway: 'residential' } });
        const graph = new Rapid.Graph(context, [way]);
        assert.strictEqual(schema.match(way, graph).id, 'residential');
      });
    });

    it('returns the appropriate fallback preset when no tags match', () => {
      const schema = new Rapid.SchemaSystem(context);
      const point = new Rapid.OsmNode(context);
      const line = new Rapid.OsmWay(context, { tags: { foo: 'bar' } });
      const graph = new Rapid.Graph(context, [point, line]);

      return schema.initAsync().then(() => {
        assert.strictEqual(schema.match(point, graph).id, 'point');
        assert.strictEqual(schema.match(line, graph).id, 'line');
      });
    });

    it('matches vertices on a line as points', () => {
      const schema = new Rapid.SchemaSystem(context);
      const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
      const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'highway': 'residential' } });
      const graph = new Rapid.Graph(context, [point, line]);

      return schema.initAsync().then(() => {
        assert.strictEqual(schema.match(point, graph).id, 'point');
      });
    });

    it('matches vertices on an addr:interpolation line as points', () => {
      const schema = new Rapid.SchemaSystem(context);
      const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
      const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'addr:interpolation': 'even' } });
      const graph = new Rapid.Graph(context, [point, line]);

      return schema.initAsync().then(() => {
        assert.strictEqual(schema.match(point, graph).id, 'park');
      });
    });
  });   // match


  describe('areaKeys', () => {
    beforeEach(() => {
      const testPresets = {
        'amenity/fuel/shell': { tags: { 'amenity': 'fuel' }, geometry: ['point', 'area'], suggestion: true },
        'highway/foo': { tags: { 'highway': 'foo' }, geometry: ['area'] },
        'leisure/track': { tags: { 'leisure': 'track' }, geometry: ['line', 'area'] },
        'natural': { tags: { 'natural': '*' }, geometry: ['point', 'vertex', 'area'] },
        'natural/peak': { tags: { 'natural': 'peak' }, geometry: ['point', 'vertex'] },
        'natural/tree_row': { tags: { 'natural': 'tree_row' }, geometry: ['line'] },
        'natural/wood': { tags: { 'natural': 'wood' }, geometry: ['point', 'area'] }
      };
      context.systems.assets._cache.iD_schema_presets = testPresets;
    });

    it('includes keys for presets with area geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.containsAllKeys(schema.areaKeys(), ['natural']);
      });
    });

    it('discards key-values for presets with a line geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.containsAllKeys(schema.areaKeys().natural, ['tree_row']);
        assert.isTrue(schema.areaKeys().natural.tree_row);
      });
    });

    it('discards key-values for presets with both area and line geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.containsAllKeys(schema.areaKeys().leisure, ['track']);
      });
    });

    it('does not discard key-values for presets with neither area nor line geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.doesNotHaveAllKeys(schema.areaKeys().natural, ['peak']);
      });
    });

    it('does not discard generic \'*\' key-values', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.doesNotHaveAllKeys(schema.areaKeys().natural, ['natural']);
      });
    });

    it('ignores keys like \'highway\' that are assumed to be lines', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.doesNotHaveAllKeys(schema.areaKeys(), ['highway']);
      });
    });

    it('ignores suggestion presets', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        assert.doesNotHaveAllKeys(schema.areaKeys(), ['amenity']);
      });
    });
  });


  describe('match', () => {
    beforeEach(() => {
      const testPresets = {
        building: {
          name: 'Building',
          tags: { building: 'yes' },
          geometry: ['area']
        },
        'type/multipolygon': {
          name: 'Multipolygon',
          geometry: ['area', 'relation'],
          tags: { 'type': 'multipolygon' },
          searchable: false,
          matchScore: 0.1
        },
        address: {
          name: 'Address',
          geometry: ['point', 'vertex', 'area'],
          tags: { 'addr:*': '*' },
          matchScore: 0.15
        },
        'highway/pedestrian_area': {
          name: 'Pedestrian Area',
          geometry: ['area'],
          tags: { highway: 'pedestrian', area: 'yes' }
        }
      };
      context.systems.assets._cache.iD_schema_presets = testPresets;
    });


    it('prefers building to multipolygon', () => {
      const schema = new Rapid.SchemaSystem(context);
      const relation = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon', building: 'yes' } });
      const graph = new Rapid.Graph(context, [relation]);
      return schema.initAsync().then(() => {
        const match = schema.match(relation, graph);
        assert.strictEqual(match.id, 'building');
      });
    });

    it('prefers building to address', () => {
      const schema = new Rapid.SchemaSystem(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes', building: 'yes', 'addr:housenumber': '1234' } });
      const graph = new Rapid.Graph(context, [way]);
      return schema.initAsync().then(() => {
        const match = schema.match(way, graph);
        assert.strictEqual(match.id, 'building');
      });
    });

    it('prefers pedestrian to area', () => {
      const schema = new Rapid.SchemaSystem(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes', highway: 'pedestrian' } });
      const graph = new Rapid.Graph(context, [way]);
      return schema.initAsync().then(() => {
        const match = schema.match(way, graph);
        assert.strictEqual(match.id, 'highway/pedestrian_area');
      });
    });
  });

});
