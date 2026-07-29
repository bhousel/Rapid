describe('uiFlash', () => {

  const context = new Rapid.MockContext();
  let body, container;

  beforeEach(() => {
    body = d3.select('body');
    container = body.append('div');
    context.container = () => container;
    container
      .append('div')
      .attr('class', 'flash-wrap')
      .append('div')
      .attr('class', 'map-footer-wrap');
  });

  afterEach(() => {
    container.remove();
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }


  it('flash is shown', () => {
    Rapid.uiFlash(context).duration(10)();
    const flashWrap = d3.selectAll('.flash-wrap');
    const footerWrap = d3.selectAll('.map-footer-wrap');
    assert.isTrue(flashWrap.classed('map-footer-show'));
    assert.isTrue(footerWrap.classed('map-footer-hide'));
  });

  it('sanitizes the label', () => {
    Rapid.uiFlash(context)
      .label('<script>alert(1)</script><img src="x" onerror="alert(2)">')();

    assert.strictEqual(container.selectAll('.flash-text script').size(), 0);
    assert.strictEqual(container.selectAll('.flash-text [onerror]').size(), 0);
  });

  it('flash goes away', () => {
    Rapid.uiFlash(context).duration(10)();
    return delay(20)
      .then(() => {
        d3.timerFlush();
        const flashWrap = d3.selectAll('.flash-wrap');
        const footerWrap = d3.selectAll('.map-footer-wrap');
        assert.isTrue(flashWrap.classed('map-footer-hide'));
        assert.isTrue(footerWrap.classed('map-footer-show'));
      });
  });

});
