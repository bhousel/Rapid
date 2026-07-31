import { selection } from 'd3-selection';
import * as PIXI from 'pixi.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiOsmoseHeader` renders the header (icon + title) for an Osmose QA issue.
 * Set the issue to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiOsmoseHeader {
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

    const context = this.context;
    const osmose = context.services.osmose as any;

    let iconFill = 0xffffff;
    if (osmose) {
      iconFill = osmose.getColor(this.datum?.props.item);
    }

    const $header = $parent.selectAll('.qa-header')
      .data(this.datum ? [this.datum] : [], (d: any) => d.key);

    $header.exit()
      .remove();

    const $$header: D3Selection = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    const $$svg = $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('svg')
      .attr('width', '20px')
      .attr('height', '27px')
      .attr('viewbox', '0 0 20 27')
      .attr('class', (d: any) => `qaItem ${d.serviceID}`);

    $$svg
      .append('polygon')
      .attr('fill', new PIXI.Color(iconFill).toHex())
      .attr('stroke', '#333')
      .attr('points', '16,3 4,3 1,6 1,17 4,20 7,20 10,27 13,20 16,20 19,17.033 19,6');

    $$svg
      .append('use')
      .attr('class', 'icon-annotation')
      .attr('width', '13px')
      .attr('height', '13px')
      .attr('transform', 'translate(3.5, 5)')
      .attr('xlink:href', (d: any) => d.props.iconID ? `#${d.props.iconID}` : '');

    $$header
      .append('div')
      .attr('class', 'qa-header-label');

    // update (text written every render so a locale switch re-fills it)
    const $merged: D3Selection = ($header as D3Selection).merge($$header);

    $merged.select('.qa-header-label')
      .text((d: any) => this._issueTitle(d));
  }


  /**
   * Returns the localized title string for the given Osmose issue.
   * @param d - The issue datum
   */
  protected _issueTitle(d: any): string {
    const l10n = this.context.systems.l10n!;
    const osmose = this.context.services.osmose as any;

    const unknown = l10n.t('inspector.unknown');
    if (!osmose || !d) return unknown;

    // Issue titles supplied by Osmose
    const s = osmose.getStrings(d.props.type);
    return ('title' in s) ? s.title : unknown;
  }
}
