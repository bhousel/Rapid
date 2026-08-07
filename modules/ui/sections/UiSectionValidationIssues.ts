import { select } from 'd3-selection';
import { geoSphericalDistance } from '@rapid-sdk/math';
import { uiIcon } from '../icon.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { utilHighlightEntities } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { IssuesBySeverity } from '../../core/ValidationSystem.ts';
import type { ValidationIssue } from '../../lib/ValidationIssue.ts';

const MAX_ISSUES = 1000;


export class UiSectionValidationIssues extends AbstractUiSection {
  protected _severity: string;    // 'error', 'warning', or 'suggestion'
  protected _issues: ValidationIssue[];

  /**
   * @param  context - Global shared application context
   * @param  severity - String 'error', 'warning', or 'suggestion'
   */
  public constructor(context: Context, severity: string) {
    super(context, `issues-${severity}`);
    this._severity = severity;
    this._issues = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawIssuesList = this._drawIssuesList.bind(this);
    this._clickAutoFix = this._clickAutoFix.bind(this);
    this._clickAutoFixAll = this._clickAutoFixAll.bind(this);
    this._renderWhenIdle = this._renderWhenIdle.bind(this);

    // event handlers to refresh the lists
    const map = context.systems.map!;
    const scheduler = context.systems.scheduler;  // optional
    const urlhash = context.systems.urlhash!;
    const validator = context.systems.validator!;

    validator.on('validated', this._renderWhenIdle);

    urlhash.on('hashchange', (currParams: URLSearchParams, prevParams: URLSearchParams) => {
      if (currParams.get('poweruser') !== prevParams.get('poweruser')) {   // change in poweruser status
        this._renderWhenIdle();
      }
    });

    map.on('draw', () => {
      // scheduler debounces the redraw; without it, just redraw immediately
      if (scheduler) {
        scheduler.debounce('ValidationIssues-render', this._renderWhenIdle, { ms: 500 });
      } else {
        this._renderWhenIdle();
      }
    });
  }


  /**
   * The disclosure heading label — "Errors/Warnings/Suggestions (N)".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    const countText = this._issues.length > MAX_ISSUES ? `${MAX_ISSUES}+` : String(this._issues.length);
    const titleText = l10n.t(`issues.${this._severity}s`);
    return l10n.t('inspector.title_count', { title: titleText, count: countText });
  }


  /**
   * Whether this section should display (there are issues to show).
   * @return `true` if there is at least one issue
   */
  public override shouldDisplay(): boolean {
    return this._issues.length > 0;
  }


  /**
   * Sorts the issues by distance from the map center and renders the list.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const editor = this.context.systems.editor!;
    const viewport = this.context.viewport;
    const graph = editor.staging.graph;
    const centerLoc = viewport.centerLoc();

    // sort issues by distance away from the center of the map
    let issues = this._issues
      .map(function withDistance(issue: ValidationIssue) {
        const extent = issue.extent(graph);
        const dist = extent ? geoSphericalDistance(centerLoc, extent.center()) : 0;
        return Object.assign(issue, { dist: dist });
      })
      .sort((a, b) => a.dist - b.dist);   // nearest to farthest

    issues = issues.slice(0, MAX_ISSUES);

    $selection
      .call(this._drawIssuesList, issues);
  }


  /**
   * Creates the issues list if needed and updates it with the current issues.
   * @param $selection - A d3-selection to render the list into
   * @param issues - the issues to display
   */
  protected _drawIssuesList($selection: D3Selection, issues: ValidationIssue[]): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;
    const validator = context.systems.validator!;
    const severity = this._severity;
    const showAutoFix = (settings?.get('poweruser.showAutoFix') === 'true');

    let $list: D3Selection = $selection.selectAll('.issues-list')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', `layer-list issues-list ${severity}-list`)
      .merge($list);


    let $items: D3Selection = $list.selectAll('li')
      .data(issues, (d: ValidationIssue) => d.key!);

    // Exit
    $items.exit()
      .remove();

    // Enter
    const $$items = $items.enter()
      .append('li')
      .attr('class', (d: ValidationIssue) => `issue severity-${d.severity}`);

    const $$labels = $$items
      .append('button')
      .attr('class', 'issue-label')
      .on('click',     (d3_event, d: ValidationIssue) => validator.focusIssue(d))
      .on('mouseover', (d3_event, d: ValidationIssue) => utilHighlightEntities(context, d.entityIds, true))
      .on('mouseout',  (d3_event, d: ValidationIssue) => utilHighlightEntities(context, d.entityIds, false));

    const $$text = $$labels
      .append('span')
      .attr('class', 'issue-text');

    $$text
      .append('span')
      .attr('class', 'issue-icon')
      .each((d: ValidationIssue, i, nodes) => {
        select(nodes[i])
          .call(uiIcon(validator.getSeverityIcon(d.severity)));
      });

