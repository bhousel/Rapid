describe('uiFieldCheck', () => {

  const context = new Rapid.MockContext();
  let selection, field, uifield;

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

  before(() => context.systems.l10n.initAsync());

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, {
      id: 'test_check',
      key: 'test',
      type: 'check'
    });
    uifield = new Rapid.UiField(context, field);
  });


  it('renders an unknown tag value as text', () => {
    const check = Rapid.uiFieldCheck(context, uifield);
    const value = '<img src="x" onerror="alert(1)">';

    selection.call(check);
    check.tags({ test: value });

    assert.strictEqual(selection.select('.value').text(), `\"${value}\"`);
    assert.strictEqual(selection.selectAll('img').size(), 0);
  });
});
