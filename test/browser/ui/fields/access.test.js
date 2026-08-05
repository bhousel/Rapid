describe('UiFieldAccess', () => {

  const context = new Rapid.MockContext();
  let selection, field;

  class MockEditSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'editor';
    }
    get staging() {
      return { graph: new Rapid.Graph(this.context) };
    }
  }

  context.systems = {
    editor:  new MockEditSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };
  context.container = () => selection;

  before(() => {
    return Promise.all([
      context.systems.l10n.initAsync()
      // context.systems.schema.initAsync()
    ]);
  });

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, {
      id:   'access',
      keys: ['access', 'foot', 'motor_vehicle', 'bicycle', 'horse'],
      type: 'access'
    });
  });


  it('creates inputs for a constiety of modes of access', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);
    assert.strictEqual(selection.selectAll('.preset-access-access').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-foot').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-motor_vehicle').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-bicycle').size(), 1);
    assert.strictEqual(selection.selectAll('.preset-access-horse').size(), 1);
  });


  it('does not include "yes", "designated", "dismount" options for general access (iD#934), (iD#2213)', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    const options = access._fieldOptions('access').map(v => v.value);
    assert.notInclude(options, 'yes');
    assert.notInclude(options, 'designated');
    assert.notInclude(options, 'dismount');
  });


  it('does include a "dismount" option for bicycles (iD#2726)', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    let options;

    options = access._fieldOptions('bicycle').map(v => v.value);
    assert.include(options, 'dismount');

    options = access._fieldOptions('foot').map(v => v.value);
    assert.notInclude(options, 'dismount');
  });


  it('sets foot placeholder to "yes" for steps and pedestrian', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);

    access.syncTags({ highway: 'steps' });
    assert.strictEqual(selection.selectAll('.preset-input-access-foot').attr('placeholder'), 'yes');

    access.syncTags({ highway: 'pedestrian' });
    assert.strictEqual(selection.selectAll('.preset-input-access-foot').attr('placeholder'), 'yes');
  });


  it('sets foot placeholder to "designated" for footways', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);

    access.syncTags({ highway: 'footway' });
    assert.strictEqual(selection.selectAll('.preset-input-access-foot').attr('placeholder'), 'designated');
  });


  it('sets bicycle placeholder to "designated" for cycleways', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);

    access.syncTags({ highway: 'cycleway' });
    assert.strictEqual(selection.selectAll('.preset-input-access-bicycle').attr('placeholder'), 'designated');
  });


  it('sets horse placeholder to "designated" for bridleways', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);

    access.syncTags({ highway: 'bridleway' });
    assert.strictEqual(selection.selectAll('.preset-input-access-horse').attr('placeholder'), 'designated');
  });


  it('sets motor_vehicle placeholder to "no" for footways, steps, pedestrian, cycleway, bridleway, and path', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);
    ['footway', 'steps', 'pedestrian', 'cycleway', 'bridleway', 'path'].forEach(value => {
      access.syncTags({ highway: value });
      assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'no');
    });
  });


  it('sets motor_vehicle placeholder to "yes" for various other highway tags', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);
    [
      'residential', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'service',
      'unclassified', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
    ].forEach(value => {
      access.syncTags({ highway: value });
      assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'yes');
    });
  });


  it('overrides a "yes" or "designated" placeholder with more specific access tag (iD#2213)', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);

    access.syncTags({ highway: 'service', access: 'emergency' });
    assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'emergency');

    access.syncTags({ highway: 'cycleway', access: 'permissive' });
    assert.strictEqual(selection.selectAll('.preset-input-access-bicycle').attr('placeholder'), 'permissive');
  });


  it('overrides a "no" placeholder with more specific access tag (iD#2763)', () => {
    const access = new Rapid.UiFieldAccess(context, field);
    selection.call(access.render);

    access.syncTags({ highway: 'cycleway', access: 'destination' });
    assert.strictEqual(selection.selectAll('.preset-input-access-motor_vehicle').attr('placeholder'), 'destination');
  });

});