    $$text
      .append('span')
      .attr('class', 'issue-message');

    $$labels
      .append('span')
      .attr('class', 'issue-autofix')
      .append('button')
      .attr('title', l10n.t('issues.fix_one.title'))
      .attr('class', 'autofix action')
      .on('click', this._clickAutoFix)
      .call(uiIcon('#rapid-icon-wrench'));


    // Update
    $items = $items
      .merge($$items)
      .order();

    $items.selectAll('.issue-message')
      .text((d: ValidationIssue) => (d.message as any)(context));

    $items.selectAll('.issue-autofix')
      .classed('hide', (d: ValidationIssue) => !(showAutoFix && d.autoArgs));


    const autofixable = issues.filter(issue => issue.autoArgs);
    let $autoFixAll: D3Selection = $selection.selectAll('.autofix-all')
      .data(showAutoFix && autofixable.length ? [0] : []);

    // exit
    $autoFixAll.exit()
      .remove();

    // enter
    const $$autoFixAll = $autoFixAll.enter()
      .insert('div', '.issues-list')
      .attr('class', 'autofix-all');

    const $$link = $$autoFixAll
      .append('a')
      .attr('class', 'autofix-all-link')
      .attr('href', '#');

    $$link
      .append('span')
      .attr('class', 'autofix-all-link-text');

    $$link
      .append('span')
      .attr('class', 'autofix-all-link-icon')
      .call(uiIcon('#rapid-icon-wrench'));

    // update
    $autoFixAll = $autoFixAll
      .merge($$autoFixAll);

    // set localized text on the update selection so it re-localizes on language change
    $autoFixAll.selectAll('.autofix-all-link-text')
      .text(l10n.t('issues.fix_all.title'));

    $autoFixAll.selectAll('.autofix-all-link')
      .on('click', (d3_event) => this._clickAutoFixAll(d3_event, autofixable));
  }


  /**
   * User clicked "Autofix": fixes a single issue.
   * @param d3_event - the triggering click event
   * @param issue - the issue to fix
   */
  protected _clickAutoFix(d3_event: Event, issue: ValidationIssue): void {
    const editor = this.context.systems.editor!;
    if (d3_event) {
      d3_event.preventDefault();
      d3_event.stopPropagation();
    }

    utilHighlightEntities(this.context, issue.entityIds, false);  // unhighlight
    editor.perform(issue.autoArgs![0]);   // autoArgs = [action, annotation]
    editor.commit({ annotation: issue.autoArgs![1] as any, selectedIDs: issue.entityIds });
  }


  /**
   * User clicked "Autofix All": fixes all the autofixable issues in one transaction.
   * @param d3_event - the triggering click event
   * @param issues - the autofixable issues to fix
   */
  protected _clickAutoFixAll(d3_event: Event, issues: ValidationIssue[]): void {
    const editor = this.context.systems.editor!;
    const l10n = this.context.systems.l10n!;
    if (d3_event) {
      d3_event.preventDefault();
      d3_event.stopPropagation();
    }

    editor.beginTransaction();

    for (const issue of issues) {
      const action = issue.autoArgs![0];  // autoArgs = [action, annotation]
      editor.perform(action);
    }

    editor.commit({ annotation: l10n.t('issues.fix_all.annotation') });
    editor.endTransaction();
  }


  /**
   * Gets the current display options for the issues lists ('what' and 'where').
   * @return the display options
   */
  protected _getOptions() {
    const settings = this.context.systems.settings;
    return {
      what: settings?.get('validator.what') || 'edited',
      where: settings?.get('validator.where') || 'all'
    };
  }


  /**
   * Gets and caches the issues to display (unordered) for this severity.
   */
  protected _reloadIssues(): void {
    const validator = this.context.systems.validator!;
    const options = this._getOptions();
    const issuesBySeverity = validator.getIssuesBySeverity(options as Parameters<typeof validator.getIssuesBySeverity>[0]);
    this._issues = issuesBySeverity[this._severity as keyof IssuesBySeverity];
  }


  /**
   * Whether the issues pane is currently open (visible).
   * @return nonzero if the issues pane is shown
   */
  protected _isVisible(): number {
    return this.context.container().selectAll('.map-panes .issues-pane.shown').size();
  }


  /**
   * Rerenders the issue pane contents, waiting for an idle moment
   * (falls back to immediate if no scheduler).
   */
  protected _renderWhenIdle(): void {
    const scheduler = this.context.systems.scheduler;
    const fn = () => {
      if (!this._isVisible()) return;
      this._reloadIssues();
      this.renderInner();
    };
    if (scheduler) {
      scheduler.scheduleIdleTask(fn)
        .catch((err: unknown) => {
          if ((err as any)?.name === 'AbortError') return;   // expected cancellation
          console.error(err);  // eslint-disable-line no-console
        });
    } else {
      fn();
    }
  }
}
