// The note and KeepRight editors keep a typed comment on the datum, as a new version of it on every
// input and blur. Their sections must update for a new version, not be replaced: a blur that replaces
// the buttons swallows the click that caused it (pressing Save blurs the textarea first).
describe('QA editors keep their sections while the user types', () => {
  let context, $container, spatial;

  beforeEach(async () => {
    context = new Rapid.MockContext();
    context.systems = {
      l10n: new Rapid.LocalizationSystem(context),
      spatial: new Rapid.SpatialSystem(context)
    };
    await context.systems.l10n.initAsync();
    spatial = context.systems.spatial;
    context.$container = $container = d3.select(document.body).append('div');
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  // Just what the note editor uses, with notes kept in the spatial cache as the service does
  function fakeOsm() {
    return {
      authenticated: () => true,
      authenticate: () => {},
      getNote: (id) => spatial.getItem('osm-notes', id),
      getUserDetailsAsync: () => new Promise(() => {}),
      loadUserAsync: () => new Promise(() => {}),
      noteReportURL: () => '',
      noteURL: () => '',
      on: () => {},
      replaceNote: (note) => spatial.replaceData('osm-notes', note),
      userURL: () => ''
    };
  }


  // Types into the textarea and leaves it, and returns the buttons before and after
  function typeAndBlur(text) {
    const before = $container.select('.buttons').node();
    const textarea = $container.select('.new-comment-input').node();
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new Event('blur'));
    return { before, after: $container.select('.buttons').node(), textarea };
  }


  it('UiNoteEditor', () => {
    context.services = { osm: fakeOsm() };
    const note = new Rapid.MarkerData(context, {
      id: '1', type: 'note', serviceID: 'osm', namespace: 'osm-notes', loc: [0, 0], status: 'open', comments: []
    });
    spatial.replaceData('osm-notes', note);
    context.selectedIDs = () => [note.dataID];

    const editor = new Rapid.UiNoteEditor(context);
    editor.datum = note;
    $container.call(editor.render);

    const { before, after, textarea } = typeAndBlur('a comment');
    assert.isOk(before);
    assert.strictEqual(after, before, 'the same buttons');
    assert.strictEqual($container.select('.new-comment-input').node(), textarea, 'the same textarea');
    assert.strictEqual(spatial.getItem('osm-notes', '1').props.newComment, 'a comment');
    assert.isNull($container.select('.comment-button').attr('disabled'), 'Comment is enabled');

    editor.render();   // a later render keeps them too
    assert.strictEqual($container.select('.buttons').node(), before);
    assert.strictEqual($container.select('.new-comment-input').node(), textarea);
  });

  it('UiNoteEditor keeps what a reload of the note stored', () => {
    context.services = { osm: fakeOsm() };
    const note = new Rapid.MarkerData(context, {
      id: '1', type: 'note', serviceID: 'osm', namespace: 'osm-notes', loc: [0, 0], status: 'open', comments: []
    });
    spatial.replaceData('osm-notes', note);
    context.selectedIDs = () => [note.dataID];

    const editor = new Rapid.UiNoteEditor(context);
    editor.datum = note;
    $container.call(editor.render);

    // The note's tile reloads, and someone else has commented since
    const comment = { action: 'commented', text: 'from someone else' };
    spatial.replaceData('osm-notes', note.update({ comments: [comment] }));

    typeAndBlur('a comment');
    const cached = spatial.getItem('osm-notes', '1');
    assert.strictEqual(cached.props.newComment, 'a comment');
    assert.deepEqual(cached.props.comments, [comment]);
  });

  it('UiKeepRightEditor', () => {
    context.services = {
      keepright: {
        getColor: () => 0xffffff,
        issueURL: () => '',
        replaceItem: (item) => spatial.replaceData('keepright', item)
      }
    };
    // The details look up the issue's OSM entities, and keep them visible
    context.systems.gfx = { scene: {}, immediateRedraw: () => {} };
    context.systems.filters = { forceVisible: () => {} };
    const issue = new Rapid.MarkerData(context, {
      id: '1', type: 'keepright', serviceID: 'keepright', namespace: 'keepright', loc: [0, 0]
    });
    spatial.replaceData('keepright', issue);
    context.selectedIDs = () => [issue.dataID];

    const editor = new Rapid.UiKeepRightEditor(context);
    editor.datum = issue;
    $container.call(editor.render);

    const { before, after, textarea } = typeAndBlur('a comment');
    assert.isOk(before);
    assert.strictEqual(after, before, 'the same buttons');
    assert.strictEqual($container.select('.new-comment-input').node(), textarea, 'the same textarea');
    assert.strictEqual(spatial.getItem('keepright', '1').props.newComment, 'a comment');
    assert.isNull($container.select('.comment-button').attr('disabled'), 'Save Comment is enabled');
  });

  it('UiOsmoseEditor updates the cached issue, which has the details loaded after it was selected', () => {
    context.services = { osmose: { getError: (id) => spatial.getItem('osmose', id), replaceItem: (item) => spatial.replaceData('osmose', item) } };
    const issue = new Rapid.MarkerData(context, {
      id: '1', type: 'osmose', serviceID: 'osmose', namespace: 'osmose', loc: [0, 0]
    });
    spatial.replaceData('osmose', issue);
    spatial.replaceData('osmose', issue.update({ elems: ['n1'], detail: 'the details' }));   // the details load

    const editor = new Rapid.UiOsmoseEditor(context);
    editor.datum = issue;   // as it was when selected
    const updated = editor._updateIssue(issue, { newStatus: 'done' });

    assert.strictEqual(updated.props.newStatus, 'done');
    assert.deepEqual(updated.props.elems, ['n1']);
    assert.strictEqual(updated.props.detail, 'the details');
    assert.strictEqual(spatial.getItem('osmose', '1'), updated);
  });
});
