import { selection } from 'd3-selection';

import { uiIcon } from './icon.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiDataHeader` renders a small header describing a piece of custom/vector map data.
 * Set the data to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiDataHeader {
  public context: Context;
  public datum: any;

  // D3 selections
  public $parent: D3Selection | null;

  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    let $header: D3Selection = $parent.selectAll('.data-header')
      .data((this.datum ? [this.datum] : []), (d: any) => d.key );

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'data-header');

    const $$icon = $$header
      .append('div')
      .attr('class', 'data-header-icon');

    $$icon
      .append('div')
      .attr('class', 'preset-icon-28')
      .call(uiIcon('#rapid-icon-data'));

    $$header
      .append('div')
      .attr('class', 'data-header-label');

    // update
    $header = $header.merge($$header);
    $header.select('.data-header-label')
      .text((d: any) => this._issueTitle(d));
  }


  /**
   * Returns a display title for the data feature.
   * @param d - the data feature to title
   */
  // We show a few different kinds of data in this pane
  // If there is a `serviceID`, try to show a better title.
  protected _issueTitle(d: any): string {
    const l10n = this.context.systems.l10n!;
    const serviceID = d.serviceID || 'custom';
    const custom =  l10n.t('map_data.layers.custom.title'); // Fallback to "Custom Map Data"

    return l10n.t(`map_data.layers.${serviceID}.title`, { default: custom });
  }
}
