describe('Context', () => {

  describe('debug', () => {
    it('sets and gets debug flags', () => {
      const context = new Rapid.Context();
      const TESTFLAGS = {
        tile: false,
        label: false,
        imagery: false,
        target: false,
        downloaded: false
      };

      assert.deepInclude(context.debugFlags(), TESTFLAGS);

      context.setDebug('tile', true);
      assert.isTrue(context.getDebug('tile'));

      context.setDebug('label');
      assert.isTrue(context.getDebug('label'));

      context.setDebug('tile', false);
      assert.isFalse(context.getDebug('tile'));
    });
  });

  describe('copyIDs', () => {
    it('keeps a snapshot of the staging graph, which later edits don\'t change', () => {
      const context = new Rapid.Context();
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const staging = new Rapid.Graph(new Rapid.Graph(context, [n1]));
      context.systems.editor = { staging: { graph: staging } };

      context.copyIDs = ['n1'];
      staging.remove(n1).commit();   // the user deletes the copied node before pasting

      assert.isUndefined(staging.hasEntity('n1'));
      assert.notStrictEqual(context.copyGraph, staging);
      assert.strictEqual(context.copyGraph.entity('n1'), n1);
    });
  });

  describe('resetAsync', () => {
    it('returns to browse mode before the systems reset, so nothing stays selected', async () => {
      const context = new Rapid.Context();
      context.$container = d3.select(document.createElement('div'));
      const fakeMode = (id) => ({ id: id, enter: () => true, exit: () => {} });
      context.modes = { browse: fakeMode('browse'), select: fakeMode('select') };
      const modeAtReset = [];
      context.systems = {
        editor: { resetAsync: () => { modeAtReset.push(context.mode.id); return Promise.resolve(); } }
      };
      context.services = {};

      context.enter('select');
      await context.resetAsync();
      assert.deepEqual(modeAtReset, ['browse']);
    });
  });

  describe('next', () => {
    it('gets the next number in the given sequence', () => {
      const context = new Rapid.Context();
      assert.strictEqual(context.next('node'), 1);
      assert.strictEqual(context.next('node'), 2);
    });

    it('handles sequence replacement', () => {
      const context = new Rapid.Context();
      context.sequences = { node: 100 };
      assert.strictEqual(context.next('node'), 101);
    });
  });

});
