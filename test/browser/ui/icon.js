describe('uiIcon', () => {
  let selection;

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
  });

  it('creates a generic SVG icon', () => {
    selection.call(Rapid.uiIcon('#rapid-icon-bug'));
    assert.isTrue(selection.select('svg').classed('icon'));
    assert.strictEqual(selection.select('use').attr('xlink:href'), '#rapid-icon-bug');
  });

  it('sets class attribute', () => {
    selection.call(Rapid.uiIcon('#rapid-icon-bug', 'svg-class'));
    assert.isTrue(selection.select('svg').classed('icon svg-class'));
  });
});
