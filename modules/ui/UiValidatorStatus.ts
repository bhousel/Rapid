import { selection, select } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { uiTooltip } from './tooltip.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This component adds the validator status control to the footer.
 * (was named "issues_info")
 */
export class UiValidatorStatus {
  public context: Context;

  // Child components
  public IssuesTooltip: any;
  public ResolvedTooltip: any;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Create child components
    this.IssuesTooltip = uiTooltip(context).placement('top');
    this.ResolvedTooltip = uiTooltip(context).placement('top');

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.click = this.click.bind(this);

    // Event listeners
    const validator = context.systems.validator!;
    validator.on('validated', this.render);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;
    const validator = context.systems.validator!;

    // Create/remove wrapper div if necessary
    let $wrap: D3Selection = $parent.selectAll('.issues-info')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'issues-info');

    // update
    $wrap = $wrap.merge($$wrap);


    // Gather info to display
    const chips = [];
    const openIssues = validator.getIssuesBySeverity({
      what: settings?.get('validator.what') ?? 'edited',
      where: settings?.get('validator.where') ?? 'all'
    });

    for (const [severity, issues] of Object.entries(openIssues)) {
      if (issues.length) {
        chips.push({
          id: severity,
          count: issues.length,
          tooltip: this.IssuesTooltip
        });
      }
    }

    if (settings?.get('validator.what') === 'all') {
      const resolvedIssues = validator.getResolvedIssues();
      if (resolvedIssues.length) {
        chips.push({
          id: 'resolved',
          count: resolvedIssues.length,
          tooltip: this.ResolvedTooltip
        });
      }
    }

    let $chips: D3Selection = $wrap.selectAll('.chip')
      .data(chips, d => d.id);

    $chips.exit()
      .remove();

    // enter
    const $$chips = $chips.enter()
      .append('a')
      .attr('class', d => `chip ${d.id}-count`)
      .attr('href', '#')
      .each((d, i, nodes) => {
        const $$chip = select(nodes[i]);

        $$chip
          .on('click', this.click)
          .call(d.tooltip)
          .call(uiIcon(validator.getSeverityIcon(d.id)));

        $$chip
          .append('span')
          .attr('class', 'count');
      });

    // update
    $chips = $chips.merge($$chips);

    $chips
      .each((d, i, nodes) => {
        const $chip = select(nodes[i]);
        $chip
          .select('.count')  // propagate bound data to child
          .text(d => d.count.toString());
      });

    // localize tooltips
    this.IssuesTooltip.title(l10n.t('issues.open_tooltip'));
    this.ResolvedTooltip.title(l10n.t('issues.resolved_tooltip'));
  }


  /**
   * When clicking on a status chip, toggle the Issues pane.
   * @param  e? - triggering event (if any)
   */
  public click(e?: Event): void {
    e?.preventDefault();

    const context = this.context;
    const ui = context.systems.ui;  // optional

    this.IssuesTooltip.hide();
    this.ResolvedTooltip.hide();

    ui?.Overmap.MapPanes.Issues.togglePane();
  }

}
