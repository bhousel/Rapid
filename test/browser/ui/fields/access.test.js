describe('uiFieldAccess', () => {

  class MockEditSystem {
    constructor(context) {
      this.context = context;
    }
    get staging() {
      return { graph: new Rapid.Graph(this.context) };
    }
  }

  class MockLocalizationSystem {
    constructor() { }
    t(id)         { return id; }
    tHtml(id)     { return id; }
  }

  class MockContext {
    constructor()   {
      this.viewport = new Rapid.sdk.Viewport();
      this.sequences = {};
      this.services = {};
      this.systems = {
        assets:  new Rapid.AssetSystem(this),
        editor:  new MockEditSystem(this),
        l10n:    new MockLocalizationSystem(this),
        presets: new Rapid.PresetSystem(this)
      };
    }
    cleanTagKey(val)   { return val; }
    cleanTagValue(val) { return val; }
    container()        { return selection; }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }


  const context = new MockContext();
  let selection, field, uifield;

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, {
      id:   'access',
      keys: ['access', 'foot', 'motor_vehicle', 'bicycle', 'horse'],
      type: 'access'
    });
    uifield = new Rapid.UiField(context, field);
  });


  it('creates inputs for a constiety of modes of access', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);
    assert.strictEqual(selection.selectAll('.preset-access-access').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-foot').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-motor_vehicle').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-bicycle').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-horse').size(), 1);
  });


  it('does not include "yes", "designated", "dismount" options for general access (iD#934), (iD#2213)', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    const options = access.options('access').map(v => v.value);
    assert.notInclude(options, 'yes');
    assert.notInclude(options, 'designated');
    assert.notInclude(options, 'dismount');
  });


  it('does include a "dismount" option for bicycles (iD#2726)', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    let options;

    options = access.options('bicycle').map(v => v.value);
    assert.include(options, 'dismount');

    options = access.options('foot').map(v => v.value);
    assert.notInclude(options, 'dismount');
  });


  it('sets foot placeholder to "yes" for steps and pedestrian', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);

    access.tags({ highway: 'steps' });
    assert.strictEqual(selection.selectAll('.preset-input-access-foot').attr('placeholder'), 'yes');

    access.tags({ highway: 'pedestrian' });
    assert.strictEqual(selection.selectAll('.preset-input-access-foot').attr('placeholder'), 'yes');
  });


  it('sets foot placeholder to "designated" for footways', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);

    access.tags({ highway: 'footway' });
    assert.strictEqual(selection.selectAll('.preset-input-access-foot').attr('placeholder'), 'designated');
  });


  it('sets bicycle placeholder to "designated" for cycleways', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);

    access.tags({ highway: 'cycleway' });
    assert.strictEqual(selection.selectAll('.preset-input-access-bicycle').attr('placeholder'), 'designated');
  });


  it('sets horse placeholder to "designated" for bridleways', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);

    access.tags({ highway: 'bridleway' });
    assert.strictEqual(selection.selectAll('.preset-input-access-horse').attr('placeholder'), 'designated');
  });


  it('sets motor_vehicle placeholder to "no" for footways, steps, pedestrian, cycleway, bridleway, and path', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);
    ['footway', 'steps', 'pedestrian', 'cycleway', 'bridleway', 'path'].forEach(value => {
      access.tags({ highway: value });
      assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'no');
    });
  });


  it('sets motor_vehicle placeholder to "yes" for various other highway tags', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);
    [
      'residential', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'service',
      'unclassified', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
    ].forEach(value => {
      access.tags({ highway: value });
      assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'yes');
    });
  });


  it('overrides a "yes" or "designated" placeholder with more specific access tag (iD#2213)', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);

    access.tags({ highway: 'service', access: 'emergency' });
    assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'emergency');

    access.tags({ highway: 'cycleway', access: 'permissive' });
    assert.strictEqual(selection.selectAll('.preset-input-access-bicycle').attr('placeholder'), 'permissive');
  });


  it('overrides a "no" placeholder with more specific access tag (iD#2763)', () => {
    const access = Rapid.uiFieldAccess(context, uifield);
    selection.call(access);

    access.tags({ highway: 'cycleway', access: 'destination' });
    assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'destination');
  });

});
