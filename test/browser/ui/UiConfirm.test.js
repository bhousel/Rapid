describe('UiConfirm', () => {
  const context = new Rapid.MockContext();
  let $container;

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }

  beforeEach(() => {
    context.$container = $container = d3.select('body').append('div').attr('class', 'confirm-wrap');
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });

  // Note: Esc/Backspace dismissal is routed through `UiSystem`'s modal stack, so it
  // can't be exercised here without a running `UiSystem`.  See `.scratchpad/current.md`.

  it('can be instantiated and shown', () => {
    const modal = new Rapid.UiConfirm(context).show();
    assert.isOk(modal);
    assert.isTrue(modal.isShown);
  });

  it('has a header section', () => {
    const modal = new Rapid.UiConfirm(context).show();
    assert.strictEqual(modal.$shaded.selectAll('div.content div.header').size(), 1);
  });

  it('has a message section', () => {
    const modal = new Rapid.UiConfirm(context).show();
    assert.strictEqual(modal.$shaded.selectAll('div.content div.message-text').size(), 1);
  });

  it('has a buttons section', () => {
    const modal = new Rapid.UiConfirm(context).show();
    assert.strictEqual(modal.$shaded.selectAll('div.content div.buttons').size(), 1);
  });

  it('can have an ok button added to it', () => {
    const modal = new Rapid.UiConfirm(context).show().okButton();
    assert.strictEqual(modal.$shaded.selectAll('div.content div.buttons button.action').size(), 1);
  });

  it('can be dismissed by calling close', () => {
    const modal = new Rapid.UiConfirm(context).show();
    const node = modal.$shaded.node();
    modal.close();
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull(node.parentNode);
      });
  });

  it('can be dismissed by clicking the close button', () => {
    const modal = new Rapid.UiConfirm(context).show();
    const node = modal.$shaded.node();
    const target = modal.$modal.select('button.close').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull(node.parentNode);
      });
  });

  it('can be dismissed by clicking the ok button', () => {
    const modal = new Rapid.UiConfirm(context).show().okButton();
    const node = modal.$shaded.node();
    const target = modal.$shaded.select('div.content div.buttons button.action').node();
    target.dispatchEvent(new MouseEvent('click'));
    return delay(275)
      .then(() => {
        d3.timerFlush();
        assert.isNull(node.parentNode);
      });
  });

});
