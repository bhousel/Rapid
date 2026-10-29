describe('UiSectionValidationIssues', () => {

  // Autofix All, run with an editor that records what happens to it
  function autofixAll(actions) {
    const calls = [];
    const editor = {
      staging: { graph: { hasEntity: () => true } },
      beginTransaction: () => calls.push('begin'),
      endTransaction: () => calls.push('end'),
      perform: action => { action(); calls.push('perform'); },
      commit: () => calls.push('commit'),
      revert: () => calls.push('revert')
    };
    const context = { systems: { editor: editor } };
    const issues = actions.map(action => ({ entityIds: ['w1'], autoArgs: [action, {}] }));
    const e = { preventDefault: () => {}, stopPropagation: () => {} };

    Rapid.UiSectionValidationIssues.prototype._clickAutoFixAll.call({ context: context }, e, issues);
    return calls;
  }


  describe('Autofix All', () => {
    it('applies every fix as one edit', () => {
      const calls = autofixAll([() => {}, () => {}]);
      assert.deepEqual(calls, ['begin', 'perform', 'perform', 'commit', 'end']);
    });

    it('drops all the fixes and ends the transaction if one fails', () => {
      const _error = console.error;
      console.error = () => {};
      try {
        const calls = autofixAll([() => {}, () => { throw new Error('fix failed'); }, () => {}]);
        assert.deepEqual(calls, ['begin', 'perform', 'revert', 'end']);
      } finally {
        console.error = _error;
      }
    });
  });
});
