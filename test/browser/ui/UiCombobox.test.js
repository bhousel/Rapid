describe('UiCombobox', () => {

  const context = new Rapid.MockContext();
  let $container, $content, $input, Combobox;

  context.systems = {
    scheduler: new Rapid.SchedulerSystem(context)
  };

  before(() => {
    const scheduler = context.systems.scheduler;
    return scheduler.initAsync().then(() => scheduler.startAsync());
  });

  beforeEach(() => {
    context.$container = $container = d3.select('body').append('div').attr('class', 'container');
    $content = $container.append('div');
    $input = $content.append('input');
    Combobox = new Rapid.UiCombobox(context);
  });

  afterEach(() => {
    $content.remove();
    $container.remove();
    context.$container = d3.select(null);
  });


  const data = [
    { title: 'foobar', value: 'foobar' },
    { title: 'foo', value: 'foo' },
    { title: 'bar', value: 'bar' },
    { title: 'Baz', value: 'Baz' },
    { title: 'test', value: 'test' }
  ];

  function simulateKeypress(key) {
    const keyCode = Rapid.utilKeybinding.keyCodes[key];
    let value = $input.property('value');
    let start = $input.property('selectionStart');
    let finis = $input.property('selectionEnd');

    $input.node().dispatchEvent(new KeyboardEvent('keydown', { key: undefined, keyCode: keyCode }));

    switch (key) {
      case '⇥':
      break;

      case '←':
      start = finis = Math.max(0, start - 1);
      $input.node().setSelectionRange(start, finis);
      break;

      case '→':
      start = finis = Math.max(start + 1, value.length);
      $input.node().setSelectionRange(start, finis);
      break;

      case '↑':
      case '↓':
      case '↩':
      case '⎋':
      break;

      case '⌫':
      value = value.substring(0, start - (start === finis ? 1 : 0)) +
          value.substring(finis, value.length);
      $input.property('value', value);
      $input.node().dispatchEvent(new InputEvent('input'));
      break;

      case '⌦':
      value = value.substring(0, start) +
          value.substring(finis + (start === finis ? 1 : 0), value.length);
      $input.property('value', value);
      $input.node().dispatchEvent(new InputEvent('input'));
      break;

      default:
      value = value.substring(0, start) + key + value.substring(finis, value.length);
      $input.property('value', value);
      $input.node().dispatchEvent(new InputEvent('input'));
    }

    $input.node().dispatchEvent(new KeyboardEvent('keyup', { key: undefined, keyCode: keyCode }));
  }


  function focusTypeahead($input) {
    $input.node().focus();
  }

  it('adds the combobox-input class', () => {
    $input.call(Combobox.attach);
    assert.isTrue($input.classed('combobox-input'));
  });

  it('adds combobox under container', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('↓');
    assert.strictEqual($container.selectAll('div.combobox').size(), 1);
  });

  it('sanitizes HTML labels', () => {
    const unsafe = [{
      display: '<script>alert(1)</script><img src="x" onerror="alert(2)">',
      value: 'unsafe'
    }];

    $input.call(Combobox.data(unsafe).attach);
    focusTypeahead($input);
    simulateKeypress('↓');

    assert.strictEqual($container.selectAll('.combobox-option script').size(), 0);
    assert.strictEqual($container.selectAll('.combobox-option [onerror]').size(), 0);
  });

  it('filters entries to those matching the value', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    assert.strictEqual($container.selectAll('.combobox-option').size(), 3);
    assert.strictEqual($container.selectAll('.combobox-option').nodes()[0].text, 'foobar');
    assert.strictEqual($container.selectAll('.combobox-option').nodes()[1].text, 'bar');
    assert.strictEqual($container.selectAll('.combobox-option').nodes()[2].text, 'Baz');
  });

  it('shows all entries when activating the combo', () => {
    $input.property('value', 'foobar').call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('↓');
    assert.strictEqual($container.selectAll('.combobox-option').size(), 5);
    assert.strictEqual($container.selectAll('.combobox-option').text(), 'foobar');
  });

  it('selects the first option that matches the input', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 1);
    assert.strictEqual($container.selectAll('.combobox-option.selected').text(), 'bar');
  });

  it('prefers an option that exactly matches the input over the first option', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('f');
    simulateKeypress('o');
    simulateKeypress('o');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 1);
    assert.strictEqual($container.selectAll('.combobox-option.selected').text(), 'foo');  // skip foobar
  });

  it('does not autocomplete numeric options', () => {
    const numeric = [
      { title: '100', value: '100' },
      { title: '110', value: '110' }
    ];
    $input.call(Combobox.data(numeric).attach);
    focusTypeahead($input);
    simulateKeypress('1');
    simulateKeypress('0');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 0);
  });

  it('does not autocomplete if canAutocomplete(false)', () => {
    $input.call(Combobox.data(data).canAutocomplete(false).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    assert.strictEqual($input.property('value'), 'b');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 0);
  });

  it('selects the completed portion of the value', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    assert.strictEqual($input.property('value'), 'bar');
    assert.strictEqual($input.property('selectionStart'), 1);
    assert.strictEqual($input.property('selectionEnd'), 3);
  });

  it('does not preserve the case of the input portion of the value by default', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('B');
    assert.strictEqual($input.property('value'), 'bar');
    assert.strictEqual($input.property('selectionStart'), 1);
    assert.strictEqual($input.property('selectionEnd'), 3);
  });

  it('does preserve the case of the input portion of the value with caseSensitive option', () => {
    Combobox.caseSensitive(true);
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('B');
    assert.strictEqual($input.property('value'), 'Baz');
    assert.strictEqual($input.property('selectionStart'), 1);
    assert.strictEqual($input.property('selectionEnd'), 3);
  });

  it('does not select when value is empty', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    $input.node().dispatchEvent(new InputEvent('input'));
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 0);
  });

  it('does not select when value is not a prefix of any suggestion', () => {
    $input.call( Combobox.fetcher((_, cb) => cb(data)).attach );
    focusTypeahead($input);
    simulateKeypress('b');
    simulateKeypress('i');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 0);
  });

  it('does not select or autocomplete after ⌫', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    simulateKeypress('⌫');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 0);
    assert.strictEqual($input.property('value'), 'b');
  });

  it('does not select or autocomplete after ⌦', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('f');
    simulateKeypress('b');
    simulateKeypress('←');
    simulateKeypress('←');
    simulateKeypress('⌦');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 0);
    assert.strictEqual($input.property('value'), 'b');
  });

  it('selects and autocompletes the next/prev suggestion on ↓/↑', () => {
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);

    simulateKeypress('↓');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 1);
    assert.strictEqual($container.selectAll('.combobox-option.selected').text(), 'foobar');
    assert.strictEqual($input.property('value'), 'foobar');

    simulateKeypress('↓');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 1);
    assert.strictEqual($container.selectAll('.combobox-option.selected').text(), 'foo');
    assert.strictEqual($input.property('value'), 'foo');

    simulateKeypress('↑');
    assert.strictEqual($container.selectAll('.combobox-option.selected').size(), 1);
    assert.strictEqual($container.selectAll('.combobox-option.selected').text(), 'foobar');
    assert.strictEqual($input.property('value'), 'foobar');
  });

  it('emits accepted event with selected datum on ⇥', done => {
    const onAccept = val => {
      assert.deepEqual(val, { title: 'bar', value: 'bar' });
      Combobox.off('accept', onAccept);
      done();
    };
    Combobox.on('accept', onAccept);
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    simulateKeypress('⇥');
  });

  it('emits accepted event with selected datum on ↩', done => {
    const onAccept = val => {
      assert.deepEqual(val, { title: 'bar', value: 'bar' });
      Combobox.off('accept', onAccept);
      done();
    };
    Combobox.on('accept', onAccept);
    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    simulateKeypress('↩');
  });

  it('emits cancel event on ⎋', () => {
    const spy = (...args) => spy.mock.calls.push(args);
    spy.mock = { calls: [] };

    Combobox.on('cancel', spy);

    $input.call(Combobox.data(data).attach);
    focusTypeahead($input);
    simulateKeypress('b');
    simulateKeypress('⎋');
    assert.lengthOf(spy.mock.calls, 1);
  });

  it('hides on ↩', () => {
    $input.call(Combobox.data(data).attach);
    $input.node().focus();
    simulateKeypress('↩');
    assert.strictEqual($container.selectAll('.combobox').size(), 0);
  });
});
