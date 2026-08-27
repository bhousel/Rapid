import { selection } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { uiIcon } from './icon.ts';
import { utilFunctor } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/** A functor: either a value, or a function returning that value. */
type Functor<T> = () => T;

/** A disclosure's content renderer. */
export type UiDisclosureContent = ($selection: D3Selection) => void;


/**
 * `UiDisclosure` component is a toggleable label over collapsible content.
 * Clicking the label toggles the visibility of the content below it:
 *
 * ```
 *   > Label        ⋁ Label
 *                    Content
 * ```
 *
 * A disclosure is owned by a parent component (e.g. a sidebar section), which
 * configures it with the fluent `.label()` / `.content()` setters and renders it
 * into a selection on each render pass. Emits a `toggled` event with the new
 * expanded state whenever the user clicks the label.
 */
export class UiDisclosure extends EventEmitter {
  public context: Context;
  public key: string;

  protected _isExpanded: boolean;        // by default, disclosures start out expanded
  protected _checkPreference: boolean;   // by default, consider user's preference for whether it should be expanded
  protected _expandOverride: boolean | undefined;   // expand can be overrided (for example, raw tag editor when it really needs to be open)

  // D3 selections
  public $parent: D3Selection | null;
  public $hideToggle: D3Selection | null;
  public $wrap: D3Selection | null;

  protected _label: Functor<string>;
  protected _content: UiDisclosureContent;


  /**
   * @param context - Global shared application context
   * @param key     - unique key for this disclosure (used for CSS classes and preference storage)
   */
  public constructor(context: Context, key: string) {
    super();
    this.context = context;
    this.key = key;

    // D3 selections
    this.$parent = null;
    this.$hideToggle = null;
    this.$wrap = null;

    this._isExpanded = true;
    this._checkPreference = true;
    this._expandOverride = undefined;
    this._label = utilFunctor('');
    this._content = () => {};

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._onClick = this._onClick.bind(this);
  }


  /**
   * Gets or sets whether the disclosure is expanded.
   * @param val - the new expanded state, or omit to get the current state
   * @return the current state (getter) or `this` (setter)
   */
  public expanded(): boolean;
  public expanded(val: boolean): this;
  public expanded(val?: boolean): boolean | this {
    if (val === undefined) return this._isExpanded;
    if (this._isExpanded !== val) {
      this._isExpanded = val;
      this.render();
    }
    return this;
  }


  /**
   * Gets or sets whether the user's stored preference overrides the expanded state.
   * @param val - the new value, or omit to get the current value
   * @return the current value (getter) or `this` (setter)
   */
  public checkPreference(): boolean;
  public checkPreference(val: boolean): this;
  public checkPreference(val?: boolean): boolean | this {
    if (val === undefined) return this._checkPreference;
    this._checkPreference = val;
    return this;
  }


  /**
   * Gets or sets a one-time override of the expanded state (ignores stored preference).
   * @param val - the override value, or omit to get the current value
   * @return the current value (getter) or `this` (setter)
   */
  public expandOverride(): boolean | undefined;
  public expandOverride(val: boolean | undefined): this;
  public expandOverride(val?: boolean): boolean | undefined | this {
    if (!arguments.length) return this._expandOverride;
    this._expandOverride = val;
    return this;
  }


  /**
   * Gets or sets the disclosure's label (a string or a function returning a string).
   * @param val - the new label, or omit to get the current label functor
   * @return the current label functor (getter) or `this` (setter)
   */
  public label(): Functor<string>;
  public label(val: string | Functor<string>): this;
  public label(val?: string | Functor<string>): Functor<string> | this {
    if (val === undefined) return this._label;
    this._label = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the function that renders the disclosure's collapsible content.
   * @param val - the new content renderer, or omit to get the current one
   * @return the current content renderer (getter) or `this` (setter)
   */
  public content(): UiDisclosureContent;
  public content(val: UiDisclosureContent): this;
  public content(val?: UiDisclosureContent): UiDisclosureContent | this {
    if (val === undefined) return this._content;
    if (this._content !== val) {
      this._content = val;
      this.render();
    }
    return this;
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
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;   // optional
    const key = this.key;

    if (this._checkPreference) {   // does user's preference override _isExpanded
      const preferExpanded = settings?.get(`ui.disclosure.${key}.expanded`) || 'true';
      this._isExpanded = (preferExpanded === 'true');
    }
    if (this._expandOverride !== undefined) {
      this._isExpanded = this._expandOverride;
    }

    let $hideToggle: D3Selection = $parent.selectAll(`.hide-toggle-${key}`)
      .data([0]);

    // enter
    const $$hideToggle = $hideToggle.enter()
      .append('a')
      .attr('href', '#')
      .attr('class', `hide-toggle hide-toggle-${key}`)
      .call(uiIcon('', 'pre-text hide-toggle-icon'));

    $$hideToggle
      .append('span')
      .attr('class', 'hide-toggle-text');

    // update
    $hideToggle = $$hideToggle.merge($hideToggle);
    this.$hideToggle = $hideToggle;

    $hideToggle
      .on('click', this._onClick)
      .classed('expanded', this._isExpanded);

    $hideToggle.selectAll('.hide-toggle-text')
      .text(this._label());

    const isRTL = l10n.isRTL;
    const icon = this._isExpanded ? 'down' : isRTL ? 'backward' : 'forward';
    $hideToggle.selectAll('.hide-toggle-icon > use')
      .attr('xlink:href', `#rapid-icon-${icon}`);


    let $wrap: D3Selection = $parent.selectAll('.disclosure-wrap')
      .data([0]);

    // enter/update
    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `disclosure-wrap disclosure-wrap-${key}`)
      .merge($wrap)
      .classed('hide', !this._isExpanded);
    this.$wrap = $wrap;

    if (this._isExpanded) {
      $wrap.call(this._content);
    }
  }


  /**
   * Handles a click on the toggle label: flips the expanded state, updates the
   * stored preference (unless overridden), animates the content, and emits `toggled`.
   * @param e - the triggering click event
   */
  protected _onClick(e: PointerEvent): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;   // optional
    const key = this.key;

    e.preventDefault();
    this._isExpanded = !this._isExpanded;

    // Only update the expanded preference if it's not been overrided
    if (this._checkPreference && this._expandOverride === undefined) {
      settings?.set(`ui.disclosure.${key}.expanded`, String(this._isExpanded));
    }
    this._expandOverride = undefined;  // reset this flag here, as the user has interacted with it

    const $hideToggle = this.$hideToggle;
    const $wrap = this.$wrap;
    if (!$hideToggle || !$wrap) return;

    $hideToggle
      .classed('expanded', this._isExpanded);

    const isRTL = l10n.isRTL;
    const icon = this._isExpanded ? 'down' : isRTL ? 'backward' : 'forward';
    $hideToggle.selectAll('.hide-toggle-icon > use')
      .attr('xlink:href', `#rapid-icon-${icon}`);

    $wrap
      .style('opacity', this._isExpanded ? 0 : 1)
      .classed('hide', false)
      .transition()
      .style('opacity', this._isExpanded ? 1 : 0)
      .on('end', () => {
        $wrap
          .classed('hide', !this._isExpanded)
          .style('opacity', null);
      });

    if (this._isExpanded) {
      $wrap.call(this._content);
    }

    this.emit('toggled', this._isExpanded);
  }
}
