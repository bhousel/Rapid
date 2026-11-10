describe('UiMapRouletteEditor', () => {
  let context, $container, spatial, maproulette;

  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });
  const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

  beforeEach(async () => {
    context = new Rapid.MockContext();
    context.systems = {
      l10n: new Rapid.LocalizationSystem(context),
      network: new Rapid.NetworkSystem(context),
      spatial: new Rapid.SpatialSystem(context)
    };
    await context.systems.l10n.initAsync();
    spatial = context.systems.spatial;
    maproulette = new Rapid.MapRouletteService(context);
    context.services = {
      maproulette: maproulette,
      osm: {
        getUserDetailsAsync: () => Promise.resolve({ display_name: 'me', id: 1 }),
        userURL: () => '',
        authenticate: () => {},
        _userDetails: { id: 1 }
      }
    };
    context.$container = $container = d3.select(document.body).append('div');
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  // A task as the service caches it from a tile, before its challenge and details have loaded
  function makeTask() {
    const task = new Rapid.MarkerData(context, {
      id: '7', namespace: 'maproulette', serviceID: 'maproulette', type: 'task', loc: [0, 0], parentId: '10'
    });
    spatial.replaceData('maproulette', task);
    context.selectedIDs = () => [task.dataID];
    return task;
  }

  // What the service's loaders do: each stores a newer task in the cache (data isn't changed in place)
  function fakeLoaders() {
    const calls = { fetches: 0 };
    maproulette.loadCompleteTaskAsync = (task) => {
      let cached = spatial.getItem('maproulette', task.id);
      if (cached.props.instruction === undefined) {   // the challenge arrives
        cached = cached.update({ isVisible: true, instruction: 'Fix {{name}}', description: 'Desc' });
      }
      if (cached.props.features === undefined) {      // the task details arrive
        calls.fetches++;
        cached = cached.update({ features: [{ type: 'Feature', properties: { name: 'X' } }] });
      }
      spatial.replaceData('maproulette', cached);
      return Promise.resolve(cached);
    };
    return calls;
  }

  // Selects the task the way SelectMode does: the editor's datum is the task as it was then
  async function select(task) {
    const editor = new Rapid.UiMapRouletteEditor(context);
    editor.datum = task;
    $container.call(editor.render);
    await settle();
    return editor;
  }


  it('keeps the Cancel and Submit buttons while the user types a comment', async () => {
    fakeLoaders();
    await select(makeTask());

    $container.select('.mr-save .fixedIt-button').node().click();
    await settle();
    assert.strictEqual($container.selectAll('.note-save .submit-button').size(), 1);
    assert.strictEqual($container.select('.mr-save .buttons').style('display'), 'none', 'the action buttons are hidden');

    const textarea = $container.select('.note-save .new-comment-input').node();
    textarea.value = 'fixed the road';
    textarea.dispatchEvent(new Event('input'));
    await settle();

    assert.strictEqual($container.selectAll('.note-save .submit-button').size(), 1);
    assert.strictEqual($container.selectAll('.note-save .cancel-button').size(), 1);
    assert.strictEqual($container.selectAll('.note-save .fixedIt-button').size(), 0);
    assert.strictEqual($container.select('.note-save .new-comment-input').node(), textarea, 'the same textarea');
    assert.strictEqual(spatial.getItem('maproulette', '7').props.newComment, 'fixed the road');
  });

  it('keeps what the loaders cached when the user acts on a task selected before they finished', async () => {
    const calls = fakeLoaders();
    const task = makeTask();
    await select(task);   // the details load after the task was selected

    $container.select('.mr-save .fixedIt-button').node().click();
    await settle();

    const cached = spatial.getItem('maproulette', '7');
    assert.strictEqual(cached.props._status, 1);
    assert.strictEqual(cached.props.instruction, 'Fix {{name}}');
    assert.isTrue(cached.props.isVisible);
    assert.isOk(cached.props.features);
    assert.strictEqual(calls.fetches, 1, 'the task details are loaded once');
    assert.notInclude($container.select('.sidebar-details').text(), 'Loading', 'the details stay shown');

    $container.select('.note-save .cancel-button').node().click();
    await settle();
    assert.isTrue(spatial.getItem('maproulette', '7').props.isVisible, 'still shown on the map after Cancel');
    assert.notStrictEqual($container.select('.mr-save .buttons').style('display'), 'none', 'the action buttons are back');
  });

  it('the MapRoulette menu also submits the cached task, not the one it was given when selected', async () => {
    fakeLoaders();
    const task = makeTask();
    await maproulette.loadCompleteTaskAsync(task);   // the cache is newer than `task` now

    let posted;
    maproulette.postUpdate = (t) => { posted = t; };
    const menu = new Rapid.UiMapRouletteMenu(context);
    menu.datum = task;
    menu._submitTask(new Event('click'), task, 1);

    assert.strictEqual(posted.props.taskStatus, 1);
    assert.strictEqual(posted.props.instruction, 'Fix {{name}}');
    assert.isOk(posted.props.features);
    assert.strictEqual(spatial.getItem('maproulette', '7'), posted);
  });
});
