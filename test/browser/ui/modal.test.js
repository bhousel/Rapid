describe('uiModal', () => {
  let elem;

  beforeEach(() => {
    elem = d3.select('body')
      .append('div')
      .attr('class', 'modal-wrap');
  });

  afterEach(() => {
    d3.select('.modal-wrap')
      .remove();
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }

  it('can be instantiated', () => {
    const $selection = Rapid.uiModal(elem);
    assert.isOk($selection);
  });

  it('has a content section', () => {
    const $selection = Rapid.uiModal(elem);
    assert.strictEqual($selection.selectAll('div.content').size(), 1);
  });

  it('can be dismissed by calling close function', () => {
    const $selection = Rapid.uiModal(elem);
    $selection.close();
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by clicking the close button', () => {
    const $selection = Rapid.uiModal(elem);
    const target = $selection.select('button.close').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by pressing escape', () => {
    const $selection = Rapid.uiModal(elem);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27 }));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

  it('can be dismissed by pressing backspace', () => {
    const $selection = Rapid.uiModal(elem);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8 }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', keyCode: 8 }));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull($selection.node().parentNode);
      });
  });

});
