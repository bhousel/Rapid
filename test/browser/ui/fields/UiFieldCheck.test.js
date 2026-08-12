describe('UiFieldCheck', () => {

  const context = new Rapid.MockContext();
  let $container, field;

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

  before(() => context.systems.l10n.initAsync());

  beforeEach(() => {
    context.$container = $container = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, {
      id: 'test_check',
      key: 'test',
      type: 'check'
    });
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  it('renders an unknown tag value as text', () => {
    const check = new Rapid.UiFieldCheck(context, field);
    const value = '<img src="x" onerror="alert(1)">';

    $container.call(check.render);
    check.syncTags({ test: value });

    assert.strictEqual($container.select('.value').text(), `\"${value}\"`);
    assert.strictEqual($container.selectAll('img').size(), 0);
  });
});
