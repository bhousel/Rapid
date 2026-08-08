import { selection } from 'd3-selection';
import { uiModal } from './modal.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * The `UiLoading` component is a reusable loading modal: a spinner over an optional
 * message that can block interaction with the rest of the UI. A parent owns the
 * instance, configures it with the fluent `.message()` / `.blocking()` setters, shows
 * it by rendering into a parent selection, and hides it again with `.close()`.
 */
export class UiLoading {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;
  /** The shaded-backdrop selection returned by `uiModal`, or an empty selection when hidden */
  public $modal: D3Selection | null;

  protected _message: string;
  protected _blocking: boolean;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // D3 selections
    this.$parent = null;
    this.$modal = null;

    this._message = '';
    this._blocking = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
  }


  /**
   * Gets or sets the message shown in the loading modal.
   * @param val - the new message, or omit to get the current message
   * @return the current message (getter) or `this` (setter)
   */
  public message(): string;
  public message(val: string): this;
  public message(val?: string): string | this {
    if (val === undefined) return this._message;
    this._message = val;
    return this;
  }


  /**
   * Gets or sets whether the modal blocks interaction with the rest of the UI.
   * @param val - the new value, or omit to get the current value
   * @return the current value (getter) or `this` (setter)
   */
  public blocking(): boolean;
  public blocking(val: boolean): this;
  public blocking(val?: boolean): boolean | this {
    if (val === undefined) return this._blocking;
    this._blocking = val;
    return this;
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    // Note we should change this - $parent will always be `context.container()`
    // This is a detail that `uiModal` should just handle though.
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const assets = context.systems.assets!;

    if (!this.$modal) {
      this.$modal = uiModal($parent, this._blocking);
    }

    const $content: D3Selection = this.$modal.select('.content');
    $content.classed('loading-modal', true);

    let $section: D3Selection = $content.selectAll('.modal-section')
      .data([0]);

    // enter
    const $$section: D3EnterSelection = $section
      .enter()
      .append('div')
      .attr('class', 'modal-section fillL');

    $$section
      .append('img')
      .attr('class', 'loader')
      .attr('src', assets.getFileURL('img/loader-white.gif'));

    $$section
      .append('h3')
      .attr('class', 'modal-message');

    // update
    $section = $section.merge($$section);

    $section.selectAll('.modal-message')
      .text(this._message);

    this.$modal.select('button.close')
      .attr('class', 'hide');
  }


  /**
   * Removes the loading modal.
   */
  public close(): void {
    this.$modal?.remove();
    this.$modal = null;
  }


  /**
   * @return `true` if the loading modal is currently shown
   */
  public isShown(): boolean {
    if (!this.$modal) return false;
    return !this.$modal.empty() && !!this.$modal.node()?.parentNode;
  }
}
