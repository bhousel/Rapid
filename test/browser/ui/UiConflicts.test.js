describe('UiConflicts', () => {
  const context = new Rapid.MockContext();
  let $container;
  let performed;

  const scope = { on() { return this; }, enable() { return this; }, disable() { return this; } };
  context.systems = {
    editor: { staging: { graph: { hasEntity: () => undefined } } },
    keyboard: { scope: () => scope },
    l10n: new Rapid.LocalizationSystem(context),
    map: {}
  };

  // A conflict like the uploader makes. Each choice's action records that it ran.
  function makeConflict(entityID) {
    return {
      id: entityID,
      name: entityID,
      details: ['changed by both'],
      chosen: 'remote',
      choices: [
        { id: entityID, type: 'local', text: 'Keep mine', action: () => performed.push(`${entityID}-local`) },
        { id: entityID, type: 'remote', text: 'Use theirs', action: () => performed.push(`${entityID}-remote`) }
      ]
    };
  }

  // happy-dom's `createDocument` returns an HTML document that already has an element, so JXON can't
  // build the osmChange XML in it. Real browsers return an empty XML document; this does the same.
  let _createDocument;
  before(() => {
    _createDocument = document.implementation.createDocument;
    document.implementation.createDocument = () => {
      const doc = new DOMParser().parseFromString('<x/>', 'application/xml');
      doc.removeChild(doc.documentElement);
      return doc;
    };
    return context.systems.l10n.initAsync();
  });

  after(() => {
    document.implementation.createDocument = _createDocument;
  });

  beforeEach(() => {
    performed = [];
    context.$container = $container = d3.select(document.createElement('div'));
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  it('applies the chosen option, and keeps the user\'s choice when they come back to a conflict', () => {
    const conflicts = [makeConflict('n1'), makeConflict('n2')];
    const ui = new Rapid.UiConflicts(context)
      .conflictList(conflicts)
      .origChanges({ modified: [], created: [], deleted: [] });

    $container.call(ui.render);
    assert.deepEqual(performed, ['n1-remote']);   // the default is applied

    // choose "Keep mine" for n1
    const $inputs = $container.selectAll('.conflict input[type=radio]');
    $inputs.nodes()[0].dispatchEvent(new Event('change'));
    assert.strictEqual(conflicts[0].chosen, 'local');
    assert.deepEqual(performed, ['n1-remote', 'n1-local']);

    // next, then back to n1: only "Keep mine" is applied again
    $container.selectAll('.conflict-nav-button').nodes()[1].click();
    $container.selectAll('.conflict-nav-button').nodes()[0].click();
    assert.deepEqual(performed, ['n1-remote', 'n1-local', 'n2-remote', 'n1-local']);
    assert.strictEqual(conflicts[0].chosen, 'local');
    assert.isTrue($container.selectAll('.conflict input[type=radio]').nodes()[0].checked);
  });

  it('offers the changes as an osmChange file', () => {
    const ui = new Rapid.UiConflicts(context)
      .conflictList([makeConflict('n1')])
      .origChanges({ modified: [], created: [], deleted: [] });

    $container.call(ui.render);
    const $link = $container.selectAll('.download-changes');
    assert.strictEqual($link.size(), 1);
    assert.strictEqual($link.attr('download'), 'changes.osc');
  });
});
