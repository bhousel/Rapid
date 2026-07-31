describe('UiSectionRawTagEditor', () => {

  const context = new Rapid.MockContext();
  const entity = new Rapid.OsmNode(context, { id: 'n-1' });
  let rawTagEditor, wrap;

  context.systems = {
    l10n:      new Rapid.LocalizationSystem(context),
    scheduler: new Rapid.SchedulerSystem(context)
  };

  before(() => {
    const l10n = context.systems.l10n;
    const scheduler = context.systems.scheduler;
    return Promise.all([ l10n.initAsync(), scheduler.initAsync() ])
      .then(() => Promise.all([l10n.startAsync(), scheduler.startAsync()]));
  });

  beforeEach(() => {
    render({ highway: 'residential' });
  });

  afterEach(() => {
    d3.selectAll('.ui-wrap').remove();
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }

  function render(tags) {
    rawTagEditor = new Rapid.UiSectionRawTagEditor(context, 'raw-tag-editor')
      .entityIDs([ entity.id ])
      .presets([ { isFallback: () => false } ])
      .tags(tags);

    wrap = d3.select('body')
      .append('div')
      .attr('class', 'ui-wrap')
      .call(rawTagEditor.render);
  }


  it('creates input elements for each key-value pair', () => {
    assert.isNotEmpty(wrap.selectAll('input[value=highway]'));
    assert.isNotEmpty(wrap.selectAll('input[value=residential]'));
  });


  it('creates a pair of empty input elements if the entity has no tags', () => {
    wrap.remove();
    render({});
    assert.isEmpty(wrap.select('.tag-list').selectAll('input.value').property('value'));
    assert.isEmpty(wrap.select('.tag-list').selectAll('input.key').property('value'));
  });


  it('adds tags when clicking the add button', () => {
    const target = wrap.selectAll('button.add-tag').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(40)
      .then(() => {
        assert.isEmpty(wrap.select('.tag-list').selectAll('input').nodes()[2].value);
        assert.isEmpty(wrap.select('.tag-list').selectAll('input').nodes()[3].value);
      });
  });


  it('removes tags when clicking the remove button', done => {
    rawTagEditor.on('change', (entityIDs, tags) => {
      assert.deepEqual(tags, { highway: undefined });
      done();
    });
    wrap.selectAll('button.remove').node()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });


  it('adds tags when pressing the Tab key on last input.value', () => {
    assert.lengthOf(wrap.selectAll('.tag-list li').nodes(), 1);
    const input = d3.select('.tag-list li:last-child input.value').node();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9 }));
    return delay(40)
      .then(() => {
        assert.lengthOf(wrap.selectAll('.tag-list li').nodes(), 2);
        assert.isEmpty(wrap.select('.tag-list').selectAll('input').nodes()[2].value);
        assert.isEmpty(wrap.select('.tag-list').selectAll('input').nodes()[3].value);
      });
  });


  it('does not add a tag when pressing Tab + Shift', () => {
    assert.lengthOf(wrap.selectAll('.tag-list li').nodes(), 1);
    const input = d3.select('.tag-list li:last-child input.value').node();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, shiftKey: true }));
    return delay(20)
      .then(() => {
        assert.lengthOf(wrap.selectAll('.tag-list li').nodes(), 1);
      });
  });
});
