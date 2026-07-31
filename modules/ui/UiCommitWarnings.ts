import { uiIcon } from './icon.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiCommitWarnings` renders the list of validation errors and warnings
 * shown in the commit sidebar. Call `.render($selection)` to draw it.
 */
export class UiCommitWarnings {
  public context: Context;

  public constructor(context: Context) {
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent (the save flow /
   *  `UiCommit`) on each render, so it renders into `$selection` directly rather than
   *  capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const validator = context.systems.validator!;

    const issuesBySeverity: any = validator
      .getIssuesBySeverity({ what: 'edited', where: 'all', includeDisabledRules: true });

    for (const severity of ['error', 'warning']) {  // no 'suggestions' here
      let issues = issuesBySeverity[severity];

      if (severity === 'warning') {      // exclude 'fixme' and similar - iD#8603
        issues = issues.filter((issue: any) => issue.type !== 'help_request');
      }

      const section = `${severity}-section`;
      const issueClass = `${severity}-item`;

      let container: D3Selection = $selection.selectAll('.' + section)
        .data(issues.length ? [0] : []);

      container.exit()
        .remove();

      const containerEnter = container.enter()
        .append('div')
        .attr('class', 'modal-section ' + section + ' fillL2');

      containerEnter
        .append('h3');

      containerEnter
        .append('ul')
        .attr('class', 'changeset-list');

      container = containerEnter
        .merge(container);

      container.select('h3')
        .html(severity === 'warning' ? l10n.tHtml('commit.warnings') : l10n.tHtml('commit.errors'));


      let items: D3Selection = container.select('ul').selectAll('li')
        .data(issues, (d: any) => d.key);

      items.exit()
        .remove();

      const itemsEnter = items.enter()
        .append('li')
        .attr('class', issueClass);

      const buttons = itemsEnter
        .append('button')
//        .on('mouseover', (d3_event, d) => {
//// todo replace legacy surface css class .hover
//          if (d.entityIds) {
//            const graph = editor.staging.graph;
//            context.surface().selectAll(utilEntityOrMemberSelector(d.entityIds, graph) )
//              .classed('hover', true);
//          }
//        })
//        .on('mouseout', () => {
//// todo replace legacy surface css class .hover
//          context.surface().selectAll('.hover')
//            .classed('hover', false);
//        })
        .on('click', (d3_event: Event, d: any) => {
          validator.focusIssue(d);
        });

      buttons
        .call(uiIcon(validator.getSeverityIcon(severity as any), 'pre-text'));

      buttons
        .append('strong')
        .attr('class', 'issue-message');

      items = itemsEnter
        .merge(items);

      items.selectAll('.issue-message')
        .text((d: any) => d.message(context));
    }
  }
}
