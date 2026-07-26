describe('UiRapidCatalog', () => {

  it('sanitizes dataset metadata before highlighting matches', () => {
    const dirty = '<script>alert(1)</script><img src="x" onerror="alert(2)">needle';
    const html = Rapid.UiRapidCatalog.prototype.highlight('needle', dirty);
    const selection = d3.select(document.createElement('div')).html(html);

    assert.strictEqual(selection.selectAll('script').size(), 0);
    assert.strictEqual(selection.selectAll('[onerror]').size(), 0);
    assert.strictEqual(selection.selectAll('mark').text(), 'needle');
  });
});
