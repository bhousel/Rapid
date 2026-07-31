import { select as d3_select } from 'd3-selection';

import { uiDisclosure } from './disclosure.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { UiDisclosure } from './disclosure.js';


/**
 * `AbstractUiSection` is the base class for the "sections" that make up the sidebar
 * inspector and the map panes. A section is a box of content, optionally wrapped in a
 * toggleable disclosure (a heading the user can expand/collapse).
 *
 * Subclasses provide their content by implementing exactly one of:
 *   - `renderDisclosureContent($selection)` — content shown inside a `UiDisclosure`
 *   - `renderContent($selection)` — content shown on its own (no disclosure)
 *
 * Subclasses may also override `label()` and `shouldDisplay()`, and may set
 * `this._classes` (extra container classes) and `this._disclosureExpandOverride`.
 */
export abstract class AbstractUiSection {
  public context: Context;
  public id: string;

  // D3 selections
  public $container: D3Selection;

  protected _classes: string;
  protected _disclosure: UiDisclosure | undefined;
  protected _disclosureExpandOverride: boolean | undefined;

  /**
   * @param  context - Global shared application context
   * @param  id      - unique identifier for this section (used for CSS classes)
   */
  public constructor(context: Context, id: string) {
    this.context = context;
    this.id = id;

    this.$container = d3_select(null);

    this._classes = '';
    this._disclosure = undefined;
    this._disclosureExpandOverride = undefined;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.reRender = this.reRender.bind(this);
    this._renderInner = this._renderInner.bind(this);
  }


  /**
   * The section's heading label. Subclasses override this.
   */
  public label(): string {
    return '';
  }


  /**
   * Whether the section should be displayed at all. Subclasses override this.
   */
  public shouldDisplay(): boolean {
    return true;
  }


  /**
   * Renders the section container into the given parent selection.
   * @param  $selection - A d3-selection to render into
   */
  public render($selection: D3Selection): void {
    this.$container = $selection
      .selectAll(`.section-${this.id}`)
      .data([0]);

    const $$container = this.$container
      .enter()
      .append('div')
      .attr('class', `section section-${this.id} ${this._classes}`.trim());

    this.$container = $$container
      .merge(this.$container);

    this.$container
      .call(this._renderInner);
  }


  /**
   * Re-renders the section's content into the existing container.
   */
  public reRender(): void {
    this.$container
      .call(this._renderInner);
  }


  /**
   * Renders the section's inner content, handling the `shouldDisplay` check and
   * dispatching to either the disclosure content or the plain content.
   */
  protected _renderInner($selection: D3Selection): void {
    const self = this as any;

    // The section may be hidden completely if it isn't needed.
    const shouldDisplay = this.shouldDisplay();
    $selection.classed('hide', !shouldDisplay);
    if (!shouldDisplay) {
      $selection.html('');
      return;
    }

    // Render the content inside a Disclosure
    if (typeof self.renderDisclosureContent === 'function') {
      if (!this._disclosure) {   // create if needed
        this._disclosure = uiDisclosure(this.context, this.id.replace(/-/g, '_'))
          .label(() => this.label())
          .content(self.renderDisclosureContent.bind(this));
      }

      this._disclosure
        .expandOverride(this._disclosureExpandOverride);

      $selection
        .call(this._disclosure);

    // Render the content on its own
    } else if (typeof self.renderContent === 'function') {
      $selection
        .call(self.renderContent.bind(this));
    }
  }
}
