describe('UiMapRouletteDetails', () => {
  const context = new Rapid.MockContext();
  let $container;

  const marker = { id: '1', key: 'maproulette-1' };
  const task = {
    id: '1',
    props: {
      description: '<script>alert(1)</script>[link](javascript:alert(2))',
      instruction: '<img src="x" onerror="alert(3)">',
      parentId: '10'
    }
  };

  context.systems = {
    l10n: new Rapid.LocalizationSystem(context)
  };
  context.services = {
    maproulette: {
      challengeIDs: [],
      loadCompleteTaskAsync: () => Promise.resolve(task)
    }
  };

  before(() => context.systems.l10n.initAsync());

  beforeEach(() => {
    context.$container = $container = d3.select(document.createElement('div'));
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  it('sanitizes challenge descriptions and instructions', async () => {
    const MapRouletteDetails = new Rapid.UiMapRouletteDetails(context);
    MapRouletteDetails.datum = marker;
    $container.call(MapRouletteDetails.render);
    await new Promise(resolve => { setTimeout(resolve, 0); });

    assert.strictEqual($container.selectAll('script').size(), 0);
    assert.strictEqual($container.selectAll('[href^="javascript:"]').size(), 0);
    assert.strictEqual($container.selectAll('[onerror]').size(), 0);
  });
});
