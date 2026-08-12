import { EventEmitter } from 'tseep/lib/ee-safe';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiModal` component is a modal dialog: a shaded backdrop containing a `.modal` box.
 * A parent owns the instance, shows it into a parent selection, renders content into
 * `$content`, and hides it again with `close()`. Multiple modals can be stacked — each owns
 * its own backdrop layer, and `UiSystem` tracks the stack so that Esc/Backspace only dismisses
 * the top (non-blocking) modal. Emits a `close` event when dismissed.
 */
export class UiModal extends EventEmitter {
  public context: Context;

  // D3 selections
  public $shaded: D3Selection | null;    // the shaded backdrop layer
  public $modal: D3Selection | null;     // the `.modal` box
  public $content: D3Selection | null;   // the `.content` area (where the owner renders)

  protected _blocking: boolean;


  /**
   * @param context  - Global shared application context
   * @param blocking - if `true`, the modal cannot be dismissed by clicking away or pressing Esc
   */
  public constructor(context: Context, blocking: boolean = false) {
    super();
    this.context = context;
    this._blocking = blocking;

    // D3 selections
    this.$shaded = null;
    this.$modal = null;
    this.$content = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this._moveFocusToFirst = this._moveFocusToFirst.bind(this);
    this._moveFocusToLast = this._moveFocusToLast.bind(this);
  }


  /**
   * @return `true` if this modal blocks interaction (cannot be dismissed by click-away or Esc)
   */
  public get blocking(): boolean {
    return this._blocking;
  }


  /**
   * @return `true` if the modal is currently shown
   */
  public get isShown(): boolean {
    return !!this.$shaded;
  }


  /**
   * Shows the modal.
   * Note that most `render` functions accept a parent selection,
   * this one doesn't need it - the root $container is always the parent.
   */
  public show(): this {
    const context = this.context;
    const ui = context.systems.ui;
    const $container = context.$container;

    if (this.$shaded) return this;   // already showing

    const $shaded = this.$shaded = $container
      .append('div')
      .attr('class', 'shaded')
      .style('opacity', 0);

    const $modal = this.$modal = $shaded
      .append('div')
      .attr('class', 'modal fillL');

    $modal
      .append('input')
      .attr('class', 'keytrap keytrap-first')
      .on('focus.keytrap', this._moveFocusToLast);

    if (!this._blocking) {
      $shaded.on('click.remove-modal', (d3_event: MouseEvent) => {
        if (d3_event.target === $shaded.node()) {
          this.close();
        }
      });

      $modal
        .append('button')
        .attr('class', 'close')
        .on('click', this.close)
        .call(uiIcon('#rapid-icon-close'));
    }

    this.$content = $modal
      .append('div')
      .attr('class', 'content');

    $modal
      .append('input')
      .attr('class', 'keytrap keytrap-last')
      .on('focus.keytrap', this._moveFocusToFirst);

    $shaded
      .transition()
      .style('opacity', 1);

    ui?.pushModal(this);

    return this;
  }


  /**
   * Hides the modal: animates it away, removes its DOM, unregisters it from the stack,
   * and emits a `close` event.
   */
  public close(): void {
    const ui = this.context.systems.ui;
    const $shaded = this.$shaded;
    const $modal = this.$modal;
    if (!$shaded) return;

    ui?.popModal(this);

    $shaded
      .transition()
      .duration(200)
      .style('opacity', 0)
      .remove();

    $modal
      ?.transition()
      .duration(200)
      .style('top', '0px');

    this.$shaded = null;
    this.$modal = null;
    this.$content = null;

    this.emit('close');
  }


  /**
   * Focus-trap handler: moves focus to the first focusable element in the modal.
   * @param d3_event - the triggering focus event (on the trailing keytrap input)
   */
  protected _moveFocusToFirst(d3_event: FocusEvent): void {
    const $modal = this.$modal;
    if (!$modal) return;

    // there are additional rules about what's focusable, but this suits our purposes
    const node = $modal
      .select('a, button, input:not(.keytrap), select, textarea')
      .node() as HTMLElement | null;

    if (node) {
      node.focus();
    } else {
      (d3_event.currentTarget as HTMLElement).blur();
    }
  }


  /**
   * Focus-trap handler: moves focus to the last focusable element in the modal.
   * @param d3_event - the triggering focus event (on the leading keytrap input)
   */
  protected _moveFocusToLast(d3_event: FocusEvent): void {
    const $modal = this.$modal;
    if (!$modal) return;

    const nodes = $modal
      .selectAll('a, button, input:not(.keytrap), select, textarea')
      .nodes() as HTMLElement[];

    if (nodes.length) {
      nodes[nodes.length - 1].focus();
    } else {
      (d3_event.currentTarget as HTMLElement).blur();
    }
  }
}
