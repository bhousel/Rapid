describe('UiFieldRadio', () => {

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
      id: 'test_radio',
      key: 'test',
      options: ['<img src="x" onerror="alert(1)">'],
      type: 'radio'
    });
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  it('renders option labels as text', () => {
    const radio = new Rapid.UiFieldRadio(context, field);

    $container.call(radio.renderContent);

    assert.strictEqual($container.select('label span').text(), field.props.options[0]);
    assert.strictEqual($container.selectAll('img').size(), 0);
  });
});
