import { EventEmitter } from 'tseep/lib/ee-safe';
import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * `UiRapidColorpicker` renders a small popup color swatch,
 * and manages a Modal popup allowing the user to change color.
 *
 * Events available:
 * - 'change':  Fires when the user picks a new color, also closing the popup
 */
export class UiRapidColorpicker extends EventEmitter {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;
  public $colorpicker: D3Selection | null;

  // Child Components
  public Modal: UiModal | null;

  /** The current color as a hexstring, e.g. '#da26d3' */
  protected _color: string;



  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // D3 selections
    this.$parent = null;
    this.$colorpicker = null;

    // Child Components
    this.Modal = null;

    this._color = '#000';

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this.renderPopup = this.renderPopup.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.toggle = this.toggle.bind(this);
  }


  /**
   * Renders the colorpicker button and icon.
   * Accepts a parent selection, and renders the content under it.
   * @param  $parent - parent selection to render into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    let $colorpicker: D3Selection = $parent.selectAll('.colorpicker-label')
      .data([0]);

    // enter
    const $$colorpicker: D3EnterSelection = $colorpicker.enter()
      .append('label')
      .attr('class', 'colorpicker-label')
      .on('click', this.toggle);

    $$colorpicker
      .call(uiIcon('#fas-palette'));

    $$colorpicker
      .append('input')
      .attr('class', 'colorpicker-input');

    // update
    this.$colorpicker = $colorpicker = $colorpicker
      .merge($$colorpicker);

    $colorpicker
      .attr('title', 'choose a color')
      .attr('aria-label', 'choose a color');

    $colorpicker.selectAll('.colorpicker-input')
      .property('value', this._color);

    $colorpicker.selectAll('.icon')
      .style('color', this._color);

//    $colorpicker
//      .selectAll('.rapid-colorpicker-fill')
//      .style('background', currColor)
//      .select('.icon')  // propagate bound data
//      .style('color', this._getBrightness(currColor) > 140.5 ? '#333' : '#fff');
  }


  /**
   * Renders the color-selection popup, showing the color choices.
   * This is an unstyled Modal that opens when the colorpicker is clicked.
   */
  public renderPopup(): void {
    if (!this.Modal || !this.$colorpicker || this.$colorpicker.empty()) return;  // not open

    const context = this.context;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;

    const isRTL = l10n.isRTL;
    const node = this.$colorpicker.node();
    const rect = node.getBoundingClientRect();
    const popWidth = 180;
    const popTop = rect.bottom + 15;
    const popLeft = isRTL ? rect.right - (0.3333 * popWidth)
      : rect.left - (0.6666 * popWidth);
    const arrowLeft = isRTL ? (0.3333 * popWidth) - rect.width + 10
      : (0.6666 * popWidth) + 10;

    const $popup = this.Modal.$content!
      .append('div')
      .attr('class', 'colorpicker-popup')
      .style('opacity', 0)
      .style('width', popWidth + 'px')
      .style('top', popTop + 'px')
      .style('left', popLeft + 'px');

    $popup
      .append('div')
      .attr('class', 'colorpicker-arrow')
      .style('left', arrowLeft + 'px');

    const $content = $popup
      .append('div')
      .attr('class', 'colorpicker-content');

    let $colorlist: D3Selection = $content.selectAll('.colorpicker-colors')
      .data([0]);

    $colorlist = $colorlist.enter()
      .append('div')
      .attr('class', 'colorpicker-colors')
      .merge($colorlist);

    let $colorOptions: D3Selection = $colorlist.selectAll('.colorpicker-option')
      .data(rapid.colors);

    // enter
    const $$colorOptions = $colorOptions.enter()
      .append('div')
      .attr('class', 'colorpicker-option')
      .style('color', (d: string) => d)
      .on('click', (e: PointerEvent, val: string) => {
        this.color = val;
        this.emit('change', val);
        $colorOptions.classed('selected', (d: string) => d === val);
        this.close(e);
      });

    $$colorOptions
      .append('div')
      .attr('class', 'colorpicker-option-fill');

    // update
    $colorOptions = $colorOptions
      .merge($$colorOptions);

    $colorOptions
      .classed('selected', (d: string) => d === this.color);

    $popup
      .transition()
      .style('opacity', 1);
  }


  /**
   * Gets the current color, as a hexstring.
   * @return The current color as a hexstring
   */
  public get color(): string {
    return this._color;
  }
  /**
   * Sets the current color, as a hexstring
   * @param val - a hexstring
   */
  public set color(val: string) {
    if (val === this._color) return;  // no change
    this._color = val;
    this.render();
    this.renderPopup();
  }


  /**
   * Opens the color popup.
   * @param [e] - the triggering event, if any
   */
  public show(e?: Event): void {
    e?.preventDefault();

    if (this.Modal?.isShown) return;  // already showing

    this.Modal = new UiModal(this.context).show();

    // Remove modal class and close button..
    // We want it to act like a modal but not look like one.
    const $modal: D3Selection = this.Modal.$modal!;
    $modal.attr('class', 'colorpicker-wrap');
    $modal.selectAll('.close').remove();
    this.renderPopup();
  }

  /**
   * Closes the color popup.
   * @param [e] - the triggering event, if any
   */
  public close(e?: Event): void {
    e?.preventDefault();

    this.Modal?.close();
    this.Modal = null;
  }


  /**
   * Toggles the color popup
   * @param [e] - the triggering event, if any
   */
  public toggle(e?: Event): void {
    if (this.Modal?.isShown) {
      this.close(e);
    } else {
      this.show(e);
    }
  }


  /**
   * Returns the perceived brightness of the given hex color.
   * https://www.w3.org/TR/AERT#color-contrast
   * https://trendct.org/2016/01/22/how-to-choose-a-label-color-to-contrast-with-background/
   * pass color as a hexstring like '#rgb', '#rgba', '#rrggbb', '#rrggbbaa'  (alpha values are ignored)
   * @param color - a hexstring like '#rgb', '#rgba', '#rrggbb', '#rrggbbaa' (alpha ignored)
   * @return A number representing the perceived brightness
   */
  protected _getBrightness(color: string): number {
    const short = (color.length < 6);
    const r = parseInt(short ? color[1] + color[1] : color[1] + color[2], 16);
    const g = parseInt(short ? color[2] + color[2] : color[3] + color[4], 16);
    const b = parseInt(short ? color[3] + color[3] : color[5] + color[6], 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000;
  }

}
