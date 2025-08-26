import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationMismatchedGeometry', () => {
  let graph;
  let _savedAreaKeys;

  class MockEditSystem {
    constructor() {}
    initAsync()   { return Promise.resolve(); }
    get staging() { return { graph: graph }; }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    assets:     new Rapid.AssetSystem(context),
    editor:     new MockEditSystem(context),
    l10n:       new Rapid.LocalizationSystem(context),
    locations:  new Rapid.LocationSystem(context),
    map:        new Rapid.MapSystem(context),
    presets:    new Rapid.PresetSystem(context),
    spatial:    new Rapid.SpatialSystem(context),
    storage:    new Rapid.StorageSystem(context),
    urlhash:    new Rapid.UrlHashSystem(context)
  };

  const validator = Rapid.validationMismatchedGeometry(context);


  before(() => {
    return Promise.all([
      context.systems.locations.initAsync()
    ]);
  });

  beforeEach(() => {
    graph = new Rapid.Graph(context);   // reset
    _savedAreaKeys = Rapid.osmAreaKeys;

    const testPresets = {
      building: {
        tags: { building: '*' },
        geometry: ['area']
      },
      desert_library: {
        tags: { amenity: 'library' },
        geometry: ['point'],
        locationSet: { include: ['Q620634'] }
      }
    };
    context.systems.assets._cache.tagging_preset_presets = testPresets;
  });

  afterEach(() => {
    Rapid.osmSetAreaKeys(_savedAreaKeys);
    context.systems.assets._cache.tagging_preset_presets = {};
  });



  function validate() {
    const entities = [ ...graph.base.entities.values() ];

    let issues = [];
    for (const entity of entities) {
      issues = issues.concat(validator(entity, graph));
    }
    return issues;
  }


  //
  //  n1
  //
  function createPoint(n1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: n1tags });
    const entities = [n1];
    graph = new Rapid.Graph(context, entities);
  }

  //    n2      w1: [n1, n2, n3]
  //    /\
  //  n1  n3
  //
  function createOpenWay(w1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 1] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [2, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: w1tags });
    const entities = [n1, n2, n3, w1];
    graph = new Rapid.Graph(context, entities);
  }

  //    n2      w1: [n1, n2, n3, n1]
  //    /\
  //  n1--n3
  //
  function createClosedWay(w1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 1] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [2, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n1'], tags: w1tags });
    const entities = [n1, n2, n3, w1];
    graph = new Rapid.Graph(context, entities);
  }


  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores building mapped as point', () => {
    createPoint({ building: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores open way without area tag', () => {
    createOpenWay({});
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores closed way with area tag', () => {
    createClosedWay({ building: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores open way with tag that allows both lines and areas', () => {
    createOpenWay({ man_made: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('flags open way with area tag', () => {
    // In this test case, `building=yes` suggests area, and we should match the 'building' preset.
    Rapid.osmSetAreaKeys({ building: {} });
    const presets = context.systems.presets;
    return presets.initAsync().then(() => {
      createOpenWay({ building: 'yes' });

      const issues = validate();
      assert.isArray(issues);
      assert.lengthOf(issues, 1);

      const expected = {
        type:      'mismatched_geometry',
        subtype:   'area_as_line',
        severity:  'warning',
        entityIds: ['w1']
      };
      assert.deepInclude(issues[0], expected);
    });
  });

  it('does not flag cases whether the entity matches the generic preset, regardless of geometry', () => {
    // In this test case, `waterway=yes` suggests area, but we won't match any presets.
    // There is no preset for `waterway=security_lock`, so it matches fallback presets for both line and area.
    Rapid.osmSetAreaKeys({ waterway: { dam: true } });
    const presets = context.systems.presets;
    return presets.initAsync().then(() => {
      createOpenWay({ 'disused:waterway': 'security_lock' });
      const issues = validate();
      assert.deepEqual(issues, []);
    });
  });

  it(`does not flag open way if the preset location doesn't match the entity location` , () => {
    // In this test case, there is an area preset for `amenity=library` but we won't match it because of the location
    const presets = context.systems.presets;
    return presets.initAsync().then(() => {
      createOpenWay({ amenity: 'library' });
      const issues = validate();
      assert.deepEqual(issues, []);
    });
  });

  it('flags open way with both area and line tags', () => {
    createOpenWay({ area: 'yes', barrier: 'fence' });
    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:      'mismatched_geometry',
      subtype:   'area_as_line',
      severity:  'warning',
      entityIds: ['w1']
    };
    assert.deepInclude(issues[0], expected);
  });

});
