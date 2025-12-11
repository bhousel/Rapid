import { afterEach, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
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
  describe.serial('properties, methods', () => {
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

      it('schemas', () => {
        assert.instanceOf(_schema.schemas, Set);

        const keys = [..._schema.schemas];
        // merged 'id-tagging-schema' data at init...
        assert.isTrue(keys.some(key => /^id-tagging-schema@/.test(key)));
        // merged 'rapid-preset-overrides' data at init...
        assert.isTrue(keys.some(key => /^rapid-preset-overrides@/.test(key)));
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

      it('_searchable', () => {
        assert.instanceOf(_schema._searchable, Array);
      });

      it('_matchIndex', () => {
        assert.instanceOf(_schema._matchIndex, Map);
        assert.hasAllKeys(_schema._matchIndex, ['point', 'vertex', 'line', 'area', 'relation']);
      });

    });


    describe('_resetCaches', () => {
      it('resets caches in Fields, Presets, and Categories', () => {
        const field = new Rapid.Field(context, {
          id: 'wikidata', type: 'wikidata', key: 'wikidata', universal: true
        });
        field.resetCache = mock();

        const preset = new Rapid.Preset(context, {
          id: 'residential', geometry: ['line'], tags: { highway: 'residential' }
        });
        preset.resetCache = mock();

        const category = new Rapid.Category(context, {
          id: 'roads', members: ['residential']
        });
        category.resetCache = mock();

        _schema.fields.set(field.id, field);
        _schema.presets.set(preset.id, preset);
        _schema.categories.set(category.id, category);

        _schema._resetCaches();

        assert.lengthOf(field.resetCache.mock.calls, 1);     // resetCache called once
        assert.lengthOf(preset.resetCache.mock.calls, 1);    // resetCache called once
        assert.lengthOf(category.resetCache.mock.calls, 1);  // resetCache called once
      });
    });


    describe('_resetAll', () => {
      beforeAll(() => {
        spySchemaChange.mockClear();  // reset call count
        _schema._resetAll();
      });

      it('resets schemas', () => {
        assert.instanceOf(_schema.schemas, Set);
        assert.isEmpty(_schema.schemas);
      });

      it('resets fields', () => {
        assert.instanceOf(_schema.fields, Map);
        assert.isEmpty(_schema.fields);
      });

      it('resets presets', () => {
        assert.instanceOf(_schema.presets, Map);
        assert.hasAllKeys(_schema.presets, ['point', 'vertex', 'line', 'area', 'relation']);
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

      it('resets _searchable', () => {
        assert.instanceOf(_schema._searchable, Array);
        assert.deepEqual(_schema._searchable.map(item => item.id), ['point', 'line', 'area', 'relation']);
      });

      it('resets _matchIndex', () => {
        assert.instanceOf(_schema._matchIndex, Map);
        assert.hasAllKeys(_schema._matchIndex, ['point', 'vertex', 'line', 'area', 'relation']);
      });

      it('emits schemachange after merging', () => {
        assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
      });
    });


    describe('fallbacks', () => {
      it('has a fallback point Preset', () => {
        const result = _schema.presets.get('point');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'point');
        assert.isTrue(result.isFallback());
      });

      it('returns the fallback point Preset for vertex', () => {
        const result = _schema.presets.get('vertex');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'point');
        assert.isTrue(result.isFallback());
      });

      it('has a fallback line Preset', () => {
        const result = _schema.presets.get('line');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'line');
        assert.isTrue(result.isFallback());
      });

      it('has a fallback area Preset', () => {
        const result = _schema.presets.get('area');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'area');
        assert.isTrue(result.isFallback());
      });

      it('has a fallback relation Preset', () => {
        const result = _schema.presets.get('relation');
        assert.instanceOf(result, Rapid.Preset);
        assert.deepEqual(result.id, 'relation');
        assert.isTrue(result.isFallback());
      });
    });


    describe('merge', () => {
      it('throws if schemaID is missing', () => {
        const schemaData = {};
        assert.throws(() => _schema.merge(schemaData), /missing schemaID/i);
      });

      it('throws if schemaID has already been merged', () => {
        const schemaData = { schemaID: 'test1' };
        assert.doesNotHaveAnyKeys(_schema.schemas, ['test1']);
        assert.doesNotThrow(() => _schema.merge(schemaData));
        assert.containsAllKeys(_schema.schemas, ['test1']);
        assert.throws(() => _schema.merge(schemaData), /already merged/i);
      });

      describe('adding', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();  // reset call count
          _schema.merge(sample.addSurfData);
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
        });

        it('adds the merged schemaID to the schemas Set', () => {
          assert.containsAllKeys(_schema.schemas, ['add-surf-data']);
        });

        describe('fields', () => {
          it('adds a new field', () => {
            const surfField = _schema.fields.get('surf/type');
            assert.instanceOf(surfField, Rapid.Field);
            assert.deepInclude(surfField.props, {
              schemaID: 'add-surf-data',
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
              schemaID: 'add-surf-data',
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
              schemaID: 'add-surf-data',
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


      describe('updating', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();  // reset call count
          _schema.merge(sample.updateSurfData);
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
        });

        it('adds the merged schemaID to the schemas Set', () => {
          assert.containsAllKeys(_schema.schemas, ['add-surf-data', 'update-surf-data']);
        });

        describe('fields', () => {
          it('updates an existing field', () => {
            const surfField = _schema.fields.get('surf/type');
            assert.instanceOf(surfField, Rapid.Field);
            assert.deepInclude(surfField.props, {
              schemaID: 'update-surf-data',  // new schemaID
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
              schemaID: 'update-surf-data',  // new schemaID
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
              schemaID: 'update-surf-data',   // new schemaID
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


      describe('deleting', () => {
        beforeAll(() => {
          spySchemaChange.mockClear();  // reset call count
          _schema.merge(sample.deleteSurfData);
        });

        it('emits schemachange after merging', () => {
          assert.lengthOf(spySchemaChange.mock.calls, 1);   // schemachange emitted once
        });

        it('adds the merged schemaID to the schemas Set', () => {
          assert.containsAllKeys(_schema.schemas, ['add-surf-data', 'update-surf-data', 'delete-surf-data']);
        });

        describe('fields', () => {
          it('deletes an existing field', () => {
            assert.isUndefined(_schema.fields.get('board/type'));
          });
        });

        describe('presets', () => {
          it('deletes an existing preset', () => {
            assert.isUndefined(_schema.presets.get('club/surf'));
          });
        });

        describe('categories', () => {
          it('deletes an existing category', () => {
            assert.isUndefined(_schema.categories.get('category-shopping'));
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

      it('matches leading name', () => {
        const residential = _schema.item('highway/residential');
        const results = _schema.search('resid', 'area');
        assert.strictEqual(results.indexOf(residential), 0);  // 1. 'Residential' (by name)
      });

      it('returns alternate matches in correct order', () => {
        const results = _schema.search('gri', 'point');
        const resultIDs = results.map(item => item.id);

        console.log (resultIDs);

//// We need to decide how we want search to work and test it thoroughly
        assert.isOk(true);
//        expect(result.indexOf(p.grill), 'Grill').to.eql(0);            // 1. 'Grill' (leading name)
//        expect(result.indexOf(p.football), 'Football').to.eql(1);      // 2. 'Football' (leading term 'gridiron')
//        expect(result.indexOf(p.sandpit), 'Sandpit').to.eql(2);        // 3. 'Sandpit' (leading tag value 'grit_bin')
//        expect(result.indexOf(p.grass1), 'Grass').to.be.within(3,5);   // 4. 'Grass' (similar name)
//        expect(result.indexOf(p.grass2), 'Ğṝȁß').to.be.within(3,5);    // 5. 'Ğṝȁß' (similar name)
//        expect(result.indexOf(p.park), 'Park').to.be.within(3,5);      // 6. 'Park' (similar term 'grass')
      });

      it('sorts preset with matchScore penalty below others', () => {
        const parking = _schema.item('amenity/parking');
        const park = _schema.item('leisure/park');
        const result = _schema.search('par', 'point');
        assert.strictEqual(result.indexOf(parking), 0, 'Parking');   // 1. 'Parking' (default matchScore)
        assert.strictEqual(result.indexOf(park), 1, 'Park');         // 2. 'Park' (low matchScore)
      });

      it('ignores matchScore penalty for exact name match', () => {
        const parking = _schema.item('amenity/parking');
        const park = _schema.item('leisure/park');
        const result = _schema.search('park', 'point');
        assert.strictEqual(result.indexOf(park), 0, 'Park');         // 1. 'Park' (low matchScore)
        assert.strictEqual(result.indexOf(parking), 1, 'Parking');   // 2. 'Parking' (default matchScore)
      });

      it('considers diacritics on exact matches', () => {
        const grass1 = _schema.item('landuse/grass1');
        const grass2 = _schema.item('landuse/grass2');
        const result = _schema.search('ğṝȁ', 'point');
        assert.strictEqual(result.indexOf(grass2), 0, 'Ğṝȁß');    // 1. 'Ğṝȁß'  (leading name)
        assert.strictEqual(result.indexOf(grass1), 1, 'Grass');   // 2. 'Grass' (similar name)
      });

      it('replaces diacritics on fuzzy matches', () => {
        const grass1 = _schema.item('landuse/grass1');
        const grass2 = _schema.item('landuse/grass2');
        const result = _schema.search('graß', 'point');
        assert.isTrue(result.indexOf(grass1) < 2, 'Grass');   // 1. 'Grass' (similar name)
        assert.isTrue(result.indexOf(grass2) < 2, 'Ğṝȁß');    // 2. 'Ğṝȁß'  (similar name)
      });

      // it('includes the appropriate fallback preset', () => {
      //   assert.isTrue(collection.search('foo', 'point').includes(p.point), 'point');
      //   assert.isTrue(collection.search('foo', 'line').includes(p.line), 'line');
      //   assert.isTrue(collection.search('foo', 'area').includes(p.area), 'area');
      // });

      it('excludes presets with searchable: false', () => {
        const excluded = _schema.item('amenity/excluded');
        const result = _schema.search('excluded', 'point');
        assert.isTrue(!result.includes(excluded));
      });
    });
  });


  describe('match', () => {
    beforeEach(() => {
      const testPresets = {
        residential: { tags: { highway: 'residential' }, geometry: ['line'] },
        park: { tags: { leisure: 'park' }, geometry: ['point', 'area'] }
      };
      context.systems.assets._cache.tagging_preset_presets = testPresets;
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
  });


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
      context.systems.assets._cache.tagging_preset_presets = testPresets;
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
      context.systems.assets._cache.tagging_preset_presets = testPresets;
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
