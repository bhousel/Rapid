describe('UiModal', () => {
  const context = new Rapid.MockContext();

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }

  beforeEach(() => {
    context.$container = d3.select('body').append('div').attr('class', 'modal-wrap');
  });

  afterEach(() => {
    context.$container.remove();
    context.$container = d3.select(null);
  });

  // Note: Esc/Backspace dismissal is routed through `UiSystem`'s modal stack, so it
  // can't be exercised here without a running `UiSystem`.  See `.scratchpad/current.md`.

  it('can be instantiated and shown', () => {
    const modal = new Rapid.UiModal(context).show();
    assert.isOk(modal);
    assert.isTrue(modal.isShown);
  });

  it('has a content section', () => {
    const modal = new Rapid.UiModal(context).show();
    assert.strictEqual(modal.$modal.selectAll('div.content').size(), 1);
  });

  it('can be dismissed by calling close', () => {
    const modal = new Rapid.UiModal(context).show();
    const node = modal.$shaded.node();
    modal.close();
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull(node.parentNode);
      });
  });

  it('can be dismissed by clicking the close button', () => {
    const modal = new Rapid.UiModal(context).show();
    const node = modal.$shaded.node();
    const target = modal.$modal.select('button.close').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull(node.parentNode);
      });
  });

});
