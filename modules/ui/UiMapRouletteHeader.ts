import { selection } from 'd3-selection';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiMapRouletteHeader` renders the header (icon + challenge name) for a MapRoulette task.
 * Set the task via the public `datum` property, then call `.render($parent)`.
 */
export class UiMapRouletteHeader {
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

    const l10n = this.context.systems.l10n!;

    let $header: D3Selection = $parent.selectAll('.qa-header')
      .data(this.datum ? [this.datum] : [], (d: any) => d.key);

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    const $$svg = $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('svg')
      .attr('width', '20px')
      .attr('height', '27px')
      .attr('viewbox', '0 0 20 27');

    $$svg
      .append('polygon')
      .attr('fill', '#01ff00')
      .attr('stroke', '#333')
      .attr('points', '16,3 4,3 1,6 1,17 4,20 7,20 10,27 13,20 16,20 19,17.033 19,6');

    $$svg
      .append('use')
      .attr('class', 'icon-annotation')
      .attr('width', '13px')
      .attr('height', '13px')
      .attr('transform', 'translate(3.5, 5)')
      .attr('fill', '#01ff00');

    // `parentName` contains the name of the challenge
    $$header
      .append('div')
      .attr('class', 'qa-header-label');

    // update
    $header = $header.merge($$header);
    $header.select('.qa-header-label')
      .text((d: any) => d.props.parentName || l10n.t('inspector.unknown'));
  }
}
