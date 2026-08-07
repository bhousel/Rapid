import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { uiTooltip } from './tooltip.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This component adds the filter status control to the footer.
 * (was named "feature_info")
 */
export class UiFilterStatus {
  public context: Context;

  // Child components
  public Tooltip: any;

  // D3 selections
  public $parent: D3Selection | null;

  public rerender: () => void;
  public deferredRender: () => void;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    const gfx = context.systems.gfx!;
    const scheduler = context.systems.scheduler;  // optional

    // Create child components
    this.Tooltip = uiTooltip(context).placement('top');

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.click = this.click.bind(this);
    this.deferredRender = () => {
      // scheduler throttles the redraw; without it, just redraw immediately
      if (scheduler) {
        scheduler.throttle('UiFilterStatus-render', () => this.rerender(), { ms: 1000 });
      } else {
        this.rerender();
      }
    };

    // Event listeners
    gfx.on('draw', this.deferredRender);
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
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;

    // Create/remove wrapper div if necessary
    let $wrap: D3Selection = $parent.selectAll('.filter-info')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'filter-info');

    const $$chip = $$wrap
      .append('a')
      .attr('class', 'chip')
      .attr('href', '#')
      .on('click', this.click)
      .call(this.Tooltip)
      .call(uiIcon('#fas-filter'));

    $$chip
      .append('span')
      .attr('class', 'count');

    // update
    $wrap = $wrap.merge($$wrap);


    // Gather stats about what features are currently filtered
    const stats = filters.getStats();
    const details = [];
    let total = 0;
    for (const [filterID, filter] of Object.entries(stats)) {
      if (filter.count > 0) {
        total += filter.count;
        details.push(
          l10n.t('inspector.title_count', { title: l10n.t(`filters.${filterID}.description`), count: filter.count })
        );
      }
    }

    if (details.length) {
      this.Tooltip.title(l10n.t('filters.active') + '<br/>' + details.join('<br/>'));
    } else {
      this.Tooltip.hide();
    }

    $wrap
      .classed('hide', !details.length);

    $wrap
      .selectAll('span.count')
      .text(total.toString());
  }


  /**
   * When clicking on a status chip, toggle the Map Data pane.
   * @param  e? - triggering event (if any)
   */
  public click(e?: Event): void {
    e?.preventDefault();

    const context = this.context;
    const ui = context.systems.ui;  // optional

    this.Tooltip.hide();

    ui?.Overmap.MapPanes.MapData.togglePane();
  }

}

