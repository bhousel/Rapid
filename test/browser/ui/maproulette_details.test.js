describe('uiMapRouletteDetails', () => {

  const context = new Rapid.MockContext();
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


  it('sanitizes challenge descriptions and instructions', async () => {
    const selection = d3.select(document.createElement('div'));

    selection.call(Rapid.uiMapRouletteDetails(context).task(marker));
    await new Promise(resolve => { setTimeout(resolve, 0); });

    assert.strictEqual(selection.selectAll('script').size(), 0);
    assert.strictEqual(selection.selectAll('[href^="javascript:"]').size(), 0);
    assert.strictEqual(selection.selectAll('[onerror]').size(), 0);
  });
});
