import { timeout as d3_timeout } from 'd3-timer';
import { utilSanitizeHTML } from '../util/sanitize.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Timer } from 'd3-timer';


/** Options controlling a single flash message. */
export interface UiFlashOptions {
  /** How long the flash stays visible, in milliseconds */
  duration: number;
  /** Sprite reference for the icon, e.g. `'#rapid-icon-no'` */
  iconName: string;
  /** Extra class(es) to add to the icon */
  iconClass: string;
  /** The message to show (may contain limited HTML, which is sanitized) */
  label: string;
}


/**
 * The `UiFlash` component briefly slides a transient message over the map footer,
 * then automatically hides it again after a short duration.
 *
 * @example
 * <div class='flash-wrap'>
 *   <div class='flash-content'>
 *     <svg class='flash-icon icon'>…</svg>
 *     <div class='flash-text'>Message</div>
 *   </div>
 * </div>
 */
export class UiFlash {
  public context: Context;

  /** Timer that hides the flash again, or `null` when nothing is showing */
  protected _flashTimer: Timer | null;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this._flashTimer = null;
  }


  /**
   * Shows a flash message, replacing any currently visible one.
   * @param options - the message content and appearance (all fields optional)
   */
  public show(options: Partial<UiFlashOptions> = {}): void {
    const context = this.context;
    const $container: D3Selection = context.container();

    const duration = options.duration ?? 2000;
    const iconName = options.iconName ?? '#rapid-icon-no';
    const iconClass = options.iconClass ?? 'disabled';
    const label = options.label ?? '';

    if (this._flashTimer) {
      this._flashTimer.stop();
    }

    $container.select('.map-footer-wrap')
      .classed('map-footer-hide', true)
      .classed('map-footer-show', false);
    $container.select('.flash-wrap')
      .classed('map-footer-hide', false)
      .classed('map-footer-show', true);

    let $content: D3Selection = $container.select('.flash-wrap').selectAll('.flash-content')
      .data([0]);

    // enter
    const $$content = $content.enter()
      .append('div')
      .attr('class', 'flash-content');

    const $$icon = $$content
      .append('svg')
      .attr('class', 'flash-icon icon')
      .append('g')
      .attr('transform', 'translate(10,10)');

    $$icon
      .append('circle')
      .attr('r', 9);

    $$icon
      .append('use')
      .attr('transform', 'translate(-7,-7)')
      .attr('width', '14')
      .attr('height', '14');

    $$content
      .append('div')
      .attr('class', 'flash-text');

    // update
    $content = $content.merge($$content);

    $content
      .selectAll('.flash-icon')
      .attr('class', 'icon flash-icon ' + (iconClass || ''));

    $content
      .selectAll('.flash-icon use')
      .attr('xlink:href', iconName);

    $content
      .selectAll('.flash-text')
      .attr('class', 'flash-text')
      .html(utilSanitizeHTML(label));    // watch out: labels may still contain html

    this._flashTimer = d3_timeout(() => {
      this._flashTimer = null;
      $container.select('.map-footer-wrap')
        .classed('map-footer-hide', false)
        .classed('map-footer-show', true);
      $container.select('.flash-wrap')
        .classed('map-footer-hide', true)
        .classed('map-footer-show', false);
    }, duration);
  }
}
