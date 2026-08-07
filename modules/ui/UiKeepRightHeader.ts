import { selection } from 'd3-selection';
import * as PIXI from 'pixi.js';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { KeepRightIssue } from '../services/KeepRightService.ts';


/**
 * The `UiKeepRightHeader` renders the header (icon + title) for a KeepRight QA issue.
 * Set the issue to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiKeepRightHeader {
  public context: Context;
  public datum: KeepRightIssue | null;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
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
    const keepright = context.services.keepright;

    let iconFill = 0xffffff;
    if (keepright && this.datum) {
      iconFill = keepright.getColor(this.datum.props.parentIssueType);
    }

    let $header: D3Selection = $parent.selectAll('.qa-header')
      .data(this.datum ? [this.datum] : [], (d: KeepRightIssue) => d.key);

    $header.exit()
      .remove();

    const $$header: D3EnterSelection = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('div')
      .attr('class', (d: KeepRightIssue) => `qaItem ${d.serviceID}`)
      .call(uiIcon('#rapid-icon-bolt'));

    $$header
      .append('div')
      .attr('class', 'qa-header-label');

    // update (text/color written every render so a locale switch re-fills them)
    $header = $header.merge($$header);

    $header.select('.qa-header-label')
      .text((d: KeepRightIssue) => this._issueTitle(d));

    $header.selectAll('.qaItem svg.icon')
      .attr('stroke', '#333')
      .attr('stroke-width', '1.3px')
      .attr('color', new PIXI.Color(iconFill).toHex());
  }


  /**
   * Returns the localized title string for the given KeepRight issue.
   * @param d - The issue datum
   */
  protected _issueTitle(d: KeepRightIssue): string {
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
