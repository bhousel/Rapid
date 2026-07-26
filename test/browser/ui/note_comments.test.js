describe('uiNoteComments', () => {

  const context = new Rapid.MockContext();

  context.systems = {
    l10n: new Rapid.LocalizationSystem(context)
  };
  context.services = {};

  before(() => context.systems.l10n.initAsync());


  it('sanitizes comment HTML and renders usernames as text', () => {
    const dirtyHTML = '<script>alert(1)</script><a href="javascript:alert(2)">link</a>';
    const username = '<img src="x" onerror="alert(3)">';
    const note = {
      isNew: false,
      props: {
        comments: [{
          action: 'commented',
          date: new Date(),
          html: dirtyHTML,
          uid: '1',
          user: username
        }]
      }
    };
    const selection = d3.select(document.createElement('div'));

    selection.call(Rapid.uiNoteComments(context).note(note));

    assert.strictEqual(selection.select('.comment-author').text(), username);
    assert.strictEqual(selection.selectAll('.comment-author img').size(), 0);
    assert.strictEqual(selection.selectAll('.comment-text script').size(), 0);
    assert.strictEqual(selection.selectAll('.comment-text [href^="javascript:"]').size(), 0);
  });
});
