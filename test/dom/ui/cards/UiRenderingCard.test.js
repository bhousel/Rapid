import { RenderFrame } from '../../../../modules/pixi/RenderFrame.ts';


describe('UiRenderingCard', () => {
  let $container;

  beforeEach(() => {
    $container = d3.select('body').append('div');
  });

  afterEach(() => {
    $container.remove();
  });


  // A frame as `GraphicsSystem` records it, with the given times
  function makeFrame(id, appMs, drawMs, gpuMs, osmKept = false) {
    const frame = new RenderFrame(id, 17);
    frame.appMs = appMs;
    frame.layers.set('osm', { enabled: true, kept: osmKept, renderMs: appMs - 1, cullMs: 0.5, features: 120, visible: 100 });
    frame.layers.set('labels', { enabled: true, kept: false, renderMs: 0.2, cullMs: 0, features: 10, visible: 10 });
    frame.draw = {
      ms: drawMs, renderGroups: 98, rebuiltGroups: osmKept ? 0 : 3, rebuiltInstructions: 0,
      instructions: { batch: 12, stencilMask: 40 }, batchTextures: { 1: 12 }, triangles: 3400, unbatched: []
    };
    if (gpuMs !== undefined) {
      frame.draw.gpuMs = gpuMs;
      frame.draw.gl = { draws: 50, programs: 4, textureBinds: 6, bufferUploads: 0 };
    }
    return frame;
  }

  // `gfx.frames` is what the card will show; `gfx.calls` records what the card asked of it
  function makeContext(frames = []) {
    const context = new Rapid.MockContext();
    const gfx = {
      frames: frames,
      calls: [],
      detailedStats: false,
      on: () => {},
      get renderFrames() { return gfx.frames.slice(); },
      enableDetailedStats: enable => { gfx.detailedStats = enable; gfx.calls.push(enable); },
      immediateRedraw: () => {}
    };
    context.systems.gfx = gfx;
    context.systems.keyboard = { global: { on: () => {}, off: () => {} } };
    context.systems.l10n = {
      localeCode: 'en',
      on: () => {},
      t: (key, vals) => (vals ? `${key} ${Object.values(vals).join(' ')}` : key)
    };
    context.systems.scheduler = undefined;   // the frame budget falls back to 60 frames per second
    return context;
  }

  function makeCard(context) {
    const card = new Rapid.UiRenderingCard(context);
    card._isVisible = true;
    card.render($container);
    return card;
  }

  const rowIDs = () => $container.selectAll('.rendering-row').data().map(d => d.id);
  const valueOf = id => $container.select(`.rendering-row-${id} .rendering-value`).text();


  it('shows the times of the APP and DRAW passes, the features and Pixi\'s instructions', () => {
    makeCard(makeContext([makeFrame(1, 9.7, 0.8)]));

    assert.deepEqual(rowIDs(), ['frames', 'app', 'draw','features', 'layers', 'instructions', 'groups']);
    assert.include(valueOf('groups'), '3.0 98');      // rebuilt per frame, then all
    assert.include(valueOf('app'), '9.7');
    assert.include(valueOf('draw'), '0.8');
    assert.include(valueOf('features'), '110 130');   // shown, then all, summed over the layers
    assert.include(valueOf('layers'), 'osm');
    assert.include(valueOf('instructions'), 'stencilMask 40');
  });

  it('shows GPU time and WebGL calls only for frames that have them', () => {
    makeCard(makeContext([makeFrame(1, 9.7, 0.8, 6.1)]));

    assert.deepEqual(rowIDs(), ['frames', 'app', 'draw','gpu', 'features', 'layers', 'instructions', 'groups', 'webgl']);
    assert.include(valueOf('gpu'), '6.1');
    assert.include(valueOf('webgl'), 'draws 50');
  });

  it('shows which layers kept their features, in how many of the frames', () => {
    const frames = [makeFrame(1, 9.7, 0.8), makeFrame(2, 2, 2, undefined, true), makeFrame(3, 2, 2, undefined, true)];
    makeCard(makeContext(frames));

    assert.deepEqual(rowIDs(), ['frames', 'app', 'draw','features', 'layers', 'kept', 'instructions', 'groups']);
    assert.strictEqual(valueOf('kept'), 'osm 2/3');
    assert.include(valueOf('groups'), '1.0 98');   // 3, 0 and 0 rebuilt
  });

  it('counts the frames drawn in the last second, and the ones that held a pass back', () => {
    const frames = [makeFrame(1, 9.7, 0.8), makeFrame(2, 2, 2, undefined, true), makeFrame(3, 2, 2, undefined, true)];
    const context = makeContext(frames);
    const card = makeCard(context);
    assert.strictEqual(valueOf('frames'), 'info_panels.rendering.frames_drawn 3 0');

    frames[1].held = true;
    card.render();
    assert.strictEqual(valueOf('frames'), 'info_panels.rendering.frames_held 3 1');

    for (const frame of frames) {
      frame.time -= 5000;   // drawn a while ago
    }
    card.render();
    assert.strictEqual(valueOf('frames'), 'info_panels.rendering.frames_drawn 0 0');
  });

  it('shows the work that the last frame put off, by layer', () => {
    const frames = [makeFrame(1, 9.7, 0.8), makeFrame(2, 9.7, 0.8)];
    frames[0].layers.get('osm').waiting = 5000;   // an earlier frame's doesn't count
    const context = makeContext(frames);
    const card = makeCard(context);
    assert.notInclude(rowIDs(), 'waiting');

    frames[1].layers.get('osm').waiting = 1234;
    frames[1].layers.get('labels').waiting = 1;
    card.render();
    assert.deepEqual(rowIDs(), ['frames', 'app', 'draw', 'features', 'layers', 'waiting', 'instructions', 'groups']);
    assert.strictEqual(valueOf('waiting'), 'osm 1,234 · labels 1');
  });

  it('averages the times of the frames drawn in the last second', () => {
    makeCard(makeContext([makeFrame(1, 4, 1), makeFrame(2, 8, 3)]));

    assert.include(valueOf('app'), '6.0');
    assert.include(valueOf('draw'), '2.0');
  });

  it('marks a time that is over the frame budget', () => {
    makeCard(makeContext([makeFrame(1, 20, 0.8)]));

    const isOver = id => $container.select(`.rendering-row-${id} .rendering-bar-fill`).classed('over');
    assert.isTrue(isOver('app'));
    assert.isFalse(isOver('draw'));
  });

  it('updates the same rows when new frames are drawn', () => {
    const context = makeContext([makeFrame(1, 9.7, 0.8)]);
    const card = makeCard(context);
    const appRow = $container.select('.rendering-row-app').node();

    context.systems.gfx.frames = [makeFrame(2, 12.5, 0.9, 6.1)];
    card.render();

    assert.strictEqual($container.select('.rendering-row-app').node(), appRow);
    assert.include(valueOf('app'), '12.5');
    assert.deepEqual(rowIDs(), ['frames', 'app', 'draw','gpu', 'features', 'layers', 'instructions', 'groups', 'webgl']);
  });

  it('shows no rows before the first frame is drawn', () => {
    makeCard(makeContext([]));

    assert.isEmpty(rowIDs());
    assert.isNotNull($container.select('.card-container-rendering').node());
  });

  it('turns detailed stats on with its button, and off again when hidden', () => {
    const context = makeContext([makeFrame(1, 9.7, 0.8)]);
    const card = makeCard(context);

    $container.select('.button-toggle-details').dispatch('click');
    assert.deepEqual(context.systems.gfx.calls, [true]);

    card.hide();
    assert.deepEqual(context.systems.gfx.calls, [true, false]);
  });

  it('leaves detailed stats alone when hidden, if someone else turned them on', () => {
    const context = makeContext([makeFrame(1, 9.7, 0.8)]);
    context.systems.gfx.detailedStats = true;
    const card = makeCard(context);

    card.hide();
    assert.isEmpty(context.systems.gfx.calls);
  });

});
