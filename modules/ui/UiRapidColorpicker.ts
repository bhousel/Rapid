import { EventEmitter } from 'tseep/lib/ee-safe';
import { select } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { utilKeybinding } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';


/** Minimal interface for the parent modal, which exposes a closeable `close` method */
interface ModalLike {
  close: () => void;
}


/**
 * The `UiRapidColorpicker` renders the small color swatch + popup used to recolor a
 * Rapid dataset. Render it into a selection carrying the dataset datum via
 * `.render($selection)`. Emits `change` (dataset id + color) and `done`.
 */
export class UiRapidColorpicker extends EventEmitter {
  public context: Context;

  protected _parentModal: ModalLike;
  protected _close: () => void;


  /**
   * Creates a new colorpicker bound to the given parent modal.
   * @param context - Global shared application context
   * @param parentModal - the parent modal that the colorpicker popup is shown on top of
   */
  public constructor(context: Context, parentModal: ModalLike) {
    super();
    this.context = context;
    this._parentModal = parentModal;
    this._close = () => {};

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._togglePopup = this._togglePopup.bind(this);
    this._handleClick = this._handleClick.bind(this);
  }


  /**
   * Opens the color popup, or closes it if already open.
   * @param event - the triggering click event
   */
  protected _togglePopup(event: Event): void {
    const context = this.context;
    const $shaded = context.container().selectAll('.shaded');  // container for the existing modal
    if ($shaded.empty()) return;

    if ($shaded.selectAll('.colorpicker-popup').size()) {
      this._close();
    } else {
      this._renderPopup($shaded, event.currentTarget as HTMLElement);
    }
  }


  /**
   * Dismisses the popup if the user clicks outside the colorpicker.
   * @param d3_event - the document click event
   */
  protected _handleClick(d3_event: Event): void {
    const target = d3_event.target as any;
    const className = (target && target.className) || '';
    if (!/colorpicker/i.test(className)) {
      d3_event.stopPropagation();
      d3_event.preventDefault();
      this._close();
    }
  }

  // https://www.w3.org/TR/AERT#color-contrast
  // https://trendct.org/2016/01/22/how-to-choose-a-label-color-to-contrast-with-background/
  // pass color as a hexstring like '#rgb', '#rgba', '#rrggbb', '#rrggbbaa'  (alpha values are ignored)
  /**
   * Returns the perceived brightness of the given hex color.
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


  /**
   * Renders into the given selection.
   * A fresh instance is created and rendered per row/use, so it renders into
   *  `$selection` rather than capturing `$parent`.
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  public render($selection: D3Selection): void {
    // capture the dataset from the parent selection
    const datum = $selection.datum() as RapidDataset | undefined;

    const $colorpicker: D3Selection = $selection.selectAll('.rapid-colorpicker')
      .data(datum ? [datum] : [], d => d.id);   // retain data from parent

    // enter
    const $$colorpicker = $colorpicker.enter()
      .append('div')
      .attr('class', 'rapid-colorpicker')
      .on('click', this._togglePopup);

    $$colorpicker
      .append('div')
      .attr('class', 'rapid-colorpicker-fill')
      .call(uiIcon('#fas-palette'));

    // update
    $colorpicker
      .merge($$colorpicker)
      .selectAll('.rapid-colorpicker-fill')
      .style('background', (d: RapidDataset) => d.color)
      .select('.icon')  // propagate bound data
      .style('color', (d: RapidDataset) => this._getBrightness(d.color) > 140.5 ? '#333' : '#fff');
  }


  /**
   * Renders the color-selection popup anchored to the given node.
   * @param $selection - A d3-selection to the container the popup renders into
   * @param forNode - the swatch node the popup is anchored to (carries the dataset datum)
   */
  protected _renderPopup($selection: D3Selection, forNode: any): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;

    const isRTL = l10n.isRTL;
    const dataset = forNode.__data__;
    const rect = forNode.getBoundingClientRect();
    const popWidth = 180;
    const popTop = rect.bottom + 15;
    const popLeft = isRTL ? rect.right - (0.3333 * popWidth)
      : rect.left - (0.6666 * popWidth);
    const arrowLeft = isRTL ? (0.3333 * popWidth) - rect.width + 10
      : (0.6666 * popWidth) + 10;

    const origClose = this._parentModal.close;
    this._parentModal.close = () => { /* ignore */ };

    const $popup = $selection
      .append('div')
      .attr('class', 'colorpicker-popup')
      .style('opacity', 0)
      .style('width', popWidth + 'px')
      .style('top', popTop + 'px')
      .style('left', popLeft + 'px');

    this._close = () => {
      $popup
        .transition()
        .duration(200)
        .style('opacity', 0)
        .remove();

      this._parentModal.close = origClose;  // restore close handler

      const keybinding = utilKeybinding('modal');
      keybinding.on(['⌫', '⎋'], origClose);
      select(document).call(keybinding);
      select(document).on('click.colorpicker', null);
      this._close = () => {};
      this.emit('done');
    };

    const keybinding = utilKeybinding('modal');
    keybinding.on(['⌫', '⎋'], this._close);
    select(document).call(keybinding);
    select(document).on('click.colorpicker', this._handleClick);

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

    let $colorItems: D3Selection = $colorlist.selectAll('.colorpicker-option')
      .data(rapid.colors);

    // enter
    const $$colorItems = $colorItems.enter()
      .append('div')
      .attr('class', 'colorpicker-option')
      .style('color', (d: string) => d)
      .on('click', (_: Event, selectedColor: string) => {
        this.emit('change', dataset.id, selectedColor);
        $colorItems.classed('selected', (d: string) => d === selectedColor);
      });

    $$colorItems
      .append('div')
      .attr('class', 'colorpicker-option-fill');

    // update
    $colorItems = $colorItems
      .merge($$colorItems);

    $colorItems
      .classed('selected', (d: string) => d === dataset.color);

    $popup
      .transition()
      .style('opacity', 1);
  }
}
