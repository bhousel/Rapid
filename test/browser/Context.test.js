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

      expect(context.debugFlags()).to.eql(TESTFLAGS);

      context.setDebug('tile', true);
      expect(context.getDebug('tile')).to.be.true;

      context.setDebug('label');
      expect(context.getDebug('label')).to.be.true;

      context.setDebug('tile', false);
      expect(context.getDebug('tile')).to.be.false;
    });
  });

  describe('next', () => {
    it('gets the next number in the given sequence', () => {
      const context = new Rapid.Context();
      expect(context.next('node')).to.equal(1);
      expect(context.next('node')).to.equal(2);
    });

    it('handles sequence replacement', () => {
      const context = new Rapid.Context();
      context.sequences = { node: 100 };
      expect(context.next('node')).to.equal(101);
    });
  });

});
