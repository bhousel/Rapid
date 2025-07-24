describe('validationMismatchedGeometry', () => {
  let graph;
  let _savedAreaKeys;

  class MockLocalizationSystem {
    constructor() {}
    displayLabel(entity)  { return entity.id; }
    t(id)                 { return id; }
  }

  class MockStorageSystem {
    constructor() { }
    getItem() { return ''; }
  }

  class MockUrlSystem {
    constructor() {
      this.initialHashParams = new Map();
    }
    initAsync()   { return Promise.resolve(); }
    on()          { return this; }
  }

  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
      this.sequences = {};
      this.systems = {
        assets:     new Rapid.AssetSystem(this),
        l10n:       new MockLocalizationSystem(),
        locations:  new Rapid.LocationSystem(this),
        presets:    new Rapid.PresetSystem(this),
        storage:    new MockStorageSystem(),
        urlhash:    new MockUrlSystem()
      };
    }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
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

  it('has no errors on init', () => {
    const issues = validate();
    expect(issues).to.have.lengthOf(0);
  });


  //
  //  n-1  *
  //
  function createPoint(n1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0], tags: n1tags });
    const entities = [n1];
    graph = new Rapid.Graph(context, entities);
  }


  //        n-2
  //         *
  //        / \
  //  n-1  *   *  n-3
  //
  function createOpenWay(w1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n-2', loc: [1, 1] });
    const n3 = new Rapid.OsmNode(context, { id: 'n-3', loc: [2, 0] });
    const w1 = new Rapid.OsmWay(context, {id: 'w-1', nodes: ['n-1', 'n-2', 'n-3'], tags: w1tags });
    const entities = [n1, n2, n3, w1];
    graph = new Rapid.Graph(context, entities);
  }


  //        n-2
  //         *
  //        / \
  //  n-1  *---*  n-3
  //
  function createClosedWay(w1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n-2', loc: [1, 1] });
    const n3 = new Rapid.OsmNode(context, { id: 'n-3', loc: [2, 0] });
    const w1 = new Rapid.OsmWay(context, {id: 'w-1', nodes: ['n-1', 'n-2', 'n-3', 'n-1'], tags: w1tags });
    const entities = [n1, n2, n3, w1];
    graph = new Rapid.Graph(context, entities);
  }


  it('ignores building mapped as point', () => {
    createPoint({ building: 'yes' });
    const issues = validate();
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores open way without area tag', () => {
    createOpenWay({});
    const issues = validate();
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores closed way with area tag', () => {
    createClosedWay({ building: 'yes' });
    const issues = validate();
    expect(issues).to.have.lengthOf(0);
  });

  it('ignores open way with tag that allows both lines and areas', () => {
    createOpenWay({ man_made: 'yes' });
    const issues = validate();
    expect(issues).to.have.lengthOf(0);
  });

  it('flags open way with area tag', () => {
    // In this test case, `building=yes` suggests area, and we should match the 'building' preset.
    Rapid.osmSetAreaKeys({ building: {} });
    const presets = context.systems.presets;
    return presets.initAsync().then(() => {
      createOpenWay({ building: 'yes' });
      const issues = validate();
      expect(issues).to.have.lengthOf(1);

      const issue = issues[0];
      expect(issue.type).to.eql('mismatched_geometry');
      expect(issue.subtype).to.eql('area_as_line');
      expect(issue.severity).to.eql('warning');
      expect(issue.entityIds).to.eql(['w-1']);
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
      expect(issues).to.have.lengthOf(0);
    });
  });

  it(`does not flag open way if the preset location doesn't match the entity location` , () => {
    // In this test case, there is an area preset for `amenity=library` but we won't match it because of the location
    const presets = context.systems.presets;
    return presets.initAsync().then(() => {
      createOpenWay({ amenity: 'library' });
      const issues = validate();
      expect(issues).to.have.lengthOf(0);
    });
  });

  it('flags open way with both area and line tags', () => {
    createOpenWay({ area: 'yes', barrier: 'fence' });
    const issues = validate();
    expect(issues).to.have.lengthOf(1);

    const issue = issues[0];
    expect(issue.type).to.eql('mismatched_geometry');
    expect(issue.subtype).to.eql('area_as_line');
    expect(issue.severity).to.eql('warning');
    expect(issue.entityIds).to.eql(['w-1']);
  });

});
