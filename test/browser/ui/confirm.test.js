describe('uiConfirm', () => {

  const context = new Rapid.MockContext();
  let elem;

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }

  beforeEach(() => {
    elem = d3.select('body')
      .append('div')
      .attr('class', 'confirm-wrap');
  });

  afterEach(() => {
    d3.select('.confirm-wrap')
      .remove();
  });

  it('can be instantiated', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    assert.isOk($selection);
  });

  it('has a header section', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    assert.strictEqual($selection.selectAll('div.content div.header').size(), 1);
  });

  it('has a message section', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    assert.strictEqual($selection.selectAll('div.content div.message-text').size(), 1);
  });

  it('has a buttons section', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    assert.strictEqual($selection.selectAll('div.content div.buttons').size(), 1);
  });

  it('can have an ok button added to it', () => {
    const $selection = Rapid.uiConfirm(context, elem).okButton();
    assert.strictEqual($selection.selectAll('div.content div.buttons button.action').size(), 1);
  });

  it('can be dismissed by calling close function', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    $selection.close();
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by clicking the close button', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    const target = $selection.select('button.close').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by pressing escape', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27 }));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by pressing backspace', () => {
    const $selection = Rapid.uiConfirm(context, elem);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8 }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', keyCode: 8 }));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by clicking the ok button', () => {
    const $selection = Rapid.uiConfirm(context, elem).okButton();
    const target = $selection.select('div.content div.buttons button.action').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });
});
