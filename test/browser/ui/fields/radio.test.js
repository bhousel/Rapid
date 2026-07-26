describe('uiFieldRadio', () => {

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

  before(() => context.systems.l10n.initAsync());

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, {
      id: 'test_radio',
      key: 'test',
      options: ['<img src="x" onerror="alert(1)">'],
      type: 'radio'
    });
    uifield = new Rapid.UiField(context, field);
  });


  it('renders option labels as text', () => {
    const radio = Rapid.uiFieldRadio(context, uifield);

    selection.call(radio);

    assert.strictEqual(selection.select('label span').text(), field.props.options[0]);
    assert.strictEqual(selection.selectAll('img').size(), 0);
  });
});
