import { uiIcon } from '../icon.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';

import type { Context } from '../../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * `UiSectionValidationStatus` renders a status message on the Issues pane.
 * This content only appears to give the user some feedback if they have set
 * the validation filering options so that no issues appear.
 * ```
 *  ✓  You have no edits yet
 *     Issues with everything else:  nn
 * ```
 */
export class UiSectionValidationStatus extends AbstractUiSection {


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'issues-status');

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._renderWhenIdle = this._renderWhenIdle.bind(this);

    const gfx = context.systems.gfx!;
    const scheduler = context.systems.scheduler;
    const settings = context.systems.settings;
    const validator = context.systems.validator!;

    settings?.on('settingschange', this._renderWhenIdle);
    validator.on('validated', this._renderWhenIdle);

    gfx.on('draw', () => {
      // scheduler debounces the redraw; without it, just redraw immediately
      if (scheduler) {
        scheduler.debounce('ValidationStatus-render', this._renderWhenIdle, { ms: 1000 });
      } else {
        this._renderWhenIdle();
      }
    });
  }


  /**
   * Whether this section should display (only when there are no issues).
   * @return `true` if there are no issues
   */
  public override shouldDisplay(): boolean {
    const validator = this.context.systems.validator!;
    const issues = validator.getIssues(this._getOptions() as any);
    return issues.length === 0;
  }


  /**
   * Gets the current issue filter options ('what' and 'where').
   * @return the current option values
   */
  protected _getOptions() {
    const settings = this.context.systems.settings;
    return {
      what: settings?.get('validator.what') || 'edited',
      where: settings?.get('validator.where') || 'all'
    };
  }


  /**
   * Renders the "no issues" message box plus the reset-ignored footer.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderContent($selection: D3Selection): void {
    const $box: D3Selection = $selection.selectAll('.box')
      .data([0]);

    const $$box: D3EnterSelection = $box.enter()
      .append('div')
      .attr('class', 'box');

    $$box
      .append('div')
      .call(uiIcon('#rapid-icon-apply', 'pre-text'));

    const $$noIssuesMessage: D3EnterSelection = $$box
      .append('span');

    $$noIssuesMessage
      .append('strong')
      .attr('class', 'message');

    $$noIssuesMessage
      .append('br');

    $$noIssuesMessage
      .append('span')
      .attr('class', 'details');

    this._renderIgnoredIssuesReset($selection);
    this._setNoIssuesText($selection);
  }


  /**
   * Renders the "reset ignored issues" footer link when there are ignored issues.
   * @param $selection - A d3-selection to the status content
   */
  protected _renderIgnoredIssuesReset($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;
    const validator = this.context.systems.validator!;
    const ignoredIssues = validator
      .getIssues({ what: 'all', where: 'all', includeDisabledRules: true, includeIgnored: 'only' });

    let $resetIgnored: D3Selection = $selection.selectAll('.reset-ignored')
      .data(ignoredIssues.length ? [0] : []);

    // exit
    $resetIgnored.exit()
      .remove();

    // enter
    const $$resetIgnored: D3EnterSelection = $resetIgnored.enter()
      .append('div')
      .attr('class', 'reset-ignored section-footer');

    $$resetIgnored
      .append('a')
      .attr('href', '#');

    // update
    $resetIgnored = $resetIgnored
      .merge($$resetIgnored);

    $resetIgnored.select('a')
      .text(l10n.t('inspector.title_count', { title: l10n.t('issues.reset_ignored'), count: ignoredIssues.length }));

    $resetIgnored.on('click', (e: PointerEvent) => {
      e.preventDefault();
      validator.resetIgnoredIssues();
    });
  }


  /**
   * Sets the "no issues" headline and details text based on hidden-issue checks.
   * @param $selection - A d3-selection to the status content
   */
// todo: check this code, seems very inefficient
  protected _setNoIssuesText($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const validator = context.systems.validator!;
    const opts = this._getOptions();

    function checkForHiddenIssues(cases: Record<string, any>): void {
      for (const type in cases) {
        const hiddenOpts = cases[type];
        const hiddenIssues = validator.getIssues(hiddenOpts);
        if (hiddenIssues.length) {
          $selection.select('.box .details')
            .text(l10n.t('issues.no_issues.hidden_issues.' + type, { count: hiddenIssues.length.toString() } ));
          return;
        }
      }
      $selection.select('.box .details')
        .text(l10n.t('issues.no_issues.hidden_issues.none'));
    }

    let messageType;

    if (opts.what === 'edited' && opts.where === 'visible') {
      messageType = 'edits_in_view';
      checkForHiddenIssues({
        elsewhere: { what: 'edited', where: 'all' },
        everything_else: { what: 'all', where: 'visible' },
        disabled_rules: { what: 'edited', where: 'visible', includeDisabledRules: 'only' },
        everything_else_elsewhere: { what: 'all', where: 'all' },
        disabled_rules_elsewhere: { what: 'edited', where: 'all', includeDisabledRules: 'only' },
        ignored_issues: { what: 'edited', where: 'visible', includeIgnored: 'only' },
        ignored_issues_elsewhere: { what: 'edited', where: 'all', includeIgnored: 'only' }
      });

    } else if (opts.what === 'edited' && opts.where === 'all') {
      messageType = 'edits';
      checkForHiddenIssues({
        everything_else: { what: 'all', where: 'all' },
        disabled_rules: { what: 'edited', where: 'all', includeDisabledRules: 'only' },
        ignored_issues: { what: 'edited', where: 'all', includeIgnored: 'only' }
      });

    } else if (opts.what === 'all' && opts.where === 'visible') {
      messageType = 'everything_in_view';
      checkForHiddenIssues({
        elsewhere: { what: 'all', where: 'all' },
        disabled_rules: { what: 'all', where: 'visible', includeDisabledRules: 'only' },
        disabled_rules_elsewhere: { what: 'all', where: 'all', includeDisabledRules: 'only' },
        ignored_issues: { what: 'all', where: 'visible', includeIgnored: 'only' },
        ignored_issues_elsewhere: { what: 'all', where: 'all', includeIgnored: 'only' }
      });

    } else if (opts.what === 'all' && opts.where === 'all') {
      messageType = 'everything';
      checkForHiddenIssues({
        disabled_rules: { what: 'all', where: 'all', includeDisabledRules: 'only' },
        ignored_issues: { what: 'all', where: 'all', includeIgnored: 'only' }
      });
    }

    if (opts.what === 'edited' && context.systems.editor!.difference().summary().size === 0) {
      messageType = 'no_edits';
    }

    $selection.select('.box .message')
      .text(l10n.t(`issues.no_issues.message.${messageType}`));
  }


  /**
   * Re-renders, waiting for an idle moment (falls back to immediate if no scheduler).
   */
  protected _renderWhenIdle(): void {
    const scheduler = this.context.systems.scheduler;
    if (scheduler) {
      scheduler.scheduleIdleTask(this.renderInner)
        .catch((err: any) => {
          if (err?.name === 'AbortError') return;   // expected cancellation
          console.error(err);  // eslint-disable-line no-console
        });
    } else {
      this.renderInner();
    }
  }
}
