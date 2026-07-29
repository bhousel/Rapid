describe('utilSanitizeHTML', () => {

  it('fails closed for executable markup', () => {
    const dirty = '<script>alert(1)</script><a href="javascript:alert(2)">link</a><p onclick="alert(3)">text</p>';
    const selection = d3.select(document.createElement('div'));

    selection.html(Rapid.utilSanitizeHTML(dirty));

    assert.strictEqual(selection.selectAll('script').size(), 0);
    assert.strictEqual(selection.selectAll('[href^="javascript:"]').size(), 0);
    assert.strictEqual(selection.selectAll('[onclick]').size(), 0);
  });

  it('preserves allowed markup and hardens new-window links', () => {
    const clean = Rapid.utilSanitizeHTML(
      '<p class="notice"><strong>Hello</strong> <a href="https://example.com/" target="_blank">world</a></p>'
    );
    const container = document.createElement('div');
    container.innerHTML = clean;

    const link = container.querySelector('a');
    assert.strictEqual(container.querySelector('strong').textContent, 'Hello');
    assert.strictEqual(link.href, 'https://example.com/');
    assert.isTrue(link.relList.contains('noopener'));
    assert.isTrue(link.relList.contains('noreferrer'));
  });

  it('removes foreign markup and unsafe resource URLs', () => {
    const clean = Rapid.utilSanitizeHTML(
      '<svg><a href="javascript:alert(1)">bad</a></svg><img src="data:text/html,evil"><p>safe</p>'
    );
    const container = document.createElement('div');
    container.innerHTML = clean;

    assert.strictEqual(container.querySelectorAll('svg').length, 0);
    assert.strictEqual(container.querySelectorAll('[href], [src]').length, 0);
    assert.strictEqual(container.querySelector('p').textContent, 'safe');
  });
});


describe('utilEscapeHTML', () => {

  it('escapes HTML-significant characters', () => {
    assert.strictEqual(
      Rapid.utilEscapeHTML(`<a title="'">A&B</a>`),
      '&lt;a title=&quot;&#39;&quot;&gt;A&amp;B&lt;/a&gt;'
    );
  });
});
