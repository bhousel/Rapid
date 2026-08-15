import { select } from 'd3-selection';
import { utilArrayIdentical } from '@rapid-sdk/util';
import { uiIcon } from '../icon.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { utilHighlightEntities } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { ValidationFix } from '../../lib/ValidationFix.ts';
import type { ValidationIssue } from '../../lib/ValidationIssue.ts';


export class UiSectionEntityIssues extends AbstractUiSection {
  protected _isExpanded: boolean;
  protected _entityIDs: EntityID[];
  protected _issues: ValidationIssue[];
  protected _activeIssueID: string | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'entity-issues');

    const settings = context.systems.settings;
    const preference = settings?.get('ui.entityIssues.referenceExpanded') || 'true';

    this._isExpanded = (preference === 'true');
    this._entityIDs = [];
    this._issues = [];
    this._activeIssueID = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._onValidated = this._onValidated.bind(this);
    this._onFocused = this._onFocused.bind(this);

    // Add or replace event handlers
    const validator = context.systems.validator!;
    validator.off('validated', this._onValidated);
    validator.off('focusedIssue', this._onFocused);
    validator.on('validated', this._onValidated);
    validator.on('focusedIssue', this._onFocused);
  }


  /**
   * Whether this section should display (there are issues to show).
   * @return `true` if there is at least one issue
   */
  public override shouldDisplay(): boolean {
    return this._issues.length > 0;
  }


  /**
   * The disclosure heading label — "Issues (N)".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    const n = this._issues.length;
    const title = l10n.t('text.issue', { n });
    return l10n.t('inspector.title_count', { title, count: n });
  }


  /**
   * Reloads the shared entity issues for the current entity IDs.
   */
  protected _reloadIssues(): void {
    const validator = this.context.systems.validator!;
    this._issues = validator.getSharedEntityIssues(this._entityIDs, { includeDisabledRules: true });
  }


  /**
   * Marks the given issue as active (expanded), collapsing the others.
   * @param issueID - the issue id to activate
   */
  protected _makeActiveIssue(issueID: string): void {
    this._activeIssueID = issueID;

    if (!this.$container) return;
    this.$container.selectAll('.issue-container')
      .classed('active', (d: ValidationIssue) => d.id === this._activeIssueID);
  }


  /**
   * Renders the issue list (messages, info references, and fixes).
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const settings = context.systems.settings;
    const validator = context.systems.validator!;

    $selection.classed('grouped-items-area', true);
    this._activeIssueID = this._issues.length ? this._issues[0].id : null;

    let $containers: D3Selection = $selection.selectAll('.issue-container')
      .data(this._issues, (d: ValidationIssue) => d.key!);

    // Exit
    $containers.exit()
      .remove();

    // Enter
    const $$containers = $containers.enter()
      .append('div')
      .attr('class', 'issue-container');


    const $$items = $$containers
      .append('div')
      .attr('class', (d: ValidationIssue) => `issue severity-${d.severity}`)
      .on('mouseover.highlight', (d3_event: Event, d: ValidationIssue) => {
        // don't hover-highlight the selected entity
        const otherIDs = d.entityIds.filter((id: EntityID) => !this._entityIDs.includes(id));
        utilHighlightEntities(context, otherIDs, true);
      })
      .on('mouseout.highlight', (d3_event: Event, d: ValidationIssue) => {
        const otherIDs = d.entityIds.filter((id: EntityID) => !this._entityIDs.includes(id));
        utilHighlightEntities(context, otherIDs, false);
      });

    const $$labels = $$items
      .append('div')
      .attr('class', 'issue-label');

    const $$text = $$labels
      .append('button')
      .attr('class', 'issue-text')
      .on('click', (d3_event: Event, d: ValidationIssue) => {
        this._makeActiveIssue(d.id);    // expand only the clicked item
        const graph = editor.staging.graph;
        const extent = d.extent(graph);
        if (extent) {
          const setZoom = Math.max(map.zoom() as number, 19);
          map.centerZoomEase(extent.center(), setZoom);
        }
      });

    $$text
      .each((d: ValidationIssue, i, nodes) => {
        select(nodes[i])
          .call(uiIcon(validator.getSeverityIcon(d.severity), 'issue-icon'));
      });

    $$text
      .append('span')
      .attr('class', 'issue-message');


    const $$infoButton = $$labels
      .append('button')
      .attr('class', 'issue-info-button')
      .attr('title', l10n.t('icons.information'))
      .call(uiIcon('#rapid-icon-inspect'));

    $$infoButton
      .on('click', (d3_event: Event) => {
        const button = d3_event.currentTarget as any;
        d3_event.stopPropagation();
        d3_event.preventDefault();
        button.blur();    // avoid keeping focus on the button - iD#4641

        const $container = select(button.parentNode.parentNode.parentNode);
        const $info = $container.selectAll('.issue-info');
        const isExpanded = $info.classed('expanded');
        this._isExpanded = !isExpanded;
        settings?.set('ui.entityIssues.referenceExpanded', String(this._isExpanded));  // update preference

        if (isExpanded) {
          $info
            .transition()
            .duration(200)
            .style('max-height', '0px')
            .style('opacity', '0')
            .on('end', () => $info.classed('expanded', false));
        } else {
          $info
            .classed('expanded', true)
            .transition()
            .duration(200)
            .style('max-height', '200px')
            .style('opacity', '1')
            .on('end', () => $info.style('max-height', null));
        }
      });

    $$items
      .append('ul')
      .attr('class', 'issue-fix-list');

    $$containers
      .append('div')
      .attr('class', 'issue-info' + (this._isExpanded ? ' expanded' : ''))
      .style('max-height', (this._isExpanded ? null : '0') as string)
      .style('opacity', (this._isExpanded ? '1' : '0'))
      .each((d: ValidationIssue, i, nodes) => {
        const $info = select(nodes[i]);
        if (typeof d.reference === 'function') {
          $info.call(d.reference);
        } else {
          $info.text(l10n.t('inspector.no_documentation_key'));
        }
      });


    // Update
    $containers = $containers
      .merge($$containers)
      .classed('active', (d: ValidationIssue) => d.id === this._activeIssueID);

    $containers.selectAll('.issue-message')
      .text((d: ValidationIssue) => (d.message as any)(context));

    // fixes
    const $fixLists = $containers.selectAll('.issue-fix-list');

    const $fixes = $fixLists.selectAll('.issue-fix-item')
      .data((d: any) => (d.fixes ? d.fixes() : []), (d: any) => d.id);

    $fixes.exit()
      .remove();

    const $$fixes: D3Selection = $fixes.enter()
      .append('li')
      .attr('class', 'issue-fix-item');

    const $$buttons = $$fixes
      .append('button')
      .on('click', (d3_event: Event, d: ValidationFix) => {
        // not all fixes are actionable
        if (select(d3_event.currentTarget as Element).attr('disabled') || !d.onClick) return;

        // Don't run another fix for this issue within a second of running one
        // (Necessary for "Select a feature type" fix. Most fixes should only ever run once)
        if ((d.issue as any).dateLastRanFix && +new Date() - (d.issue as any).dateLastRanFix < 1000) return;
        (d.issue as any).dateLastRanFix = new Date();

        utilHighlightEntities(context, d.issue!.entityIds.concat(d.entityIds), false);  // remove hover-highlighting
        d.onClick();
      })
      .on('mouseover.highlight', (d3_event: Event, d: ValidationFix) => utilHighlightEntities(context, d.issue!.entityIds, true))
      .on('mouseout.highlight', (d3_event: Event, d: ValidationFix) => utilHighlightEntities(context, d.issue!.entityIds, false));

    $$buttons
      .each((d: ValidationFix, i, nodes) => {
        const iconName = d.icon ?? 'rapid-icon-wrench';
        select(nodes[i]).call(uiIcon(`#${iconName}`, 'fix-icon'));
      });

    $$buttons
      .append('span')
      .attr('class', 'fix-message')
      .text((d: ValidationFix) => d.title);

    $$fixes.merge($fixes)
      .selectAll('button')
      .classed('actionable', (d: ValidationFix) => typeof d.onClick === 'function')
      .attr('disabled', (d: ValidationFix) => typeof d.onClick === 'function' ? null : 'true')
      .attr('title', (d: ValidationFix) => d.disabledReason ?? null);
  }


  /**
   * Gets or sets the entity IDs being inspected.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (val === undefined) return this._entityIDs;

    if (!this._entityIDs || !val || !utilArrayIdentical(this._entityIDs, val)) {
      this._entityIDs = val;
      this._activeIssueID = null;
      this._reloadIssues();
    }
    return this;
  }


  /**
   * Handles the validator's `validated` event by reloading and re-rendering.
   */
  protected _onValidated(): void {
    this._reloadIssues();   // Refresh on validated events
    this.renderInner();
  }


  /**
   * Handles the validator's `focusedIssue` event by activating that issue.
   * @param issue - the focused issue
   */
  protected _onFocused(issue: ValidationIssue): void {
    this._makeActiveIssue(issue.id);
  }
}
