describe('uiCommitWarnings', () => {

  const context = new Rapid.MockContext();
  const message = '<img src="x" onerror="alert(1)">';

  context.systems = {
    l10n: new Rapid.LocalizationSystem(context),
    validator: {
      getIssuesBySeverity: () => ({
        error: [{
          key: 'unsafe-message',
          message: () => message,
          severity: 'error',
          type: 'test'
        }],
        warning: []
      }),
      getSeverityIcon: () => '#rapid-icon-alert',
      focusIssue: () => {}
    }
  };

  before(() => context.systems.l10n.initAsync());


  it('renders validation messages as text', () => {
    const selection = d3.select(document.createElement('div'));

    selection.call(Rapid.uiCommitWarnings(context));

    assert.strictEqual(selection.select('.issue-message').text(), message);
    assert.strictEqual(selection.selectAll('.issue-message img').size(), 0);
  });
});
