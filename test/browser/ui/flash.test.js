describe('uiFlash', () => {

  const context = new Rapid.MockContext();
  let $body, $container;

  beforeEach(() => {
    $body = d3.select('body');
    $container = $body.append('div');
    $container
      .append('div')
      .attr('class', 'flash-wrap')
      .append('div')
      .attr('class', 'map-footer-wrap');
    context.$container = $container;
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }


  it('flash is shown', () => {
    new Rapid.UiFlash(context).show({ duration: 10 });
    const $flashWrap = d3.selectAll('.flash-wrap');
    const $footerWrap = d3.selectAll('.map-footer-wrap');
    assert.isTrue($flashWrap.classed('map-footer-show'));
    assert.isTrue($footerWrap.classed('map-footer-hide'));
  });

  it('sanitizes the label', () => {
    new Rapid.UiFlash(context).show({
      label: '<script>alert(1)</script><img src="x" onerror="alert(2)">'
    });

    assert.strictEqual($container.selectAll('.flash-text script').size(), 0);
    assert.strictEqual($container.selectAll('.flash-text [onerror]').size(), 0);
  });

  it('flash goes away', () => {
    new Rapid.UiFlash(context).show({ duration: 10 });
    return delay(20)
      .then(() => {
        const $flashWrap = d3.selectAll('.flash-wrap');
        const $footerWrap = d3.selectAll('.map-footer-wrap');
        assert.isTrue($flashWrap.classed('map-footer-hide'));
        assert.isTrue($footerWrap.classed('map-footer-show'));
      });
  });

});
