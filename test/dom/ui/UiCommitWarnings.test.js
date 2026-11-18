describe('uiCommitWarnings', () => {
  const context = new Rapid.MockContext();
  const message = '<img src="x" onerror="alert(1)">';
  let $container;

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

  beforeEach(() => {
    context.$container = $container = d3.select(document.createElement('div'));
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });


  it('renders validation messages as text', () => {
    $container.call(new Rapid.UiCommitWarnings(context).render);
    assert.strictEqual($container.select('.issue-message').text(), message);
    assert.strictEqual($container.selectAll('.issue-message img').size(), 0);
  });
});
