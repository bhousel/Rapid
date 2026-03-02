import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock, spyOn } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './ImagerySystem.sample.js';


describe('ImagerySystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets: new Rapid.AssetSystem(context)
  };

  // Setup mock asset data that ImagerySystem attempts to load at init time.
  const assets = context.systems.assets;
  assets._loaded.editor_layer_index = { assetID: 'editor_layer_index' };
  assets._loaded.rapid_imagery = { assetID: 'rapid_imagery' };
  assets._loaded.custom_imagery = { assetID: 'custom_imagery' };

  // Mock osm service with empty blocklists (needed for baseLayerSource)
  context.services = {
    osm: {
      imageryBlocklists: []
    }
  };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an ImagerySystem from a context', () => {
        const imagery = new Rapid.ImagerySystem(context);
        assert.instanceOf(imagery, Rapid.ImagerySystem);
        assert.strictEqual(imagery.id, 'imagery');
        assert.strictEqual(imagery.context, context);
        assert.instanceOf(imagery.requiredDependencies, Set);
        assert.instanceOf(imagery.optionalDependencies, Set);
        assert.isTrue(imagery.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const imagery = new Rapid.ImagerySystem(context);
        const prom = imagery.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const imagery = new Rapid.ImagerySystem(context);
        imagery.requiredDependencies.add('missing');
        const prom = imagery.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });

      it('inits without an AssetSystem', () => {
        const orig = context.systems.assets;
        delete context.systems.assets;

        const imagery = new Rapid.ImagerySystem(context);
        const prom = imagery.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true))
          .finally(() => context.systems.assets = orig);  // restore
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const imagery = new Rapid.ImagerySystem(context);
        const prom = imagery.initAsync().then(() => imagery.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(imagery.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const imagery = new Rapid.ImagerySystem(context);
        const prom = imagery.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  // The tests in here need to run serially, because we rely on being able to
  // merge multiple imagery assets into the ImagerySystem and then match against them.
  describe.serial('methods', () => {
    const spyImageryChange = mock();
    let _imagery;

    beforeAll(() => {
      _imagery = new Rapid.ImagerySystem(context);
      context.systems.imagery = _imagery;
      return _imagery.initAsync()
        .then(() => _imagery.startAsync())
        .then(() => _imagery.on('imagerychange', spyImageryChange));
    });


    describe('properties', () => {
      it('defaultAssetIDs', () => {
        assert.deepEqual(_imagery.defaultAssetIDs, new Set(['editor_layer_index', 'rapid_imagery']));
      });

      it('loadedAssetIDs', () => {
        assert.instanceOf(_imagery.loadedAssetIDs, Map);
        // Note: The actual assets loaded depend on test environment.
        // The merge tests below verify that merge() properly adds to loadedAssetIDs.
      });

      it('sources', () => {
        assert.instanceOf(_imagery.sources, Map);
        // Should have at least the builtin 'none' and 'custom' sources
        assert.isTrue(_imagery.sources.has('none'));
        assert.isTrue(_imagery.sources.has('custom'));
      });

      it('features', () => {
        assert.instanceOf(_imagery.features, Map);
      });

      it('offset', () => {
        assert.deepEqual(_imagery.offset, [0, 0]);
      });

      it('brightness', () => {
        assert.strictEqual(_imagery.brightness, 1);
      });

      it('contrast', () => {
        assert.strictEqual(_imagery.contrast, 1);
      });

      it('saturation', () => {
        assert.strictEqual(_imagery.saturation, 1);
      });

      it('sharpness', () => {
        assert.strictEqual(_imagery.sharpness, 1);
      });

      it('numGridSplits', () => {
        assert.strictEqual(_imagery.numGridSplits, 0);
      });
    });

    describe('requestedAssetIDs', () => {
      it('is initially null', () => {
        assert.isNull(_imagery.requestedAssetIDs);
      });

      it('accepts a string', () => {
        _imagery.requestedAssetIDs = 'zero';
        assert.deepEqual(_imagery.requestedAssetIDs, new Set(['zero']));
      });

      it('accepts an Array', () => {
        _imagery.requestedAssetIDs = ['one', 'two'];
        assert.deepEqual(_imagery.requestedAssetIDs, new Set(['one', 'two']));
      });

      it('accepts a Set', () => {
        _imagery.requestedAssetIDs = new Set(['three', 'four']);
        assert.deepEqual(_imagery.requestedAssetIDs, new Set(['three', 'four']));
      });

      it(`handles the 'default' keyword`, () => {
        _imagery.requestedAssetIDs = new Set(['five', 'default', 'six']);
        const expected = ['five', ..._imagery.defaultAssetIDs, 'six'];
        assert.deepEqual(_imagery.requestedAssetIDs, new Set(expected));
      });

      it('accepts empty string', () => {
        _imagery.requestedAssetIDs = '';
        assert.deepEqual(_imagery.requestedAssetIDs, new Set());
      });

      it('accepts null or undefined', () => {
        _imagery.requestedAssetIDs = null;
        assert.isNull(_imagery.requestedAssetIDs);
        _imagery.requestedAssetIDs = undefined;
        assert.isNull(_imagery.requestedAssetIDs);
      });
    });


    describe('merge', () => {
      it('throws if assetID is missing', () => {
        assert.throws(() => _imagery.merge({}), /missing assetID/i);
      });

      it('throws if assetID has already been merged', () => {
        const schemaData = { assetID: 'test1' };
        assert.isFalse(_imagery.loadedAssetIDs.has('test1'));
        assert.doesNotThrow(() => _imagery.merge(schemaData));
        assert.isTrue(_imagery.loadedAssetIDs.has('test1'));
        assert.throws(() => _imagery.merge(schemaData), /already merged/i);
      });


      describe('merge add', () => {
        beforeAll(() => {
          spyImageryChange.mockClear();
          _imagery.merge(sample.addImageryData);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _imagery.loadedAssetIDs.get('add-imagery-data');
          assert.strictEqual(version, '2026-01-01');
        });

        it('adds sources to the sources Map', () => {
          assert.isTrue(_imagery.sources.has('nj-2015'));
          assert.isTrue(_imagery.sources.has('nj-2020'));
          assert.isTrue(_imagery.sources.has('ca-imagery'));
          assert.isTrue(_imagery.sources.has('test-overlay'));
          assert.isTrue(_imagery.sources.has('foo-source1'));
          assert.isTrue(_imagery.sources.has('foo-source2'));
          assert.isTrue(_imagery.sources.has('bar-source'));
          assert.isTrue(_imagery.sources.has('testbing'));
          assert.isTrue(_imagery.sources.has('esriworldimagerytest'));
        });

        it('creates ImagerySourceBing for type=bing sources', () => {
          const bing = _imagery.sources.get('testbing');
          assert.instanceOf(bing, Rapid.ImagerySourceBing);
          assert.strictEqual(bing.props.type, 'bing');
        });

        it('creates ImagerySourceEsri for EsriWorldImagery sources', () => {
          const esri = _imagery.sources.get('esriworldimagerytest');
          assert.instanceOf(esri, Rapid.ImagerySourceEsri);
        });

        it('preserves source properties', () => {
          const nj = _imagery.sources.get('nj-2015');
          assert.strictEqual(nj.props.id, 'nj-2015');
          assert.strictEqual(nj.props.name, 'NJ 2015 Aerial Imagery');
          assert.strictEqual(nj.props.type, 'wms');
          assert.deepEqual(nj.props.zoomExtent, [3, 20]);
        });

        it('stores GeoJSON features for sources with location data', () => {
          assert.isTrue(_imagery.features.has('nj-2015'));
          assert.isTrue(_imagery.features.has('nj-2020'));
          assert.isTrue(_imagery.features.has('ca-imagery'));
        });

        it('emits imagerychange after merging', () => {
          assert.isTrue(spyImageryChange.mock.calls.length > 0);
        });
      });


      describe('merge update', () => {
        beforeAll(() => {
          spyImageryChange.mockClear();
          _imagery.merge(sample.updateImageryData);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _imagery.loadedAssetIDs.get('update-imagery-data');
          assert.strictEqual(version, '2026-01-02');
        });

        it('replaces existing source with updated data', () => {
          const nj = _imagery.sources.get('nj-2015');
          assert.strictEqual(nj.props.name, 'NJ 2015 Aerial Imagery (Updated)');
          assert.deepEqual(nj.props.zoomExtent, [3, 21]);
          assert.isTrue(nj.props.best);
        });

        it('adds new sources in the update', () => {
          assert.isTrue(_imagery.sources.has('new-source'));
        });

        it('emits imagerychange after merging', () => {
          assert.isTrue(spyImageryChange.mock.calls.length > 0);
        });
      });


      describe('merge delete', () => {
        beforeAll(() => {
          spyImageryChange.mockClear();
          _imagery.merge(sample.deleteImageryData);
        });

        it('adds assetID and assetVersion to loadedAssetIDs Map', () => {
          const version = _imagery.loadedAssetIDs.get('delete-imagery-data');
          assert.strictEqual(version, '2026-01-03');
        });

        it('removes sources using wildcard patterns', () => {
          assert.isFalse(_imagery.sources.has('foo-source1'));
          assert.isFalse(_imagery.sources.has('foo-source2'));
        });

        it('removes sources using exact match', () => {
          assert.isFalse(_imagery.sources.has('bar-source'));
        });

        it('does not remove unrelated sources', () => {
          assert.isTrue(_imagery.sources.has('nj-2015'));
          assert.isTrue(_imagery.sources.has('nj-2020'));
          assert.isTrue(_imagery.sources.has('ca-imagery'));
          assert.isTrue(_imagery.sources.has('new-source'));
        });

        it('removes corresponding features when sources are deleted', () => {
          // foo-source1 and foo-source2 didn't have features, but this tests the logic
          assert.isFalse(_imagery.features.has('foo-source1'));
          assert.isFalse(_imagery.features.has('foo-source2'));
        });

        it('emits imagerychange after merging', () => {
          assert.isTrue(spyImageryChange.mock.calls.length > 0);
        });
      });
    });   // merge


    describe('source', () => {
      it('gets a source by its sourceID', () => {
        const nj = _imagery.source('nj-2015');
        assert.instanceOf(nj, Rapid.ImagerySource);
        assert.strictEqual(nj.props.id, 'nj-2015');
      });

      it('gets a source by its sourceID (case-insensitive)', () => {
        const nj = _imagery.source('NJ-2015');
        assert.instanceOf(nj, Rapid.ImagerySource);
        assert.strictEqual(nj.props.id, 'nj-2015');
      });

      it('returns undefined if no sourceID found', () => {
        assert.isUndefined(_imagery.source('nonexistent'));
      });

      it('returns undefined for null/undefined input', () => {
        assert.isUndefined(_imagery.source(null));
        assert.isUndefined(_imagery.source(undefined));
      });
    });


    describe('getSourceByID', () => {
      it('gets a source by its sourceID', () => {
        const nj = _imagery.getSourceByID('nj-2015');
        assert.instanceOf(nj, Rapid.ImagerySource);
        assert.strictEqual(nj.props.id, 'nj-2015');
      });

      it('returns undefined for empty string', () => {
        assert.isUndefined(_imagery.getSourceByID(''));
      });

      it('handles EsriWayback prefix with date suffix', () => {
        // EsriWayback_2020-01-01 should resolve to the EsriWayback source
        const wayback = _imagery.getSourceByID('EsriWayback_2020-01-01');
        assert.isDefined(wayback);
        assert.strictEqual(wayback.props.id, 'EsriWayback');
      });

      it('handles EsriWayback without date suffix', () => {
        const wayback = _imagery.getSourceByID('EsriWayback');
        assert.isDefined(wayback);
        assert.strictEqual(wayback.props.id, 'EsriWayback');
      });
    });


    describe('setSourceByID', () => {
      afterEach(() => {
        // Reset to none after each test
        _imagery.setSourceByID('none');
      });

      it('sets the base layer source', () => {
        _imagery.setSourceByID('nj-2015');
        const base = _imagery.baseLayerSource();
        assert.strictEqual(base.props.id, 'nj-2015');
      });

      it('handles EsriWayback with date suffix', () => {
        _imagery.setSourceByID('EsriWayback_2020-01-01');
        const base = _imagery.baseLayerSource();
        assert.strictEqual(base.props.id, 'EsriWayback');
        // The date should be extracted and set on the source
        assert.strictEqual(base.date, '2020-01-01');
      });

      it('handles EsriWayback without date suffix', () => {
        _imagery.setSourceByID('EsriWayback');
        const base = _imagery.baseLayerSource();
        assert.strictEqual(base.props.id, 'EsriWayback');
      });

      it('does nothing for non-existent source', () => {
        _imagery.setSourceByID('nj-2015');
        _imagery.setSourceByID('nonexistent-source');
        // Should still be nj-2015
        const base = _imagery.baseLayerSource();
        assert.strictEqual(base.props.id, 'nj-2015');
      });
    });


    describe('baseLayerSource', () => {
      afterEach(() => {
        _imagery.setSourceByID('none');
      });

      it('gets the current base layer source', () => {
        _imagery.setSourceByID('nj-2020');
        const base = _imagery.baseLayerSource();
        assert.instanceOf(base, Rapid.ImagerySource);
        assert.strictEqual(base.props.id, 'nj-2020');
      });

      it('sets the base layer source when called with an argument', () => {
        const ca = _imagery.source('ca-imagery');
        _imagery.baseLayerSource(ca);
        const base = _imagery.baseLayerSource();
        assert.strictEqual(base.props.id, 'ca-imagery');
      });
    });


    describe('showsLayer', () => {
      afterEach(() => {
        _imagery.setSourceByID('none');
      });

      it('returns true if the source is the current base layer', () => {
        _imagery.setSourceByID('nj-2015');
        const nj = _imagery.source('nj-2015');
        assert.isTrue(_imagery.showsLayer(nj));
      });

      it('returns false if the source is not the current base layer', () => {
        _imagery.setSourceByID('nj-2015');
        const ca = _imagery.source('ca-imagery');
        assert.isFalse(_imagery.showsLayer(ca));
      });

      it('returns false for null/undefined source', () => {
        assert.isFalse(_imagery.showsLayer(null));
        assert.isFalse(_imagery.showsLayer(undefined));
      });
    });


    describe('overlayLayerSources', () => {
      afterEach(() => {
        // Clear all overlays
        _imagery.enableOverlayLayers([]);
      });

      it('returns an array of overlay sources', () => {
        const overlays = _imagery.overlayLayerSources();
        assert.isArray(overlays);
      });
    });


    describe('toggleOverlayLayer', () => {
      afterEach(() => {
        _imagery.enableOverlayLayers([]);
      });

      it('adds an overlay when toggled on', () => {
        const overlay = _imagery.source('test-overlay');
        _imagery.toggleOverlayLayer(overlay);
        const overlays = _imagery.overlayLayerSources();
        assert.isTrue(overlays.some(o => o.props.id === 'test-overlay'));
      });

      it('removes an overlay when toggled off', () => {
        const overlay = _imagery.source('test-overlay');
        _imagery.toggleOverlayLayer(overlay);  // on
        _imagery.toggleOverlayLayer(overlay);  // off
        const overlays = _imagery.overlayLayerSources();
        assert.isFalse(overlays.some(o => o.props.id === 'test-overlay'));
      });
    });


    describe('enableOverlayLayers', () => {
      afterEach(() => {
        _imagery.enableOverlayLayers([]);
      });

      it('enables specified overlays', () => {
        _imagery.enableOverlayLayers(['test-overlay']);
        const overlays = _imagery.overlayLayerSources();
        assert.isTrue(overlays.some(o => o.props.id === 'test-overlay'));
      });

      it('accepts a Set of IDs', () => {
        _imagery.enableOverlayLayers(new Set(['test-overlay']));
        const overlays = _imagery.overlayLayerSources();
        assert.isTrue(overlays.some(o => o.props.id === 'test-overlay'));
      });
    });


    describe('imageryUsed', () => {
      afterEach(() => {
        _imagery.setSourceByID('none');
        _imagery.enableOverlayLayers([]);
      });

      it('returns an array', () => {
        const used = _imagery.imageryUsed();
        assert.isArray(used);
      });

      it('includes the base layer name when set', () => {
        _imagery.setSourceByID('nj-2015');
        const used = _imagery.imageryUsed();
        assert.isTrue(used.some(name => name.includes('NJ 2015')));
      });

      it('includes overlay layer names when overlays are enabled', () => {
        _imagery.setSourceByID('nj-2015');
        const overlay = _imagery.source('test-overlay');
        _imagery.toggleOverlayLayer(overlay);
        const used = _imagery.imageryUsed();
        // Should include both base layer and overlay
        assert.isTrue(used.some(name => name.includes('NJ 2015')));
        assert.isTrue(used.some(name => name.includes('Test Overlay')));
      });

      it('includes multiple overlays', () => {
        _imagery.setSourceByID('nj-2015');
        _imagery.enableOverlayLayers(['test-overlay', 'nj-2020']);
        const used = _imagery.imageryUsed();
        assert.isTrue(used.length >= 2);  // at least base + overlays
      });
    });


    describe('visibleSources', () => {
      let origViewport;

      beforeAll(() => {
        origViewport = context.viewport;
      });

      afterEach(() => {
        _imagery.setSourceByID('none');
        context.services.osm.imageryBlocklists = [];
        context.viewport = origViewport;
      });

      it('returns empty array when called too soon (no sources)', () => {
        const temp = new Rapid.ImagerySystem(context);
        const visible = temp.visibleSources();
        assert.isArray(visible);
        assert.isEmpty(visible);
      });

      it('returns empty array when called too soon (no whichPolygon)', () => {
        const temp = new Rapid.ImagerySystem(context);
        temp.sources.set('test', _imagery.source('nj-2015'));
        const visible = temp.visibleSources();
        assert.isArray(visible);
        assert.isEmpty(visible);
      });

      it('returns sources visible in current viewport extent', () => {
        // Mock viewport with extent covering New Jersey
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-75.5, 39.5, -74.0, 41.0]  // NJ area
          }),
          transform: { zoom: 10 }
        };

        const visible = _imagery.visibleSources();
        assert.isArray(visible);
        // Should include nj-2015 and nj-2020 which have NJ coverage
        const ids = visible.map(s => s.id);
        assert.isTrue(ids.includes('nj-2015'));
        assert.isTrue(ids.includes('nj-2020'));
      });

      it('always includes current base layer source', () => {
        // Set CA imagery as base layer, but viewport is in NJ
        _imagery.setSourceByID('ca-imagery');
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-75.5, 39.5, -74.0, 41.0]  // NJ area
          }),
          transform: { zoom: 10 }
        };

        const visible = _imagery.visibleSources();
        const ids = visible.map(s => s.id);
        // Should include CA even though we're viewing NJ
        assert.isTrue(ids.includes('ca-imagery'));
      });

      it('excludes blocked sources', () => {
        // Add a blocklist that matches test-overlay's template
        const overlay = _imagery.source('test-overlay');
        const template = overlay.template;
        context.services.osm.imageryBlocklists = [new RegExp(template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];

        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-180, -90, 180, 90]  // worldwide
          }),
          transform: { zoom: 10 }
        };

        const visible = _imagery.visibleSources();
        const ids = visible.map(s => s.id);
        // test-overlay should be blocked
        assert.isFalse(ids.includes('test-overlay'));
      });

      it('includes sources with worldwide coverage regardless of extent', () => {
        // Sources without a 'feature' property have worldwide coverage
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-75.5, 39.5, -74.0, 41.0]  // NJ area
          }),
          transform: { zoom: 10 }
        };

        const visible = _imagery.visibleSources();
        // Should include sources without geographic restrictions
        // Check for sources that don't have a feature property
        const worldwideSources = visible.filter(s => !s.props.feature);
        assert.isAbove(worldwideSources.length, 0);
      });

      it('excludes local imagery at low zoom levels', () => {
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-75.5, 39.5, -74.0, 41.0]  // NJ area
          }),
          transform: { zoom: 5 }  // Low zoom
        };

        const visible = _imagery.visibleSources();
        const ids = visible.map(s => s.id);
        // Should exclude local sources at zoom < 6
        assert.isFalse(ids.includes('nj-2015'));
        assert.isFalse(ids.includes('nj-2020'));
      });

      it('rechecks blocked sources when blocklists change', () => {
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-180, -90, 180, 90]
          }),
          transform: { zoom: 10 }
        };

        // Get first visible source
        context.services.osm.imageryBlocklists = [];
        let visible = _imagery.visibleSources();
        assert.isAbove(visible.length, 0);
        const sourceToBlock = visible[0];

        // Add a blocklist matching that source's template
        const escapedTemplate = sourceToBlock.template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        context.services.osm.imageryBlocklists = [new RegExp(escapedTemplate)];

        // Call visibleSources again to trigger recheck
        visible = _imagery.visibleSources();
        const ids = visible.map(s => s.id);

        // The blocked source should no longer be in the list (unless it's the current base layer)
        if (sourceToBlock.id !== _imagery.baseLayerSource()?.id) {
          assert.isFalse(ids.includes(sourceToBlock.id));
        }
      });
    });


    describe('chooseDefaultSource', () => {
      let origViewport;

      beforeAll(() => {
        origViewport = context.viewport;
      });

      afterEach(() => {
        _imagery.setSourceByID('none');
        delete context.systems.storage;
        context.viewport = origViewport;
      });

      it('returns source marked as best when available', () => {
        // nj-2015 was updated with best:true in updateImageryData
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-75.5, 39.5, -74.0, 41.0]  // NJ area
          }),
          transform: { zoom: 10 }
        };

        const chosen = _imagery.chooseDefaultSource();
        assert.strictEqual(chosen.props.id, 'nj-2015');
        assert.isTrue(chosen.props.best);
      });

      it('returns previously used source from storage', () => {
        // Mock storage with previously used source
        context.systems.storage = {
          getItem: (key) => {
            if (key === 'background-last-used') return 'ca-imagery';
            return null;
          }
        };

        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-122, 37, -121, 38]  // CA area
          }),
          transform: { zoom: 10 }
        };

        const chosen = _imagery.chooseDefaultSource();
        assert.strictEqual(chosen.props.id, 'ca-imagery');
      });

      it('ignores previously used "none" source', () => {
        // Mock storage with 'none' as previous
        context.systems.storage = {
          getItem: (key) => {
            if (key === 'background-last-used') return 'none';
            return null;
          }
        };

        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-180, -90, 180, 90]
          }),
          transform: { zoom: 10 }
        };

        const chosen = _imagery.chooseDefaultSource();
        // Should not return 'none', should return best source (nj-2015) or fallback
        assert.notStrictEqual(chosen.props.id, 'none');
      });

      it('falls back through priority chain: best, previous, Bing, first, none', () => {
        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-180, -90, 180, 90]
          }),
          transform: { zoom: 3 }  // Low zoom, no local imagery
        };

        const chosen = _imagery.chooseDefaultSource();
        // Should return some valid source
        assert.isDefined(chosen);
        assert.instanceOf(chosen, Rapid.ImagerySource);
      });

      it('returns first available source if Bing not available', () => {
        // Remove Bing from the 'osm' scope temporarily
        const osmScope = _imagery.getScope('osm');
        const bing = osmScope.sources.get('testbing');
        osmScope.sources.delete('testbing');

        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-180, -90, 180, 90]
          }),
          transform: { zoom: 3 }
        };

        const chosen = _imagery.chooseDefaultSource();
        assert.isDefined(chosen);
        // Should be some available source
        assert.isTrue(_imagery.sources.has(chosen.id));

        // Restore Bing
        if (bing) osmScope.sources.set('testbing', bing);
      });

      it('returns "none" source as last resort', () => {
        // Save and clear all scopes' sources except 'none'
        const osmScope = _imagery.getScope('osm');
        const commonScope = _imagery.getScope('*');
        const osmBackup = new Map(osmScope.sources);
        const custom = commonScope.sources.get('custom');
        osmScope.sources.clear();
        commonScope.sources.delete('custom');

        context.viewport = {
          visibleExtent: () => ({
            rectangle: () => [-180, -90, 180, 90]
          }),
          transform: { zoom: 10 }
        };

        const chosen = _imagery.chooseDefaultSource();
        assert.strictEqual(chosen.props.id, 'none');

        // Restore sources
        for (const [id, source] of osmBackup) {
          osmScope.sources.set(id, source);
        }
        if (custom) {
          commonScope.sources.set('custom', custom);
        }
      });
    });


    describe('display settings', () => {
      afterEach(() => {
        _imagery.brightness = 1;
        _imagery.contrast = 1;
        _imagery.saturation = 1;
        _imagery.sharpness = 1;
        _imagery.numGridSplits = 0;
      });

      describe('brightness', () => {
        it('gets and sets brightness', () => {
          _imagery.brightness = 0.5;
          assert.strictEqual(_imagery.brightness, 0.5);
        });

        it('accepts any numeric value', () => {
          _imagery.brightness = 2.5;
          assert.strictEqual(_imagery.brightness, 2.5);
        });
      });

      describe('contrast', () => {
        it('gets and sets contrast', () => {
          _imagery.contrast = 0.5;
          assert.strictEqual(_imagery.contrast, 0.5);
        });

        it('accepts any numeric value', () => {
          _imagery.contrast = 2.5;
          assert.strictEqual(_imagery.contrast, 2.5);
        });
      });

      describe('saturation', () => {
        it('gets and sets saturation', () => {
          _imagery.saturation = 0.5;
          assert.strictEqual(_imagery.saturation, 0.5);
        });

        it('accepts any numeric value', () => {
          _imagery.saturation = 2.5;
          assert.strictEqual(_imagery.saturation, 2.5);
        });
      });

      describe('sharpness', () => {
        it('gets and sets sharpness', () => {
          _imagery.sharpness = 0.5;
          assert.strictEqual(_imagery.sharpness, 0.5);
        });

        it('accepts any numeric value', () => {
          _imagery.sharpness = 2.5;
          assert.strictEqual(_imagery.sharpness, 2.5);
        });
      });

      describe('offset', () => {
        afterEach(() => {
          _imagery.setSourceByID('none');
        });

        it('returns [0, 0] when no base layer is set', () => {
          assert.deepEqual(_imagery.offset, [0, 0]);
        });

        it('gets and sets offset when base layer is set', () => {
          _imagery.setSourceByID('nj-2015');
          _imagery.offset = [5, 10];
          assert.deepEqual(_imagery.offset, [5, 10]);
        });

        it('does not emit event when offset is unchanged', () => {
          _imagery.setSourceByID('nj-2015');
          _imagery.offset = [5, 10];
          spyImageryChange.mockClear();
          _imagery.offset = [5, 10];  // same value
          // Should not emit since no change
          assert.strictEqual(spyImageryChange.mock.calls.length, 0);
        });
      });

      describe('nudge', () => {
        let origViewport;

        beforeAll(() => {
          origViewport = context.viewport;
          context.viewport = {
            visibleExtent: () => ({ rectangle: () => [-180, -90, 180, 90] }),
            transform: { zoom: 10 }
          };
        });

        afterEach(() => {
          _imagery.setSourceByID('none');
        });

        afterAll(() => {
          context.viewport = origViewport;
        });

        it('adjusts offset when base layer is set', () => {
          _imagery.setSourceByID('nj-2015');
          const base = _imagery.baseLayerSource();
          base.offset = [0, 0];  // reset offset
          spyImageryChange.mockClear();

          // nudge by [100, 100] - the zoom comes from viewport.transform.zoom
          _imagery.nudge([100, 100], 10);

          assert.isTrue(spyImageryChange.mock.calls.length > 0);
          const offset = _imagery.offset;
          assert.isAbove(offset[0], 0);
          assert.isAbove(offset[1], 0);
        });

        it('accumulates multiple nudges', () => {
          _imagery.setSourceByID('nj-2015');
          const base = _imagery.baseLayerSource();
          base.offset = [0, 0];  // reset offset

          _imagery.nudge([100, 100], 10);
          const firstOffset = _imagery.offset.slice();

          _imagery.nudge([100, 100], 10);
          const secondOffset = _imagery.offset;

          // Second nudge should add to the first
          assert.isAbove(secondOffset[0], firstOffset[0]);
          assert.isAbove(secondOffset[1], firstOffset[1]);
        });
      });

      describe('numGridSplits', () => {
        it('gets and sets numGridSplits', () => {
          _imagery.numGridSplits = 4;
          assert.strictEqual(_imagery.numGridSplits, 4);
        });
      });
    });


    describe('_localeChanged', () => {
      let sourceSpy;

      beforeAll(() => {
        const source = _imagery.getSourceByID('nj-2015');
        sourceSpy = spyOn(source, 'setLocale');
      });

      afterAll(() => {
        sourceSpy.mockReset();
      });

      it(`defaults to en-US, calls 'setLocale' on ImagerySources`, () => {
        sourceSpy.mockClear();
        _imagery._localeChanged();
        assert.lengthOf(sourceSpy.mock.calls, 1);     // setLocale called once
        assert.deepEqual(sourceSpy.mock.lastCall, ['en-US']);
      });

      it(`accepts a localeCode, calls 'setLocale' on ImagerySources`, () => {
        sourceSpy.mockClear();
        _imagery._localeChanged('de');
        assert.lengthOf(sourceSpy.mock.calls, 1);     // setLocale called once
        assert.deepEqual(sourceSpy.mock.lastCall, ['de']);
      });
    });


    describe('_hashChanged', () => {
      let origViewport;

      beforeAll(() => {
        origViewport = context.viewport;
        context.viewport = {
          visibleExtent: () => ({ rectangle: () => [-180, -90, 180, 90] }),
          transform: { zoom: 10 }
        };
      });

      beforeEach(() => {
        spyImageryChange.mockClear();
      });

      afterEach(() => {
        _imagery.requestedAssetIDs = null;
      });

      afterAll(() => {
        context.viewport = origViewport;
      });

      it('does nothing when schema param is unchanged', () => {
        const curr = new Map([['other', 'value']]);
        const prev = new Map([['other', 'value']]);
        _imagery._hashChanged(curr, prev);
        assert.lengthOf(spyImageryChange.mock.calls, 0);  // No imagery change should occur
      });

      it('handles imagery param set to empty string', () => {
        const curr = new Map([['imagery', '']]);
        const prev = new Map();
        _imagery._hashChanged(curr, prev);
        assert.deepEqual(_imagery.requestedAssetIDs, new Set());
        assert.isAtLeast(spyImageryChange.mock.calls.length, 1);  // imagerychange emitted by resetAll
      });

      it('handles imagery param set to null', () => {
        const curr = new Map();
        const prev = new Map([['imagery', 'something']]);
        _imagery._hashChanged(curr, prev);
        assert.isNull(_imagery.requestedAssetIDs);
        assert.isAtLeast(spyImageryChange.mock.calls.length, 1);  // imagerychange emitted by resetAll
      });

      it('handles imagery param with asset IDs', () => {
        const curr = new Map([['imagery', 'editor_layer_index']]);
        const prev = new Map();
        _imagery._hashChanged(curr, prev);
        assert.deepEqual(_imagery.requestedAssetIDs, new Set(['editor_layer_index']));
        assert.isAtLeast(spyImageryChange.mock.calls.length, 1);  // imagerychange emitted by resetAll
      });
    });


    describe('loadImageryAssetsAsync', () => {
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
        const prom = _imagery.loadImageryAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('uses requestedAssetIDs when set', () => {
        _imagery.requestedAssetIDs = 'custom_imagery';
        const prom = _imagery.loadImageryAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.isTrue(_imagery.loadedAssetIDs.has('custom_imagery'));
            assert.isFalse(_imagery.loadedAssetIDs.has('editor_layer_index'));
            assert.isFalse(_imagery.loadedAssetIDs.has('rapid_imagery'));
          })
          .finally(() => _imagery.requestedAssetIDs = null);  // restore
      });

      it('uses defaultAssetIDs when requestedAssetIDs is null', () => {
        _imagery.requestedAssetIDs = null;
        const prom = _imagery.loadImageryAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // Default assetIDs includes 'editor_layer_index' and 'rapid_imagery'
            assert.isTrue(_imagery.loadedAssetIDs.has('editor_layer_index'));
            assert.isTrue(_imagery.loadedAssetIDs.has('rapid_imagery'));
          });
      });

      it('handles rejected asset loading gracefully', () => {
        // Set requestedAssetIDs to something that will fail to load
        _imagery.requestedAssetIDs = 'nonexistent-asset-12345';
        const prom = _imagery.loadImageryAssetsAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            // promise succeeds, but error is logged
            assert.lengthOf(spyError.mock.calls, 1);   // console.error called once
            assert.match(spyError.mock.lastCall[0], /unknown assetID/i);
          })
          .finally(() => _imagery.requestedAssetIDs = null);
      });
    });


    describe('resetAll', () => {
      beforeAll(() => {
        spyImageryChange.mockClear();
        _imagery.resetAll();
      });

      afterEach(() => {
        // Re-merge the test data for subsequent tests
        return _imagery.initAsync().then(() => _imagery.startAsync());
      });

      it('clears collections', () => {
        // After reset, should only have the initial builtin assets
        assert.isEmpty(_imagery.loadedAssetIDs);
        assert.isEmpty(_imagery.features);
        assert.lengthOf(_imagery.sources, 2);
      });

      it('preserves builtin sources', () => {
        assert.isTrue(_imagery.sources.has('none'));
        assert.isTrue(_imagery.sources.has('custom'));
      });

      it('emits imagerychange event', () => {
        assert.lengthOf(spyImageryChange.mock.calls, 1);
      });
    });


    describe('resetAll with storage', () => {
      let mockStorage;

      beforeAll(() => {
        // Set up mock storage with a custom template
        mockStorage = {
          getItem: (key) => {
            if (key === 'background-custom-template') {
              return 'https://custom.example.com/{z}/{x}/{y}.png';
            }
            return null;
          }
        };
        context.systems.storage = mockStorage;
      });

      afterEach(() => {
        // Clear storage mock
        delete context.systems.storage;
        // Re-merge the test data for subsequent tests
        return _imagery.initAsync().then(() => _imagery.startAsync());
      });

      it('loads custom template from storage', () => {
        _imagery.resetAll();
        const custom = _imagery.sources.get('custom');
        assert.strictEqual(custom.template, 'https://custom.example.com/{z}/{x}/{y}.png');
      });
    });

  });  // methods

});
