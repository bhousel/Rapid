describe('UiNoteComments', () => {
  const context = new Rapid.MockContext();
  let $container;

  context.systems = {
    l10n: new Rapid.LocalizationSystem(context)
  };
  context.services = {};

  before(() => context.systems.l10n.initAsync());

  beforeEach(() => {
    context.$container = $container = d3.select(document.createElement('div'));
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });

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
    const NoteComments = new Rapid.UiNoteComments(context);
    NoteComments.datum = note;
    $container.call(NoteComments.render);

    assert.strictEqual($container.select('.comment-author').text(), username);
    assert.strictEqual($container.selectAll('.comment-author img').size(), 0);
    assert.strictEqual($container.selectAll('.comment-text script').size(), 0);
    assert.strictEqual($container.selectAll('.comment-text [href^="javascript:"]').size(), 0);
  });
});
