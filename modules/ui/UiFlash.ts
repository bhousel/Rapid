import { utilSanitizeHTML } from '../util/sanitize.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


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
  protected _isShowing: boolean;
  /** If no SchedulerSystem, we can fallback to using `setTimeout/clearTimeout` */
  protected _handle: ReturnType<typeof globalThis.setTimeout > | null;



  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this._isShowing = false;
    this._handle = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.hide = this.hide.bind(this);
    this.show = this.show.bind(this);
  }


  /**
   * Shows a flash message, replacing any currently visible one.
   * i.e. hide the footer, show the flash
   * @param options - the message content and appearance (all fields optional)
   */
  public show(options: Partial<UiFlashOptions> = {}): void {
    const context = this.context;
    const scheduler = context.systems.scheduler;
    const $container = context.$container;

    const duration = options.duration ?? 2000;
    const iconName = options.iconName ?? '#rapid-icon-no';
    const iconClass = options.iconClass ?? 'disabled';
    const label = options.label ?? '';
    const workID = 'ui-flash-timer' as WorkID;

    if (this._isShowing) {
      scheduler?.cancel(workID);
      if (this._handle) {
        globalThis.clearTimeout(this._handle);
      }
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
    const $$content: D3EnterSelection = $content.enter()
      .append('div')
      .attr('class', 'flash-content');

    const $$icon: D3EnterSelection = $$content
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

    this._isShowing = true;

    // Try to use the SchedulerSystem, but fallback to globalThis.setTimeout if needed.
    if (scheduler) {
      scheduler.setTimeout(workID, this.hide, { ms: duration });
    } else {
      this._handle = globalThis.setTimeout(this.hide, duration);
    }
  }


  /**
   * Hids any flash message
   * i.e. show the footer, hide the flash
   */
  public hide(): void {
    const context = this.context;
    const $container = context.$container;

    this._isShowing = false;
    $container.select('.map-footer-wrap')
      .classed('map-footer-hide', false)
      .classed('map-footer-show', true);
    $container.select('.flash-wrap')
      .classed('map-footer-hide', true)
      .classed('map-footer-show', false);
  }
}
