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
