describe('UiSectionValidationIssues', () => {

  // Autofix All, run with an editor that records what happens to it.
  // (`ValidationSystem.autofixAction` is tested with the validation system.)
  function autofixAll(action) {
    const calls = [];
    const editor = {
      perform: action => { action(); calls.push('perform'); },   // the real one leaves staging as it was if the action throws
      commit: () => calls.push('commit')
    };
    const validator = {
      autofixAction: issues => { calls.push(`autofix ${issues.length}`); return action; }
    };
    const context = { systems: { editor: editor, validator: validator } };
    const issues = [{ entityIds: ['w1'] }, { entityIds: ['w2'] }];
    const e = { preventDefault: () => {}, stopPropagation: () => {} };

    Rapid.UiSectionValidationIssues.prototype._clickAutoFixAll.call({ context: context }, e, issues);
    return calls;
  }


  describe('Autofix All', () => {
    it('applies every fix as one edit', () => {
      const calls = autofixAll(() => {});
      assert.deepEqual(calls, ['autofix 2', 'perform', 'commit']);
    });

    it('commits nothing if a fix fails', () => {
      const _error = console.error;
      console.error = () => {};
      try {
        const calls = autofixAll(() => { throw new Error('fix failed'); });
        assert.deepEqual(calls, ['autofix 2']);
      } finally {
        console.error = _error;
      }
    });
  });
});
