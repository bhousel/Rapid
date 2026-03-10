import { afterAll, beforeAll, beforeEach, afterEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './StyleSystem.sample.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('StyleSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };

  // Setup mock asset data that SchemaSystem attempts to load at init time.
  const assets = context.systems.assets;
  assets._loaded.rapid_style = { assetID: 'rapid_style' };
  assets._loaded.custom_style = { assetID: 'custom_style' };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a StyleSystem from a context', () => {
        const styles = new Rapid.StyleSystem(context);
        assert.instanceOf(styles, Rapid.StyleSystem);
        assert.strictEqual(styles.id, 'styles');
        assert.strictEqual(styles.context, context);
        assert.instanceOf(styles.requiredDependencies, Set);
        assert.instanceOf(styles.optionalDependencies, Set);
        assert.isTrue(styles.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const styles = new Rapid.StyleSystem(context);
        const prom = styles.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const styles = new Rapid.StyleSystem(context);
        styles.requiredDependencies.add('missing');
        const prom = styles.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });

      it('inits without an AssetSystem', () => {
        const orig = context.systems.assets;
        delete context.systems.assets;

        const styles = new Rapid.StyleSystem(context);
        const prom = styles.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true))
          .finally(() => context.systems.assets = orig);  // restore
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const styles = new Rapid.StyleSystem(context);
        const prom = styles.initAsync().then(() => styles.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(styles.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const styles = new Rapid.StyleSystem(context);
        const prom = styles.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  // The tests in here need to run serially, because we rely on being able to
  // merge multiple style assets into the StyleSystem and then match against them.
  describe.serial('methods', () => {
    const spyStyleChange = mock();
    let _styles;

    beforeAll(() => {
      _styles = new Rapid.StyleSystem(context);
      context.systems.styles = _styles;
      return _styles.initAsync()
        .then(() => _styles.startAsync())
        .then(() => _styles.on('stylechange', spyStyleChange));
    });


    describe('properties', () => {
      it('defaultAssetIDs', () => {
        assert.deepEqual(_styles.defaultAssetIDs, new Set(['rapid_style']));
      });

      it('loadedAssetIDs', () => {
        assert.instanceOf(_styles.loadedAssetIDs, Map);
        // Note: The actual assets loaded depend on test environment.
        // The merge tests below verify that merge() properly adds to loadedAssetIDs.
      });

      it('getScope auto-creates scope for unknown scopeID', () => {
        const scope = _styles.getScope('nonexistent');
        assert.isDefined(scope);
        assert.instanceOf(scope.styles, Map);
        assert.instanceOf(scope.selectors, Map);
      });

      it('patternIDs', () => {
        assert.instanceOf(_styles.patternIDs, Set);
        assert.isTrue(_styles.patternIDs.has('forest'));
        assert.isTrue(_styles.patternIDs.has('grass'));
        assert.isTrue(_styles.patternIDs.has('waves'));
        assert.isTrue(_styles.patternIDs.has('wetland'));
      });

      it('protanopiaMatrix', () => {
        assert.isArray(_styles.protanopiaMatrix);
        assert.lengthOf(_styles.protanopiaMatrix, 20);
      });

      it('deuteranopiaMatrix', () => {
        assert.isArray(_styles.deuteranopiaMatrix);
        assert.lengthOf(_styles.deuteranopiaMatrix, 20);
      });

      it('tritanopiaMatrix', () => {
        assert.isArray(_styles.tritanopiaMatrix);
        assert.lengthOf(_styles.tritanopiaMatrix, 20);
      });
    });


    describe('requestedAssetIDs', () => {
      it('is initially null', () => {
        assert.isNull(_styles.requestedAssetIDs);
      });

      it('accepts a string', () => {
        _styles.requestedAssetIDs = 'zero';
        assert.deepEqual(_styles.requestedAssetIDs, new Set(['zero']));
      });

      it('accepts an Array', () => {
        _styles.requestedAssetIDs = ['one', 'two'];
        assert.deepEqual(_styles.requestedAssetIDs, new Set(['one', 'two']));
      });

      it('accepts a Set', () => {
        _styles.requestedAssetIDs = new Set(['three', 'four']);
        assert.deepEqual(_styles.requestedAssetIDs, new Set(['three', 'four']));
      });

      it(`handles the 'default' keyword`, () => {
        _styles.requestedAssetIDs = new Set(['five', 'default', 'six']);
        const expected = ['five', ..._styles.defaultAssetIDs, 'six'];
        assert.deepEqual(_styles.requestedAssetIDs, new Set(expected));
      });

      it('accepts empty string', () => {
        _styles.requestedAssetIDs = '';
        assert.deepEqual(_styles.requestedAssetIDs, new Set());
      });

      it('accepts null or undefined', () => {
        _styles.requestedAssetIDs = null;
        assert.isNull(_styles.requestedAssetIDs);
        _styles.requestedAssetIDs = undefined;
        assert.isNull(_styles.requestedAssetIDs);
      });
    });


    describe('merge', () => {
      it('throws if assetID is missing', () => {
        assert.throws(() => _styles.merge({}), /assetID/i);
      });

      it('throws if assetID has already been merged', () => {
        const styleData = { assetID: 'test1' };
        assert.isFalse(_styles.loadedAssetIDs.has('test1'));
        assert.doesNotThrow(() => _styles.merge(styleData));
        assert.isTrue(_styles.loadedAssetIDs.has('test1'));
        assert.throws(() => _styles.merge(styleData), /already merged/i);
      });


      describe('merge add', () => {
        beforeAll(() => {
          spyStyleChange.mockClear();
          _styles.merge(sample.addStyleData);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _styles.loadedAssetIDs.get('add-style-data');
          assert.strictEqual(version, '2026-01-01');
        });

        it('adds styles to the correct scope', () => {
          const common = _styles.getScope('*');
          assert.isTrue(common.styles.has('DEFAULTS'));

          const scope = _styles.getScope('osm');
          assert.isTrue(scope.styles.has('LIFECYCLE'));
          assert.isTrue(scope.styles.has('motorway'));
          assert.isTrue(scope.styles.has('trunk'));
          assert.isTrue(scope.styles.has('primary'));
          assert.isTrue(scope.styles.has('secondary'));
          assert.isTrue(scope.styles.has('building_red'));
          assert.isTrue(scope.styles.has('green'));
          assert.isTrue(scope.styles.has('pattern-forest'));
          assert.isTrue(scope.styles.has('blue'));
          assert.isTrue(scope.styles.has('footway'));
          assert.isTrue(scope.styles.has('foo-style1'));
          assert.isTrue(scope.styles.has('foo-style2'));
          assert.isTrue(scope.styles.has('bar-style'));
        });

        it('creates Style instances', () => {
          const scope = _styles.getScope('osm');
          const motorway = scope.styles.get('motorway');
          assert.instanceOf(motorway, Rapid.Style);
          assert.strictEqual(motorway.id, 'motorway');
        });

        it('preserves style properties', () => {
          const scope = _styles.getScope('osm');
          const motorway = scope.styles.get('motorway');
          assert.deepInclude(motorway.props, {
            id: 'motorway',
            assetID: 'add-style-data',
            assetVersion: '2026-01-01'
          });
          assert.deepEqual(motorway.casing, { width: 10, color: 0x70372f });
          assert.deepEqual(motorway.stroke, { width: 8, color: 0xcf2081 });
        });

        it('preserves fill properties including patterns', () => {
          const scope = _styles.getScope('osm');
          const forest = scope.styles.get('pattern-forest');
          assert.instanceOf(forest, Rapid.Style);
          assert.deepEqual(forest.fill, { pattern: 'forest' });
        });

        it('preserves dash patterns', () => {
          const scope = _styles.getScope('osm');
          const footway = scope.styles.get('footway');
          assert.instanceOf(footway, Rapid.Style);
          assert.deepEqual(footway.stroke.dash, [6, 6]);
          assert.strictEqual(footway.stroke.cap, 'butt');
        });

        it('adds selectors to the scope', () => {
          const scope = _styles.getScope('osm');
          assert.isTrue(scope.selectors.has('highway-motorway'));
          assert.isTrue(scope.selectors.has('highway-trunk'));
          assert.isTrue(scope.selectors.has('highway-primary'));
          assert.isTrue(scope.selectors.has('highway-secondary'));
          assert.isTrue(scope.selectors.has('building-default'));
          assert.isTrue(scope.selectors.has('landuse-forest'));
          assert.isTrue(scope.selectors.has('natural-water'));
          assert.isTrue(scope.selectors.has('highway-footway'));
          assert.isTrue(scope.selectors.has('foo-selector1'));
          assert.isTrue(scope.selectors.has('foo-selector2'));
          assert.isTrue(scope.selectors.has('bar-selector'));
        });

        it('creates StyleSelector instances', () => {
          const scope = _styles.getScope('osm');
          const hwMotorway = scope.selectors.get('highway-motorway');
          assert.instanceOf(hwMotorway, Rapid.StyleSelector);
          assert.strictEqual(hwMotorway.id, 'highway-motorway');
        });

        it('preserves selector properties', () => {
          const scope = _styles.getScope('osm');
          const hwMotorway = scope.selectors.get('highway-motorway');
          assert.deepEqual(hwMotorway.styleIDs, ['motorway']);
          assert.deepEqual(hwMotorway.match, { tags: [{ key: 'highway', value: 'motorway' }] });
        });

        it('supports multi-style selectors', () => {
          const scope = _styles.getScope('osm');
          const forest = scope.selectors.get('landuse-forest');
          assert.deepEqual(forest.styleIDs, ['green', 'pattern-forest']);
        });

        it('emits stylechange after merging', () => {
          assert.isTrue(spyStyleChange.mock.calls.length > 0);
        });
      });


      describe('merge update', () => {
        beforeAll(() => {
          spyStyleChange.mockClear();
          _styles.merge(sample.updateStyleData);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _styles.loadedAssetIDs.get('update-style-data');
          assert.strictEqual(version, '2026-01-02');
        });

        it('replaces existing style with updated data', () => {
          const scope = _styles.getScope('osm');
          const motorway = scope.styles.get('motorway');
          assert.strictEqual(motorway.props.assetID, 'update-style-data');
          assert.deepEqual(motorway.stroke, { width: 10, color: 0xff0000 });
          assert.deepEqual(motorway.casing, { width: 12, color: 0x70372f });
        });

        it('adds new styles in the update', () => {
          const scope = _styles.getScope('osm');
          assert.isTrue(scope.styles.has('new-style'));
          const newStyle = scope.styles.get('new-style');
          assert.deepEqual(newStyle.fill, { color: 0x123456, opacity: 0.5 });
        });

        it('replaces existing selector with updated data', () => {
          const scope = _styles.getScope('osm');
          const hwMotorway = scope.selectors.get('highway-motorway');
          assert.strictEqual(hwMotorway.props.assetID, 'update-style-data');
        });

        it('adds new selectors in the update', () => {
          const scope = _styles.getScope('osm');
          assert.isTrue(scope.selectors.has('new-selector'));
          const newSel = scope.selectors.get('new-selector');
          assert.deepEqual(newSel.styleIDs, ['new-style']);
        });

        it('does not remove unrelated styles', () => {
          const common = _styles.getScope('*');
          assert.isTrue(common.styles.has('DEFAULTS'));

          const scope = _styles.getScope('osm');
          assert.isTrue(scope.styles.has('trunk'));
          assert.isTrue(scope.styles.has('primary'));
          assert.isTrue(scope.styles.has('green'));
        });

        it('emits stylechange after merging', () => {
          assert.isTrue(spyStyleChange.mock.calls.length > 0);
        });
      });


      describe('merge delete', () => {
        beforeAll(() => {
          spyStyleChange.mockClear();
          _styles.merge(sample.deleteStyleData);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _styles.loadedAssetIDs.get('delete-style-data');
          assert.strictEqual(version, '2026-01-03');
        });

        it('removes styles using wildcard patterns', () => {
          const scope = _styles.getScope('osm');
          assert.isFalse(scope.styles.has('foo-style1'));
          assert.isFalse(scope.styles.has('foo-style2'));
        });

        it('removes styles using exact match', () => {
          const scope = _styles.getScope('osm');
          assert.isFalse(scope.styles.has('bar-style'));
        });

        it('does not remove unrelated styles', () => {
          const common = _styles.getScope('*');
          assert.isTrue(common.styles.has('DEFAULTS'));

          const scope = _styles.getScope('osm');
          assert.isTrue(scope.styles.has('motorway'));
          assert.isTrue(scope.styles.has('trunk'));
          assert.isTrue(scope.styles.has('green'));
          assert.isTrue(scope.styles.has('new-style'));
        });

        it('removes selectors using wildcard patterns', () => {
          const scope = _styles.getScope('osm');
          assert.isFalse(scope.selectors.has('foo-selector1'));
          assert.isFalse(scope.selectors.has('foo-selector2'));
        });

        it('removes selectors using exact match', () => {
          const scope = _styles.getScope('osm');
          assert.isFalse(scope.selectors.has('bar-selector'));
        });

        it('does not remove unrelated selectors', () => {
          const scope = _styles.getScope('osm');
          assert.isTrue(scope.selectors.has('highway-motorway'));
          assert.isTrue(scope.selectors.has('building-default'));
          assert.isTrue(scope.selectors.has('landuse-forest'));
          assert.isTrue(scope.selectors.has('new-selector'));
        });

        it('emits stylechange after merging', () => {
          assert.isTrue(spyStyleChange.mock.calls.length > 0);
        });
      });
    });   // merge


    describe('loadStyleAssetsAsync', () => {
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
        const prom = _styles.loadStyleAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('uses requestedAssetIDs when set', () => {
        _styles.requestedAssetIDs = 'custom_style';
        const prom = _styles.loadStyleAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.isTrue(_styles.loadedAssetIDs.has('custom_style'));
            assert.isFalse(_styles.loadedAssetIDs.has('rapid_style'));
          })
          .finally(() => _styles.requestedAssetIDs = null);  // restore
      });

      it('uses defaultAssetIDs when requestedAssetIDs is null', () => {
        _styles.requestedAssetIDs = null;
        const prom = _styles.loadStyleAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // Default assetIDs includes 'rapid_style'
            assert.isTrue(_styles.loadedAssetIDs.has('rapid_style'));
          });
      });

      it('handles rejected asset loading gracefully', () => {
        // Set requestedAssetIDs to something that will fail to load
        _styles.requestedAssetIDs = 'nonexistent-asset-12345';
        const prom = _styles.loadStyleAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // promise succeeds, but error is logged
            assert.lengthOf(spyError.mock.calls, 1);   // console.error called once
            assert.match(spyError.mock.lastCall[0], /unknown assetID/i);
          })
          .finally(() => _styles.requestedAssetIDs = null);
      });
    });


    describe('_hashChanged', () => {
      beforeEach(() => {
        spyStyleChange.mockClear();
      });

      afterEach(() => {
        _styles.requestedAssetIDs = null;
      });

      it('does nothing when style param is unchanged', () => {
        const curr = new Map([['other', 'value']]);
        const prev = new Map([['other', 'value']]);
        _styles._hashChanged(curr, prev);
        assert.lengthOf(spyStyleChange.mock.calls, 0);  // No style change should occur
      });

      it('handles style param set to empty string', () => {
        const curr = new Map([['style', '']]);
        const prev = new Map();
        _styles._hashChanged(curr, prev);
        assert.deepEqual(_styles.requestedAssetIDs, new Set());
        assert.isAtLeast(spyStyleChange.mock.calls.length, 1);   // stylechange emitted by resetAll
      });

      it('handles style param set to null', () => {
        const curr = new Map();
        const prev = new Map([['style', 'something']]);
        _styles._hashChanged(curr, prev);
        assert.isNull(_styles.requestedAssetIDs);
        assert.isAtLeast(spyStyleChange.mock.calls.length, 1);   // stylechange emitted by resetAll
      });

      it('handles style param with asset IDs', () => {
        const curr = new Map([['style', 'rapid_style']]);
        const prev = new Map();
        _styles._hashChanged(curr, prev);
        assert.deepEqual(_styles.requestedAssetIDs, new Set(['rapid_style']));
        assert.isAtLeast(spyStyleChange.mock.calls.length, 1);   // stylechange emitted by resetAll
      });
    });


    describe('_styleChanged', () => {
      it('emits stylechange event', () => {
        spyStyleChange.mockClear();
        _styles._styleChanged();
        assert.lengthOf(spyStyleChange.mock.calls, 1);
      });
    });


    describe('resetAll', () => {
      beforeAll(() => {
        spyStyleChange.mockClear();
        _styles.resetAll();
      });

      it('clears loadedAssetIDs', () => {
        assert.instanceOf(_styles.loadedAssetIDs, Map);
        assert.isEmpty(_styles.loadedAssetIDs);
      });

      it('clears all scopes', () => {
        const scope = _styles.getScope('osm');
        assert.strictEqual(scope.styles.size, 0);
        assert.strictEqual(scope.selectors.size, 0);
      });

      it('emits stylechange', () => {
        assert.lengthOf(spyStyleChange.mock.calls, 1);
      });
    });

  });  // methods


  describe.serial('variables', () => {
    let _styles;

    beforeAll(() => {
      _styles = new Rapid.StyleSystem(context);
      context.systems.styles = _styles;
      return _styles.initAsync()
        .then(() => _styles.startAsync())
        .then(() => {
          _styles.resetAll();
          _styles.merge(sample.variableAddData);
        });
    });


    describe('merge variables', () => {
      it('stores variables in scope.variables Map', () => {
        const scope = _styles.getScope('osm');
        assert.instanceOf(scope.variables, Map);
        assert.isTrue(scope.variables.has('major_road_values'));
        assert.isTrue(scope.variables.has('water_color'));
        assert.isTrue(scope.variables.has('delete_me'));
        assert.isTrue(scope.variables.has('delete_wild_1'));
        assert.isTrue(scope.variables.has('delete_wild_2'));
      });

      it('creates Variable instances', () => {
        const scope = _styles.getScope('osm');
        const majorRoads = scope.variables.get('major_road_values');
        assert.instanceOf(majorRoads, Rapid.Variable);
        assert.strictEqual(majorRoads.id, 'major_road_values');
      });

      it('preserves array variable values', () => {
        const scope = _styles.getScope('osm');
        const majorRoads = scope.variables.get('major_road_values');
        assert.deepEqual(majorRoads.value, ['motorway', 'trunk', 'primary']);
      });

      it('preserves scalar variable values', () => {
        const scope = _styles.getScope('osm');
        const waterColor = scope.variables.get('water_color');
        assert.strictEqual(waterColor.value, 0x77DDDD);
      });

      it('resolves var() references in selectors', () => {
        const scope = _styles.getScope('osm');
        const selector = scope.selectors.get('highway-major');
        assert.instanceOf(selector, Rapid.StyleSelector);

        // The selector's var() reference should have been resolved by _styleChanged
        const tagMatchers = selector.tagMatchers;
        assert.lengthOf(tagMatchers, 1);
        // The matcher should now match highway=motorway
        assert.isTrue(tagMatchers[0].matches({ highway: 'motorway' }));
        assert.isTrue(tagMatchers[0].matches({ highway: 'trunk' }));
        assert.isTrue(tagMatchers[0].matches({ highway: 'primary' }));
        assert.isFalse(tagMatchers[0].matches({ highway: 'residential' }));
      });

      it('uses var()-based selectors in styleMatch', () => {
        const result = _styles.styleMatch({ highway: 'motorway' });
        assert.strictEqual(result.stroke.color, 0xcf2081);
        assert.strictEqual(result.stroke.width, 8);
        assert.strictEqual(result.casing.color, 0x70372f);
        assert.strictEqual(result.casing.width, 10);
      });

      it('does not match values outside the variable list', () => {
        const result = _styles.styleMatch({ highway: 'residential' });
        // Should fall through to defaults, not match major_road style
        assert.notStrictEqual(result.stroke.color, 0xcf2081);
      });
    });


    describe('var() in style props', () => {
      it('resolves var() color references in style props', () => {
        const scope = _styles.getScope('osm');
        const majorRoad = scope.styles.get('major_road');
        assert.instanceOf(majorRoad, Rapid.Style);

        // After _styleChanged, var() references should be resolved to numeric values
        assert.strictEqual(majorRoad.stroke.color, 0xcf2081);
        assert.strictEqual(majorRoad.casing.color, 0x70372f);
      });

      it('resolves var() width references in style props', () => {
        const scope = _styles.getScope('osm');
        const majorRoad = scope.styles.get('major_road');
        assert.strictEqual(majorRoad.stroke.width, 8);
        assert.strictEqual(majorRoad.casing.width, 10);
      });

      it('resolves var() opacity references in style props', () => {
        const scope = _styles.getScope('osm');
        const waterStyle = scope.styles.get('water_style');
        assert.instanceOf(waterStyle, Rapid.Style);
        assert.strictEqual(waterStyle.fill.color, 0x77DDDD);
        assert.strictEqual(waterStyle.fill.opacity, 0.3);
      });

      it('resolved styles produce correct styleMatch results', () => {
        // Water style uses var() for both color and opacity
        const result = _styles.styleMatch({ natural: 'water' });
        assert.strictEqual(result.fill.color, 0x77DDDD);
        assert.strictEqual(result.fill.opacity, 0.3);
      });

      it('tracks hasVarRefs on styles with var() references', () => {
        const scope = _styles.getScope('osm');
        const majorRoad = scope.styles.get('major_road');
        assert.isTrue(majorRoad.hasVarRefs);

        // Style without var() references should not have varRefs
        const minorRoad = scope.styles.get('minor_road');
        assert.isFalse(minorRoad.hasVarRefs);
      });

      it('re-resolves style vars after reset and resolveVariables', () => {
        const scope = _styles.getScope('osm');
        const majorRoad = scope.styles.get('major_road');

        // Reset restores var() strings
        majorRoad.reset();
        assert.strictEqual(majorRoad.stroke.color, 'var(major_stroke_color)');

        // Re-resolve restores numeric values
        majorRoad.resolveVariables(scope.variables);
        assert.strictEqual(majorRoad.stroke.color, 0xcf2081);
      });
    });


    describe('merge variable update/delete', () => {
      beforeAll(() => {
        _styles.merge(sample.variableUpdateData);
      });

      it('adds new variables', () => {
        const scope = _styles.getScope('osm');
        assert.isTrue(scope.variables.has('minor_road_values'));
        const minorRoads = scope.variables.get('minor_road_values');
        assert.deepEqual(minorRoads.value, ['residential', 'service', 'unclassified']);
      });

      it('deletes variables by exact match', () => {
        const scope = _styles.getScope('osm');
        assert.isFalse(scope.variables.has('delete_me'));
      });

      it('deletes variables by wildcard', () => {
        const scope = _styles.getScope('osm');
        assert.isFalse(scope.variables.has('delete_wild_1'));
        assert.isFalse(scope.variables.has('delete_wild_2'));
      });

      it('preserves unrelated variables', () => {
        const scope = _styles.getScope('osm');
        assert.isTrue(scope.variables.has('major_road_values'));
        assert.isTrue(scope.variables.has('water_color'));
      });

      it('resolves new var() selector after update', () => {
        const result = _styles.styleMatch({ highway: 'residential' });
        assert.strictEqual(result.stroke.color, 0xffffff);
        assert.strictEqual(result.stroke.width, 5);
      });
    });


    describe('getScope auto-creates variables Map', () => {
      it('new scope has empty variables Map', () => {
        const scope = _styles.getScope('test-scope-vars');
        assert.instanceOf(scope.variables, Map);
        assert.strictEqual(scope.variables.size, 0);
      });
    });


    describe('resetAll clears variables', () => {
      beforeAll(() => {
        _styles.resetAll();
      });

      it('clears all scope data including variables', () => {
        // After resetAll, getScope creates a fresh empty scope
        const scope = _styles.getScope('osm');
        assert.strictEqual(scope.variables.size, 0);
        assert.strictEqual(scope.styles.size, 0);
        assert.strictEqual(scope.selectors.size, 0);
      });
    });

  });  // variables


  describe('styleMatch', () => {
    let _styles;

    beforeAll(async () => {
      const schema = context.systems.schema;
      schema.requestedAssetIDs = '';
      await schema.initAsync();
      schema.merge(osmRulesets);
      _styles = new Rapid.StyleSystem(context);
      context.systems.styles = _styles;
      // Don't init - just create and merge data directly
      _styles.resetAll();
      _styles.merge(sample.styleMatchData);
    });

    it('returns a minimal style when DEFAULTS has not been loaded', () => {
      const empty = new Rapid.StyleSystem(context);
      const result = empty.styleMatch({});
      assert.isObject(result);
      assert.isObject(result.fill);
      assert.isObject(result.casing);
      assert.isObject(result.stroke);
    });

    it('returns defaults for tags that match no selectors', () => {
      const result = _styles.styleMatch({ some_random_tag: 'xyz' });
      assert.isObject(result);
      assert.strictEqual(result.fill.color, 0xaaaaaa);
      assert.strictEqual(result.stroke.color, 0xcccccc);
      assert.strictEqual(result.casing.color, 0x444444);
    });

    it('matches highway=motorway tags', () => {
      const result = _styles.styleMatch({ highway: 'motorway' });
      assert.strictEqual(result.stroke.color, 0xcf2081);
      assert.strictEqual(result.stroke.width, 8);
      assert.strictEqual(result.casing.color, 0x70372f);
      assert.strictEqual(result.casing.width, 10);
    });

    it('matches highway=residential tags', () => {
      const result = _styles.styleMatch({ highway: 'residential' });
      assert.strictEqual(result.stroke.color, 0xffffff);
      assert.strictEqual(result.stroke.width, 6);
      assert.strictEqual(result.casing.color, 0x888888);
      assert.strictEqual(result.casing.width, 8);
    });

    it('matches building tags with fill properties', () => {
      const result = _styles.styleMatch({ building: 'yes' });
      assert.strictEqual(result.fill.color, 0xE06050);
      assert.strictEqual(result.fill.opacity, 0.3);
    });

    it('matches landuse=forest with composed styles (color + pattern)', () => {
      const result = _styles.styleMatch({ landuse: 'forest' });
      assert.strictEqual(result.fill.color, 0x8cd05f);
      assert.strictEqual(result.fill.opacity, 0.3);
      assert.strictEqual(result.fill.pattern, 'forest');
    });

    it('matches natural=water tags', () => {
      const result = _styles.styleMatch({ natural: 'water' });
      assert.strictEqual(result.fill.color, 0x77DDDD);
      assert.strictEqual(result.fill.opacity, 0.3);
    });

    it('matches footway with dash patterns', () => {
      const result = _styles.styleMatch({ highway: 'footway' });
      assert.deepEqual(result.stroke.dash, [6, 6]);
      assert.strictEqual(result.stroke.cap, 'butt');
      assert.strictEqual(result.stroke.color, 0x998888);
    });

    describe('bridge/tunnel/embankment overrides', () => {
      it('increases casing width for bridges', () => {
        const base = _styles.styleMatch({ highway: 'motorway' });
        const bridged = _styles.styleMatch({ highway: 'motorway', bridge: 'yes' });
        assert.strictEqual(bridged.casing.width, base.casing.width + 7);
        assert.strictEqual(bridged.casing.color, 0x000000);
        assert.strictEqual(bridged.casing.cap, 'butt');
      });

      it('applies dashed casing for embankments', () => {
        const result = _styles.styleMatch({ highway: 'residential', embankment: 'yes' });
        assert.deepEqual(result.casing.dash, [2, 4]);
        assert.strictEqual(result.casing.cap, 'butt');
        assert.strictEqual(result.casing.color, 0x000000);
      });

      it('applies dashed casing for cuttings', () => {
        const result = _styles.styleMatch({ highway: 'residential', cutting: 'yes' });
        assert.deepEqual(result.casing.dash, [2, 4]);
        assert.strictEqual(result.casing.cap, 'butt');
      });

      it('reduces stroke alpha for tunnels', () => {
        const result = _styles.styleMatch({ highway: 'motorway', tunnel: 'yes' });
        assert.strictEqual(result.stroke.opacity, 0.5);
      });

      it('ignores bridge=no', () => {
        const base = _styles.styleMatch({ highway: 'motorway' });
        const noBridge = _styles.styleMatch({ highway: 'motorway', bridge: 'no' });
        assert.strictEqual(noBridge.casing.width, base.casing.width);
      });

      it('ignores tunnel=no', () => {
        const result = _styles.styleMatch({ highway: 'motorway', tunnel: 'no' });
        assert.strictEqual(result.stroke.opacity, 1);
      });
    });


    describe('unpaved surface overrides', () => {
      it('applies bumpy casing for unpaved roads', () => {
        const result = _styles.styleMatch({ highway: 'residential', surface: 'gravel' });
        assert.deepEqual(result.casing.dash, [4, 4]);
        assert.strictEqual(result.casing.cap, 'butt');
      });

      it('does not apply bumpy casing for paved roads', () => {
        const result = _styles.styleMatch({ highway: 'residential', surface: 'asphalt' });
        assert.isUndefined(result.casing.dash);
      });

      it('assumes dirt surface for non-grade1 tracks', () => {
        const result = _styles.styleMatch({ highway: 'track' });
        assert.deepEqual(result.casing.dash, [4, 4]);
        assert.strictEqual(result.casing.cap, 'butt');
      });

      it('does not assume dirt surface for grade1 tracks', () => {
        const result = _styles.styleMatch({ highway: 'track', tracktype: 'grade1' });
        assert.isUndefined(result.casing.dash);
      });
    });


    describe('lifecycle overrides', () => {
      it('applies lifecycle overrides for abandoned features', () => {
        const result = _styles.styleMatch({ highway: 'motorway', abandoned: 'yes' });
        assert.deepEqual(result.stroke.dash, [7, 3]);
        assert.strictEqual(result.stroke.cap, 'butt');
      });

      it('applies lifecycle overrides for lifecycle key prefix', () => {
        const result = _styles.styleMatch({ 'demolished:railway': 'rail' });
        assert.deepEqual(result.stroke.dash, [7, 3]);
        assert.strictEqual(result.stroke.cap, 'butt');
      });

      it('applies lifecycle overrides for lifecycle value', () => {
        const result = _styles.styleMatch({ highway: 'proposed' });
        assert.deepEqual(result.stroke.dash, [7, 3]);
        assert.strictEqual(result.stroke.cap, 'butt');
      });

      it('does not apply lifecycle overrides for abandoned=no', () => {
        const result = _styles.styleMatch({ highway: 'motorway', abandoned: 'no' });
        assert.isUndefined(result.stroke.dash);
      });

      it('does not apply lifecycle overrides for lifecycle key prefix with no value', () => {
        const result = _styles.styleMatch({ 'demolished:railway': 'no' });
        assert.isUndefined(result.stroke.dash);
      });

      it('applies lifecycle value only when tag matches styleKey', () => {
        // highway=motorway matched, styleKey='highway'
        // amenity=proposed should NOT trigger lifecycle because amenity != styleKey
        const result = _styles.styleMatch({ highway: 'motorway', amenity: 'proposed' });
        assert.isUndefined(result.stroke.dash);
      });

      it('applies lifecycle key prefix only when no styleKey', () => {
        // When there's a styleKey (highway=motorway matched), lifecycle prefix should be ignored
        const result = _styles.styleMatch({ highway: 'motorway', 'demolished:amenity': 'cafe' });
        assert.isUndefined(result.stroke.dash);
      });
    });


    describe('marker and icon resolution', () => {
      it('returns default marker when no style-specific marker', () => {
        const result = _styles.styleMatch({ some_random_tag: 'xyz' });
        assert.isObject(result.marker);
        assert.strictEqual(result.marker.image, 'smallCircle');
        assert.strictEqual(result.marker.color, 0xffffff);
        assert.strictEqual(result.marker.opacity, 1);
      });

      it('returns style-specific marker when defined', () => {
        const result = _styles.styleMatch({ amenity: 'cafe' });
        assert.strictEqual(result.marker.image, 'pin');
        assert.strictEqual(result.marker.color, 0xff0000);
      });

      it('returns default icon when no style-specific icon', () => {
        const result = _styles.styleMatch({ some_random_tag: 'xyz' });
        assert.isObject(result.icon);
        assert.isUndefined(result.icon.image);
        assert.strictEqual(result.icon.color, 0x111111);
        assert.strictEqual(result.icon.opacity, 1);
        assert.strictEqual(result.icon.size, 11);
      });

      it('returns style-specific icon when defined', () => {
        const result = _styles.styleMatch({ amenity: 'cafe' });
        assert.strictEqual(result.icon.image, 'maki-cafe');
        assert.strictEqual(result.icon.color, 0x333333);
        assert.strictEqual(result.icon.size, 15);
      });
    });


    describe('lineMarker and sidedMarker resolution', () => {
      it('returns default lineMarker', () => {
        const result = _styles.styleMatch({ highway: 'motorway' });
        assert.isObject(result.lineMarker);
        assert.strictEqual(result.lineMarker.image, 'oneway');
        assert.strictEqual(result.lineMarker.color, 0xffffff);
      });

      it('returns default sidedMarker when no style-specific sidedMarker', () => {
        const result = _styles.styleMatch({ highway: 'motorway' });
        assert.isObject(result.sidedMarker);
        assert.isUndefined(result.sidedMarker.image);
        assert.strictEqual(result.sidedMarker.color, 0xffffff);
      });

      it('returns style-specific sidedMarker when defined', () => {
        const result = _styles.styleMatch({ natural: 'cliff' });
        assert.strictEqual(result.sidedMarker.image, 'cliff');
        assert.strictEqual(result.sidedMarker.color, 0x888888);
      });
    });


    describe('label resolution', () => {
      it('returns default label color when no style-specific label', () => {
        const result = _styles.styleMatch({ some_random_tag: 'xyz' });
        assert.strictEqual(result.label.color, 0xeeeeee);
      });

      it('returns style-specific label color when defined', () => {
        const result = _styles.styleMatch({ amenity: 'cafe' });
        assert.strictEqual(result.label.color, 0xdddddd);
      });
    });


    describe('fill pattern validation', () => {
      const origError = console.error;
      const spyError = mock();

      beforeAll(() => {
        console.error = spyError;
      });

      beforeEach(() => {
        spyError.mockClear();
      });

      afterAll(() => {
        console.error = origError;
      });

      it('allows valid fill patterns', () => {
        const result = _styles.styleMatch({ landuse: 'forest' });
        assert.strictEqual(result.fill.pattern, 'forest');
        assert.lengthOf(spyError.mock.calls, 0);
      });

      it('clears invalid fill patterns and logs error', () => {
        const result = _styles.styleMatch({ landuse: 'invalid_test' });
        assert.isUndefined(result.fill.pattern);
        assert.lengthOf(spyError.mock.calls, 1);
        assert.match(spyError.mock.lastCall[0], /invalid patternID/i);
      });

      it('does not validate patterns for buildings (exception)', () => {
        // Buildings skip pattern validation entirely
        const result = _styles.styleMatch({ building: 'yes' });
        // Should not have a pattern property since building_red style has no pattern
        assert.isUndefined(result.fill.pattern);
      });
    });

  });  // styleMatch

});
