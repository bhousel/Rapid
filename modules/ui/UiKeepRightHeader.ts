import { selection } from 'd3-selection';
import * as PIXI from 'pixi.js';

import { uiIcon } from './icon.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiKeepRightHeader` renders the header (icon + title) for a KeepRight QA issue.
 * Set the issue to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiKeepRightHeader {
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
    const keepright = context.services.keepright as any;

    let iconFill = 0xffffff;
    if (keepright) {
      iconFill = keepright.getColor(this.datum?.props.parentIssueType);
    }

    const $header = $parent.selectAll('.qa-header')
      .data(this.datum ? [this.datum] : [], (d: any) => d.key);

    $header.exit()
      .remove();

    const $$header: D3Selection = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('div')
      .attr('class', (d: any) => `qaItem ${d.serviceID}`)
      .call(uiIcon('#rapid-icon-bolt'));

    $$header
      .append('div')
      .attr('class', 'qa-header-label');

    // update (text/color written every render so a locale switch re-fills them)
    const $merged: D3Selection = ($header as D3Selection).merge($$header);

    $merged.select('.qa-header-label')
      .text((d: any) => this._issueTitle(d));

    $merged.selectAll('.qaItem svg.icon')
      .attr('stroke', '#333')
      .attr('stroke-width', '1.3px')
      .attr('color', new PIXI.Color(iconFill).toHex());
  }


  /**
   * Returns the localized title string for the given KeepRight issue.
   * @param d - The issue datum
   */
  protected _issueTitle(d: any): string {
    const l10n = this.context.systems.l10n!;

    const { itemType, parentIssueType } = d.props;
    const unknown = l10n.t('inspector.unknown');
    const replacements = d.props.replacements || {};
    replacements.default = unknown;  // special key `default` works as a fallback string

    let title = l10n.t(`QA.keepRight.errorTypes.${itemType}.title`, replacements);
    if (title === unknown) {
      title = l10n.t(`QA.keepRight.errorTypes.${parentIssueType}.title`, replacements);
    }
    return title;
  }
}
