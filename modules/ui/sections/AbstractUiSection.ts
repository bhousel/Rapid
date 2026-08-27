import { selection } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { UiDisclosure } from '../UiDisclosure.ts';

import type { Context } from '../../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * `AbstractUiSection` is the base class for the "sections" that make up the sidebar
 * inspector and the map panes. A section is a box of content, optionally wrapped in a
 * toggleable disclosure (a heading the user can expand/collapse).
 *
 * Subclasses provide their content by implementing exactly one of:
 * - `renderDisclosureContent($selection)` — content shown inside a `UiDisclosure`
 * - `renderContent($selection)` — content shown on its own (no disclosure)
 *
 * Subclasses may also override `label()` and `shouldDisplay()`, and may set
 * `this._classes` (extra container classes) and `this._disclosureExpandOverride`.
 */
export abstract class AbstractUiSection extends EventEmitter {
  public context: Context;
  public id: string;

  // D3 selections
  public $parent: D3Selection | null;
  public $container: D3Selection | null;

  protected _classes: string;
  protected _disclosure: UiDisclosure | undefined;
  protected _disclosureExpandOverride: boolean | undefined;


  /**
   * @param  context - Global shared application context
   * @param  id      - unique identifier for this section (used for CSS classes)
   */
  public constructor(context: Context, id: string) {
    super();
    this.context = context;
    this.id = id;

    // D3 selections
    this.$parent = null;
    this.$container = null;

    this._classes = '';
    this._disclosure = undefined;
    this._disclosureExpandOverride = undefined;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.renderInner = this.renderInner.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    this.$container = $parent
      .selectAll(`.section-${this.id}`)
      .data([0]);

    // enter
    const $$container: D3EnterSelection = this.$container
      .enter()
      .append('div')
      .attr('class', `section section-${this.id} ${this._classes}`.trim());

    // update
    this.$container = $$container
      .merge(this.$container);

    this.$container
      .call(this.renderInner);
  }


  /**
   * Renders the section's inner content, handling the `shouldDisplay` check and
   * dispatching to either the disclosure content or the plain content.
   */
  public renderInner(): void {
    const $container = this.$container;
    if (!$container) return;  // called too early?

    // The section may be hidden completely if it isn't needed.
    const shouldDisplay = this.shouldDisplay();
    $container.classed('hide', !shouldDisplay);
    if (!shouldDisplay) {
      $container.html('');
      return;
    }

    const self = this as any;

    // Render the content inside a Disclosure
    if (typeof self.renderDisclosureContent === 'function') {
      if (!this._disclosure) {   // create if needed
        this._disclosure = new UiDisclosure(this.context, this.id.replace(/-/g, '_'))
          .label(() => this.label())
          .content(self.renderDisclosureContent.bind(this));
      }

      this._disclosure
        .expandOverride(this._disclosureExpandOverride);

      $container
        .call(this._disclosure.render);

      // Render the content on its own
    } else if (typeof self.renderContent === 'function') {
      $container
        .call(self.renderContent.bind(this));
    }
  }


  /**
   * The section's heading label. Subclasses may override this.
   */
  public label(): string {
    return '';
  }


  /**
   * Whether the section should be displayed at all. Subclasses may override this.
   */
  public shouldDisplay(): boolean {
    return true;
  }
}
