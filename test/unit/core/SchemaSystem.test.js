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

  // Setup mock asset data that SchemaSystem attempts to load at init time.
  const assets = context.systems.assets;
  assets._loaded.id_tagging_schema = { assetID: 'id_tagging_schema' };
  assets._loaded.osm_rulesets = { assetID: 'osm_rulesets' };
  assets._loaded.rapid_schema = { assetID: 'rapid_schema' };
  assets._loaded.custom_schema = { assetID: 'custom_schema' };

  // Setup mock asset data that LocalizationSystem attempts to load during initAsync.
  assets._loaded.languages = { languages: { en: { nativeName: 'English' } } };
  assets._loaded.locales = { locales: { en: { rtl: false } } };
  assets._loaded.territory_languages = { territoryLanguages: { us: ['en'] } };
  assets._loaded.l10n_core_en = { en: {} };
  assets._loaded.l10n_tagging_en = { en: {} };
  assets._loaded.l10n_imagery_en = { en: {} };
  assets._loaded.l10n_community_en = { en: {} };


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
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const schema = new Rapid.SchemaSystem(context);
        schema.requiredDependencies.add('missing');
        const prom = schema.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
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

      it('inits without an AssetSystem', () => {
        const orig = context.systems.assets;
        delete context.systems.assets;

        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true))
          .finally(() => context.systems.assets = orig);  // restore
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.initAsync().then(() => schema.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(schema.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const schema = new Rapid.SchemaSystem(context);
        const prom = schema.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
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

      it('defaultAssetIDs', () => {
        assert.deepEqual(_schema.defaultAssetIDs, new Set(['id_tagging_schema', 'osm_rulesets', 'rapid_schema']));
      });

      it('loadedAssetIDs', () => {
        assert.instanceOf(_schema.loadedAssetIDs, Map);
        // Note: The actual assets loaded depend on test environment.
        // The merge tests below verify that merge() properly adds to loadedAssetIDs.
      });

      it('presets', () => {
        assert.instanceOf(_schema.getScope('osm').presets, Map);
      });

      it('fields', () => {
        assert.instanceOf(_schema.getScope('osm').fields, Map);
      });

      it('categories', () => {
        assert.instanceOf(_schema.getScope('osm').categories, Map);
      });

      it('universal', () => {
        assert.instanceOf(_schema.getScope('osm').universal, Map);
      });

      it('defaults', () => {
        assert.instanceOf(_schema.getScope('osm').defaults, Map);
        assert.hasAllKeys(_schema.getScope('osm').defaults, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('matchIndex', () => {
        assert.instanceOf(_schema.getScope('osm').matchIndex, Map);
        assert.hasAllKeys(_schema.getScope('osm').matchIndex, ['point', 'vertex', 'line', 'area', 'relation']);
      });
    });


    describe('requestedAssetIDs', () => {
      it('is initially null', () => {
        assert.isNull(_schema.requestedAssetIDs);
      });

      it('accepts a string', () => {
        _schema.requestedAssetIDs = 'zero';
        assert.deepEqual(_schema.requestedAssetIDs, new Set(['zero']));
      });

      it('accepts an Array', () => {
        _schema.requestedAssetIDs = ['one', 'two'];
        assert.deepEqual(_schema.requestedAssetIDs, new Set(['one', 'two']));
      });

      it('accepts a Set', () => {
        _schema.requestedAssetIDs = new Set(['three', 'four']);
        assert.deepEqual(_schema.requestedAssetIDs, new Set(['three', 'four']));
      });

      it(`handles the 'default' keyword`, () => {
        _schema.requestedAssetIDs = new Set(['five', 'default', 'six']);
        const expected = ['five', ..._schema.defaultAssetIDs, 'six'];
        assert.deepEqual(_schema.requestedAssetIDs, new Set(expected));
      });

      it('accepts empty string', () => {
        _schema.requestedAssetIDs = '';
        assert.deepEqual(_schema.requestedAssetIDs, new Set());
      });

      it('accepts null or undefined', () => {
        _schema.requestedAssetIDs = null;
        assert.isNull(_schema.requestedAssetIDs);
        _schema.requestedAssetIDs = undefined;
        assert.isNull(_schema.requestedAssetIDs);
      });
    });


    describe('merge', () => {
      it('throws if assetID is missing', () => {
        const schemaData = {};
        assert.throws(() => _schema.merge(schemaData), /missing assetID/i);
      });

      it('throws if assetID has already been merged', () => {
        const schemaData = { assetID: 'test1' };
        assert.isFalse(_schema.loadedAssetIDs.has('test1'));
        assert.doesNotThrow(() => _schema.merge(schemaData));
        assert.isTrue(_schema.loadedAssetIDs.has('test1'));
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

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _schema.loadedAssetIDs.get('add-surf-data');
          assert.strictEqual(version, '2026-01-01');
        });

        describe('fields', () => {
          it('adds a new field', () => {
            const surfField = _schema.getScope('osm').fields.get('surf/type');
            assert.instanceOf(surfField, Rapid.Field);
            assert.deepInclude(surfField.props, {
              assetID: 'add-surf-data',
              id: 'surf/type',
              label: 'Surf Type',
              key: 'surf:type',
              type: 'combo'
            });
          });

          it('ignores unrecognized field types', () => {
            assert.isUndefined(_schema.getScope('osm').fields.get('weather'));
          });
        });

        describe('presets', () => {
          it('adds a new preset', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            assert.instanceOf(surfPreset, Rapid.Preset);
            assert.deepInclude(surfPreset.props, {
              assetID: 'add-surf-data',
              id: 'amenity/shop/surf',
              name: 'Surf Shop'
            });
          });

          it('rewrites icon names from iD- to rapid-', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            assert.deepEqual(surfPreset.props.icon, 'rapid-surfing');
          });

          it('references merged fields', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            const fields = surfPreset.fields();
            const scope = _schema.getScope('osm');
            assert.deepEqual(fields, [ scope.fields.get('name'), scope.fields.get('surf/type') ]);
          });

          it('references merged morefields', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            const fields = surfPreset.moreFields();
            const scope = _schema.getScope('osm');
            assert.deepEqual(fields, [ scope.fields.get('board/type') ]);
          });
        });

        describe('categories', () => {
          it('adds a new category', () => {
            const surfCategory = _schema.getScope('osm').categories.get('category-surfing');
            assert.instanceOf(surfCategory, Rapid.Category);
            assert.deepInclude(surfCategory.props, {
              assetID: 'add-surf-data',
              id: 'category-surfing',
              name: 'Surf Features'
            });
          });

          it('rewrites icon names from iD- to rapid-', () => {
            const surfCategory = _schema.getScope('osm').categories.get('category-surfing');
            assert.deepEqual(surfCategory.props.icon, 'rapid-surfing');
          });

          it('references merged presets, ignores unknown presets', () => {
            const surfCategory = _schema.getScope('osm').categories.get('category-surfing');
            const presets = surfCategory.presets;
            assert.deepEqual(presets, [ _schema.getScope('osm').presets.get('amenity/shop/surf') ]);
          });
        });

        describe('defaults', () => {
          it('adds itemIDs to the specified Sets', () => {
            const expected = ['amenity/shop/surf', 'club/surf'];
            assert.containsAllKeys(_schema.getScope('osm').defaults.get('point'), expected);
            assert.containsAllKeys(_schema.getScope('osm').defaults.get('area'), expected);
          });
          it('ignores invalid geometry types', () => {
            assert.isUndefined(_schema.getScope('osm').defaults.get('dummy'));
          });
        });

        describe('locations', () => {
          it('adds custom locations in FeatureCollection', () => {
            const loco = context.systems.locations._loco;
            assert.isOk(loco._cache.get('surf-city-nj.geojson'));  // added to LocationConflation cache
          });

          it('resolved custom locations on fields', () => {
            const surfField = _schema.getScope('osm').fields.get('surf/type');
            assert.deepEqual(surfField.props.locationSetID, '+[surf-city-nj.geojson]');
          });

          it('resolved custom locations on presets', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            assert.deepEqual(surfPreset.props.locationSetID, '+[surf-city-nj.geojson]');
          });

          it('resolved custom locations on fields', () => {
            const surfCategory = _schema.getScope('osm').categories.get('category-surfing');
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

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _schema.loadedAssetIDs.get('update-surf-data');
          assert.strictEqual(version, '2026-01-02');
        });

        describe('fields', () => {
          it('updates an existing field', () => {
            const surfField = _schema.getScope('osm').fields.get('surf/type');
            assert.instanceOf(surfField, Rapid.Field);
            assert.deepInclude(surfField.props, {
              assetID: 'update-surf-data',  // new assetID
              id: 'surf/type',
              label: 'Surfing Type',  // new name
              key: 'surf:type',
              type: 'combo'
            });
          });
        });

        describe('presets', () => {
          it('updates an existing preset', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            assert.instanceOf(surfPreset, Rapid.Preset);
            assert.deepInclude(surfPreset.props, {
              assetID: 'update-surf-data',  // new assetID
              id: 'amenity/shop/surf',
              name: 'Surfing Shop'   // new name
            });
          });
        });

        describe('categories', () => {
          it('updates an existing category', () => {
            const scope = _schema.getScope('osm');
            const surfCategory = scope.categories.get('category-surfing');
            assert.instanceOf(surfCategory, Rapid.Category);
            assert.deepInclude(surfCategory.props, {
              assetID: 'update-surf-data',   // new assetID
              id: 'category-surfing',
              name: 'Surfing Features'  // new name
            });
          });

          it('references merged presets, ignores unknown presets', () => {
            const scope = _schema.getScope('osm');
            const surfCategory = scope.categories.get('category-surfing');
            const presets = surfCategory.presets;
            assert.deepEqual(presets, [
              scope.presets.get('amenity/shop/surf'),
              scope.presets.get('club/surf')   // newly added
            ]);
          });
        });

        describe('locations', () => {
          it('adds custom locations in FeatureCollection', () => {
            const loco = context.systems.locations._loco;
            assert.isOk(loco._cache.get('surf-city-nc.geojson'));  // added to LocationConflation cache
          });

          it('resolved custom locations on fields', () => {
            const surfField = _schema.getScope('osm').fields.get('surf/type');
            assert.deepEqual(surfField.props.locationSetID, '+[surf-city-nc.geojson,surf-city-nj.geojson]');
          });

          it('resolved custom locations on presets', () => {
            const surfPreset = _schema.getScope('osm').presets.get('amenity/shop/surf');
            assert.deepEqual(surfPreset.props.locationSetID, '+[surf-city-nc.geojson,surf-city-nj.geojson]');
          });

          it('resolved custom locations on fields', () => {
            const surfCategory = _schema.getScope('osm').categories.get('category-surfing');
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

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _schema.loadedAssetIDs.get('delete-surf-data');
          assert.strictEqual(version, '2026-01-03');
        });

        describe('fields', () => {
          it('deletes an existing fieldID', () => {
            assert.isUndefined(_schema.getScope('osm').fields.get('board/type'));
          });

          it(`deletes wildcard fieldIDs containing '?'`, () => {
            assert.isUndefined(_schema.getScope('osm').fields.get('field/foo1'));
            assert.isUndefined(_schema.getScope('osm').fields.get('field/foo2'));
          });

          it(`deletes wildcard fieldIDs containing '*'`, () => {
            assert.isUndefined(_schema.getScope('osm').fields.get('field/ban'));
            assert.isUndefined(_schema.getScope('osm').fields.get('field/bun'));
          });
        });

        describe('presets', () => {
          it('deletes an existing presetID', () => {
            assert.isUndefined(_schema.getScope('osm').presets.get('club/surf'));
          });

          it(`deletes wildcard presetIDs containing '?'`, () => {
            assert.isUndefined(_schema.getScope('osm').presets.get('preset/foo1'));
            assert.isUndefined(_schema.getScope('osm').presets.get('preset/foo2'));
          });

          it(`deletes wildcard presetIDs containing '*'`, () => {
            assert.isUndefined(_schema.getScope('osm').presets.get('preset/ban'));
            assert.isUndefined(_schema.getScope('osm').presets.get('preset/bun'));
          });
        });

        describe('categories', () => {
          it('deletes an existing categoryID', () => {
            assert.isUndefined(_schema.getScope('osm').categories.get('category-shopping'));
          });

          it(`deletes wildcard categoryIDs containing '?'`, () => {
            assert.isUndefined(_schema.getScope('osm').categories.get('category-foo1'));
            assert.isUndefined(_schema.getScope('osm').categories.get('category-foo2'));
          });

          it(`deletes wildcard categoryIDs containing '*'`, () => {
            assert.isUndefined(_schema.getScope('osm').categories.get('category-ban'));
            assert.isUndefined(_schema.getScope('osm').categories.get('category-bun'));
          });
        });
      });


      describe('merge add rulesets', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();
          _schema.merge(sample.addRulesetData);
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _schema.loadedAssetIDs.get('add-ruleset-data');
          assert.strictEqual(version, '2026-03-01');
        });

        it('adds a paved ruleset', () => {
          const scope = _schema.getScope('osm');
          const paved = scope.rulesets.get('surface_paved');
          assert.instanceOf(paved, Rapid.Ruleset);
          assert.strictEqual(paved.id, 'surface_paved');
        });

        it('paved ruleset has correct rules count', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.lengthOf(paved.include, 2);   // 'in' rule + exact match rule
        });

        it('paved ruleset matches surface=asphalt', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.isTrue(paved.match({ surface: 'asphalt' }));
        });

        it('paved ruleset matches tracktype=grade1', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.isTrue(paved.match({ tracktype: 'grade1' }));
        });

        it('paved ruleset does not match surface=gravel', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.isFalse(paved.match({ surface: 'gravel' }));
        });

        it('oneway_forward ruleset matches highway=motorway', () => {
          const forward = _schema.getScope('osm').rulesets.get('oneway_forward');
          assert.isTrue(forward.match({ highway: 'motorway' }));
        });

        it('connected_highway ruleset matches highway=trunk', () => {
          const routable = _schema.getScope('osm').rulesets.get('connected_highway');
          assert.isTrue(routable.match({ highway: 'trunk' }));
        });

        it('connected_highway ruleset does not match highway=raceway', () => {
          const routable = _schema.getScope('osm').rulesets.get('connected_highway');
          assert.isFalse(routable.match({ highway: 'raceway' }));
        });

        it('sets assetID on ruleset props', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.strictEqual(paved.props.assetID, 'add-ruleset-data');
        });

        it('sets scopeID on ruleset props', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.strictEqual(paved.props.scopeID, 'osm');
        });
      });


      describe('merge update rulesets', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();
          _schema.merge(sample.updateRulesetData);
        });

        it('replaces the paved ruleset', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.instanceOf(paved, Rapid.Ruleset);
          assert.strictEqual(paved.props.assetID, 'update-ruleset-data');
        });

        it('updated paved ruleset matches surface=chipseal', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.isTrue(paved.match({ surface: 'chipseal' }));
        });

        it('does not affect other rulesets', () => {
          const forward = _schema.getScope('osm').rulesets.get('oneway_forward');
          assert.instanceOf(forward, Rapid.Ruleset);
          assert.strictEqual(forward.props.assetID, 'add-ruleset-data');  // still the original
        });
      });


      describe('merge delete rulesets', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();
          _schema.merge(sample.deleteRulesetData);
        });

        it('deletes an exact rulesetID', () => {
          assert.isUndefined(_schema.getScope('osm').rulesets.get('connected_highway'));
        });

        it(`deletes wildcard rulesetIDs containing '*'`, () => {
          assert.isUndefined(_schema.getScope('osm').rulesets.get('oneway_forward'));
        });

        it('does not delete non-matching rulesets', () => {
          const paved = _schema.getScope('osm').rulesets.get('surface_paved');
          assert.instanceOf(paved, Rapid.Ruleset);
        });
      });
    });   // merge


    describe('getScope collections', () => {
      it('gets a preset by its presetID from scope.presets', () => {
        const result = _schema.getScope('osm').presets.get('amenity/shop/surf');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'amenity/shop/surf');
      });

      it('gets a category by its categoryID from scope.categories', () => {
        const result = _schema.getScope('osm').categories.get('category-surfing');
        assert.instanceOf(result, Rapid.Category);
        assert.deepEqual(result.id, 'category-surfing');
      });

      it('returns undefined for unknown IDs', () => {
        assert.isUndefined(_schema.getScope('osm').presets.get('invalid'));
        assert.isUndefined(_schema.getScope('osm').categories.get('invalid'));
      });

      it('gets a field by its fieldID from scope.fields', () => {
        const result = _schema.getScope('osm').fields.get('surf/type');
        assert.instanceOf(result, Rapid.Field);
        assert.deepEqual(result.id, 'surf/type');
      });

      it('returns undefined for unknown fieldID', () => {
        assert.isUndefined(_schema.getScope('osm').fields.get('invalid'));
      });
    });


    describe('search', () => {
      beforeAll(() => {
        _schema.resetAll();   // remove the surf data
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
        _schema.getScope('osm').currSearchIndex = null;
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
        _schema.resetAll();
        _schema.merge(sample.searchData);  // use the sample search data
        _schema._recentIDs = null;
      });

      it('ignores invalid preset parameter', () => {
        assert.doesNotThrow(() => _schema.setMostRecent());
        assert.isNull(_schema._recentIDs);
      });

      it('ignores unsearchable presets', () => {
        const excluded = _schema.getScope('osm').presets.get('amenity/excluded');
        _schema.setMostRecent(excluded);
        assert.isNull(_schema._recentIDs);
      });

      it('adds searchable presets in reverse order', () => {
        const scope = _schema.getScope('osm');
        const sandpit = scope.presets.get('amenity/grit_bin');
        const surfing = scope.presets.get('amenity/shop/surf');
        _schema.setMostRecent(sandpit);
        _schema.setMostRecent(surfing);
        assert.deepEqual(_schema._recentIDs, ['amenity/shop/surf', 'amenity/grit_bin']);
      });

      it('removes seen duplicates', () => {
        const sandpit = _schema.getScope('osm').presets.get('amenity/grit_bin');
        _schema.setMostRecent(sandpit);   // Prepend "Sandpit" back to the beginning of the list
        assert.deepEqual(_schema._recentIDs, ['amenity/grit_bin', 'amenity/shop/surf']);
      });
    });


    describe('getRecents', () => {
      beforeAll(() => {
        _schema.resetAll();
        _schema.merge(sample.searchData);  // use the sample search data
        _schema._recentIDs = null;
      });

      it('if no recentIDs, returns an empty array', () => {
        const result = _schema.getRecents();
        assert.deepEqual(result, []);
        assert.deepEqual(_schema._recentIDs, []);
      });

      it('converts recognized recentIDs to Presets', () => {
        const scope = _schema.getScope('osm');
        const sandpit = scope.presets.get('amenity/grit_bin');
        const surfing = scope.presets.get('amenity/shop/surf');
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
        _schema.resetAll();
        _schema.merge(sample.searchData);  // use the sample search data
      });

      it('if no geometry, returns an empty array', () => {
        const result = _schema.getDefaults();
        assert.deepEqual(result, []);
      });

      it('no recents and no defaults, returns only the fallback preset', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = [];
        scope.defaults.set('point', []);
        _schema.addablePresetIDs = null;

        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [point]);
      });

      it('has recents but no defaults, returns recents and fallback preset', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        scope.defaults.set('point', []);
        _schema.addablePresetIDs = null;

        const sandpit = scope.presets.get('amenity/grit_bin');
        const surfing = scope.presets.get('amenity/shop/surf');
        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [sandpit, surfing, point]);
      });

      it('has defaults but no recents, returns defaults and fallback preset', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = [];
        scope.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = null;

        const bbq = scope.presets.get('amenity/bbq');
        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [bbq, point]);
      });

      it('has recents and defaults, returns recents, then defaults, then fallback preset', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        scope.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = null;

        const sandpit = scope.presets.get('amenity/grit_bin');
        const surfing = scope.presets.get('amenity/shop/surf');
        const bbq = scope.presets.get('amenity/bbq');
        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [sandpit, surfing, bbq, point]);
      });

      it('optionally uses the addablePresetIDs instead of the defaults', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        scope.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = new Set(['amenity/parking']);

        const sandpit = scope.presets.get('amenity/grit_bin');
        const surfing = scope.presets.get('amenity/shop/surf');
        const parking = scope.presets.get('amenity/parking');
        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point');
        assert.deepEqual(result, [sandpit, surfing, parking, point]);
      });

      it('optionally skips the recents', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        scope.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = new Set(['amenity/parking']);

        const parking = scope.presets.get('amenity/parking');
        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point', false  /* no recents */);
        assert.deepEqual(result, [parking, point]);
      });

      it('optionally filters by location, if location provided', () => {
        const scope = _schema.getScope('osm');
        _schema._recentIDs = ['amenity/grit_bin', 'amenity/shop/surf'];
        scope.defaults.set('point', ['amenity/bbq']);
        _schema.addablePresetIDs = null;

        const sandpit = scope.presets.get('amenity/grit_bin');
        const bbq = scope.presets.get('amenity/bbq');
        const point = _schema.getFallback('point');

        const result = _schema.getDefaults('point', true, [-75.1638, 39.9526]);
        assert.deepEqual(result, [sandpit, bbq, point]);
        // no "Surf Shop" - it is not supported at the given location
      });
    });


    describe('loadSchemaAssetsAsync', () => {
      const origError = console.error;
      const spyError = mock();

      beforeAll(() => {
        console.error = spyError;
      });

      beforeEach(() => {
        spyError.mockClear();  // reset call count
      });

      afterAll(() => {
        console.error = origError;
      });

      it('returns a promise', () => {
        const prom = _schema.loadSchemaAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('uses requestedAssetIDs when set', () => {
        _schema.requestedAssetIDs = 'custom_schema';
        const prom = _schema.loadSchemaAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.isTrue(_schema.loadedAssetIDs.has('custom_schema'));
            assert.isFalse(_schema.loadedAssetIDs.has('id_tagging_schema'));
            assert.isFalse(_schema.loadedAssetIDs.has('rapid_schema'));
          })
          .finally(() => _schema.requestedAssetIDs = null);  // restore
      });

      it('uses defaultAssetIDs when requestedAssetIDs is null', () => {
        _schema.requestedAssetIDs = null;
        const prom = _schema.loadSchemaAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // Default assetIDs includes 'id_tagging_schema' and 'rapid_schema'
            assert.isTrue(_schema.loadedAssetIDs.has('id_tagging_schema'));
            assert.isTrue(_schema.loadedAssetIDs.has('rapid_schema'));
          });
      });

      it('handles rejected asset loading gracefully', () => {
        // Set requestedAssetIDs to something that will fail to load
        _schema.requestedAssetIDs = 'nonexistent-asset-12345';
        const prom = _schema.loadSchemaAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // promise succeeds, but error is logged
            assert.lengthOf(spyError.mock.calls, 1);   // console.error called once
            assert.match(spyError.mock.lastCall[0], /unknown assetID/i);
          })
          .finally(() => _schema.requestedAssetIDs = null);
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

        _schema.getScope('osm').fields.set(field.id, field);
        _schema.getScope('osm').presets.set(preset.id, preset);
        _schema.getScope('osm').categories.set(category.id, category);
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
        _schema.getScope('osm').searchIndexes.clear();
        _schema.getScope('osm').currSearchIndex = null;
        _schema._currLocaleCode = null;

        _schema._prepareSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'en-US');
        const index = _schema.getScope('osm').searchIndexes.get('en-US');
        assert.strictEqual(index.constructor.name, 'MiniSearch');
        assert.strictEqual(_schema.getScope('osm').currSearchIndex, index);
      });

      it(`reuses an existing search index when changing locales`, () => {
        _schema.getScope('osm').searchIndexes.clear();
        _schema.getScope('osm').currSearchIndex = null;

        _schema._currLocaleCode = 'en-US';
        _schema._prepareSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'en-US');
        const index1 = _schema.getScope('osm').currSearchIndex;

        _schema._currLocaleCode = 'de';
        _schema._prepareSearchIndex();

        assert.strictEqual(_schema._currLocaleCode, 'de');
        const index2 = _schema.getScope('osm').currSearchIndex;

        _schema._currLocaleCode = 'en-US';
        _schema._prepareSearchIndex();
        const index3 = _schema.getScope('osm').currSearchIndex;

        assert.notStrictEqual(index1, index2);
        assert.strictEqual(index1, index3);
      });
    });


    describe('_rebuildSearchIndex', () => {
      it(`calls '_prepareSearchIndex' if needed`, () => {
        _schema.getScope('osm').searchIndexes.clear();
        _schema.getScope('osm').currSearchIndex = null;
        _schema._currLocaleCode = null;

        _schema._rebuildSearchIndex(_schema.getScope('osm'));

        assert.strictEqual(_schema._currLocaleCode, 'en-US');
        const index = _schema.getScope('osm').currSearchIndex;
        assert.strictEqual(index.constructor.name, 'MiniSearch');
      });

      it(`rebuilds the search index`, () => {
        _schema.getScope('osm').searchIndexes.clear();
        _schema.getScope('osm').currSearchIndex = null;

        _schema._currLocaleCode = 'en-US';
        _schema._prepareSearchIndex();

        const index = _schema.getScope('osm').currSearchIndex;
        index.removeAll();  // clear it
        assert.strictEqual(index.documentCount, 0);  // has no documents

        _schema._rebuildSearchIndex(_schema.getScope('osm'));
        assert.isAbove(index.documentCount, 0);  // has documents
      });
    });


    describe('_hashChanged', () => {
      beforeEach(() => {
        spySchemaChange.mockClear();
      });

      afterEach(() => {
        _schema.requestedAssetIDs = null;
      });

      it('does nothing when schema param is unchanged', () => {
        const curr = new Map([['other', 'value']]);
        const prev = new Map([['other', 'value']]);
        _schema._hashChanged(curr, prev);
        assert.lengthOf(spySchemaChange.mock.calls, 0);   // No schema change should occur
      });

      it('handles schema param set to empty string', () => {
        const curr = new Map([['schema', '']]);
        const prev = new Map();
        _schema._hashChanged(curr, prev);
        assert.deepEqual(_schema.requestedAssetIDs, new Set());
        assert.isAtLeast(spySchemaChange.mock.calls.length, 1);   // schemachange emitted by resetAll
      });

      it('handles schema param set to null', () => {
        const curr = new Map();
        const prev = new Map([['schema', 'something']]);
        _schema._hashChanged(curr, prev);
        assert.isNull(_schema.requestedAssetIDs);
        assert.isAtLeast(spySchemaChange.mock.calls.length, 1);   // schemachange emitted by resetAll
      });

      it('handles schema param with asset IDs', () => {
        const curr = new Map([['schema', 'id_tagging_schema']]);
        const prev = new Map();
        _schema._hashChanged(curr, prev);
        assert.deepEqual(_schema.requestedAssetIDs, new Set(['id_tagging_schema']));
        assert.isAtLeast(spySchemaChange.mock.calls.length, 1);   // schemachange emitted by resetAll
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

        _schema.getScope('osm').fields.set(field.id, field);
        _schema.getScope('osm').presets.set(preset.id, preset);
        _schema.getScope('osm').categories.set(category.id, category);

        _schema._schemaChanged();
      });

      it(`calls 'reset' on Fields, Presets, and Categories`, () => {
        assert.lengthOf(fieldSpy.mock.calls, 1);     // reset called once
        assert.lengthOf(presetSpy.mock.calls, 1);    // reset called once
        assert.lengthOf(categorySpy.mock.calls, 1);  // reset called once
      });

      it('updates the universal field cache', () => {
        assert.strictEqual(_schema.getScope('osm').universal.get('wikidata'), field);
      });
    });


    describe('resetAll', () => {
      beforeAll(() => {
        spySchemaChange.mockClear();  // reset call count
        _schema.resetAll();
      });

      it('clears loadedAssetIDs', () => {
        assert.instanceOf(_schema.loadedAssetIDs, Map);
        assert.isEmpty(_schema.loadedAssetIDs);
      });

      it('resets fields', () => {
        assert.instanceOf(_schema.getScope('osm').fields, Map);
        assert.isEmpty(_schema.getScope('osm').fields);
      });

      it('resets presets', () => {
        assert.instanceOf(_schema.getScope('osm').presets, Map);
        assert.isEmpty(_schema.getScope('osm').presets);
      });

      it('creates common scope with fallback presets', () => {
        assert.instanceOf(_schema.getScope('*').presets, Map);
        assert.hasAllKeys(_schema.getScope('*').presets, ['point', 'line', 'area', 'relation']);
      });

      it('resets categories', () => {
        assert.instanceOf(_schema.getScope('osm').categories, Map);
        assert.isEmpty(_schema.getScope('osm').categories);
      });

      it('resets universal', () => {
        assert.instanceOf(_schema.getScope('osm').universal, Map);
        assert.isEmpty(_schema.getScope('osm').universal);
      });

      it('resets defaults', () => {
        assert.instanceOf(_schema.getScope('osm').defaults, Map);
        assert.hasAllKeys(_schema.getScope('osm').defaults, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('resets matchIndex', () => {
        assert.instanceOf(_schema.getScope('osm').matchIndex, Map);
        assert.hasAllKeys(_schema.getScope('osm').matchIndex, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('emits schemachange', () => {
        assert.lengthOf(spySchemaChange.mock.calls, 1);
      });
    });

  });  // methods


  describe('match', () => {
    const testPresets = {
      assetID: 'match-test-1',
      scopes: [{
        scope: 'osm',
        presets: {
          residential: { tags: { highway: 'residential' }, geometry: ['line'] },
          park: { tags: { leisure: 'park' }, geometry: ['point', 'area'] }
        }
      }]
    };

    it('returns a collection containing presets matching a geometry and tags', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const way = new Rapid.OsmWay(context, { tags: { highway: 'residential' } });
        const graph = new Rapid.Graph(context, [way]);
        assert.strictEqual(schema.match(way, graph).id, 'residential');
      });
    });

    it('returns the appropriate fallback preset when no tags match', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const point = new Rapid.OsmNode(context);
        const line = new Rapid.OsmWay(context, { tags: { foo: 'bar' } });
        const graph = new Rapid.Graph(context, [point, line]);
        assert.strictEqual(schema.match(point, graph).id, 'point');
        assert.strictEqual(schema.match(line, graph).id, 'line');
      });
    });

    it('matches vertices on a line as points', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
        const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'highway': 'residential' } });
        const graph = new Rapid.Graph(context, [point, line]);
        assert.strictEqual(schema.match(point, graph).id, 'point');
      });
    });

    it('matches vertices on an addr:interpolation line as points', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
        const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'addr:interpolation': 'even' } });
        const graph = new Rapid.Graph(context, [point, line]);
        assert.strictEqual(schema.match(point, graph).id, 'park');
      });
    });
  });   // match


  describe('areaKeys', () => {
    const testPresets = {
      assetID: 'areakeys-test',
      scopes: [{
        scope: 'osm',
        presets: {
          'amenity/fuel/shell': { tags: { 'amenity': 'fuel' }, geometry: ['point', 'area'], suggestion: true },
          'highway/foo': { tags: { 'highway': 'foo' }, geometry: ['area'] },
          'leisure/track': { tags: { 'leisure': 'track' }, geometry: ['line', 'area'] },
          'natural': { tags: { 'natural': '*' }, geometry: ['point', 'vertex', 'area'] },
          'natural/peak': { tags: { 'natural': 'peak' }, geometry: ['point', 'vertex'] },
          'natural/tree_row': { tags: { 'natural': 'tree_row' }, geometry: ['line'] },
          'natural/wood': { tags: { 'natural': 'wood' }, geometry: ['point', 'area'] }
        }
      }]
    };

    it('includes keys for presets with area geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.containsAllKeys(schema.areaKeys(), ['natural']);
      });
    });

    it('discards key-values for presets with a line geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.containsAllKeys(schema.areaKeys().natural, ['tree_row']);
        assert.isTrue(schema.areaKeys().natural.tree_row);
      });
    });

    it('discards key-values for presets with both area and line geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.containsAllKeys(schema.areaKeys().leisure, ['track']);
      });
    });

    it('does not discard key-values for presets with neither area nor line geometry', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.doesNotHaveAllKeys(schema.areaKeys().natural, ['peak']);
      });
    });

    it('does not discard generic \'*\' key-values', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.doesNotHaveAllKeys(schema.areaKeys().natural, ['natural']);
      });
    });

    it('ignores keys like \'highway\' that are assumed to be lines', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.doesNotHaveAllKeys(schema.areaKeys(), ['highway']);
      });
    });

    it('ignores suggestion presets', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        assert.doesNotHaveAllKeys(schema.areaKeys(), ['amenity']);
      });
    });
  });


  describe('match', () => {
    const testPresets = {
      assetID: 'match-test-2',
      scopes: [{
        scope: 'osm',
        presets: {
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
        }
      }]
    };

    it('prefers building to multipolygon', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const relation = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon', building: 'yes' } });
        const graph = new Rapid.Graph(context, [relation]);
        const match = schema.match(relation, graph);
        assert.strictEqual(match.id, 'building');
      });
    });

    it('prefers building to address', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const way = new Rapid.OsmWay(context, { tags: { area: 'yes', building: 'yes', 'addr:housenumber': '1234' } });
        const graph = new Rapid.Graph(context, [way]);
        const match = schema.match(way, graph);
        assert.strictEqual(match.id, 'building');
      });
    });

    it('prefers pedestrian to area', () => {
      const schema = new Rapid.SchemaSystem(context);
      return schema.initAsync().then(() => {
        schema.merge(testPresets);
        const way = new Rapid.OsmWay(context, { tags: { area: 'yes', highway: 'pedestrian' } });
        const graph = new Rapid.Graph(context, [way]);
        const match = schema.match(way, graph);
        assert.strictEqual(match.id, 'highway/pedestrian_area');
      });
    });
  });

});
